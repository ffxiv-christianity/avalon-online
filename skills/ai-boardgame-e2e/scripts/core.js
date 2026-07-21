"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { loadAdapter, resolveGenericPurpose } = require("./adapters");
const legacyV1Adapter = require("./adapters/legacy-v1");

const SKILL_ROOT = path.resolve(__dirname, "..");
const CATALOG_PATH = path.join(SKILL_ROOT, "references", "game-catalog.json");
const DEFAULT_ARTIFACT_ROOT = "D:\\Codex\\avalon-online\\tests\\AI_E2E";
const RESOURCE_LIFECYCLE_POLICY = Object.freeze({
  policyVersion: "1.0",
  cleanupAfterRun: true
});
const PLAYER_STYLES = Object.freeze([
  "evidence_first",
  "social_persuasion",
  "risk_tolerant_contrarian"
]);
const COMMUNICATION_BEHAVIORS = Object.freeze([
  "evidence_sharing",
  "selective_disclosure",
  "deceptive_claim",
  "strategic_silence",
  "adaptive"
]);
const BEHAVIOR_MIXES = Object.freeze({
  cooperative: Object.freeze(["evidence_sharing"]),
  balanced: Object.freeze([
    "evidence_sharing",
    "selective_disclosure",
    "deceptive_claim",
    "strategic_silence",
    "adaptive"
  ]),
  adversarial: Object.freeze([
    "deceptive_claim",
    "strategic_silence",
    "selective_disclosure",
    "deceptive_claim",
    "adaptive"
  ])
});
const PLAYER_NAMES = Object.freeze(["Ada", "Ben", "Cleo", "Dara", "Eli", "Faye", "Gus", "Hana", "Ivo", "June"]);
const SPEED_PRESETS = Object.freeze({
  watch: Object.freeze({ operationDelayMs: 800, pollIntervalMs: 250, serverTimeScale: 1, narration: "all_public" }),
  fast: Object.freeze({ operationDelayMs: 0, pollIntervalMs: 100, serverTimeScale: 1, narration: "milestones" }),
  accelerated: Object.freeze({ operationDelayMs: 0, pollIntervalMs: 100, serverTimeScale: 0.1, narration: "milestones" })
});
const NARRATION_MODES = new Set(["all_public", "milestones", "none"]);
const RECONNECT_MODES = new Set(["none", "lobby_reload", "in_game_reload"]);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value, options = {}) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (options.exclusive) {
    fs.writeFileSync(filePath, text, { encoding: "utf8", flag: "wx" });
    return;
  }
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  try {
    fs.writeFileSync(temporaryPath, text, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function catalog() {
  return readJson(CATALOG_PATH);
}

function resolveResourceLifecycle(value, errors) {
  if (value !== undefined) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push("resourceLifecycle must be the fixed Skill policy object.");
    } else {
      const unexpected = Object.keys(value).filter((key) => !["policyVersion", "cleanupAfterRun"].includes(key));
      if (unexpected.length) errors.push(`resourceLifecycle has unsupported fields: ${unexpected.join(", ")}.`);
      if (value.policyVersion !== RESOURCE_LIFECYCLE_POLICY.policyVersion || value.cleanupAfterRun !== true) {
        errors.push("resourceLifecycle is mandatory and cannot disable cleanupAfterRun.");
      }
    }
  }
  return { ...RESOURCE_LIFECYCLE_POLICY };
}

function canonicalGame(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const aliases = {
    onenightwolf: "onenightwolf",
    one_night_wolf: "onenightwolf",
    avalon: "avalon",
    criminaldance: "criminaldance",
    loveletter: "loveletter",
    gangsi: "gangsi"
  };
  return aliases[key] || key;
}

function isLocalUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch (_error) {
    return false;
  }
}

function integer(value, label, min, max, errors, defaultValue) {
  const resolved = value === undefined ? defaultValue : Number(value);
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    errors.push(`${label} 必須是 ${min}～${max} 的整數。`);
  }
  return resolved;
}

function numberInRange(value, label, min, max, errors, defaultValue) {
  const resolved = value === undefined ? defaultValue : Number(value);
  if (!Number.isFinite(resolved) || resolved < min || resolved > max) {
    errors.push(`${label} 必須是 ${min}～${max} 的數值。`);
  }
  return resolved;
}

function resolveSpeed(value, entryUrl, errors) {
  const requested = value && typeof value === "object" ? value : {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("speed must be an object with an explicit profile.");
  } else if (!Object.hasOwn(value, "profile") || !String(value.profile || "").trim()) {
    errors.push("speed.profile is required.");
  }
  const profile = String(requested.profile || "watch");
  let resolved;
  if (SPEED_PRESETS[profile]) {
    resolved = { profile, ...SPEED_PRESETS[profile] };
  } else if (profile === "custom") {
    resolved = {
      profile,
      operationDelayMs: integer(requested.operationDelayMs, "speed.operationDelayMs", 0, 3000, errors, 0),
      pollIntervalMs: integer(requested.pollIntervalMs, "speed.pollIntervalMs", 50, 1000, errors, 100),
      serverTimeScale: numberInRange(requested.serverTimeScale, "speed.serverTimeScale", 0.1, 1, errors, 1),
      narration: String(requested.narration || "milestones")
    };
    if (!NARRATION_MODES.has(resolved.narration)) errors.push("speed.narration 不合法。");
  } else {
    errors.push("speed.profile 必須是 watch、fast、accelerated 或 custom。");
    resolved = { profile: "watch", ...SPEED_PRESETS.watch };
  }
  if (resolved.serverTimeScale < 1 && !isLocalUrl(entryUrl)) {
    errors.push("Server 加速只允許 localhost、127.0.0.1 或 ::1。");
  }
  resolved.timingFidelity = resolved.serverTimeScale < 1 ? "accelerated_waits" : "production";
  return resolved;
}

function resolvePlayers(value, playerCount, errors) {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) {
    return Array.from({ length: playerCount }, (_unused, index) => ({
      id: `P${index + 1}`,
      name: `P${index + 1}-${PLAYER_NAMES[index] || `Player${index + 1}`}`,
      style: PLAYER_STYLES[index % PLAYER_STYLES.length]
    }));
  }
  if (!Array.isArray(value)) {
    errors.push("players 必須是陣列。");
    return [];
  }
  if (value.length !== playerCount) errors.push("players 數量必須等於 playerCount。");
  const players = value.map((player, index) => ({
    id: String(player?.id || `P${index + 1}`).trim(),
    name: String(player?.name || "").trim(),
    style: String(player?.style || PLAYER_STYLES[index % PLAYER_STYLES.length]).trim()
  }));
  if (players.some((player) => !player.id || !player.name || !player.style)) errors.push("每位玩家都必須有 id、name 與 style。");
  if (new Set(players.map((player) => player.id)).size !== players.length) errors.push("玩家 id 不得重複。");
  if (new Set(players.map((player) => player.name.toLocaleLowerCase())).size !== players.length) errors.push("玩家 name 不得重複。");
  return players;
}

function resolvePlayersWithBehavior(value, playerCount, errors, behaviorMix) {
  const behaviorCycle = BEHAVIOR_MIXES[behaviorMix] || BEHAVIOR_MIXES.balanced;
  if (value === undefined || (Array.isArray(value) && value.length === 0)) {
    if (behaviorMix === "custom") errors.push("discussion.behaviorMix is custom, so every player must be provided explicitly.");
    return Array.from({ length: playerCount }, (_unused, index) => ({
      id: `P${index + 1}`,
      name: `P${index + 1}-${PLAYER_NAMES[index] || `Player${index + 1}`}`,
      style: PLAYER_STYLES[index % PLAYER_STYLES.length],
      communicationBehavior: behaviorCycle[index % behaviorCycle.length]
    }));
  }
  if (!Array.isArray(value)) {
    errors.push("players must be an array.");
    return [];
  }
  if (value.length !== playerCount) errors.push("players length must equal playerCount.");
  const players = value.map((player, index) => {
    const suppliedBehavior = String(player?.communicationBehavior || "").trim();
    if (behaviorMix === "custom" && !suppliedBehavior) {
      errors.push(`players[${index}].communicationBehavior is required for a custom behavior mix.`);
    }
    return {
      id: String(player?.id || `P${index + 1}`).trim(),
      name: String(player?.name || "").trim(),
      style: String(player?.style || PLAYER_STYLES[index % PLAYER_STYLES.length]).trim(),
      communicationBehavior: suppliedBehavior || behaviorCycle[index % behaviorCycle.length]
    };
  });
  if (players.some((player) => !player.id || !player.name || !player.style)) {
    errors.push("Every player requires id, name, and style.");
  }
  players.forEach((player, index) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(player.id)) {
      errors.push(`players[${index}].id must use 1-32 letters, digits, underscores, or hyphens and cannot contain path separators.`);
    }
    if (!COMMUNICATION_BEHAVIORS.includes(player.communicationBehavior)) {
      errors.push(`players[${index}].communicationBehavior is invalid.`);
    }
  });
  if (new Set(players.map((player) => player.id)).size !== players.length) errors.push("Player ids must be unique.");
  if (new Set(players.map((player) => player.name.toLocaleLowerCase())).size !== players.length) errors.push("Player names must be unique.");
  return players;
}

function resolveGenericPlayers(value, playerCount, errors) {
  const supplied = value === undefined || (Array.isArray(value) && value.length === 0)
    ? Array.from({ length: playerCount }, (_unused, index) => ({
      id: `P${index + 1}`,
      name: `P${index + 1}-${PLAYER_NAMES[index] || `Player${index + 1}`}`,
      style: PLAYER_STYLES[index % PLAYER_STYLES.length],
      traits: []
    }))
    : value;
  if (!Array.isArray(supplied)) {
    errors.push("players must be an array.");
    return [];
  }
  if (supplied.length !== playerCount) errors.push("players length must equal playerCount.");
  const players = supplied.map((player, index) => ({
    id: String(player?.id || `P${index + 1}`).trim(),
    name: String(player?.name || "").trim(),
    style: String(player?.style || PLAYER_STYLES[index % PLAYER_STYLES.length]).trim(),
    traits: Array.isArray(player?.traits) ? player.traits.map((item) => String(item).trim()).filter(Boolean) : []
  }));
  players.forEach((player, index) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(player.id)) errors.push(`players[${index}].id is not a safe identifier.`);
    if (!player.name || !player.style) errors.push(`players[${index}] requires name and style.`);
  });
  if (new Set(players.map((player) => player.id)).size !== players.length) errors.push("Player ids must be unique.");
  if (new Set(players.map((player) => player.name.toLocaleLowerCase())).size !== players.length) errors.push("Player names must be unique.");
  return players;
}

function resolveGenericConfig(input, options = {}) {
  const errors = [];
  const registry = catalog();
  const game = canonicalGame(input.game);
  const catalogEntry = registry.games[game];
  if (!catalogEntry) errors.push(`Unknown game: ${game || "(missing)"}.`);
  let adapterModule;
  if (catalogEntry) {
    try { adapterModule = loadAdapter(catalogEntry); } catch (error) { errors.push(error.message); }
  }
  const entryUrl = String(input.entryUrl || catalogEntry?.entryUrl || "");
  if (!entryUrl) errors.push("entryUrl is required.");
  const playerCount = integer(
    input.playerCount,
    "playerCount",
    catalogEntry?.playerCount?.min || 1,
    catalogEntry?.playerCount?.max || 20,
    errors,
    catalogEntry?.playerCount?.min || 1
  );
  const gamesToPlay = integer(input.gamesToPlay, "gamesToPlay", 1, 20, errors, 1);
  const speed = resolveSpeed(input.speed, entryUrl, errors);
  const players = resolveGenericPlayers(input.players, playerCount, errors);
  const interaction = {
    maximumDecisionPasses: integer(input.interaction?.maximumDecisionPasses, "interaction.maximumDecisionPasses", 0, 20, errors, 3),
    allowInaction: input.interaction?.allowInaction !== false,
    userPacing: String(input.interaction?.userPacing || "human_like")
  };
  if (!["human_like", "deliberate", "fast_decisions"].includes(interaction.userPacing)) errors.push("interaction.userPacing is invalid.");
  const context = { game, catalogEntry: catalogEntry || {}, adapter: adapterModule || {}, playerCount, players, speed };
  const gameSettings = typeof adapterModule?.validateSettings === "function"
    ? adapterModule.validateSettings(input.gameSettings, context, errors)
    : (input.gameSettings && typeof input.gameSettings === "object" ? { ...input.gameSettings } : {});
  context.gameSettings = gameSettings;
  const testPurpose = resolveGenericPurpose(input.testPurpose, context, errors);
  const allowExperimental = Boolean(input.allowExperimental);
  const allowDiscovery = Boolean(input.allowDiscovery);
  const certificationCandidate = input.certificationCandidate === true;
  if (input.certificationCandidate !== undefined && typeof input.certificationCandidate !== "boolean") {
    errors.push("certificationCandidate must be a boolean.");
  }
  if (catalogEntry?.status === "planned") {
    if (certificationCandidate) {
      const policy = catalogEntry.certificationCandidate;
      if (policy?.enabled !== true) {
        errors.push(`${catalogEntry.displayName || game} does not declare an enabled certification-candidate policy.`);
      }
      if (testPurpose.approach === "exploratory") {
        errors.push("certificationCandidate requires a formal non-exploratory purpose.");
      }
      if (Array.isArray(policy?.approaches) && !policy.approaches.includes(testPurpose.approach)) {
        errors.push(`certificationCandidate approach ${testPurpose.approach} is outside the Catalog authorization.`);
      }
      if (Array.isArray(policy?.playerCounts) && !policy.playerCounts.includes(playerCount)) {
        errors.push(`certificationCandidate playerCount ${playerCount} is outside the Catalog authorization.`);
      }
      if (Array.isArray(policy?.settings)
        && !policy.settings.some((setting) => stableStringify(setting) === stableStringify(gameSettings))) {
        errors.push("certificationCandidate gameSettings are outside the Catalog authorization.");
      }
      if (allowDiscovery) errors.push("certificationCandidate cannot set allowDiscovery: true.");
    } else if (testPurpose.approach !== "exploratory" || !allowDiscovery) {
      errors.push(`${catalogEntry.displayName || game} has no executable Adapter; set exploratory purpose and allowDiscovery: true to draft one.`);
    }
  } else if (catalogEntry?.status === "experimental" && !allowExperimental && !options.allowUnverified) {
    errors.push(`${catalogEntry.displayName || game} is experimental; set allowExperimental: true.`);
  } else if (certificationCandidate && !options.allowUnverified) {
    errors.push("certificationCandidate is only valid while the Catalog entry remains planned.");
  }
  const evidence = { mode: String(input.evidence?.mode || "logs_only") };
  if (evidence.mode !== "logs_only") errors.push("evidence.mode must be logs_only.");
  if (input.evidence?.screenshots === true) errors.push("Screenshot evidence is forbidden.");
  const reconnect = { mode: String(input.reconnect?.mode || "none") };
  if (!RECONNECT_MODES.has(reconnect.mode)) errors.push("reconnect.mode is invalid.");
  const resourceLifecycle = resolveResourceLifecycle(input.resourceLifecycle, errors);
  const limits = {
    maxInvalidDecisions: integer(input.limits?.maxInvalidDecisions, "limits.maxInvalidDecisions", 1, 10, errors, 3),
    maxDecisionSeconds: integer(input.limits?.maxDecisionSeconds, "limits.maxDecisionSeconds", 10, 600, errors, 120),
    maxMinutesPerGame: integer(input.limits?.maxMinutesPerGame, "limits.maxMinutesPerGame", 1, 300, errors, 30)
  };
  if (input.limits?.maxInGameRounds !== undefined) {
    limits.maxInGameRounds = integer(input.limits.maxInGameRounds, "limits.maxInGameRounds", 1, 1000, errors, undefined);
  }
  const artifactRoot = path.resolve(String(input.artifactRoot || DEFAULT_ARTIFACT_ROOT));
  if (path.parse(artifactRoot).root === artifactRoot) errors.push("artifactRoot cannot be a filesystem root.");
  if (errors.length) {
    const error = new Error(errors.join("\n"));
    error.validationErrors = errors;
    throw error;
  }
  return {
    schemaVersion: "1.1",
    game,
    gameDisplayName: catalogEntry.displayName,
    adapterStatus: catalogEntry.status,
    entryUrl,
    playerCount,
    gamesToPlay,
    gameSettings,
    speed,
    players,
    interaction,
    testPurpose,
    evidence,
    reconnect,
    resourceLifecycle,
    limits,
    allowExperimental,
    allowDiscovery,
    certificationCandidate,
    artifactRoot,
    adapter: {
      id: adapterModule.id,
      contractVersion: adapterModule.contractVersion,
      module: catalogEntry.adapterModule,
      manifest: catalogEntry.manifest || null,
      testCommand: catalogEntry.testCommand,
      scalableWaits: catalogEntry.scalableWaits || [],
      capabilities: catalogEntry.capabilities || {}
    }
  };
}

function resolveConfig(input, options = {}) {
  if (String(input?.schemaVersion || "") === "1.1") return resolveGenericConfig(input, options);
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("設定必須是 JSON 物件。");
  if (String(input.schemaVersion || "") !== "1.0") errors.push("schemaVersion 必須是 1.0。");
  const registry = catalog();
  const game = canonicalGame(input.game);
  const adapter = registry.games[game];
  if (!adapter) errors.push(`未知遊戲：${game || "(空白)"}`);
  const entryUrl = String(input.entryUrl || adapter?.entryUrl || "");
  if (!entryUrl) errors.push("缺少 entryUrl。");
  const playerCount = integer(
    input.playerCount,
    "playerCount",
    adapter?.playerCount?.min || 1,
    adapter?.playerCount?.max || 20,
    errors,
    adapter?.playerCount?.min || 1
  );
  const allowExperimental = Boolean(input.allowExperimental);
  if (adapter?.status === "planned" && !options.allowUnverified) {
    errors.push(`${adapter?.displayName || game} 仍是 planned；此狀態不可執行。`);
  } else if (adapter?.status === "experimental" && !allowExperimental && !options.allowUnverified) {
    errors.push(`${adapter?.displayName || game} 目前是 experimental；若要試跑必須設定 allowExperimental: true。`);
  }
  const gamesToPlay = integer(input.gamesToPlay, "gamesToPlay", 1, 20, errors, 1);
  const legacyContext = { game, playerCount, integer };
  const gameSettings = legacyV1Adapter.validateSettings(game, input.gameSettings, legacyContext, errors);
  const speed = resolveSpeed(input.speed, entryUrl, errors);
  const discussion = {
    maximumPublicPasses: integer(input.discussion?.maximumPublicPasses, "discussion.maximumPublicPasses", 0, 10, errors, 2),
    allowStrategicSilence: input.discussion?.allowStrategicSilence !== false,
    behaviorMix: String(input.discussion?.behaviorMix || "balanced"),
    enforceBehaviorCoverage: input.discussion?.enforceBehaviorCoverage === true
  };
  if (![...Object.keys(BEHAVIOR_MIXES), "custom"].includes(discussion.behaviorMix)) {
    errors.push("discussion.behaviorMix must be cooperative, balanced, adversarial, or custom.");
  }
  const players = resolvePlayersWithBehavior(input.players, playerCount, errors, discussion.behaviorMix);
  if (!discussion.allowStrategicSilence
    && players.some((player) => player.communicationBehavior === "strategic_silence")) {
    errors.push("allowStrategicSilence: false conflicts with a strategic_silence player.");
  }
  const evidence = { mode: String(input.evidence?.mode || "logs_only") };
  const purposeInput = options.allowLegacyPurpose === true && input.testPurpose === undefined
    ? { mode: discussion.enforceBehaviorCoverage === true ? "behavior_matrix" : "natural_play" }
    : input.testPurpose;
  const testPurpose = legacyV1Adapter.resolvePurpose(purposeInput, { ...legacyContext, players, speed }, errors);
  if (testPurpose.mode === "natural_play" && discussion.allowStrategicSilence !== true) {
    errors.push("natural_play must allow strategic silence; it may not force every player to speak.");
  }
  if (testPurpose.mode === "behavior_matrix" && discussion.enforceBehaviorCoverage !== true) {
    errors.push("behavior_matrix requires discussion.enforceBehaviorCoverage: true.");
  }
  if (testPurpose.mode !== "behavior_matrix" && discussion.enforceBehaviorCoverage === true) {
    errors.push("Only behavior_matrix may enforce per-game communication behavior coverage.");
  }
  legacyV1Adapter.validateResolvedPurpose(testPurpose, { ...legacyContext, players, speed }, errors);
  if (evidence.mode !== "logs_only") errors.push("evidence.mode 第一版只支援 logs_only。");
  if (input.evidence?.screenshots === true) errors.push("正式 Skill 禁止 screenshots 證據。");
  const reconnect = { mode: String(input.reconnect?.mode || "none") };
  if (!RECONNECT_MODES.has(reconnect.mode)) errors.push("reconnect.mode 不合法。");
  const limits = {
    maxInvalidDecisions: integer(input.limits?.maxInvalidDecisions, "limits.maxInvalidDecisions", 1, 10, errors, 3),
    maxDecisionSeconds: integer(input.limits?.maxDecisionSeconds, "limits.maxDecisionSeconds", 10, 600, errors, 120),
    maxMinutesPerGame: integer(input.limits?.maxMinutesPerGame, "limits.maxMinutesPerGame", 1, 300, errors, 30)
  };
  const resourceLifecycle = resolveResourceLifecycle(input.resourceLifecycle, errors);
  if (input.limits?.maxInGameRounds !== undefined) {
    limits.maxInGameRounds = integer(input.limits.maxInGameRounds, "limits.maxInGameRounds", 1, 1000, errors, undefined);
  }
  const artifactRoot = path.resolve(String(input.artifactRoot || DEFAULT_ARTIFACT_ROOT));
  if (path.parse(artifactRoot).root === artifactRoot) errors.push("artifactRoot 不得是磁碟根目錄。");
  if (errors.length) {
    const error = new Error(errors.join("\n"));
    error.validationErrors = errors;
    throw error;
  }
  return {
    schemaVersion: "1.0",
    game,
    gameDisplayName: adapter.displayName,
    adapterStatus: adapter.status,
    entryUrl,
    playerCount,
    gamesToPlay,
    gameSettings,
    speed,
    players,
    discussion,
    testPurpose,
    evidence,
    reconnect,
    resourceLifecycle,
    limits,
    allowExperimental,
    artifactRoot,
    adapter: {
      testCommand: adapter.testCommand,
      scalableWaits: adapter.scalableWaits
    }
  };
}

function timestamp(date = new Date()) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0")
  ];
  return parts.join("");
}

function findUniqueRunDir(runsRoot, baseRunId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(baseRunId || ""))
    || [".", ".."].includes(String(baseRunId))) {
    throw new Error("Run ID must use 1-128 letters, digits, dots, underscores, or hyphens and cannot traverse directories.");
  }
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const runId = suffix === 0 ? baseRunId : `${baseRunId}-${suffix + 1}`;
    const runDir = path.join(runsRoot, runId);
    try {
      fs.mkdirSync(runDir, { recursive: false });
      return { runId, runDir };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw new Error("無法建立唯一 Run 目錄。");
}

function initializeRun(resolvedConfig, options = {}) {
  const runsRoot = path.join(resolvedConfig.artifactRoot, "runs");
  fs.mkdirSync(runsRoot, { recursive: true });
  const baseRunId = options.runId || `${timestamp(options.now)}-${resolvedConfig.game}-${resolvedConfig.playerCount}p`;
  const { runId, runDir } = findUniqueRunDir(runsRoot, baseRunId);
  fs.mkdirSync(path.join(runDir, "public"));
  fs.mkdirSync(path.join(runDir, "players"));
  resolvedConfig.players.forEach((player) => {
    const playerDir = path.join(runDir, "players", player.id);
    fs.mkdirSync(playerDir);
    ["observations.jsonl", "decisions.jsonl", "console.jsonl"].forEach((file) => fs.writeFileSync(path.join(playerDir, file), "", "utf8"));
  });
  ["timeline.jsonl", "chat.log", "final-state.log"].forEach((file) => fs.writeFileSync(path.join(runDir, "public", file), "", "utf8"));
  writeJson(path.join(runDir, "config.resolved.json"), resolvedConfig, { exclusive: true });
  if (options.approvedPlan) writeJson(path.join(runDir, "plan.approved.json"), options.approvedPlan, { exclusive: true });
  const now = (options.now || new Date()).toISOString();
  const run = {
    schemaVersion: resolvedConfig.schemaVersion,
    runId,
    status: "initialized",
    startedAt: now,
    finishedAt: null,
    game: resolvedConfig.game,
    playerCount: resolvedConfig.playerCount,
    gamesToPlay: resolvedConfig.gamesToPlay,
    evidenceMode: "logs_only",
    productVerdict: "not_evaluated",
    informationIsolationLevel: "behavioral",
    testPurpose: resolvedConfig.testPurpose,
    resourceLifecycle: resolvedConfig.resourceLifecycle,
    preflightPlan: options.planVerification || null,
    speed: {
      requestedProfile: resolvedConfig.speed.profile,
      operationDelayMs: resolvedConfig.speed.operationDelayMs,
      pollIntervalMs: resolvedConfig.speed.pollIntervalMs,
      serverTimeScale: resolvedConfig.speed.serverTimeScale,
      timingFidelity: resolvedConfig.speed.timingFidelity,
      scalableWaits: resolvedConfig.adapter.scalableWaits,
      serverManagedBySkill: null
    },
    findings: { P0: 0, P1: 0, P2: 0, decisionIsolationFailures: 0 },
    games: []
  };
  writeJson(path.join(runDir, "run.json"), run, { exclusive: true });
  writeJson(path.join(runDir, "writer-state.json"), { nextOrder: 2 }, { exclusive: true });
  fs.appendFileSync(path.join(runDir, "public", "timeline.jsonl"), `${JSON.stringify({
    at: now,
    writerMonotonicMs: Math.round(os.uptime() * 1000),
    writerOrder: 1,
    sequence: 1,
    type: "run_initialized",
    runId,
    game: resolvedConfig.game,
    playerCount: resolvedConfig.playerCount,
    gamesToPlay: resolvedConfig.gamesToPlay,
    testPurpose: resolvedConfig.testPurpose,
    speed: run.speed
  })}\n`, "utf8");
  return { runId, runDir, run };
}

function parseArgs(argv) {
  const result = { positional: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      result.positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

module.exports = {
  SKILL_ROOT,
  CATALOG_PATH,
  DEFAULT_ARTIFACT_ROOT,
  RESOURCE_LIFECYCLE_POLICY,
  PLAYER_STYLES,
  COMMUNICATION_BEHAVIORS,
  BEHAVIOR_MIXES,
  SPEED_PRESETS,
  stableStringify,
  readJson,
  writeJson,
  catalog,
  canonicalGame,
  isLocalUrl,
  resolveConfig,
  timestamp,
  initializeRun,
  parseArgs
};
