#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { parseArgs, readJson, writeJson } = require("./core");
const { loadAdapter } = require("./adapters");
const legacyV1Adapter = require("./adapters/legacy-v1");

const PUBLIC_FILES = Object.freeze({
  timeline: "timeline.jsonl",
  chat: "chat.log",
  "final-state": "final-state.log"
});
const PLAYER_FILES = Object.freeze({
  observation: "observations.jsonl",
  decision: "decisions.jsonl",
  console: "console.jsonl"
});
const COMMUNICATION_INTENTS = new Set([
  "evidence_sharing",
  "selective_disclosure",
  "deceptive_claim",
  "strategic_silence",
  "adaptive"
]);
const COMMON_TIMING_INTENTS = new Set(["act_now", "wait"]);
const COMMON_PUBLIC_FIELDS = ["at", "writerMonotonicMs", "writerOrder", "sequence", "type"];
const PUBLIC_TIMELINE_FIELDS = Object.freeze({
  run_initialized: ["runId", "game", "playerCount", "gamesToPlay", "testPurpose", "speed"],
  product_test: ["command", "passed", "gitHead", "productSourceSha256", "sourceTreeDirty"],
  server_capability: ["endpoint", "status", "response", "serverManagement"],
  agent_provenance: ["mode", "forkTurns", "browserAccess", "projectAccess", "players"],
  identity_check: ["passed", "roomCode", "playerNames", "reload"],
  journey_started: ["gameIndex", "journeyId", "userPerspective"],
  checkpoint_result: ["gameIndex", "checkpointId", "passed", "source", "evidenceRefs", "notes"],
  journey_completed: ["gameIndex", "journeyId", "requirementIds", "source", "evidenceRefs", "summary"],
  phase_observed: ["gameIndex", "phaseId", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
  action_observed: ["gameIndex", "playerId", "actionId", "targetIds", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
  terminal_visible: ["gameIndex", "terminalId", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
  result_detail: ["gameIndex", "outcomeId", "summary", "result", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
  criterion_result: ["gameIndex", "criterionId", "passed", "source", "evidenceRefs", "notes"],
  adapter_checkpoint: ["gameIndex", "checkpointId", "status", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds", "data"],
  usability_observation: ["gameIndex", "category", "severity", "description", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
  game_started: ["gameIndex", "roomCode", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
  public_observation: ["gameIndex", "phase", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
  isolation_check: ["gameIndex", "playerTabs", "privateUi", "agentContext", "evidenceRefs"],
  resource_cleanup: [
    "policyVersion",
    "status",
    "ownedTabsClosed",
    "ownedContextsClosed",
    "ownedProcessesStopped",
    "ownedServersStopped",
    "isolatedPlayersReleased",
    "temporaryArtifactsRemoved",
    "reusedResourcesPreserved",
    "unresolvedResources"
  ],
  product_build_verified: ["gitHead", "productSourceSha256", "sourceTreeDirty"],
  run_finished: ["status", "productVerdict", "findings", "finishedAt"]
});
const PUBLIC_CHAT_FIELDS = Object.freeze({
  identity_message: ["playerId", "playerName", "message", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
  message: ["gameIndex", "phase", "observationId", "playerId", "playerName", "message", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"]
});
const PUBLIC_FINAL_STATE_FIELDS = Object.freeze(["at", "writerMonotonicMs", "writerOrder", "gameIndex", "playerId", "normalizedResult", "tabIndex"]);
const FORBIDDEN_PUBLIC_KEYS = new Set([
  "privatefacts",
  "privaterationale",
  "ownmemory",
  "privateinfo",
  "privaterole",
  "ownrole",
  "secret",
  "secrets",
  "nightresult",
  "rolecard",
  "hiddencard",
  "hiddenfacts",
  "role",
  "roles",
  "facts",
  "finalroles",
  "centercards",
  "nighthistory",
  "screenshot",
  "screenshots",
  "image",
  "images",
  "imagedata",
  "imagebytes"
]);

function normalizedKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasImageMagicBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return true;
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP") return true;
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString("ascii") === "BM") return true;
  if (buffer.length >= 4 && (buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00]))
    || buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])))) return true;
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brands = buffer.subarray(8, Math.min(buffer.length, 64)).toString("ascii");
    if (/(?:avif|avis|heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(brands)) return true;
  }
  return /^\s*<svg(?:\s|>)/i.test(buffer.subarray(0, 4096).toString("utf8"));
}

function containsEncodedImageString(value) {
  const text = String(value || "");
  if (/data\s*:\s*image\//i.test(text) || /<svg(?:\s|>)/i.test(text)) return true;
  const candidates = text.match(/[A-Za-z0-9+/]{16,}={0,2}/g) || [];
  const compact = text.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/]{16,}={0,2}$/.test(compact)) candidates.push(compact);
  return candidates.some((candidate) => {
    try {
      return hasImageMagicBuffer(Buffer.from(candidate, "base64"));
    } catch (_error) {
      return false;
    }
  });
}

function withWriterLock(runDir, callback, options = {}) {
  const lockPath = path.join(path.resolve(runDir), "writer.lock");
  const timeoutMs = Number(options.timeoutMs || 10000);
  const deadline = Date.now() + timeoutMs;
  let descriptor;
  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(lockPath, "wx");
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), "utf8");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        let alive = true;
        try { process.kill(Number(owner.pid), 0); } catch (probeError) { alive = probeError.code === "EPERM"; }
        if (!alive) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch (_lockReadError) {
        // A newly created lock can be briefly empty; wait for its owner to populate it.
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting for the Run evidence writer lock.");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return callback();
  } finally {
    try { fs.closeSync(descriptor); } catch (_error) { /* already closed */ }
    try { fs.unlinkSync(lockPath); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function unexpectedPublicKeys(kind, event, options = {}) {
  let allowed;
  if (kind === "timeline") {
    const timelineFields = {
      ...PUBLIC_TIMELINE_FIELDS,
      ...(options.publicTimelineFields || {})
    };
    const fields = timelineFields[event?.type];
    if (!fields) return [`unknown timeline type: ${event?.type || "(missing)"}`];
    allowed = new Set([...COMMON_PUBLIC_FIELDS, ...fields]);
  } else if (kind === "chat") {
    const fields = PUBLIC_CHAT_FIELDS[event?.type];
    if (!fields) return [`unknown chat type: ${event?.type || "(missing)"}`];
    allowed = new Set([...COMMON_PUBLIC_FIELDS, ...fields]);
  } else if (kind === "final-state") {
    allowed = new Set(PUBLIC_FINAL_STATE_FIELDS);
  } else {
    return [`unknown public kind: ${kind}`];
  }
  return Object.keys(event || {}).filter((key) => !allowed.has(key));
}

function containsPrivateUiMarker(value) {
  if (typeof value === "string") {
    return /\b(?:private|secret|your|own)\s+(?:role|card|night result|information)\b|私人角色|秘密角色|你的角色|自己的角色|夜間結果|私密資訊/i.test(value);
  }
  if (Array.isArray(value)) return value.some(containsPrivateUiMarker);
  if (value && typeof value === "object") return Object.values(value).some(containsPrivateUiMarker);
  return false;
}

function containsForbiddenPublicKey(value, options = {}) {
  const allowedKeys = options.allowedKeys || new Set();
  if (typeof value === "string" && containsEncodedImageString(value)) {
    return "embedded_image";
  }
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = containsForbiddenPublicKey(item, options);
      if (found) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (FORBIDDEN_PUBLIC_KEYS.has(normalized) && !allowedKeys.has(normalized)) return key;
    const found = containsForbiddenPublicKey(child, options);
    if (found) return found;
  }
  return null;
}

function requiredArray(event, key) {
  if (!Array.isArray(event[key])) throw new Error(`${key} 必須是陣列。`);
}

function validateFactProvenance(event, playerId) {
  for (const key of ["publicFacts", "privateFacts"]) {
    event[key].forEach((fact, index) => {
      if (!fact || typeof fact !== "object" || Array.isArray(fact)) {
        throw new Error(`${key}[${index}] must be a provenance object.`);
      }
      if (!String(fact.text || "").trim() || !String(fact.evidenceId || "").trim()) {
        throw new Error(`${key}[${index}] requires text and evidenceId.`);
      }
      if (key === "publicFacts") {
        if (fact.visibility !== "public" || !["visible_dom", "public_chat"].includes(fact.source)) {
          throw new Error(`${key}[${index}] requires public visibility and a visible_dom/public_chat source.`);
        }
      } else if (fact.visibility !== "private" || fact.source !== "visible_dom" || fact.sourcePlayerId !== playerId) {
        throw new Error(`${key}[${index}] must come from the same player's private visible DOM.`);
      }
    });
  }
  event.ownMemory.forEach((memory, index) => {
    if (!memory || typeof memory !== "object" || Array.isArray(memory)
      || !String(memory.text || "").trim() || !String(memory.sourceObservationId || "").trim()) {
      throw new Error(`ownMemory[${index}] requires text and sourceObservationId.`);
    }
  });
}

function validatePlayerEvent(kind, event, options = {}) {
  if (kind === "observation") {
    if (!String(event.observationId || "")) throw new Error("Observation 缺少 observationId。");
    if (!Number.isInteger(event.gameIndex) || event.gameIndex < 1) throw new Error("Observation 缺少合法 gameIndex。");
    if (!String(event.phase || "")) throw new Error("Observation 缺少 phase。");
    ["publicFacts", "privateFacts", "legalActions", "ownMemory"].forEach((key) => requiredArray(event, key));
    if (options.strictProvenance) validateFactProvenance(event, options.playerId);
  }
  if (kind === "decision") {
    if (!String(event.observationId || "")) throw new Error("Decision 缺少 observationId。");
    if (!String(event.action || "")) throw new Error("Decision 缺少 action。");
    ["targets", "evidenceRefs"].forEach((key) => requiredArray(event, key));
    if (event.communicationIntent !== undefined
      && !COMMUNICATION_INTENTS.has(String(event.communicationIntent))) {
      throw new Error("Decision communicationIntent is invalid.");
    }
    const timingIntents = new Set([...COMMON_TIMING_INTENTS, ...(options.adapter?.timingIntents || [])]);
    if (event.timingIntent !== undefined && !timingIntents.has(String(event.timingIntent))) {
      throw new Error("Decision timingIntent is invalid.");
    }
  }
  if (typeof options.adapter?.validatePlayerEvent === "function") {
    const adapterErrors = [];
    options.adapter.validatePlayerEvent(kind, event, {
      playerId: options.playerId,
      config: options.config,
      run: options.run
    }, adapterErrors);
    if (adapterErrors.length) throw new Error(`Adapter player-event validation failed: ${adapterErrors.join(" ")}`);
  }
}

function eventFromArgs(args) {
  if (args.json) return JSON.parse(args.json);
  if (args["json-base64"]) return JSON.parse(Buffer.from(args["json-base64"], "base64").toString("utf8"));
  if (args.input) return readJson(path.resolve(args.input));
  if (!process.stdin.isTTY) {
    const text = fs.readFileSync(0, "utf8").trim();
    if (text) return JSON.parse(text);
  }
  throw new Error("請使用 --json、--json-base64、--input，或由 stdin 提供事件 JSON。");
}

function appendEventUnlocked({ runDir, scope, kind, playerId, event, allowFinalized = false }) {
  const resolvedRun = path.resolve(runDir);
  const runPath = path.join(resolvedRun, "run.json");
  if (!fs.existsSync(runPath)) throw new Error("找不到 Run 的 run.json。");
  const run = readJson(runPath);
  const finalized = ["complete", "incomplete", "aborted"].includes(String(run.status || ""));
  const internalFinish = allowFinalized && scope === "public" && kind === "timeline" && event?.type === "run_finished";
  if (finalized && !internalFinish) throw new Error(`Run 已經 ${run.status}，禁止回填證據。`);
  const configPath = path.join(resolvedRun, "config.resolved.json");
  const config = fs.existsSync(configPath) ? readJson(configPath) : null;
  const strictProvenance = Object.hasOwn(config || {}, "testPurpose");
  const adapter = !strictProvenance
    ? null
    : String(config?.schemaVersion || "") === "1.1" && config?.adapter?.module
      ? loadAdapter({ adapterModule: config.adapter.module })
      : legacyV1Adapter;
  const pendingFinalizationPath = path.join(resolvedRun, "finalization-pending.json");
  if (strictProvenance && fs.existsSync(pendingFinalizationPath) && !internalFinish) {
    throw new Error("Run finalization is pending; regular evidence writes are blocked.");
  }
  const writerStatePath = path.join(resolvedRun, "writer-state.json");
  const writerState = strictProvenance && fs.existsSync(writerStatePath) ? readJson(writerStatePath) : null;
  if (strictProvenance && (!Number.isInteger(writerState?.nextOrder) || writerState.nextOrder < 2)) {
    throw new Error("Strict-contract Run is missing a valid writer-state.json.");
  }
  if (strictProvenance && event.at !== undefined && !internalFinish) {
    throw new Error("Strict-contract evidence timestamps are assigned by the writer and cannot be supplied by the caller.");
  }
  const value = strictProvenance
    ? {
      ...event,
      at: internalFinish ? (event.at || new Date().toISOString()) : new Date().toISOString(),
      writerMonotonicMs: Math.round(os.uptime() * 1000),
      writerOrder: writerState.nextOrder
    }
    : { at: event.at || new Date().toISOString(), ...event };
  let target;
  if (scope === "public") {
    const file = PUBLIC_FILES[kind];
    if (!file) throw new Error("公開 kind 必須是 timeline、chat 或 final-state。");
    if (strictProvenance) {
      const unexpected = unexpectedPublicKeys(kind, value, {
        publicTimelineFields: adapter?.publicTimelineFields
      });
      if (unexpected.length) throw new Error(`Strict public event has unexpected fields: ${unexpected.join(", ")}`);
      if (typeof adapter?.validatePublicEvent === "function") {
        const adapterErrors = [];
        adapter.validatePublicEvent(kind, value, { config, run, runDir: resolvedRun }, adapterErrors);
        if (adapterErrors.length) throw new Error(`Adapter public-event validation failed: ${adapterErrors.join(" ")}`);
      }
    }
    const postTerminalTypes = new Set(["result_detail", ...(adapter?.postTerminalEventTypes || [])]);
    const postSettlement = kind === "final-state"
      || (kind === "timeline" && postTerminalTypes.has(value.type));
    if (strictProvenance && kind !== "chat" && !postSettlement && containsPrivateUiMarker(value)) {
      throw new Error("Pre-settlement public event appears to contain a private-role marker.");
    }
    if (strictProvenance && postSettlement) {
      const timelinePath = path.join(resolvedRun, "public", "timeline.jsonl");
      const timeline = fs.existsSync(timelinePath)
        ? fs.readFileSync(timelinePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
        : [];
      const terminalMarkerTypes = new Set(["terminal_visible", ...(adapter?.visibleTerminalMarkerTypes || [])]);
      const marker = timeline.find((item) => terminalMarkerTypes.has(item.type)
        && item.gameIndex === value.gameIndex
        && item.source === "visible_dom");
      if (!marker) throw new Error(`Game ${value.gameIndex} result data requires a prior visible settlement marker or terminal marker.`);
    }
    const allowedKeys = postSettlement
      ? new Set(adapter?.resultDisclosureKeys || [])
      : new Set();
    const forbidden = containsForbiddenPublicKey(value, { allowedKeys });
    if (forbidden) throw new Error(`公開事件不得包含 ${forbidden}。`);
    target = path.join(resolvedRun, "public", file);
    if (kind === "timeline") {
      const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8").split(/\r?\n/).filter(Boolean).length : 0;
      value.sequence = existing + 1;
    }
  } else if (scope === "player") {
    const file = PLAYER_FILES[kind];
    if (!file) throw new Error("玩家 kind 必須是 observation、decision 或 console。");
    if (!playerId) throw new Error("玩家事件必須提供 --player。");
    const configuredIds = new Set((config?.players || []).map((player) => String(player.id)));
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(String(playerId)) || !configuredIds.has(String(playerId))) {
      throw new Error(`Player ${playerId} is not a configured Run participant.`);
    }
    const playersRoot = path.resolve(resolvedRun, "players");
    const playerRoot = path.resolve(playersRoot, String(playerId));
    target = path.resolve(playerRoot, file);
    if (path.dirname(target) !== playerRoot || !playerRoot.startsWith(`${playersRoot}${path.sep}`)) {
      throw new Error(`Player ${playerId} log destination escapes the Run players directory.`);
    }
    if (!fs.existsSync(playerRoot)) throw new Error(`找不到玩家目錄：${playerId}`);
    validatePlayerEvent(kind, value, {
      playerId,
      strictProvenance,
      adapter,
      config,
      run
    });
  } else {
    throw new Error("scope 必須是 public 或 player。");
  }
  if (strictProvenance) writeJson(writerStatePath, { nextOrder: writerState.nextOrder + 1 });
  fs.appendFileSync(target, `${JSON.stringify(value)}\n`, "utf8");
  return { target, event: value };
}

function appendEvent(args) {
  const resolvedRun = path.resolve(args.runDir);
  const configPath = path.join(resolvedRun, "config.resolved.json");
  const config = fs.existsSync(configPath) ? readJson(configPath) : null;
  if (!Object.hasOwn(config || {}, "testPurpose")) return appendEventUnlocked(args);
  return withWriterLock(resolvedRun, () => appendEventUnlocked(args));
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.run || !args.scope || !args.kind) {
    throw new Error("用法：node append-event.js --run <run-dir> --scope <public|player> --kind <kind> [--player P1] (--json <json> | --json-base64 <base64>)");
  }
  const result = appendEvent({
    runDir: args.run,
    scope: args.scope,
    kind: args.kind,
    playerId: args.player,
    event: eventFromArgs(args)
  });
  process.stdout.write(`${JSON.stringify({ appended: true, target: result.target })}\n`);
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  PUBLIC_FILES,
  PLAYER_FILES,
  FORBIDDEN_PUBLIC_KEYS,
  PUBLIC_TIMELINE_FIELDS,
  PUBLIC_CHAT_FIELDS,
  hasImageMagicBuffer,
  containsEncodedImageString,
  containsForbiddenPublicKey,
  containsPrivateUiMarker,
  unexpectedPublicKeys,
  withWriterLock,
  appendEvent,
  main
};
