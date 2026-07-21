"use strict";

const crypto = require("crypto");
const { stableStringify } = require("./core");

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const EVIDENCE_SCOPES = new Set(["public", "player", "cross_tab"]);
const RESET_KINDS = new Set(["none", "lobby", "room"]);
const DEFAULT_OPTIMIZATION = Object.freeze({
  objective: "wall_clock",
  tieBreakers: Object.freeze(["resets", "randomness", "route_id"])
});

function fail(message) {
  throw new Error(`CoverageModel: ${message}`);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) fail(`${label} must be a stable lowercase ID.`);
}

function assertSeconds(value, label, allowZero = true) {
  if (!Number.isFinite(value) || value < (allowZero ? 0 : Number.EPSILON)) {
    fail(`${label} must be a ${allowZero ? "non-negative" : "positive"} number of seconds.`);
  }
}

function sortedUnique(values, label) {
  if (!Array.isArray(values)) fail(`${label} must be an array.`);
  const result = [...new Set(values)];
  for (const value of result) assertId(value, `${label} entry`);
  return result.sort();
}

function isSubset(expected, actual) {
  if (Array.isArray(expected)) return Array.isArray(actual) && stableStringify(expected) === stableStringify(actual);
  if (expected && typeof expected === "object") {
    return actual && typeof actual === "object" && !Array.isArray(actual)
      && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && isSubset(value, actual[key]));
  }
  return stableStringify(expected) === stableStringify(actual);
}

function uniqueById(values, label) {
  if (!Array.isArray(values) || values.length === 0) fail(`${label} must be a non-empty array.`);
  const map = new Map();
  for (const item of values) {
    assertObject(item, `${label} entry`);
    assertId(item.id, `${label} entry id`);
    if (map.has(item.id)) fail(`${label} contains duplicate id ${item.id}.`);
    map.set(item.id, item);
  }
  return map;
}

function validateCoverageModel(raw) {
  assertObject(raw, "root");
  if (raw.schemaVersion !== "1.0") fail("schemaVersion must be 1.0.");
  assertId(raw.game, "game");

  const rawCheckpoints = uniqueById(raw.checkpoints, "checkpoints");
  const rawProfiles = uniqueById(raw.setupProfiles, "setupProfiles");
  const rawRoutes = uniqueById(raw.routes, "routes");
  const rawTransitions = Array.isArray(raw.transitions) ? raw.transitions : [];
  const rawTransitionMap = new Map();
  for (const item of rawTransitions) {
    assertObject(item, "transitions entry");
    assertId(item.id, "transitions entry id");
    if (rawTransitionMap.has(item.id)) fail(`transitions contains duplicate id ${item.id}.`);
    rawTransitionMap.set(item.id, item);
  }

  const checkpoints = [...rawCheckpoints.values()].map((item) => {
    const prerequisiteCheckpointIds = sortedUnique(item.prerequisiteCheckpointIds || [], `checkpoint ${item.id} prerequisites`);
    if (item.evidenceScope !== undefined && !EVIDENCE_SCOPES.has(item.evidenceScope)) {
      fail(`checkpoint ${item.id} evidenceScope must be public, player, or cross_tab.`);
    }
    return Object.freeze({
      id: item.id,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : item.id,
      evidenceScope: item.evidenceScope || "public",
      prerequisiteCheckpointIds
    });
  }).sort((a, b) => a.id.localeCompare(b.id));
  const checkpointIds = new Set(checkpoints.map((item) => item.id));
  for (const checkpoint of checkpoints) {
    for (const prerequisite of checkpoint.prerequisiteCheckpointIds) {
      if (!checkpointIds.has(prerequisite)) fail(`checkpoint ${checkpoint.id} references unknown prerequisite ${prerequisite}.`);
      if (prerequisite === checkpoint.id) fail(`checkpoint ${checkpoint.id} cannot require itself.`);
    }
  }

  const profiles = [...rawProfiles.values()].map((item) => {
    assertId(item.initialStateId, `setupProfile ${item.id} initialStateId`);
    assertSeconds(item.setupSeconds, `setupProfile ${item.id} setupSeconds`);
    assertSeconds(item.resetSeconds, `setupProfile ${item.id} resetSeconds`);
    const playerCount = item.playerCount || {};
    const min = playerCount.min === undefined ? 1 : playerCount.min;
    const max = playerCount.max === undefined ? 99 : playerCount.max;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
      fail(`setupProfile ${item.id} playerCount must contain a valid min/max range.`);
    }
    return Object.freeze({
      id: item.id,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : item.id,
      initialStateId: item.initialStateId,
      gameSettings: item.gameSettings && typeof item.gameSettings === "object" && !Array.isArray(item.gameSettings)
        ? item.gameSettings
        : {},
      playerCount: Object.freeze({ min, max }),
      setupSeconds: item.setupSeconds,
      resetSeconds: item.resetSeconds,
      deterministic: item.deterministic !== false
    });
  }).sort((a, b) => a.id.localeCompare(b.id));
  const profileIds = new Set(profiles.map((item) => item.id));

  const routes = [...rawRoutes.values()].map((item) => {
    if (!profileIds.has(item.setupProfileId)) fail(`route ${item.id} references unknown setupProfile ${item.setupProfileId}.`);
    assertId(item.startStateId, `route ${item.id} startStateId`);
    assertId(item.endStateId, `route ${item.id} endStateId`);
    assertSeconds(item.estimatedSeconds, `route ${item.id} estimatedSeconds`, false);
    const coversCheckpointIds = sortedUnique(item.coversCheckpointIds, `route ${item.id} coversCheckpointIds`);
    if (coversCheckpointIds.length === 0) fail(`route ${item.id} must cover at least one checkpoint.`);
    const prerequisiteCheckpointIds = sortedUnique(item.prerequisiteCheckpointIds || [], `route ${item.id} prerequisites`);
    for (const checkpointId of [...coversCheckpointIds, ...prerequisiteCheckpointIds]) {
      if (!checkpointIds.has(checkpointId)) fail(`route ${item.id} references unknown checkpoint ${checkpointId}.`);
    }
    return Object.freeze({
      id: item.id,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : item.id,
      coversCheckpointIds,
      setupProfileId: item.setupProfileId,
      startStateId: item.startStateId,
      endStateId: item.endStateId,
      prerequisiteCheckpointIds,
      estimatedSeconds: item.estimatedSeconds,
      requiresFreshExecution: item.requiresFreshExecution === true,
      deterministic: item.deterministic !== false
    });
  }).sort((a, b) => a.id.localeCompare(b.id));

  const transitions = [...rawTransitionMap.values()].map((item) => {
    if (!profileIds.has(item.setupProfileId)) fail(`transition ${item.id} references unknown setupProfile ${item.setupProfileId}.`);
    assertId(item.fromStateId, `transition ${item.id} fromStateId`);
    assertId(item.toStateId, `transition ${item.id} toStateId`);
    assertSeconds(item.estimatedSeconds, `transition ${item.id} estimatedSeconds`);
    if (item.resetKind !== undefined && !RESET_KINDS.has(item.resetKind)) {
      fail(`transition ${item.id} resetKind must be none, lobby, or room.`);
    }
    return Object.freeze({
      id: item.id,
      setupProfileId: item.setupProfileId,
      fromStateId: item.fromStateId,
      toStateId: item.toStateId,
      estimatedSeconds: item.estimatedSeconds,
      resetKind: item.resetKind || "none",
      deterministic: item.deterministic !== false
    });
  }).sort((a, b) => a.id.localeCompare(b.id));

  const dependencies = new Map(checkpoints.map((item) => [item.id, item.prerequisiteCheckpointIds]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) fail(`checkpoint prerequisites contain a cycle at ${id}.`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) || []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const checkpoint of checkpoints) visit(checkpoint.id);

  return Object.freeze({
    schemaVersion: "1.0",
    game: raw.game,
    checkpoints: Object.freeze(checkpoints),
    setupProfiles: Object.freeze(profiles),
    routes: Object.freeze(routes),
    transitions: Object.freeze(transitions)
  });
}

function deriveCoverageModel(adapter, catalogEntry, game) {
  if (adapter?.coverageModel) return adapter.coverageModel;
  const capabilities = catalogEntry?.capabilities || {};
  const declarations = [
    ...(Array.isArray(capabilities.journeys) ? capabilities.journeys.map((entry) => ({ ...entry, kind: "journey" })) : []),
    ...(Array.isArray(capabilities.scenarios) ? capabilities.scenarios.map((entry) => ({ ...entry, kind: "scenario" })) : [])
  ];
  const checkpointIds = [...new Set(declarations.flatMap((declaration) =>
    (declaration.completionRequirements || [])
      .filter((requirement) => requirement.kind === "checkpoint")
      .map((requirement) => requirement.checkpointId || requirement.id)
  ))].sort();
  if (!checkpointIds.length) return null;
  const routes = declarations.map((declaration) => {
    const coversCheckpointIds = [...new Set((declaration.completionRequirements || [])
      .filter((requirement) => requirement.kind === "checkpoint")
      .map((requirement) => requirement.checkpointId || requirement.id))].sort();
    if (!coversCheckpointIds.length) return null;
    return {
      id: `${declaration.kind}.${declaration.id}`,
      title: declaration.title || declaration.id,
      coversCheckpointIds,
      setupProfileId: "catalog-default",
      startStateId: "entry",
      endStateId: "entry",
      estimatedSeconds: Number.isFinite(Number(declaration.estimatedSeconds)) && Number(declaration.estimatedSeconds) > 0
        ? Number(declaration.estimatedSeconds)
        : 300,
      requiresFreshExecution: true,
      deterministic: declaration.deterministic !== false
    };
  }).filter(Boolean);
  return {
    schemaVersion: "1.0",
    game,
    checkpoints: checkpointIds.map((id) => ({ id, evidenceScope: "public" })),
    setupProfiles: [{
      id: "catalog-default",
      title: "Catalog-derived default setup",
      initialStateId: "entry",
      setupSeconds: 0,
      resetSeconds: 0,
      playerCount: catalogEntry?.playerCount || { min: 1, max: 20 },
      deterministic: true
    }],
    routes,
    transitions: []
  };
}

function normalizeRequest(raw, model) {
  assertObject(raw, "request");
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== "1.0") fail("request schemaVersion must be 1.0.");
  if (raw.game !== undefined && raw.game !== model.game) fail(`request game ${raw.game} does not match model game ${model.game}.`);
  const known = new Set(model.checkpoints.map((item) => item.id));
  const targets = sortedUnique(raw.targetCheckpointIds || [], "request targetCheckpointIds");
  if (targets.length === 0) fail("request targetCheckpointIds must not be empty.");
  const completed = sortedUnique(raw.completedCheckpointIds || [], "request completedCheckpointIds");
  const reused = sortedUnique(raw.reusedCheckpointIds || [], "request reusedCheckpointIds");
  if (completed.some((id) => reused.includes(id))) fail("request completedCheckpointIds and reusedCheckpointIds must not overlap.");
  for (const id of [...targets, ...completed, ...reused]) {
    if (!known.has(id)) fail(`request references unknown checkpoint ${id}.`);
  }
  const excludedRouteIds = sortedUnique(raw.excludedRouteIds || [], "request excludedRouteIds");
  const knownRoutes = new Set(model.routes.map((item) => item.id));
  for (const id of excludedRouteIds) if (!knownRoutes.has(id)) fail(`request excludes unknown route ${id}.`);
  const allowedSetupProfileIds = raw.allowedSetupProfileIds === undefined
    ? model.setupProfiles.map((item) => item.id)
    : sortedUnique(raw.allowedSetupProfileIds, "request allowedSetupProfileIds");
  const knownProfiles = new Set(model.setupProfiles.map((item) => item.id));
  for (const id of allowedSetupProfileIds) if (!knownProfiles.has(id)) fail(`request allows unknown setupProfile ${id}.`);
  if (raw.playerCount !== undefined && (!Number.isInteger(raw.playerCount) || raw.playerCount < 1)) {
    fail("request playerCount must be a positive integer.");
  }
  if (raw.currentSetupProfileId !== undefined && raw.currentSetupProfileId !== null && !knownProfiles.has(raw.currentSetupProfileId)) {
    fail(`request currentSetupProfileId ${raw.currentSetupProfileId} is unknown.`);
  }
  if (raw.currentStateId !== undefined && raw.currentStateId !== null) assertId(raw.currentStateId, "request currentStateId");
  const hasCurrentProfile = raw.currentSetupProfileId !== undefined && raw.currentSetupProfileId !== null;
  const hasCurrentState = raw.currentStateId !== undefined && raw.currentStateId !== null;
  if (hasCurrentProfile !== hasCurrentState) fail("request currentSetupProfileId and currentStateId must be provided together.");
  if (hasCurrentProfile) {
    const knownStates = new Set();
    const profile = model.setupProfiles.find((item) => item.id === raw.currentSetupProfileId);
    knownStates.add(profile.initialStateId);
    model.routes.filter((item) => item.setupProfileId === profile.id).forEach((item) => {
      knownStates.add(item.startStateId);
      knownStates.add(item.endStateId);
    });
    model.transitions.filter((item) => item.setupProfileId === profile.id).forEach((item) => {
      knownStates.add(item.fromStateId);
      knownStates.add(item.toStateId);
    });
    if (!knownStates.has(raw.currentStateId)) fail(`request currentStateId ${raw.currentStateId} is unknown for setupProfile ${profile.id}.`);
  }
  return {
    schemaVersion: "1.0",
    game: model.game,
    targetCheckpointIds: targets,
    completedCheckpointIds: completed,
    reusedCheckpointIds: reused,
    excludedRouteIds,
    allowedSetupProfileIds,
    playerCount: raw.playerCount,
    gameSettings: raw.gameSettings && typeof raw.gameSettings === "object" && !Array.isArray(raw.gameSettings) ? raw.gameSettings : {},
    currentSetupProfileId: raw.currentSetupProfileId || null,
    currentStateId: raw.currentStateId || null,
    replanReason: typeof raw.replanReason === "string" && raw.replanReason.trim() ? raw.replanReason.trim() : null,
    previousPlanSha256: typeof raw.previousPlanSha256 === "string" ? raw.previousPlanSha256 : null,
    optimization: { ...DEFAULT_OPTIMIZATION }
  };
}

function historicalRouteCosts(evidenceIndex, request) {
  const samples = new Map();
  if (!evidenceIndex || !Array.isArray(evidenceIndex.runs)) return {};
  const settingsKey = stableStringify(request.gameSettings || {});
  for (const run of evidenceIndex.runs) {
    if (!run || run.game !== request.game || run.audit?.passed !== true) continue;
    if (request.playerCount !== undefined && run.playerCount !== request.playerCount) continue;
    for (const item of run.coverageRoutes || []) {
      if (!item || typeof item.routeId !== "string" || !Number.isFinite(item.durationMs) || item.durationMs < 0) continue;
      if (item.gameSettings !== undefined && stableStringify(item.gameSettings) !== settingsKey) continue;
      if (!samples.has(item.routeId)) samples.set(item.routeId, []);
      samples.get(item.routeId).push(item.durationMs / 1000);
    }
  }
  const result = {};
  for (const [routeId, values] of samples) {
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    result[routeId] = { seconds: median, sampleCount: values.length, source: "historical_median" };
  }
  return result;
}

function transitionTables(model) {
  const tables = new Map();
  for (const profile of model.setupProfiles) {
    const states = new Set([profile.initialStateId]);
    for (const route of model.routes.filter((item) => item.setupProfileId === profile.id)) {
      states.add(route.startStateId);
      states.add(route.endStateId);
    }
    for (const transition of model.transitions.filter((item) => item.setupProfileId === profile.id)) {
      states.add(transition.fromStateId);
      states.add(transition.toStateId);
    }
    const distances = new Map();
    const better = (left, right) => {
      if (!right) return true;
      if (left.seconds !== right.seconds) return left.seconds < right.seconds;
      if (left.resets !== right.resets) return left.resets < right.resets;
      if (left.random !== right.random) return left.random < right.random;
      return left.pathKey.localeCompare(right.pathKey) < 0;
    };
    for (const from of states) {
      for (const to of states) distances.set(`${from}\u0000${to}`, from === to
        ? { seconds: 0, resets: 0, random: 0, pathIds: [], pathKey: "" }
        : { seconds: Infinity, resets: Infinity, random: Infinity, pathIds: [], pathKey: "" });
    }
    for (const transition of model.transitions.filter((item) => item.setupProfileId === profile.id)) {
      const key = `${transition.fromStateId}\u0000${transition.toStateId}`;
      const candidate = {
        seconds: transition.estimatedSeconds,
        resets: transition.resetKind === "none" ? 0 : 1,
        random: transition.deterministic ? 0 : 1,
        pathIds: [transition.id],
        pathKey: transition.id
      };
      if (better(candidate, distances.get(key))) distances.set(key, candidate);
    }
    const ordered = [...states].sort();
    for (const via of ordered) {
      for (const from of ordered) {
        for (const to of ordered) {
          const first = distances.get(`${from}\u0000${via}`);
          const second = distances.get(`${via}\u0000${to}`);
          const candidate = {
            seconds: first.seconds + second.seconds,
            resets: first.resets + second.resets,
            random: first.random + second.random,
            pathIds: [...first.pathIds, ...second.pathIds],
            pathKey: [...first.pathIds, ...second.pathIds].join("\u0000")
          };
          const key = `${from}\u0000${to}`;
          if (better(candidate, distances.get(key))) distances.set(key, candidate);
        }
      }
    }
    tables.set(profile.id, distances);
  }
  return tables;
}

function compareCost(left, right) {
  if (left.totalEstimatedSeconds !== right.totalEstimatedSeconds) return left.totalEstimatedSeconds - right.totalEstimatedSeconds;
  if (left.resetCount !== right.resetCount) return left.resetCount - right.resetCount;
  if (left.randomDependencyCount !== right.randomDependencyCount) return left.randomDependencyCount - right.randomDependencyCount;
  return left.routeKey.localeCompare(right.routeKey);
}

function computePlanHash(plan) {
  const copy = { ...plan };
  delete copy.planSha256;
  return crypto.createHash("sha256").update(stableStringify(copy)).digest("hex");
}

function createBlockedPlan(model, request, details) {
  const plan = {
    schemaVersion: "1.0",
    game: model.game,
    status: "incomplete",
    targetCheckpointIds: request.targetCheckpointIds,
    reusedCheckpointIds: request.reusedCheckpointIds.filter((id) => request.targetCheckpointIds.includes(id)),
    completedCheckpointIds: request.completedCheckpointIds.filter((id) => request.targetCheckpointIds.includes(id)),
    supportCheckpointIds: details.supportCheckpointIds || [],
    pendingCheckpointIds: details.pendingCheckpointIds,
    routes: [],
    totalEstimatedSeconds: 0,
    resetCount: 0,
    randomDependencyCount: 0,
    uncoveredCheckpointIds: details.uncoveredCheckpointIds,
    optimization: request.optimization,
    replan: request.replanReason ? {
      reason: request.replanReason,
      previousPlanSha256: request.previousPlanSha256
    } : null,
    blockedReason: details.blockedReason
  };
  plan.planSha256 = computePlanHash(plan);
  return plan;
}

function planCoverage(rawModel, rawRequest, options = {}) {
  const model = validateCoverageModel(rawModel);
  const request = normalizeRequest(rawRequest, model);
  if (model.checkpoints.length > 24) fail("models with more than 24 checkpoints must be split into bounded coverage groups.");
  if (model.routes.length > 64) fail("models with more than 64 routes must be split into bounded route groups.");

  const completedSet = new Set([...request.completedCheckpointIds, ...request.reusedCheckpointIds]);
  const pendingTargets = request.targetCheckpointIds.filter((id) => !completedSet.has(id));
  const checkpointById = new Map(model.checkpoints.map((item) => [item.id, item]));
  const required = new Set(pendingTargets);
  function requireDependencies(id) {
    for (const dependency of checkpointById.get(id).prerequisiteCheckpointIds) {
      if (completedSet.has(dependency) || required.has(dependency)) continue;
      required.add(dependency);
      requireDependencies(dependency);
    }
  }
  for (const id of pendingTargets) requireDependencies(id);
  let dependencyExpansionChanged = true;
  while (dependencyExpansionChanged) {
    dependencyExpansionChanged = false;
    for (const route of model.routes) {
      if (!route.coversCheckpointIds.some((id) => required.has(id))) continue;
      for (const dependency of route.prerequisiteCheckpointIds) {
        if (completedSet.has(dependency) || required.has(dependency)) continue;
        required.add(dependency);
        requireDependencies(dependency);
        dependencyExpansionChanged = true;
      }
    }
  }
  const relevantIds = [...required].sort();
  const possibleSupportCheckpointIds = relevantIds.filter((id) => !request.targetCheckpointIds.includes(id));
  if (pendingTargets.length === 0) {
    const plan = createBlockedPlan(model, request, {
      pendingCheckpointIds: [],
      uncoveredCheckpointIds: [],
      supportCheckpointIds: [],
      blockedReason: null
    });
    plan.status = "complete";
    plan.planSha256 = computePlanHash(plan);
    return plan;
  }

  const bitById = new Map(relevantIds.map((id, index) => [id, 1 << index]));
  let requiredMask = 0;
  for (const id of pendingTargets) requiredMask |= bitById.get(id);
  let initialMask = 0;
  for (const id of completedSet) if (bitById.has(id)) initialMask |= bitById.get(id);
  const profileById = new Map(model.setupProfiles.map((item) => [item.id, item]));
  const allowedProfiles = new Set(request.allowedSetupProfileIds.filter((id) => {
    const profile = profileById.get(id);
    const playerCompatible = request.playerCount === undefined
      || (request.playerCount >= profile.playerCount.min && request.playerCount <= profile.playerCount.max);
    return playerCompatible && isSubset(profile.gameSettings, request.gameSettings);
  }));
  const excludedRoutes = new Set(request.excludedRouteIds);
  const routes = model.routes.filter((route) => allowedProfiles.has(route.setupProfileId) && !excludedRoutes.has(route.id));
  const tables = transitionTables(model);
  const historicalCosts = options.historicalCosts || historicalRouteCosts(options.evidenceIndex, request);

  const queue = [{
    mask: initialMask,
    profileId: request.currentSetupProfileId,
    stateId: request.currentStateId,
    totalEstimatedSeconds: 0,
    resetCount: 0,
    randomDependencyCount: 0,
    routeKey: "",
    routes: []
  }];
  const best = new Map();
  let solution = null;
  while (queue.length) {
    queue.sort(compareCost);
    const current = queue.shift();
    const stateKey = `${current.mask}|${current.profileId || ""}|${current.stateId || ""}`;
    const previous = best.get(stateKey);
    if (previous && compareCost(previous, current) <= 0) continue;
    best.set(stateKey, current);
    if ((current.mask & requiredMask) === requiredMask) {
      solution = current;
      break;
    }

    for (const route of routes) {
      let routeMask = 0;
      for (const id of route.coversCheckpointIds) if (bitById.has(id)) routeMask |= bitById.get(id);
      if ((routeMask & ~current.mask) === 0) continue;
      let prerequisitesMet = true;
      for (const id of route.prerequisiteCheckpointIds) {
        if (completedSet.has(id)) continue;
        const bit = bitById.get(id);
        if (bit === undefined || (current.mask & bit) === 0) prerequisitesMet = false;
      }
      for (const id of route.coversCheckpointIds) {
        if (!bitById.has(id) || (current.mask & bitById.get(id)) !== 0) continue;
        for (const dependency of checkpointById.get(id).prerequisiteCheckpointIds) {
          if (completedSet.has(dependency)) continue;
          const bit = bitById.get(dependency);
          if (bit === undefined || (current.mask & bit) === 0) prerequisitesMet = false;
        }
      }
      if (!prerequisitesMet) continue;

      const profile = profileById.get(route.setupProfileId);
      const distances = tables.get(route.setupProfileId);
      let positioningSeconds = 0;
      let resetIncrement = 0;
      let randomPositioning = 0;
      let transitionPathIds = [];
      let resetBefore = "none";
      if (!current.profileId) {
        const initialDistance = distances.get(`${profile.initialStateId}\u0000${route.startStateId}`);
        if (!Number.isFinite(initialDistance.seconds)) continue;
        positioningSeconds = profile.setupSeconds + initialDistance.seconds;
        resetIncrement = initialDistance.resets;
        randomPositioning = (profile.deterministic ? 0 : 1) + initialDistance.random;
        transitionPathIds = initialDistance.pathIds;
        resetBefore = "initial_setup";
      } else if (current.profileId === route.setupProfileId && !route.requiresFreshExecution) {
        const directDistance = distances.get(`${current.stateId}\u0000${route.startStateId}`);
        if (Number.isFinite(directDistance.seconds)) {
          positioningSeconds = directDistance.seconds;
          resetIncrement = directDistance.resets;
          randomPositioning = directDistance.random;
          transitionPathIds = directDistance.pathIds;
          if (directDistance.resets > 0) resetBefore = "declared_transition_reset";
        }
        else {
          const resetDistance = distances.get(`${profile.initialStateId}\u0000${route.startStateId}`);
          if (!Number.isFinite(resetDistance.seconds)) continue;
          positioningSeconds = profile.resetSeconds + profile.setupSeconds + resetDistance.seconds;
          resetIncrement = 1 + resetDistance.resets;
          randomPositioning = (profile.deterministic ? 0 : 1) + resetDistance.random;
          transitionPathIds = resetDistance.pathIds;
          resetBefore = "unreachable_reset";
        }
      } else {
        const initialDistance = distances.get(`${profile.initialStateId}\u0000${route.startStateId}`);
        if (!Number.isFinite(initialDistance.seconds)) continue;
        const priorReset = profileById.get(current.profileId).resetSeconds;
        positioningSeconds = priorReset + profile.setupSeconds + initialDistance.seconds;
        resetIncrement = 1 + initialDistance.resets;
        randomPositioning = (profile.deterministic ? 0 : 1) + initialDistance.random;
        transitionPathIds = initialDistance.pathIds;
        resetBefore = route.requiresFreshExecution ? "fresh_execution" : "profile_change";
      }

      const historical = historicalCosts[route.id];
      const routeSeconds = historical && Number.isFinite(historical.seconds) ? historical.seconds : route.estimatedSeconds;
      const costSource = historical && Number.isFinite(historical.seconds) ? "historical_median" : "adapter_baseline";
      const coveredNow = route.coversCheckpointIds.filter((id) => bitById.has(id) && (current.mask & bitById.get(id)) === 0).sort();
      const nextRoutes = [...current.routes, {
        sequence: current.routes.length + 1,
        routeId: route.id,
        checkpointIds: coveredNow,
        setupProfileId: route.setupProfileId,
        startStateId: route.startStateId,
        endStateId: route.endStateId,
        transitionPathIds,
        positioningSeconds,
        routeSeconds,
        estimatedSeconds: positioningSeconds + routeSeconds,
        costSource,
        historicalSampleCount: costSource === "historical_median" ? historical.sampleCount : 0,
        resetBefore
      }];
      queue.push({
        mask: current.mask | routeMask,
        profileId: route.setupProfileId,
        stateId: route.endStateId,
        totalEstimatedSeconds: current.totalEstimatedSeconds + positioningSeconds + routeSeconds,
        resetCount: current.resetCount + resetIncrement,
        randomDependencyCount: current.randomDependencyCount + randomPositioning + (route.deterministic ? 0 : 1),
        routeKey: nextRoutes.map((item) => item.routeId).join("\u0000"),
        routes: nextRoutes
      });
    }
  }

  if (!solution) {
    const reachable = new Set(completedSet);
    let changed = true;
    while (changed) {
      changed = false;
      for (const route of routes) {
        const dependencies = new Set(route.prerequisiteCheckpointIds);
        for (const coveredId of route.coversCheckpointIds) {
          for (const dependency of checkpointById.get(coveredId).prerequisiteCheckpointIds) dependencies.add(dependency);
        }
        if ([...dependencies].every((id) => reachable.has(id))) {
          for (const id of route.coversCheckpointIds) if (!reachable.has(id)) {
            reachable.add(id);
            changed = true;
          }
        }
      }
    }
    const uncovered = pendingTargets.filter((id) => !reachable.has(id));
    return createBlockedPlan(model, request, {
      pendingCheckpointIds: pendingTargets,
      uncoveredCheckpointIds: uncovered.length ? uncovered : pendingTargets,
      supportCheckpointIds: possibleSupportCheckpointIds,
      blockedReason: "unreachable_checkpoints"
    });
  }

  const supportCheckpointIds = [...new Set(solution.routes
    .flatMap((route) => route.checkpointIds)
    .filter((id) => !request.targetCheckpointIds.includes(id)))].sort();
  const plan = {
    schemaVersion: "1.0",
    game: model.game,
    status: "complete",
    targetCheckpointIds: request.targetCheckpointIds,
    reusedCheckpointIds: request.reusedCheckpointIds.filter((id) => request.targetCheckpointIds.includes(id)),
    completedCheckpointIds: request.completedCheckpointIds.filter((id) => request.targetCheckpointIds.includes(id)),
    supportCheckpointIds,
    pendingCheckpointIds: pendingTargets,
    routes: solution.routes,
    totalEstimatedSeconds: solution.totalEstimatedSeconds,
    resetCount: solution.resetCount,
    randomDependencyCount: solution.randomDependencyCount,
    uncoveredCheckpointIds: [],
    optimization: request.optimization,
    replan: request.replanReason ? {
      reason: request.replanReason,
      previousPlanSha256: request.previousPlanSha256
    } : null,
    blockedReason: null
  };
  plan.planSha256 = computePlanHash(plan);
  return plan;
}

module.exports = {
  DEFAULT_OPTIMIZATION,
  validateCoverageModel,
  deriveCoverageModel,
  historicalRouteCosts,
  computePlanHash,
  planCoverage
};
