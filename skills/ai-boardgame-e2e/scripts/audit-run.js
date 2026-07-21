#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parseArgs, readJson, writeJson, resolveConfig, isLocalUrl } = require("./core");
const { loadAdapter } = require("./adapters");
const { validateCoveragePlan, verifyApprovedPlan } = require("./plan-contract");
const legacyV1Adapter = require("./adapters/legacy-v1");
const {
  containsForbiddenPublicKey,
  containsPrivateUiMarker,
  containsEncodedImageString,
  hasImageMagicBuffer,
  unexpectedPublicKeys
} = require("./append-event");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".svg", ".avif", ".heic", ".heif"]);
const COMMUNICATION_INTENTS = new Set([
  "evidence_sharing",
  "selective_disclosure",
  "deceptive_claim",
  "strategic_silence",
  "adaptive"
]);
const ROOT_LOG_FILES = new Set([
  "audit.json",
  "config.resolved.json",
  "finalization-pending.json",
  "findings.md",
  "plan.approved.json",
  "run.json",
  "summary.md",
  "writer-state.json"
]);
const PUBLIC_LOG_FILES = new Set(["chat.log", "final-state.log", "timeline.jsonl"]);
const PLAYER_LOG_FILES = new Set(["console.jsonl", "decisions.jsonl", "observations.jsonl"]);

function allFiles(root) {
  const result = [];
  if (!fs.existsSync(root)) return result;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else result.push(full);
    });
  }
  return result;
}

function hasImagePayload(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (hasImageMagicBuffer(buffer)) return true;
  const text = buffer.toString("utf8");
  return containsEncodedImageString(text);
}

function isExpectedLogArtifact(root, filePath) {
  const parts = path.relative(root, filePath).split(path.sep);
  if (parts.length === 1) return ROOT_LOG_FILES.has(parts[0]);
  if (parts.length === 2 && parts[0] === "public") return PUBLIC_LOG_FILES.has(parts[1]);
  return parts.length === 3
    && parts[0] === "players"
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(parts[1])
    && PLAYER_LOG_FILES.has(parts[2]);
}

function isUtf8TextFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch (_error) {
    return false;
  }
}

function screenshotDirectories(root) {
  const matches = [];
  const stack = fs.existsSync(root) ? [root] : [];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(current, entry.name);
      if (entry.name.toLowerCase() === "screenshots") matches.push(full);
      stack.push(full);
    }
  }
  return matches;
}

function parseJsonLines(filePath, errors, warnings, options = {}) {
  if (!fs.existsSync(filePath)) {
    if (!options.optional) errors.push(`缺少檔案：${filePath}`);
    return [];
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter((line) => line.trim());
  const values = [];
  lines.forEach((line, index) => {
    try {
      values.push(JSON.parse(line));
    } catch (_error) {
      if (options.allowPlainText) warnings.push(`${path.basename(filePath)} 第 ${index + 1} 行是舊版純文字，未做 JSON 欄位稽核。`);
      else errors.push(`${path.basename(filePath)} 第 ${index + 1} 行不是合法 JSON。`);
    }
  });
  return values;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function timestampMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function monotonicMs(event) {
  const value = Number(event?.writerMonotonicMs);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function writerOrder(event) {
  const value = Number(event?.writerOrder);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function decisionMatchesLegalActions(decision, observation) {
  if (!Array.isArray(observation.legalActions)) return false;
  const action = String(decision.action || "");
  if (observation.legalActions.includes(action)) return true;
  const targets = Array.isArray(decision.targets) ? decision.targets.map(String) : [];
  return targets.length > 0 && observation.legalActions.includes(`${action}:${targets.join("+")}`);
}

function validateEvidenceRef(ref, observation, legacy, errors, warnings, playerId, decisionIndex) {
  const match = /^(publicFacts|privateFacts|legalActions|ownMemory)\[(\d+)\]$/.exec(String(ref));
  if (!match) {
    errors.push(`${playerId} decision ${decisionIndex + 1} 的 evidenceRef 格式不合法：${ref}`);
    return;
  }
  const [, key, rawIndex] = match;
  const index = Number(rawIndex);
  if (!Array.isArray(observation[key])) {
    if (legacy && key === "ownMemory") warnings.push(`${playerId} 舊版 Observation 未保存 ownMemory，無法驗證 ${ref}。`);
    else errors.push(`${playerId} 的 ${observation.observationId} 缺少 ${key}。`);
    return;
  }
  if (index < 0 || index >= observation[key].length) {
    const message = `${playerId} 的 ${observation.observationId} 無法解析舊版引用 ${ref}。`;
    if (legacy) warnings.push(message);
    else errors.push(message);
  }
}

function validateVoteParticipation(purpose, configuredIds, event, gameIndex, errors) {
  if (!event) return;
  const voters = Array.isArray(event.actualVoterIds) ? event.actualVoterIds.map(String) : [];
  const nonVoters = Array.isArray(event.nonVoterIds) ? event.nonVoterIds.map(String) : [];
  const allParticipants = [...voters, ...nonVoters].sort();
  const expectedIds = [...configuredIds].sort();
  if (new Set(allParticipants).size !== expectedIds.length
    || stableStringify(allParticipants) !== stableStringify(expectedIds)) {
    errors.push(`Game ${gameIndex} vote_participation must partition every configured player exactly once.`);
  }
  if (!["all_submitted", "deadline"].includes(event.actualSettlementTrigger)) {
    errors.push(`Game ${gameIndex} vote_participation has invalid actualSettlementTrigger.`);
  }
  if (event.source !== "visible_dom") {
    errors.push(`Game ${gameIndex} vote_participation must come from visible_dom evidence.`);
  }
  if (purpose.mode === "rules_matrix") {
    const expectedVoters = [...(purpose.voterIds || [])].sort();
    if (stableStringify([...voters].sort()) !== stableStringify(expectedVoters)) {
      errors.push(`Game ${gameIndex} rules_matrix voter set differs from testPurpose.voterIds.`);
    }
    if (event.actualSettlementTrigger !== purpose.settlementTrigger) {
      errors.push(`Game ${gameIndex} rules_matrix settlement trigger differs from testPurpose.`);
    }
  }
}

function validateDeadlineEvidence(timeline, config, gameIndex, errors) {
  const starts = timeline.filter((event) => event.type === "discussion_started" && event.gameIndex === gameIndex);
  const reached = timeline.filter((event) => event.type === "deadline_reached" && event.gameIndex === gameIndex);
  if (starts.length !== 1 || reached.length !== 1) {
    errors.push(`Game ${gameIndex} deadline settlement requires exactly one discussion_started and one deadline_reached event.`);
    return;
  }
  const start = starts[0];
  const end = reached[0];
  const configuredSeconds = Number(config?.gameSettings?.discussionSeconds);
  const startAt = timestampMs(start.at);
  const deadlineAt = timestampMs(start.deadlineAt);
  const reachedAt = timestampMs(end.at);
  const startMonotonic = monotonicMs(start);
  const reachedMonotonic = monotonicMs(end);
  const startOrder = writerOrder(start);
  const reachedOrder = writerOrder(end);
  if (start.source !== "visible_dom" || end.source !== "visible_dom") {
    errors.push(`Game ${gameIndex} deadline evidence must come from visible_dom.`);
  }
  if (!Number.isFinite(configuredSeconds) || Number(start.discussionSeconds) !== configuredSeconds) {
    errors.push(`Game ${gameIndex} discussion_started does not match configured discussionSeconds.`);
  }
  if (Number(end.remainingSeconds) > 0 || !Number.isFinite(Number(end.remainingSeconds))) {
    errors.push(`Game ${gameIndex} deadline_reached must show remainingSeconds <= 0.`);
  }
  if (startAt === null || deadlineAt === null || reachedAt === null) {
    errors.push(`Game ${gameIndex} deadline evidence has invalid wall-clock timestamps.`);
    return;
  }
  const toleranceMs = 1000;
  if (deadlineAt - startAt < configuredSeconds * 1000 - toleranceMs
    || Math.abs((deadlineAt - startAt) - configuredSeconds * 1000) > 5000) {
    errors.push(`Game ${gameIndex} visible deadlineAt does not represent the configured real duration.`);
  }
  if (reachedAt < deadlineAt - toleranceMs || reachedAt - startAt < configuredSeconds * 1000 - toleranceMs) {
    errors.push(`Game ${gameIndex} settlement occurred before the real discussion deadline.`);
  }
  if (startMonotonic === null || reachedMonotonic === null
    || reachedMonotonic - startMonotonic < configuredSeconds * 1000 - toleranceMs) {
    errors.push(`Game ${gameIndex} deadline is not proven by the writer monotonic clock.`);
  }
  if (startOrder === null || reachedOrder === null || startOrder >= reachedOrder) {
    errors.push(`Game ${gameIndex} deadline evidence is not strictly ordered by the writer.`);
  }
}

function validateCoverageExecution(timeline, approvedPlan, errors) {
  const coveragePlan = approvedPlan?.coveragePlan || null;
  const coverageEvents = timeline.filter((event) => String(event.type || "").startsWith("coverage_"));
  if (!coveragePlan) {
    if (coverageEvents.length) errors.push("Coverage events require a CoveragePlan bound to plan.approved.json.");
    return;
  }
  if (coveragePlan.status !== "complete") {
    errors.push("The approved CoveragePlan is incomplete; the Run cannot claim checkpoint coverage.");
  }
  const initialEvents = coverageEvents.filter((event) => event.type === "coverage_plan_created" && !event.replanOf);
  if (initialEvents.length !== 1) {
    errors.push("Coverage execution requires exactly one initial coverage_plan_created event.");
    return;
  }
  const initial = initialEvents[0];
  const expectedTargets = [...coveragePlan.targetCheckpointIds].sort();
  const expectedReused = [...coveragePlan.reusedCheckpointIds].sort();
  const expectedPending = [...coveragePlan.pendingCheckpointIds].sort();
  if (initial.planSha256 !== coveragePlan.planSha256
    || stableStringify(initial.coveragePlan) !== stableStringify(coveragePlan)
    || stableStringify([...(initial.targetCheckpointIds || [])].sort()) !== stableStringify(expectedTargets)
    || stableStringify([...(initial.reusedCheckpointIds || [])].sort()) !== stableStringify(expectedReused)
    || stableStringify([...(initial.pendingCheckpointIds || [])].sort()) !== stableStringify(expectedPending)
    || stableStringify(initial.routeIds || []) !== stableStringify(coveragePlan.routes.map((route) => route.routeId))) {
    errors.push("Initial coverage_plan_created event differs from the approved CoveragePlan.");
  }

  let activePlan = null;
  let pendingReplan = null;
  const completedTargets = new Set(expectedReused);
  const startedRoutes = new Map();
  const completedByPlan = new Map();
  for (const event of timeline) {
    if (event.type === "coverage_plan_created") {
      let eventPlan = null;
      try {
        eventPlan = validateCoveragePlan(event.coveragePlan, coveragePlan.game);
      } catch (error) {
        errors.push(`coverage_plan_created contains an invalid CoveragePlan: ${error.message}`);
      }
      if (eventPlan?.status !== "complete") errors.push("coverage_plan_created embedded CoveragePlan is incomplete.");
      if (eventPlan && (event.planSha256 !== eventPlan.planSha256
        || stableStringify(event.routeIds || []) !== stableStringify(eventPlan.routes.map((route) => route.routeId))
        || stableStringify([...(event.pendingCheckpointIds || [])].sort()) !== stableStringify(eventPlan.pendingCheckpointIds))) {
        errors.push("coverage_plan_created summary differs from its embedded CoveragePlan.");
      }
      if (!activePlan) {
        if (event.planSha256 !== coveragePlan.planSha256 || event.replanOf) continue;
      } else {
        if (!pendingReplan
          || event.replanOf !== activePlan.planSha256
          || event.planSha256 !== pendingReplan.newPlanSha256
          || stableStringify([...(event.pendingCheckpointIds || [])].sort()) !== stableStringify(pendingReplan.remainingCheckpointIds)) {
          errors.push("Replanned coverage_plan_created event is not linked to the active plan and remaining checkpoints.");
        }
        pendingReplan = null;
        if (eventPlan?.replan?.previousPlanSha256 !== activePlan.planSha256
          || !String(eventPlan?.replan?.reason || "").trim()) {
          errors.push("Replanned embedded CoveragePlan is missing its previous-plan link and reason.");
        }
      }
      if (stableStringify([...(event.targetCheckpointIds || [])].sort()) !== stableStringify(expectedTargets)
        || stableStringify([...(event.reusedCheckpointIds || [])].sort()) !== stableStringify(expectedReused)
        || !Array.isArray(event.routeIds)) {
        errors.push("coverage_plan_created changed the approved target or reused checkpoint set.");
      }
      activePlan = {
        planSha256: event.planSha256,
        routeIds: [...(event.routeIds || [])],
        createdOrder: writerOrder(event) || 0
      };
      completedByPlan.set(activePlan.planSha256, new Set());
      continue;
    }
    if (event.type === "coverage_replanned") {
      if (!activePlan || event.previousPlanSha256 !== activePlan.planSha256) {
        errors.push("coverage_replanned does not reference the active CoveragePlan.");
        continue;
      }
      const remaining = [...new Set((event.remainingCheckpointIds || []).map(String))].sort();
      const actualRemaining = expectedPending.filter((checkpointId) => !completedTargets.has(checkpointId));
      if (stableStringify(remaining) !== stableStringify(actualRemaining)) {
        errors.push("coverage_replanned remainingCheckpointIds do not match observed completed coverage.");
      }
      if (!String(event.reason || "").trim() || !/^[a-f0-9]{64}$/.test(String(event.newPlanSha256 || ""))) {
        errors.push("coverage_replanned requires a reason and a valid new plan hash.");
      }
      pendingReplan = { newPlanSha256: event.newPlanSha256, remainingCheckpointIds: remaining };
      continue;
    }
    if (event.type === "coverage_route_started") {
      if (!activePlan || !activePlan.routeIds.includes(event.routeId)) {
        errors.push(`Coverage route ${event.routeId || "(missing)"} was started outside the active CoveragePlan.`);
        continue;
      }
      const key = `${event.gameIndex}:${event.routeId}`;
      if (startedRoutes.has(key)) errors.push(`Coverage route ${event.routeId} was started more than once for game ${event.gameIndex}.`);
      startedRoutes.set(key, { event, planSha256: activePlan.planSha256 });
      continue;
    }
    if (event.type === "coverage_route_completed") {
      const key = `${event.gameIndex}:${event.routeId}`;
      const started = startedRoutes.get(key);
      if (!started || started.planSha256 !== activePlan?.planSha256) {
        errors.push(`Coverage route ${event.routeId || "(missing)"} completed without a matching start in the active plan.`);
        continue;
      }
      if (!Number.isFinite(Number(event.durationMs)) || Number(event.durationMs) < 0) {
        errors.push(`Coverage route ${event.routeId} has an invalid durationMs.`);
      }
      if (!Array.isArray(event.checkpointIds) || !event.checkpointIds.length || !Array.isArray(event.evidenceRefs) || !event.evidenceRefs.length) {
        errors.push(`Coverage route ${event.routeId} must name covered checkpoints and logs-only evidenceRefs.`);
      }
      for (const checkpointId of event.checkpointIds || []) {
        if (!expectedTargets.includes(checkpointId) && !(coveragePlan.supportCheckpointIds || []).includes(checkpointId)) {
          errors.push(`Coverage route ${event.routeId} claimed undeclared checkpoint ${checkpointId}.`);
        }
        completedTargets.add(checkpointId);
      }
      completedByPlan.get(activePlan.planSha256)?.add(event.routeId);
      startedRoutes.delete(key);
    }
  }
  if (pendingReplan) errors.push("coverage_replanned was not followed by its linked coverage_plan_created event.");
  if (startedRoutes.size) errors.push("One or more CoveragePlan routes were started but not completed.");
  if (activePlan) {
    const finalCompleted = completedByPlan.get(activePlan.planSha256) || new Set();
    for (const routeId of activePlan.routeIds) {
      if (!finalCompleted.has(routeId)) errors.push(`Final CoveragePlan route ${routeId} was not completed.`);
    }
  }
  const passedCheckpoints = new Set(timeline
    .filter((event) => event.type === "checkpoint_result" && event.passed === true)
    .map((event) => String(event.checkpointId || event.requirementId || "")));
  for (const checkpointId of expectedPending) {
    if (!completedTargets.has(checkpointId)) errors.push(`CoveragePlan checkpoint ${checkpointId} was not covered by a completed route.`);
    if (!passedCheckpoints.has(checkpointId)) errors.push(`CoveragePlan checkpoint ${checkpointId} has no passing checkpoint_result.`);
  }
}

function validateScopedEvidenceRefs(refs, evidenceByRef, label, errors) {
  if (!Array.isArray(refs) || !refs.length) {
    errors.push(`${label} requires at least one scoped evidenceRef.`);
    return false;
  }
  let valid = true;
  for (const ref of refs) {
    if (!/^(?:public|[A-Za-z0-9][A-Za-z0-9_-]{0,31}):[^:]+$/.test(String(ref || ""))
      || !evidenceByRef.has(String(ref))) {
      errors.push(`${label} evidenceRef does not resolve to recorded visible evidence: ${ref}.`);
      valid = false;
    }
  }
  return valid;
}

function resolvedCompletionRequirements(config) {
  const requirements = config?.testPurpose?.completionRequirements;
  return Array.isArray(requirements) ? requirements : null;
}

function requiresCompletionKind(requirements, kind) {
  return Array.isArray(requirements) && requirements.some((item) => item.kind === kind);
}

function validateJourneyCompletion(timeline, finalStates, config, run, evidenceByRef, errors) {
  const purpose = config?.testPurpose || {};
  const requirements = resolvedCompletionRequirements(config);
  if (!requirements) return;
  const executions = Number.isInteger(run.gamesToPlay) && run.gamesToPlay > 0 ? run.gamesToPlay : 1;
  const checkpointResults = timeline.filter((event) => event.type === "checkpoint_result");
  const completions = timeline.filter((event) => event.type === "journey_completed");
  const requiredIds = requirements.map((item) => String(item.id)).sort();
  for (let gameIndex = 1; gameIndex <= executions; gameIndex += 1) {
    const requiredEvents = [];
    const checkpointEvidenceRefs = new Set();
    for (const requirement of requirements) {
      if (requirement.kind === "terminal_visible") {
        const matches = timeline.filter((event) => event.type === "terminal_visible"
          && event.gameIndex === gameIndex);
        if (matches.length !== 1 || matches[0]?.source !== "visible_dom") {
          errors.push(`Execution ${gameIndex} requirement ${requirement.id} requires exactly one visible_dom terminal_visible event.`);
        } else {
          requiredEvents.push(matches[0]);
          const detail = timeline.find((event) => event.type === "result_detail" && event.gameIndex === gameIndex);
          if (detail) requiredEvents.push(detail);
        }
      } else if (requirement.kind === "cross_tab_final_state") {
        const matches = finalStates.filter((event) => (event.gameIndex ?? 1) === gameIndex);
        if (matches.length !== run.playerCount) {
          errors.push(`Execution ${gameIndex} requirement ${requirement.id} requires ${run.playerCount} final-state events; found ${matches.length}.`);
        } else {
          requiredEvents.push(...matches);
          const statePlayerIds = matches.map((event) => event.playerId).sort();
          const configuredIds = (config?.players || []).map((player) => player.id).sort();
          if (new Set(statePlayerIds).size !== run.playerCount
            || stableStringify(statePlayerIds) !== stableStringify(configuredIds)) {
            errors.push(`Execution ${gameIndex} requirement ${requirement.id} must cover every configured player exactly once.`);
          }
          const normalized = matches.map((event) => stableStringify(event.normalizedResult ?? event.result ?? null));
          if (new Set(normalized).size !== 1) {
            errors.push(`Execution ${gameIndex} requirement ${requirement.id} has inconsistent cross-tab results.`);
          }
        }
      } else if (requirement.kind === "checkpoint") {
        const checkpointId = String(requirement.checkpointId || requirement.id);
        const matches = checkpointResults.filter((event) => event.gameIndex === gameIndex
          && event.checkpointId === checkpointId);
        if (matches.length !== 1) {
          errors.push(`Execution ${gameIndex} requirement ${requirement.id} requires exactly one checkpoint_result for ${checkpointId}.`);
          continue;
        }
        const event = matches[0];
        requiredEvents.push(event);
        if (event.source !== "evidence_refs") {
          errors.push(`Execution ${gameIndex} checkpoint ${checkpointId} must use evidence_refs provenance.`);
        }
        validateScopedEvidenceRefs(event.evidenceRefs, evidenceByRef,
          `Execution ${gameIndex} checkpoint ${checkpointId}`, errors);
        for (const ref of event.evidenceRefs || []) {
          const scopedRef = String(ref);
          checkpointEvidenceRefs.add(scopedRef);
          const evidence = evidenceByRef.get(scopedRef);
          if (evidence && Number(evidence.gameIndex) !== gameIndex) {
            errors.push(`Execution ${gameIndex} checkpoint ${checkpointId} references evidence from another execution: ${scopedRef}.`);
          }
          if (evidence && (writerOrder(evidence) === null || writerOrder(event) === null
            || writerOrder(evidence) >= writerOrder(event))) {
            errors.push(`Execution ${gameIndex} checkpoint ${checkpointId} references evidence recorded after the checkpoint result: ${scopedRef}.`);
          }
        }
        if (run.productVerdict === "pass" && event.passed !== true) {
          errors.push(`Passing Run has an unmet completion requirement: ${requirement.id}.`);
        }
      }
    }
    for (const journeyId of purpose.journeyIds || []) {
      const matches = completions.filter((event) => event.gameIndex === gameIndex
        && event.journeyId === journeyId);
      if (matches.length !== 1) {
        errors.push(`Execution ${gameIndex} requires exactly one journey_completed event for ${journeyId}.`);
        continue;
      }
      const event = matches[0];
      if (event.source !== "requirements_satisfied") {
        errors.push(`Execution ${gameIndex} journey ${journeyId} must use requirements_satisfied provenance.`);
      }
      if (stableStringify([...(event.requirementIds || [])].map(String).sort())
        !== stableStringify(requiredIds)) {
        errors.push(`Execution ${gameIndex} journey ${journeyId} does not list the Adapter-derived completion requirements.`);
      }
      if (!Array.isArray(event.evidenceRefs)) {
        errors.push(`Execution ${gameIndex} journey ${journeyId} evidenceRefs must be an array.`);
      } else if (checkpointEvidenceRefs.size) {
        validateScopedEvidenceRefs(event.evidenceRefs, evidenceByRef,
          `Execution ${gameIndex} journey ${journeyId}`, errors);
        if (stableStringify([...new Set(event.evidenceRefs.map(String))].sort())
          !== stableStringify([...checkpointEvidenceRefs].sort())) {
          errors.push(`Execution ${gameIndex} journey ${journeyId} must reference exactly the evidence used by its checkpoint requirements.`);
        }
      } else if (event.evidenceRefs.length) {
        validateScopedEvidenceRefs(event.evidenceRefs, evidenceByRef,
          `Execution ${gameIndex} journey ${journeyId}`, errors);
      }
      const lastRequirementOrder = Math.max(0, ...requiredEvents.map((value) => writerOrder(value) || 0));
      if (writerOrder(event) === null || writerOrder(event) <= lastRequirementOrder) {
        errors.push(`Execution ${gameIndex} journey ${journeyId} completed before its requirements were satisfied.`);
      }
    }
  }
}

function validateResourceCleanup(timeline, finalStates, config, run, errors, warnings) {
  const lifecycle = config?.resourceLifecycle;
  if (lifecycle?.cleanupAfterRun !== true) return;
  if (stableStringify(run.resourceLifecycle || null) !== stableStringify(lifecycle)) {
    errors.push("run.json resourceLifecycle differs from config.resolved.json.");
  }
  if (!["complete", "incomplete", "aborted"].includes(String(run.status || ""))) return;
  const events = timeline.filter((event) => event.type === "resource_cleanup");
  if (events.length !== 1) {
    errors.push(`Finalized Run must contain exactly one resource_cleanup event; found ${events.length}.`);
    return;
  }
  const event = events[0];
  if (event.policyVersion !== lifecycle.policyVersion) {
    errors.push("resource_cleanup policyVersion differs from the resolved config.");
  }
  if (!["passed", "partial"].includes(event.status)) {
    errors.push("resource_cleanup status must be passed or partial.");
  }
  for (const key of [
    "ownedTabsClosed",
    "ownedContextsClosed",
    "ownedProcessesStopped",
    "ownedServersStopped",
    "isolatedPlayersReleased",
    "temporaryArtifactsRemoved"
  ]) {
    if (!Number.isInteger(event[key]) || event[key] < 0) {
      errors.push(`resource_cleanup ${key} must be a non-negative integer.`);
    }
  }
  if (event.reusedResourcesPreserved !== true) {
    errors.push("resource_cleanup must affirm that reused and user-owned resources were preserved.");
  }
  if (!Array.isArray(event.unresolvedResources)
    || event.unresolvedResources.some((value) => !String(value || "").trim())) {
    errors.push("resource_cleanup unresolvedResources must be an array of non-empty safe labels.");
  }
  const unresolved = Array.isArray(event.unresolvedResources) ? event.unresolvedResources : [];
  if (run.status === "complete" && (event.status !== "passed" || unresolved.length > 0)) {
    errors.push("Complete Run requires passed resource cleanup with no unresolved Run-owned resources.");
  } else if (event.status === "partial" || unresolved.length > 0) {
    warnings.push("Run cleanup was partial; unresolved resources were preserved and reported instead of being stopped unsafely.");
  }
  const lastCompletionEvidenceSequence = Math.max(
    0,
    ...finalStates.map((value) => Number(value.sequence) || 0),
    ...timeline.filter((value) => value.type === "journey_completed")
      .map((value) => Number(value.sequence) || 0)
  );
  if (run.status === "complete" && Number(event.sequence) <= lastCompletionEvidenceSequence) {
    errors.push("resource_cleanup must occur after all journey completion evidence.");
  }
  const verification = timeline.find((value) => value.type === "product_build_verified");
  if (verification && Number(event.sequence) >= Number(verification.sequence)) {
    errors.push("resource_cleanup must occur before product_build_verified and finalization.");
  }
}

function auditRun(runDir, options = {}) {
  const resolvedRun = path.resolve(runDir);
  const errors = [];
  const warnings = [];
  const runPath = path.join(resolvedRun, "run.json");
  if (!fs.existsSync(runPath)) throw new Error("找不到 run.json。");
  const run = readJson(runPath);
  const genericContract = String(run.schemaVersion || "") === "1.1";
  const legacy = !["1.0", "1.1"].includes(String(run.schemaVersion || ""));
  const configPath = path.join(resolvedRun, "config.resolved.json");
  const config = fs.existsSync(configPath) ? readJson(configPath) : null;
  let approvedPlan = null;
  let adapter = genericContract ? null : legacyV1Adapter;
  if (genericContract && config?.adapter?.module) {
    try {
      adapter = loadAdapter({ adapterModule: config.adapter.module });
    } catch (error) {
      errors.push(`Adapter could not be loaded for audit: ${error.message}`);
    }
  }
  const purposeMode = String(config?.testPurpose?.approach || config?.testPurpose?.mode
    || (config?.discussion?.enforceBehaviorCoverage === true ? "behavior_matrix" : "natural_play"));
  const completionRequirements = genericContract ? resolvedCompletionRequirements(config) : null;
  const requiresVisibleTerminal = completionRequirements === null
    || requiresCompletionKind(completionRequirements, "terminal_visible");
  const requiresCrossTabFinalState = completionRequirements === null
    || requiresCompletionKind(completionRequirements, "cross_tab_final_state");
  if (!legacy && !config) errors.push("v1 Run 缺少 config.resolved.json。");
  if (!legacy && config?.evidence?.mode !== "logs_only") errors.push("正式 Run 的 evidence.mode 必須是 logs_only。");
  if (!legacy && config) {
    try {
      resolveConfig(config, { allowUnverified: true, allowLegacyPurpose: true });
    } catch (error) {
      errors.push(`config.resolved.json validation failed: ${error.message}`);
    }
    if (run.game !== config.game || run.playerCount !== config.playerCount || run.gamesToPlay !== config.gamesToPlay) {
      errors.push("run.json game/playerCount/gamesToPlay differs from config.resolved.json.");
    }
    if (run.preflightPlan) {
      const planPath = path.join(resolvedRun, "plan.approved.json");
      if (!fs.existsSync(planPath)) {
        errors.push("Run declares a preflight plan but plan.approved.json is missing.");
      } else {
        try {
          approvedPlan = readJson(planPath);
          const verifiedPlan = verifyApprovedPlan(approvedPlan, config);
          if (verifiedPlan.planSha256 !== run.preflightPlan.planSha256
            || verifiedPlan.executionDecision !== run.preflightPlan.executionDecision
            || verifiedPlan.evidenceDisposition !== run.preflightPlan.evidenceDisposition
            || (run.preflightPlan.coveragePlanSha256 || null) !== (verifiedPlan.coveragePlanSha256 || null)) {
            errors.push("run.json preflight plan metadata differs from plan.approved.json.");
          }
        } catch (error) {
          errors.push(`plan.approved.json validation failed: ${error.message}`);
        }
      }
    }
    if (run.speed?.requestedProfile !== config.speed?.profile
      || Number(run.speed?.operationDelayMs) !== Number(config.speed?.operationDelayMs)
      || Number(run.speed?.pollIntervalMs) !== Number(config.speed?.pollIntervalMs)
      || Number(run.speed?.serverTimeScale) !== Number(config.speed?.serverTimeScale)) {
      errors.push("run.json actual speed differs from config.resolved.json.");
    }
  }

  allFiles(resolvedRun).forEach((file) => {
    if (!isExpectedLogArtifact(resolvedRun, file)) errors.push(`Unexpected artifact file in logs-only Run: ${file}`);
    if (!isUtf8TextFile(file)) errors.push(`Run artifact is not plain UTF-8 text: ${file}`);
    if (IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) errors.push(`Run 內禁止圖片證據：${file}`);
    if (hasImagePayload(file)) errors.push(`Run contains an image payload, which is forbidden in logs-only evidence: ${file}`);
    if (file.split(path.sep).some((segment) => segment.toLowerCase() === "screenshots")) errors.push(`Run 內禁止 screenshots 路徑：${file}`);
  });
  screenshotDirectories(resolvedRun).forEach((directory) => errors.push(`Run 內禁止 screenshots 目錄：${directory}`));

  const publicDir = path.join(resolvedRun, "public");
  const timeline = parseJsonLines(path.join(publicDir, "timeline.jsonl"), errors, warnings);
  const chat = parseJsonLines(path.join(publicDir, "chat.log"), errors, warnings, { optional: true, allowPlainText: legacy });
  const finalStates = parseJsonLines(path.join(publicDir, "final-state.log"), errors, warnings, { optional: true, allowPlainText: legacy });
  validateCoverageExecution(timeline, approvedPlan, errors);
  validateResourceCleanup(timeline, finalStates, config, run, errors, warnings);
  const strictContract = !legacy && Object.hasOwn(config || {}, "testPurpose");
  const strictOrderedEvents = strictContract ? [...timeline, ...chat, ...finalStates] : [];
  if (!legacy) {
    timeline.forEach((event, index) => {
      if (event.sequence !== index + 1) errors.push(`Timeline sequence must be strict and contiguous at line ${index + 1}.`);
      if (strictContract && monotonicMs(event) === null) errors.push(`Timeline line ${index + 1} is missing writerMonotonicMs.`);
      if (strictContract && writerOrder(event) === null) errors.push(`Timeline line ${index + 1} is missing writerOrder.`);
      if (strictContract && index > 0 && monotonicMs(event) < monotonicMs(timeline[index - 1])) {
        errors.push(`Timeline writerMonotonicMs moved backwards at line ${index + 1}.`);
      }
      if (strictContract && index > 0 && writerOrder(event) <= writerOrder(timeline[index - 1])) {
        errors.push(`Timeline writerOrder is not strictly increasing at line ${index + 1}.`);
      }
    });
  }
  timeline.forEach((event) => {
    if (strictContract) {
      const unexpected = unexpectedPublicKeys("timeline", event, {
        publicTimelineFields: adapter?.publicTimelineFields
      });
      if (unexpected.length) errors.push(`Strict public timeline event has unexpected fields: ${unexpected.join(", ")}.`);
      const postTerminalTypes = new Set(["result_detail", ...(adapter?.postTerminalEventTypes || [])]);
      if (!postTerminalTypes.has(event.type) && containsPrivateUiMarker(event)) {
        errors.push("Pre-settlement public event appears to contain a private-role marker.");
      }
      if (typeof adapter?.validatePublicEvent === "function") {
        try {
          adapter.validatePublicEvent("timeline", event, { config, run, runDir: resolvedRun }, errors);
        } catch (error) {
          errors.push(`Adapter timeline-event validation failed: ${error.message}`);
        }
      }
    }
    const postTerminalTypes = new Set(["result_detail", ...(adapter?.postTerminalEventTypes || [])]);
    const allowedKeys = postTerminalTypes.has(event.type)
      ? new Set(adapter?.resultDisclosureKeys || [])
      : new Set();
    const forbidden = containsForbiddenPublicKey(event, { allowedKeys });
    if (forbidden) errors.push(`公開 Log 包含私人欄位：${forbidden}`);
  });
  chat.forEach((event) => {
    if (strictContract && monotonicMs(event) === null) errors.push("Strict public chat event is missing writerMonotonicMs.");
    if (strictContract && writerOrder(event) === null) errors.push("Strict public chat event is missing writerOrder.");
    if (strictContract) {
      const unexpected = unexpectedPublicKeys("chat", event);
      if (unexpected.length) errors.push(`Strict public chat event has unexpected fields: ${unexpected.join(", ")}.`);
      if (typeof adapter?.validatePublicEvent === "function") {
        try {
          adapter.validatePublicEvent("chat", event, { config, run, runDir: resolvedRun }, errors);
        } catch (error) {
          errors.push(`Adapter chat-event validation failed: ${error.message}`);
        }
      }
    }
    const forbidden = containsForbiddenPublicKey(event);
    if (forbidden) errors.push(`公開 Chat 包含私人欄位：${forbidden}`);
  });
  finalStates.forEach((event) => {
    if (strictContract && monotonicMs(event) === null) errors.push("Strict public final-state event is missing writerMonotonicMs.");
    if (strictContract && writerOrder(event) === null) errors.push("Strict public final-state event is missing writerOrder.");
    if (strictContract) {
      const unexpected = unexpectedPublicKeys("final-state", event);
      if (unexpected.length) errors.push(`Strict public final-state event has unexpected fields: ${unexpected.join(", ")}.`);
      if (typeof adapter?.validatePublicEvent === "function") {
        try {
          adapter.validatePublicEvent("final-state", event, { config, run, runDir: resolvedRun }, errors);
        } catch (error) {
          errors.push(`Adapter final-state validation failed: ${error.message}`);
        }
      }
    }
    const forbidden = containsForbiddenPublicKey(event, {
      allowedKeys: new Set(adapter?.resultDisclosureKeys || [])
    });
    if (forbidden) errors.push(`公開結算 Log 包含非結算私人欄位：${forbidden}`);
  });
  const publicDomEvidence = new Map();
  const publicChatEvidence = new Map();
  const scopedEvidenceByRef = new Map();
  if (strictContract) {
    const configuredVisibilityIds = (config.players || []).map((player) => String(player.id)).sort();
    const visibleToAll = (event) => Array.isArray(event.visibleToPlayerIds)
      && stableStringify(event.visibleToPlayerIds.map(String).sort()) === stableStringify(configuredVisibilityIds);
    timeline.filter((event) => event.source === "visible_dom" && String(event.evidenceId || "")).forEach((event) => {
      if (event.contentClass !== "public_ui" || !visibleToAll(event)) {
        errors.push(`Public DOM evidence ${event.evidenceId} is not proven visible to every configured player.`);
        return;
      }
      if (publicDomEvidence.has(event.evidenceId)) errors.push(`Duplicate public DOM evidenceId: ${event.evidenceId}.`);
      publicDomEvidence.set(event.evidenceId, event);
      scopedEvidenceByRef.set(`public:${event.evidenceId}`, event);
    });
    chat.filter((event) => event.source === "visible_dom").forEach((event) => {
      if (event.contentClass !== "public_chat" || !visibleToAll(event)) {
        errors.push(`Public chat event ${event.evidenceId || event.observationId || event.playerId || "unknown"} is not proven visible to every configured player.`);
        return;
      }
      if (!String(event.evidenceId || "")) return;
      if (publicChatEvidence.has(event.evidenceId)) errors.push(`Duplicate public chat evidenceId: ${event.evidenceId}.`);
      publicChatEvidence.set(event.evidenceId, event);
      scopedEvidenceByRef.set(`public:${event.evidenceId}`, event);
    });
  }

  const playersRoot = path.join(resolvedRun, "players");
  const playerIds = fs.existsSync(playersRoot)
    ? fs.readdirSync(playersRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  if (!playerIds.length) errors.push("Run 沒有玩家 Log 目錄。");
  if (!legacy && config && playerIds.length !== config.playerCount) errors.push("玩家 Log 目錄數量與 playerCount 不一致。");
  if (!legacy && config) {
    const configuredIds = (config.players || []).map((player) => player.id).sort();
    const directoryIds = [...playerIds].sort();
    if (new Set(directoryIds).size !== directoryIds.length || stableStringify(directoryIds) !== stableStringify(configuredIds)) {
      errors.push("Player log directories must exactly match unique configured player IDs.");
    }
  }

  let observationCount = 0;
  let decisionCount = 0;
  const discussionMessagesExpected = [];
  const behaviorDecisions = new Map();
  const participationDecisions = new Map();
  const voteActions = new Map();
  playerIds.forEach((playerId) => {
    const playerDir = path.join(playersRoot, playerId);
    const observations = parseJsonLines(path.join(playerDir, "observations.jsonl"), errors, warnings);
    const decisions = parseJsonLines(path.join(playerDir, "decisions.jsonl"), errors, warnings);
    const consoleEvents = parseJsonLines(path.join(playerDir, "console.jsonl"), errors, warnings, { optional: legacy });
    const privateEvidence = new Map();
    if (strictContract) {
      strictOrderedEvents.push(...observations, ...decisions, ...consoleEvents);
      consoleEvents.filter((event) => event.source === "visible_dom"
        && event.playerId === playerId
        && String(event.evidenceId || "")).forEach((event) => {
        if (privateEvidence.has(event.evidenceId)) errors.push(`${playerId} has duplicate private evidenceId ${event.evidenceId}.`);
        privateEvidence.set(event.evidenceId, event);
        scopedEvidenceByRef.set(`${playerId}:${event.evidenceId}`, event);
      });
      consoleEvents.filter((event) => event.type === "vote_action").forEach((event) => {
        const key = `${playerId}:${event.gameIndex}`;
        if (!voteActions.has(key)) voteActions.set(key, []);
        voteActions.get(key).push(event);
      });
    }
    if (genericContract && typeof adapter?.validatePlayerEvent === "function") {
      for (const [kind, values] of [["observation", observations], ["decision", decisions], ["console", consoleEvents]]) {
        values.forEach((event) => {
          try {
            adapter.validatePlayerEvent(kind, event, { playerId, config, run }, errors, warnings);
          } catch (error) {
            errors.push(`${playerId} Adapter ${kind} validation failed: ${error.message}`);
          }
        });
      }
    }
    if (!legacy && run.status === "complete") {
      const finishedMs = timestampMs(run.finishedAt);
      [...observations, ...decisions, ...consoleEvents].forEach((event) => {
        const at = timestampMs(event.at);
        if (at === null) errors.push(`${playerId} private event is missing a valid timestamp.`);
        else if (finishedMs !== null && at > finishedMs) errors.push(`${playerId} private evidence was recorded after run finalization.`);
        if (strictContract && monotonicMs(event) === null) errors.push(`${playerId} private evidence is missing writerMonotonicMs.`);
        if (strictContract && writerOrder(event) === null) errors.push(`${playerId} private evidence is missing writerOrder.`);
      });
    }
    observationCount += observations.length;
    decisionCount += decisions.length;
    const byId = new Map();
    observations.forEach((observation, index) => {
      if (!observation.observationId) errors.push(`${playerId} observation ${index + 1} 缺少 observationId。`);
      if (!legacy && (!Number.isInteger(observation.gameIndex) || observation.gameIndex < 1)) {
        errors.push(`${playerId} 的 ${observation.observationId || index + 1} 缺少合法 gameIndex。`);
      }
      if (byId.has(observation.observationId)) errors.push(`${playerId} observationId 重複：${observation.observationId}`);
      byId.set(observation.observationId, observation);
      if (genericContract && typeof adapter?.validateObservation === "function") {
        try {
          adapter.validateObservation(observation, { playerId, config }, errors, warnings);
        } catch (error) {
          errors.push(`${playerId} Adapter Observation validation failed: ${error.message}`);
        }
      }
    });
    if (strictContract) {
      observations.forEach((observation) => {
        for (const [key, expectedVisibility] of [["publicFacts", "public"], ["privateFacts", "private"]]) {
          if (!Array.isArray(observation[key])) continue;
          observation[key].forEach((fact, factIndex) => {
            if (!fact || typeof fact !== "object" || Array.isArray(fact)) {
              errors.push(`${playerId} ${observation.observationId} ${key}[${factIndex}] lacks provenance.`);
              return;
            }
            if (!String(fact.text || "").trim() || !String(fact.evidenceId || "").trim()
              || fact.visibility !== expectedVisibility) {
              errors.push(`${playerId} ${observation.observationId} ${key}[${factIndex}] has invalid text/evidenceId/visibility.`);
              return;
            }
            let evidence;
            if (key === "publicFacts" && fact.source === "visible_dom") evidence = publicDomEvidence.get(fact.evidenceId);
            else if (key === "publicFacts" && fact.source === "public_chat") evidence = publicChatEvidence.get(fact.evidenceId);
            else if (key === "privateFacts" && fact.source === "visible_dom" && fact.sourcePlayerId === playerId) evidence = privateEvidence.get(fact.evidenceId);
            if (!evidence) {
              errors.push(`${playerId} ${observation.observationId} ${key}[${factIndex}] does not resolve to allowed same-scope evidence.`);
              return;
            }
            if (Number(evidence.gameIndex) !== Number(observation.gameIndex)) {
              errors.push(`${playerId} ${observation.observationId} ${key}[${factIndex}] comes from a different game.`);
            }
            if (writerOrder(evidence) === null || writerOrder(observation) === null
              || writerOrder(evidence) >= writerOrder(observation)) {
              errors.push(`${playerId} ${observation.observationId} ${key}[${factIndex}] source evidence was recorded after the Observation.`);
            }
            const evidenceText = String(evidence.evidenceText ?? evidence.message ?? "");
            if (evidenceText !== String(fact.text)) {
              errors.push(`${playerId} ${observation.observationId} ${key}[${factIndex}] text differs from source evidence.`);
            }
          });
        }
        if (Array.isArray(observation.ownMemory)) {
          observation.ownMemory.forEach((memory, memoryIndex) => {
            const sourceObservation = memory && typeof memory === "object"
              ? byId.get(memory.sourceObservationId)
              : null;
            if (!memory || typeof memory !== "object" || Array.isArray(memory)
              || !String(memory.text || "").trim()
              || !String(memory.sourceObservationId || "").trim()
              || !sourceObservation
              || Number(sourceObservation.gameIndex) > Number(observation.gameIndex)
              || writerOrder(sourceObservation) === null
              || writerOrder(observation) === null
              || writerOrder(sourceObservation) >= writerOrder(observation)) {
              errors.push(`${playerId} ${observation.observationId} ownMemory[${memoryIndex}] is not linked to this player's Observation history.`);
            }
          });
        }
      });
    }
    const decisionObservationIds = new Set();
    decisions.forEach((decision, index) => {
      const observation = byId.get(decision.observationId);
      if (decisionObservationIds.has(decision.observationId)) {
        errors.push(`${playerId} has more than one Decision for Observation ${decision.observationId}.`);
      }
      decisionObservationIds.add(decision.observationId);
      if (!observation) {
        errors.push(`${playerId} decision ${index + 1} 找不到同玩家 Observation：${decision.observationId}`);
        return;
      }
      if (strictContract && (writerOrder(decision) === null || writerOrder(observation) === null
        || writerOrder(decision) <= writerOrder(observation))) {
        errors.push(`${playerId} decision ${index + 1} does not strictly follow its Observation in writer order.`);
      }
      if (!Array.isArray(decision.evidenceRefs) || !decision.evidenceRefs.length) {
        errors.push(`${playerId} decision ${index + 1} 缺少 evidenceRefs。`);
        return;
      }
      if (!decisionMatchesLegalActions(decision, observation)) {
        errors.push(`${playerId} decision ${index + 1} action/targets 不在該 Observation 的 legalActions。`);
      }
      if (genericContract && typeof adapter?.validateDecision === "function") {
        try {
          adapter.validateDecision(decision, observation, { playerId, config }, errors, warnings);
        } catch (error) {
          errors.push(`${playerId} Adapter Decision validation failed: ${error.message}`);
        }
      }
      if (strictContract && !genericContract
        && (adapter?.timingIntents || []).includes(String(decision.timingIntent || ""))) {
        const participationKey = `${playerId}:${observation.gameIndex}`;
        if (!participationDecisions.has(participationKey)) participationDecisions.set(participationKey, []);
        participationDecisions.get(participationKey).push({ decision, observation });
      }
      decision.evidenceRefs.forEach((ref) => validateEvidenceRef(ref, observation, legacy, errors, warnings, playerId, index));
      const phase = String(observation.phase || "");
      // Frozen v1 One Night Werewolf behavior contract. Generic Adapters decide
      // whether communication intent is meaningful for their own phases.
      if (!genericContract
        && (Object.hasOwn(config || {}, "testPurpose") || config?.discussion?.enforceBehaviorCoverage === true)
        && phase.startsWith("discussion")) {
        const intent = String(decision.communicationIntent || "");
        const configuredBehavior = String(config?.players?.find((player) => player.id === playerId)?.communicationBehavior || "adaptive");
        if (!COMMUNICATION_INTENTS.has(intent)) {
          errors.push(`${playerId} discussion Decision ${decision.observationId} is missing a valid communicationIntent.`);
        }
        if (purposeMode === "behavior_matrix" && configuredBehavior !== "adaptive" && intent !== configuredBehavior) {
          errors.push(`${playerId} discussion Decision ${decision.observationId} did not exercise configured behavior ${configuredBehavior}.`);
        }
        const message = String(decision.publicMessage || "");
        if (intent === "strategic_silence") {
          if (message || decision.action !== "stay_silent") {
            errors.push(`${playerId} strategic_silence must use stay_silent with an empty publicMessage.`);
          }
        } else if (COMMUNICATION_INTENTS.has(intent) && !message) {
          errors.push(`${playerId} communicationIntent ${intent} requires a publicMessage.`);
        }
        const key = `${playerId}:${observation.gameIndex}`;
        if (!behaviorDecisions.has(key)) behaviorDecisions.set(key, []);
        behaviorDecisions.get(key).push({ intent, message, observationId: decision.observationId });
      }
      if (String(decision.publicMessage || "")) {
        discussionMessagesExpected.push({
          playerId,
          observationId: decision.observationId,
          message: String(decision.publicMessage),
          decisionAt: decision.at,
          decisionOrder: decision.writerOrder
        });
      }
    });
  });

  if (approvedPlan?.coveragePlan) {
    timeline.filter((event) => event.type === "coverage_route_completed").forEach((event) => {
      validateScopedEvidenceRefs(event.evidenceRefs, scopedEvidenceByRef,
        `Coverage route ${event.routeId || "(missing)"}`, errors);
    });
  }

  if (strictContract) {
    const orders = strictOrderedEvents.map(writerOrder);
    if (orders.some((order) => order === null)) {
      errors.push("Strict-contract evidence contains an invalid writerOrder.");
    } else if (new Set(orders).size !== orders.length) {
      errors.push("Strict-contract evidence contains duplicate writerOrder values.");
    }
    const writerStatePath = path.join(resolvedRun, "writer-state.json");
    const writerState = fs.existsSync(writerStatePath) ? readJson(writerStatePath) : null;
    const maximumOrder = orders.length ? Math.max(...orders) : 0;
    if (!Number.isInteger(writerState?.nextOrder) || writerState.nextOrder <= maximumOrder) {
      errors.push("writer-state.json does not advance beyond every recorded writerOrder.");
    }
  }

  if (!legacy && run.speed) {
    const expectedFidelity = Number(run.speed.serverTimeScale) < 1 ? "accelerated_waits" : "production";
    if (run.speed.timingFidelity !== expectedFidelity) errors.push("run.json 的 timingFidelity 與 serverTimeScale 不一致。");
  }
  if (!legacy && run.status === "complete") {
    const finishedMs = timestampMs(run.finishedAt);
    if (finishedMs === null) errors.push("Complete run is missing a valid finishedAt timestamp.");
    const finishEvents = timeline.filter((event) => event.type === "run_finished");
    if (finishEvents.length !== 1) errors.push(`Complete run must contain exactly one run_finished event; found ${finishEvents.length}.`);
    if (timeline.at(-1)?.type !== "run_finished") errors.push("run_finished must be the final public timeline event.");
    if (finishEvents[0] && finishEvents[0].finishedAt !== run.finishedAt) {
      errors.push("run_finished does not match run.json finishedAt.");
    }
    [...timeline, ...chat, ...finalStates].forEach((event) => {
      const at = timestampMs(event.at);
      if (at === null) errors.push(`Public ${event.type || "event"} is missing a valid timestamp.`);
      else if (finishedMs !== null && at > finishedMs) errors.push(`Public ${event.type || "event"} was recorded after run finalization.`);
      if (event.recordedAfterRun === true || event.recoveredFromBatch === true) {
        errors.push(`Public ${event.type || "event"} is retroactively recovered evidence and cannot certify a formal run.`);
      }
    });

    const gamesToPlay = Number.isInteger(run.gamesToPlay) && run.gamesToPlay > 0 ? run.gamesToPlay : 1;
    if (requiresCrossTabFinalState) {
      const expectedFinalStates = run.playerCount * gamesToPlay;
      if (finalStates.length !== expectedFinalStates) {
        errors.push(`Complete run requires ${expectedFinalStates} final-state events; found ${finalStates.length}.`);
      }
      if (completionRequirements === null) {
        for (let gameIndex = 1; gameIndex <= gamesToPlay; gameIndex += 1) {
          const gameStates = finalStates.filter((event) => (event.gameIndex ?? 1) === gameIndex);
          if (gameStates.length !== run.playerCount) {
            errors.push(`Game ${gameIndex} must contain ${run.playerCount} final-state events; found ${gameStates.length}.`);
            continue;
          }
          const statePlayerIds = gameStates.map((event) => event.playerId).sort();
          const configuredIds = (config?.players || []).map((player) => player.id).sort();
          if (new Set(statePlayerIds).size !== run.playerCount
            || stableStringify(statePlayerIds) !== stableStringify(configuredIds)) {
            errors.push(`Game ${gameIndex} final-state events must cover every configured player exactly once.`);
          }
          const normalized = gameStates.map((event) => stableStringify(event.normalizedResult ?? event.result ?? null));
          if (new Set(normalized).size !== 1) errors.push(`Game ${gameIndex} final-state results are inconsistent across players.`);
        }
      }
    }

    const gameStarts = timeline.filter((event) => event.type === "game_started");
    if (completionRequirements === null || requiresVisibleTerminal) {
      if (gameStarts.length !== gamesToPlay) errors.push(`Complete run must contain ${gamesToPlay} game_started events; found ${gameStarts.length}.`);
    }
    const firstGameSequence = Math.min(...gameStarts.map((event) => Number(event.sequence)), Number.POSITIVE_INFINITY);

    if (Object.hasOwn(config || {}, "testPurpose")) {
      const purpose = config.testPurpose || {};
      if (stableStringify(run.testPurpose || null) !== stableStringify(purpose)) {
        errors.push("run.json testPurpose differs from config.resolved.json.");
      }
      const initialized = timeline.find((event) => event.type === "run_initialized");
      if (stableStringify(initialized?.testPurpose || null) !== stableStringify(purpose)) {
        errors.push("run_initialized must record the resolved testPurpose.");
      }
      if (!genericContract) {
      const participationEvents = timeline.filter((event) => event.type === "vote_participation");
      if (participationEvents.length !== gamesToPlay) {
        errors.push(`Complete run must contain ${gamesToPlay} vote_participation events; found ${participationEvents.length}.`);
      }
      const configuredIds = (config.players || []).map((player) => player.id).sort();
      for (let gameIndex = 1; gameIndex <= gamesToPlay; gameIndex += 1) {
        const matches = participationEvents.filter((candidate) => candidate.gameIndex === gameIndex);
        if (matches.length !== 1) {
          errors.push(`Game ${gameIndex} must contain exactly one vote_participation event; found ${matches.length}.`);
          continue;
        }
        validateVoteParticipation(purpose, configuredIds, matches[0], gameIndex, errors);
        if (matches[0].actualSettlementTrigger === "deadline") {
          validateDeadlineEvidence(timeline, config, gameIndex, errors);
        }
        const voters = new Set((matches[0].actualVoterIds || []).map(String));
        const settlementMarker = timeline.find((candidate) => candidate.type === "settlement_visible" && candidate.gameIndex === gameIndex);
        const deadlineReached = timeline.find((candidate) => candidate.type === "deadline_reached" && candidate.gameIndex === gameIndex);
        for (const playerId of configuredIds) {
          const actions = voteActions.get(`${playerId}:${gameIndex}`) || [];
          if (voters.has(playerId)) {
            if (actions.length !== 1 || actions[0].playerId !== playerId || actions[0].source !== "visible_dom"
              || !String(actions[0].targetId || "")) {
              errors.push(`Game ${gameIndex} ${playerId} actual vote is not backed by exactly one private visible vote_action event.`);
            } else if (writerOrder(actions[0]) === null || writerOrder(matches[0]) === null
              || writerOrder(actions[0]) >= writerOrder(matches[0])
              || writerOrder(settlementMarker) === null || writerOrder(actions[0]) >= writerOrder(settlementMarker)) {
              errors.push(`Game ${gameIndex} ${playerId} vote_action was not recorded before visible settlement evidence.`);
            }
          } else if (actions.length !== 0) {
            errors.push(`Game ${gameIndex} ${playerId} is listed as a non-voter but has a vote_action event.`);
          }

          if (["natural_play", "behavior_matrix"].includes(purpose.mode)) {
            const decisions = participationDecisions.get(`${playerId}:${gameIndex}`) || [];
            if (decisions.length !== 1) {
              errors.push(`Game ${gameIndex} ${playerId} must have exactly one autonomous final vote/abstain Decision; found ${decisions.length}.`);
              continue;
            }
            const decision = decisions[0].decision;
            if (writerOrder(decision) === null || writerOrder(matches[0]) === null
              || writerOrder(decision) >= writerOrder(matches[0])) {
              errors.push(`Game ${gameIndex} ${playerId} final participation Decision was recorded after vote participation/result evidence.`);
            }
            if (voters.has(playerId)) {
              if (decision.action !== "vote" || decision.timingIntent !== "vote_now"
                || decision.readyToVote !== true || !Array.isArray(decision.targets) || decision.targets.length !== 1) {
                errors.push(`Game ${gameIndex} ${playerId} voter participation is not backed by a valid autonomous vote Decision.`);
              }
              if (actions.length === 1 && (writerOrder(decision) === null
                || writerOrder(actions[0]) === null || writerOrder(decision) >= writerOrder(actions[0]))) {
                errors.push(`Game ${gameIndex} ${playerId} autonomous vote Decision was not recorded before the visible vote action.`);
              }
              if (actions.length === 1 && String(decision.targets?.[0] || "") !== String(actions[0].targetId || "")) {
                errors.push(`Game ${gameIndex} ${playerId} vote_action target differs from the autonomous vote Decision.`);
              }
            } else if (!["wait", "abstain"].includes(decision.action)
              || decision.timingIntent !== "abstain_until_deadline"
              || decision.readyToVote !== false
              || !Array.isArray(decision.targets) || decision.targets.length !== 0) {
              errors.push(`Game ${gameIndex} ${playerId} non-voter participation is not backed by an autonomous abstain Decision.`);
            }
            if (!voters.has(playerId) && matches[0].actualSettlementTrigger === "deadline"
              && (writerOrder(deadlineReached) === null || writerOrder(decision) === null
                || writerOrder(decision) >= writerOrder(deadlineReached))) {
              errors.push(`Game ${gameIndex} ${playerId} abstain Decision was not recorded before the visible deadline.`);
            }
          }
        }
      }
      } else {
        const journeyEvents = timeline.filter((event) => event.type === "journey_started");
        for (let gameIndex = 1; gameIndex <= gamesToPlay; gameIndex += 1) {
          for (const journeyId of purpose.journeyIds || []) {
            const matches = journeyEvents.filter((event) => event.gameIndex === gameIndex && event.journeyId === journeyId);
            if (matches.length !== 1) errors.push(`Game ${gameIndex} requires one journey_started event for ${journeyId}.`);
          }
        }
        const criterionEvents = timeline.filter((event) => event.type === "criterion_result");
        const criterionExecutions = completionRequirements === null ? 1 : gamesToPlay;
        for (let gameIndex = 1; gameIndex <= criterionExecutions; gameIndex += 1) {
          for (const criterion of purpose.successCriteria || []) {
            const matches = criterionEvents.filter((event) => event.criterionId === criterion.id
              && (completionRequirements === null || event.gameIndex === gameIndex));
            if (matches.length !== 1) errors.push(`Success criterion ${criterion.id} requires exactly one criterion_result event${completionRequirements === null ? "" : ` in execution ${gameIndex}`}.`);
            if (matches[0] && !["visible_dom", "cross_tab_consistency", "evidence_refs"].includes(matches[0].source)) {
              errors.push(`Success criterion ${criterion.id} must use a user-visible oracle.`);
            }
            if (matches[0]?.source === "evidence_refs") {
              validateScopedEvidenceRefs(matches[0].evidenceRefs, scopedEvidenceByRef,
                `Success criterion ${criterion.id}`, errors);
            }
            if (criterion.required && run.productVerdict === "pass" && matches[0]?.passed !== true) {
              errors.push(`Passing Run has an unmet required criterion: ${criterion.id}.`);
            }
          }
        }
        validateJourneyCompletion(timeline, finalStates, config, run, scopedEvidenceByRef, errors);
      }
    }

    const productTests = timeline.filter((event) => event.type === "product_test" && event.passed === true);
    if (productTests.length !== 1) errors.push(`Complete run must contain exactly one passing product_test event; found ${productTests.length}.`);
    if (!run.productBuild?.gitHead || !run.productBuild?.productSourceSha256 || run.productBuild?.passed !== true) {
      errors.push("Complete run is missing productBuild identity in run.json.");
    }
    if (!/^[0-9a-f]{40}$/i.test(String(run.productBuild?.gitHead || ""))
      || !/^[0-9a-f]{64}$/i.test(String(run.productBuild?.productSourceSha256 || ""))
      || typeof run.productBuild?.sourceTreeDirty !== "boolean") {
      errors.push("productBuild must contain a 40-hex Git commit, 64-hex source digest, and sourceTreeDirty boolean.");
    }
    const productTest = productTests[0];
    if (productTest) {
      if (Number(productTest.sequence) >= firstGameSequence) errors.push("product_test must be recorded before the first game starts.");
      if (productTest.gitHead !== run.productBuild?.gitHead
        || productTest.productSourceSha256 !== run.productBuild?.productSourceSha256
        || productTest.command !== run.productBuild?.command
        || productTest.sourceTreeDirty !== run.productBuild?.sourceTreeDirty) {
        errors.push("product_test build identity differs from run.json productBuild.");
      }
    }
    const buildVerifications = timeline.filter((event) => event.type === "product_build_verified");
    if (buildVerifications.length !== 1) errors.push(`Complete run must contain exactly one product_build_verified event; found ${buildVerifications.length}.`);
    const buildVerification = buildVerifications[0];
    if (buildVerification && Number(buildVerification.sequence) !== timeline.length - 1) {
      errors.push("product_build_verified must be the penultimate timeline event immediately before run_finished.");
    }
    if (buildVerification && (buildVerification.gitHead !== run.productBuild?.gitHead
      || buildVerification.productSourceSha256 !== run.productBuild?.productSourceSha256
      || buildVerification.sourceTreeDirty !== run.productBuild?.sourceTreeDirty)) {
      errors.push("Product source changed between pre-game test and final verification.");
    }

    if (!String(run.serverManagedBySkill || "")) errors.push("Complete run is missing actual server-management metadata.");
    if (run.agentProvenance?.mode !== "isolated_subagents") errors.push("Complete run is missing isolated-subagent provenance.");
    if (!Array.isArray(run.agentProvenance?.players) || run.agentProvenance.players.length !== run.playerCount) {
      errors.push("Complete run agent provenance does not cover every player.");
    }
    const configuredPlayerIds = new Set((config?.players || []).map((player) => player.id));
    const provenancePlayerIds = (run.agentProvenance?.players || []).map((player) => player.id);
    const provenanceAgents = (run.agentProvenance?.players || []).map((player) => String(player.agent || ""));
    if (new Set(provenancePlayerIds).size !== run.playerCount
      || provenancePlayerIds.some((id) => !configuredPlayerIds.has(id))
      || new Set(provenanceAgents).size !== run.playerCount
      || provenanceAgents.some((agent) => !agent)) {
      errors.push("Complete run agent provenance must map every configured player to one unique agent.");
    }
    if (run.agentProvenance?.forkTurns !== "none"
      || run.agentProvenance?.browserAccess !== false
      || run.agentProvenance?.projectAccess !== false) {
      errors.push("Complete run agent provenance must record forkTurns:none and no browser/project access.");
    }
    const isolation = run.isolation || {};
    if (![isolation.playerTabs, isolation.privateUi, isolation.agentDecisionContext, isolation.evidenceRefs]
      .every((value) => value === "pass")) {
      errors.push("Complete run must pass tab identity, private UI, agent context, and evidenceRefs isolation checks.");
    }
    const isolationEvents = timeline.filter((event) => event.type === "isolation_check");
    if (isolationEvents.length !== gamesToPlay) {
      errors.push(`Complete run must contain ${gamesToPlay} isolation_check events; found ${isolationEvents.length}.`);
    }
    for (let gameIndex = 1; gameIndex <= gamesToPlay; gameIndex += 1) {
      const event = isolationEvents.find((candidate) => candidate.gameIndex === gameIndex);
      if (!event || ![event.playerTabs, event.privateUi, event.agentContext, event.evidenceRefs].every((value) => value === true)) {
        errors.push(`Game ${gameIndex} isolation_check must pass all four isolation dimensions.`);
      }
    }
    const provenanceEvents = timeline.filter((event) => event.type === "agent_provenance");
    if (provenanceEvents.length !== 1) errors.push(`Complete run must contain exactly one agent_provenance event; found ${provenanceEvents.length}.`);
    if (provenanceEvents[0] && Number(provenanceEvents[0].sequence) >= firstGameSequence) {
      errors.push("agent_provenance must be recorded before the first game starts.");
    }
    if (provenanceEvents[0]?.mode !== "isolated_subagents"
      || provenanceEvents[0]?.forkTurns !== "none"
      || provenanceEvents[0]?.browserAccess !== false
      || provenanceEvents[0]?.projectAccess !== false
      || !Array.isArray(provenanceEvents[0]?.players)
      || provenanceEvents[0].players.length !== run.playerCount) {
      errors.push("agent_provenance event does not prove isolated players without browser/project access.");
    }
    if (provenanceEvents[0]
      && stableStringify(provenanceEvents[0].players) !== stableStringify(run.agentProvenance?.players || [])) {
      errors.push("agent_provenance event differs from run.json agentProvenance.");
    }

    const capabilityEvents = timeline.filter((event) => event.type === "server_capability");
    if (capabilityEvents.length !== 1) errors.push(`Complete run must contain exactly one server_capability event; found ${capabilityEvents.length}.`);
    if (capabilityEvents[0] && Number(capabilityEvents[0].sequence) >= firstGameSequence) {
      errors.push("server_capability must be recorded before the first game starts.");
    }
    const capabilityEvidence = capabilityEvents[0];
    if (capabilityEvidence) {
      if (!isLocalUrl(capabilityEvidence.endpoint)
        || new URL(capabilityEvidence.endpoint).pathname !== "/__ai-e2e/capabilities") {
        errors.push("server_capability must record the exact localhost capability endpoint.");
      }
      if (capabilityEvidence.serverManagement !== run.serverManagedBySkill
        || run.speed?.serverManagedBySkill !== run.serverManagedBySkill) {
        errors.push("Server management metadata differs between capability evidence, run.json, and actual speed.");
      }
    }
    const identityChecks = timeline.filter((event) => event.type === "identity_check" && event.passed === true);
    if (identityChecks.length !== 1) errors.push(`Complete run must contain exactly one passing identity_check event; found ${identityChecks.length}.`);
    if (identityChecks[0] && Number(identityChecks[0].sequence) >= firstGameSequence) {
      errors.push("identity_check must be recorded before the first game starts.");
    }
    const reconnectMode = String(config?.reconnect?.mode || "none");
    if (identityChecks[0] && reconnectMode !== "none"
      && (!identityChecks[0].reload?.playerId
        || identityChecks[0].reload?.identityPreserved !== true
        || identityChecks[0].reload?.otherTabsUnaffected !== true)) {
      errors.push("identity_check must prove one-tab reload identity persistence and unaffected peer tabs.");
    }
    if (!genericContract || config?.adapter?.capabilities?.identityProof === "public_chat_and_own_dom") {
    for (const player of config?.players || []) {
      const expectedMessage = `IDENTITY_CHECK ${player.id} ${player.name}`;
      const matches = chat.filter((event) => event.type === "identity_message"
        && event.playerId === player.id
        && event.playerName === player.name
        && event.message === expectedMessage
        && event.source === "visible_dom");
      if (matches.length !== 1) errors.push(`${player.id} must have one exact visible identity chat message.`);
      if (matches[0] && gameStarts[0] && timestampMs(matches[0].at) > timestampMs(gameStarts[0].at)) {
        errors.push(`${player.id} identity chat message must be recorded before game start.`);
      }
    }
    }

    if (!genericContract) {
    const settlementDetails = timeline.filter((event) => event.type === "settlement_detail");
    for (let gameIndex = 1; gameIndex <= gamesToPlay; gameIndex += 1) {
      const settlementMarkers = timeline.filter((event) => event.type === "settlement_visible" && event.gameIndex === gameIndex);
      if (strictContract && (settlementMarkers.length !== 1 || settlementMarkers[0]?.source !== "visible_dom")) {
        errors.push(`Game ${gameIndex} requires exactly one visible_dom settlement_visible marker.`);
      }
      const details = settlementDetails.filter((event) => event.gameIndex === gameIndex);
      if (details.length !== 1) {
        errors.push(`Game ${gameIndex} must contain exactly one settlement_detail event; found ${details.length}.`);
        continue;
      }
      const detail = details[0];
      const markerAt = timestampMs(settlementMarkers[0]?.at);
      if (strictContract && (markerAt === null || timestampMs(detail.at) < markerAt
        || writerOrder(settlementMarkers[0]) === null || writerOrder(detail) === null
        || writerOrder(detail) <= writerOrder(settlementMarkers[0]))) {
        errors.push(`Game ${gameIndex} settlement_detail was recorded before settlement became visible.`);
      }
      if (!String(detail.headline || "") || !String(detail.reason || "") || !String(detail.winner || "")) {
        errors.push(`Game ${gameIndex} settlement_detail is missing headline, reason, or winner.`);
      }
      if (!Array.isArray(detail.eliminated) || !Array.isArray(detail.centerCards) || detail.centerCards.length !== 3) {
        errors.push(`Game ${gameIndex} settlement_detail has invalid eliminated or centerCards data.`);
      }
      if (!Array.isArray(detail.votes) || detail.votes.length !== run.playerCount) {
        errors.push(`Game ${gameIndex} settlement_detail must contain one vote per player.`);
      }
      const participation = timeline.filter((event) => event.type === "vote_participation" && event.gameIndex === gameIndex);
      if (Array.isArray(detail.votes) && participation.length === 1) {
        const nameToId = new Map((config?.players || []).map((player) => [String(player.name), String(player.id)]));
        const normalizedVoterId = (vote) => {
          const raw = String(vote.voterId ?? vote.voter ?? "");
          return nameToId.get(raw) || raw;
        };
        const hasTarget = (vote) => {
          const target = vote.targetId ?? vote.target;
          return target !== null && target !== undefined && String(target) !== "";
        };
        const settlementVoters = detail.votes.filter(hasTarget).map(normalizedVoterId).sort();
        const observedVoters = [...(participation[0].actualVoterIds || [])].map(String).sort();
        if (stableStringify(settlementVoters) !== stableStringify(observedVoters)) {
          errors.push(`Game ${gameIndex} settlement_detail votes disagree with vote_participation actualVoterIds.`);
        }
        if (strictContract && ["natural_play", "behavior_matrix"].includes(purposeMode)) {
          for (const vote of detail.votes.filter(hasTarget)) {
            const voterId = normalizedVoterId(vote);
            const records = participationDecisions.get(`${voterId}:${gameIndex}`) || [];
            if (records.length !== 1) continue;
            const rawTarget = String(vote.targetId ?? vote.target ?? "");
            const settlementTarget = nameToId.get(rawTarget) || rawTarget;
            const decisionTargetRaw = String(records[0].decision.targets?.[0] ?? "");
            const decisionTarget = nameToId.get(decisionTargetRaw) || decisionTargetRaw;
            if (decisionTarget !== settlementTarget) {
              errors.push(`Game ${gameIndex} ${voterId} settlement target differs from the autonomous vote Decision.`);
            }
          }
        }
        for (const vote of detail.votes.filter(hasTarget)) {
          const voterId = normalizedVoterId(vote);
          const actions = voteActions.get(`${voterId}:${gameIndex}`) || [];
          if (actions.length !== 1) continue;
          const rawTarget = String(vote.targetId ?? vote.target ?? "");
          const settlementTarget = nameToId.get(rawTarget) || rawTarget;
          const actionTargetRaw = String(actions[0].targetId || "");
          const actionTarget = nameToId.get(actionTargetRaw) || actionTargetRaw;
          if (actionTarget !== settlementTarget) {
            errors.push(`Game ${gameIndex} ${voterId} settlement target differs from private vote_action evidence.`);
          }
        }
      }
      if (!detail.finalRoles || Object.keys(detail.finalRoles).length !== run.playerCount) {
        errors.push(`Game ${gameIndex} settlement_detail must contain every final role.`);
      }
      if (!Array.isArray(detail.nightHistory) || !detail.nightHistory.length) {
        errors.push(`Game ${gameIndex} settlement_detail is missing night history.`);
      }
      const expectedNormalized = {
        headline: detail.headline,
        reason: detail.reason,
        winner: detail.winner,
        execution: detail.eliminated,
        votes: detail.votes,
        finalRoles: detail.finalRoles,
        centerCards: detail.centerCards,
        nightHistory: detail.nightHistory
      };
      const gameStates = finalStates.filter((event) => event.gameIndex === gameIndex);
      for (const state of gameStates) {
        if (strictContract && (markerAt === null || timestampMs(state.at) < markerAt
          || writerOrder(settlementMarkers[0]) === null || writerOrder(state) === null
          || writerOrder(state) <= writerOrder(settlementMarkers[0]))) {
          errors.push(`Game ${gameIndex} ${state.playerId || "unknown player"} final-state predates visible settlement.`);
        }
        if (stableStringify(state.normalizedResult) !== stableStringify(expectedNormalized)) {
          errors.push(`Game ${gameIndex} ${state.playerId || "unknown player"} final-state is not the full settlement_detail normalization.`);
        }
      }
    }
    } else if (requiresVisibleTerminal) {
      const resultDetails = timeline.filter((event) => event.type === "result_detail");
      for (let gameIndex = 1; gameIndex <= gamesToPlay; gameIndex += 1) {
        const terminalMarkers = timeline.filter((event) => event.type === "terminal_visible" && event.gameIndex === gameIndex);
        if (terminalMarkers.length !== 1 || terminalMarkers[0]?.source !== "visible_dom") {
          errors.push(`Game ${gameIndex} requires exactly one visible_dom terminal_visible event.`);
        }
        const details = resultDetails.filter((event) => event.gameIndex === gameIndex);
        if (details.length !== 1) {
          errors.push(`Game ${gameIndex} requires exactly one generic result_detail event.`);
          continue;
        }
        const detail = details[0];
        const marker = terminalMarkers[0];
        if (!String(detail.outcomeId || "") || !String(detail.summary || "")
          || !detail.result || typeof detail.result !== "object" || Array.isArray(detail.result)) {
          errors.push(`Game ${gameIndex} result_detail requires outcomeId, summary, and an object result.`);
        }
        if (typeof adapter?.validateResult === "function") {
          try {
            adapter.validateResult(detail.result, {
              gameIndex,
              config,
              run,
              terminal: marker,
              resultDetail: detail,
              finalStates: finalStates.filter((event) => event.gameIndex === gameIndex)
            }, errors);
          } catch (error) {
            errors.push(`Game ${gameIndex} Adapter result validation failed: ${error.message}`);
          }
        }
        if (detail.source !== "visible_dom" || detail.contentClass !== "public_ui") {
          errors.push(`Game ${gameIndex} result_detail must come from visible public UI.`);
        }
        if (!marker || writerOrder(detail) === null || writerOrder(marker) === null
          || writerOrder(detail) <= writerOrder(marker)) {
          errors.push(`Game ${gameIndex} result_detail predates visible terminal state.`);
        }
        const gameStates = finalStates.filter((event) => event.gameIndex === gameIndex);
        for (const state of gameStates) {
          if (!marker || writerOrder(state) === null || writerOrder(state) <= writerOrder(marker)) {
            errors.push(`Game ${gameIndex} ${state.playerId || "unknown player"} final-state predates visible terminal state.`);
          }
          if (stableStringify(state.normalizedResult) !== stableStringify(detail.result)) {
            errors.push(`Game ${gameIndex} ${state.playerId || "unknown player"} final-state differs from generic result_detail.`);
          }
        }
      }
    }

    if (!genericContract && purposeMode === "behavior_matrix" && config?.discussion?.enforceBehaviorCoverage === true) {
      const evaluations = timeline.filter((event) => event.type === "behavior_evaluation");
      const expectedCount = run.playerCount * gamesToPlay;
      if (evaluations.length !== expectedCount) {
        errors.push(`Complete run must contain ${expectedCount} behavior_evaluation events; found ${evaluations.length}.`);
      }
      for (let gameIndex = 1; gameIndex <= gamesToPlay; gameIndex += 1) {
        for (const player of config?.players || []) {
          const matches = evaluations.filter((event) => event.gameIndex === gameIndex && event.playerId === player.id);
          if (matches.length !== 1) {
            errors.push(`Game ${gameIndex} ${player.id} must have exactly one behavior_evaluation event.`);
            continue;
          }
          const evaluation = matches[0];
          const configuredBehavior = String(player.communicationBehavior || "adaptive");
          const decisionsForGame = behaviorDecisions.get(`${player.id}:${gameIndex}`) || [];
          if (evaluation.configuredBehavior !== configuredBehavior) {
            errors.push(`Game ${gameIndex} ${player.id} behavior_evaluation differs from the configured behavior.`);
          }
          if (!COMMUNICATION_INTENTS.has(String(evaluation.observedIntent || ""))) {
            errors.push(`Game ${gameIndex} ${player.id} has an invalid observedIntent.`);
          }
          if (!decisionsForGame.some((decision) => decision.intent === evaluation.observedIntent)) {
            errors.push(`Game ${gameIndex} ${player.id} behavior_evaluation is not backed by a discussion Decision.`);
          }
          if (!["truthful", "partial", "false", "none", "not_evaluated"].includes(String(evaluation.claimAssessment || ""))) {
            errors.push(`Game ${gameIndex} ${player.id} has an invalid claimAssessment.`);
          }
          if (configuredBehavior === "strategic_silence"
            && (evaluation.observedIntent !== "strategic_silence" || evaluation.spoke !== false || evaluation.claimAssessment !== "none")) {
            errors.push(`Game ${gameIndex} ${player.id} did not prove strategic silence.`);
          }
          if (configuredBehavior === "deceptive_claim"
            && (evaluation.observedIntent !== "deceptive_claim" || evaluation.spoke !== true
              || evaluation.claimAssessment !== "false" || !String(evaluation.settlementEvidence || ""))) {
            errors.push(`Game ${gameIndex} ${player.id} did not prove a deceptive claim against settlement evidence.`);
          }
          if (configuredBehavior === "selective_disclosure"
            && (evaluation.observedIntent !== "selective_disclosure" || evaluation.spoke !== true
              || !["partial", "false"].includes(evaluation.claimAssessment))) {
            errors.push(`Game ${gameIndex} ${player.id} did not prove selective disclosure.`);
          }
          if (configuredBehavior === "evidence_sharing" && evaluation.spoke !== true) {
            errors.push(`Game ${gameIndex} ${player.id} did not publish the configured evidence-sharing claim.`);
          }
        }
      }
    }

    for (const expected of discussionMessagesExpected) {
      const matches = chat.filter((event) => event.type === "message"
        && event.observationId === expected.observationId
        && event.playerId === expected.playerId);
      if (matches.length !== 1) {
        errors.push(`${expected.playerId} Decision ${expected.observationId} must have exactly one per-action public chat event; found ${matches.length}.`);
        continue;
      }
      if (String(matches[0].message || "") !== expected.message) {
        errors.push(`${expected.playerId} Decision ${expected.observationId} differs from rendered chat evidence.`);
      }
      const messageAt = timestampMs(matches[0].at);
      const decisionAt = timestampMs(expected.decisionAt);
      const invalidChronology = strictContract
        ? writerOrder(matches[0]) === null || !Number.isInteger(Number(expected.decisionOrder))
          || writerOrder(matches[0]) <= Number(expected.decisionOrder)
        : messageAt === null || decisionAt === null || messageAt < decisionAt;
      if (invalidChronology) {
        errors.push(`${expected.playerId} Decision ${expected.observationId} has invalid evidence chronology.`);
      }
    }

    const capability = capabilityEvents[0];
    if (Number(run.speed?.serverTimeScale) < 1) {
      if (!capability || Number(capability.status) !== 200 || capability.response?.enabled !== true
        || Number(capability.response?.timeScale) !== Number(run.speed.serverTimeScale)
        || capability.response?.timingFidelity !== "accelerated_waits") {
        errors.push("Accelerated run is missing a matching server_capability response.");
      }
      const advertisedWaits = new Set(capability?.response?.scalableWaits || []);
      if ((run.speed?.scalableWaits || []).some((wait) => !advertisedWaits.has(wait))) {
        errors.push("Accelerated server capability does not advertise every adapter scalableWait.");
      }
      if (Number(run.capability?.timeScale) !== Number(run.speed.serverTimeScale)) {
        errors.push("Accelerated run run.json capability does not match the actual speed.");
      }
    } else {
      if (!capability || Number(capability.status) !== 404) {
        errors.push("Production-time run must record the disabled E2E capability 404 before play.");
      }
      if (run.capability?.enabled !== false || Number(run.capability?.timeScale) !== 1) {
        errors.push("Production-time run run.json capability must record disabled scale 1.0.");
      }
    }
  }
  if (legacy) warnings.push("這是 schemaVersion 0.3 舊版 Run；使用相容模式稽核，不改寫原始資料。");

  const findings = run.findings || {};
  const blockingFindings = Number(findings.P0 || 0) + Number(findings.P1 || 0) + Number(findings.decisionIsolationFailures || 0);
  if (blockingFindings > 0 && options.ignoreBlockingFindings !== true) {
    errors.push("Run 含有 P0、未處理 P1 或決策隔離失敗。");
  }

  if (genericContract && typeof adapter?.auditRun === "function") {
    try {
      adapter.auditRun({
        runDir: resolvedRun,
        run,
        config,
        timeline,
        chat,
        finalStates,
        completionRequirements,
        evidenceByRef: scopedEvidenceByRef
      }, errors, warnings);
    } catch (error) {
      errors.push(`Adapter Run audit failed: ${error.message}`);
    }
  }

  const audit = {
    schemaVersion: "1.0",
    auditorSha256: crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex"),
    runId: run.runId,
    auditedAt: new Date().toISOString(),
    compatibleSchema: legacy ? "0.3" : run.schemaVersion,
    passed: errors.length === 0,
    counts: {
      players: playerIds.length,
      observations: observationCount,
      decisions: decisionCount,
      publicTimelineEvents: timeline.length,
      finalStates: finalStates.length,
      errors: errors.length,
      warnings: warnings.length
    },
    timingFidelity: run.speed?.timingFidelity || (legacy ? "production" : "unknown"),
    errors,
    warnings
  };
  if (options.write !== false) writeJson(path.join(resolvedRun, "audit.json"), audit);
  return audit;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const runDir = args.run || args.positional[0];
  if (!runDir) throw new Error("用法：node audit-run.js --run <run-dir>");
  const audit = auditRun(runDir, { write: !args["no-write"] });
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  if (!audit.passed) process.exitCode = 1;
  return audit;
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
  IMAGE_EXTENSIONS,
  allFiles,
  hasImagePayload,
  screenshotDirectories,
  parseJsonLines,
  validateVoteParticipation,
  validateDeadlineEvidence,
  validateCoverageExecution,
  resolvedCompletionRequirements,
  requiresCompletionKind,
  validateJourneyCompletion,
  auditRun,
  main
};
