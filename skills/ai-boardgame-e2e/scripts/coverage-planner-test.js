"use strict";

const assert = require("assert");
const { historicalRouteCosts, planCoverage, validateCoverageModel } = require("./coverage-planner");
const { validateCoverageExecution } = require("./audit-run");
const { reusedCheckpointIds } = require("./plan-coverage");

function model(overrides = {}) {
  return {
    schemaVersion: "1.0",
    game: "synthetic",
    checkpoints: [
      { id: "cp.alpha", evidenceScope: "public" },
      { id: "cp.beta", evidenceScope: "public" },
      { id: "cp.gamma", evidenceScope: "player", prerequisiteCheckpointIds: ["cp.alpha"] }
    ],
    setupProfiles: [
      { id: "default", initialStateId: "lobby", setupSeconds: 10, resetSeconds: 5, playerCount: { min: 2, max: 8 }, deterministic: true }
    ],
    routes: [
      { id: "route.alpha", coversCheckpointIds: ["cp.alpha"], setupProfileId: "default", startStateId: "lobby", endStateId: "alpha", estimatedSeconds: 12, deterministic: true },
      { id: "route.beta", coversCheckpointIds: ["cp.beta"], setupProfileId: "default", startStateId: "alpha", endStateId: "beta", estimatedSeconds: 12, deterministic: true },
      { id: "route.beta-direct", coversCheckpointIds: ["cp.beta"], setupProfileId: "default", startStateId: "lobby", endStateId: "beta", estimatedSeconds: 15, deterministic: true },
      { id: "route.combined", coversCheckpointIds: ["cp.alpha", "cp.beta"], setupProfileId: "default", startStateId: "lobby", endStateId: "beta", estimatedSeconds: 20, deterministic: true },
      { id: "route.gamma", coversCheckpointIds: ["cp.gamma"], prerequisiteCheckpointIds: ["cp.alpha"], setupProfileId: "default", startStateId: "alpha", endStateId: "gamma", estimatedSeconds: 8, deterministic: true }
    ],
    transitions: [
      { id: "move.alpha.beta", setupProfileId: "default", fromStateId: "alpha", toStateId: "alpha", estimatedSeconds: 0 }
    ],
    ...overrides
  };
}

function request(targetCheckpointIds, extra = {}) {
  return {
    schemaVersion: "1.0",
    game: "synthetic",
    targetCheckpointIds,
    playerCount: 3,
    gameSettings: { mode: "default" },
    ...extra
  };
}

function runCoveragePlannerTests() {
  const combined = planCoverage(model(), request(["cp.alpha", "cp.beta"]));
  assert.equal(combined.status, "complete");
  assert.deepEqual(combined.routes.map((item) => item.routeId), ["route.combined"]);
  assert.equal(combined.totalEstimatedSeconds, 30);
  assert.equal(combined.resetCount, 0);

  const evidenceIndex = {
    runs: [
      { game: "synthetic", playerCount: 3, audit: { passed: true }, coverageRoutes: [
        { routeId: "route.combined", durationMs: 80000, gameSettings: { mode: "default" } },
        { routeId: "route.alpha", durationMs: 4000, gameSettings: { mode: "default" } },
        { routeId: "route.beta", durationMs: 4000, gameSettings: { mode: "default" } }
      ] },
      { game: "synthetic", playerCount: 3, audit: { passed: true }, coverageRoutes: [
        { routeId: "route.combined", durationMs: 100000, gameSettings: { mode: "default" } },
        { routeId: "route.alpha", durationMs: 6000, gameSettings: { mode: "default" } },
        { routeId: "route.beta", durationMs: 6000, gameSettings: { mode: "default" } }
      ] }
    ]
  };
  const costs = historicalRouteCosts(evidenceIndex, request(["cp.alpha", "cp.beta"]));
  assert.equal(costs["route.combined"].seconds, 90);
  assert.equal(costs["route.alpha"].seconds, 5);
  const historicallyOptimized = planCoverage(model(), request(["cp.alpha", "cp.beta"]), { evidenceIndex });
  assert.deepEqual(historicallyOptimized.routes.map((item) => item.routeId), ["route.alpha", "route.beta"]);
  assert.ok(historicallyOptimized.routes.every((item) => item.costSource === "historical_median"));

  const reused = planCoverage(model(), request(["cp.alpha", "cp.beta"], { reusedCheckpointIds: ["cp.alpha"] }));
  assert.deepEqual(reused.pendingCheckpointIds, ["cp.beta"]);
  assert.deepEqual(reused.routes.map((item) => item.routeId), ["route.beta-direct"]);

  const replanned = planCoverage(model(), request(["cp.alpha", "cp.beta"], {
    completedCheckpointIds: ["cp.alpha"],
    excludedRouteIds: ["route.combined"],
    currentSetupProfileId: "default",
    currentStateId: "alpha",
    replanReason: "random state unavailable",
    previousPlanSha256: combined.planSha256
  }));
  assert.deepEqual(replanned.routes.map((item) => item.routeId), ["route.beta"]);
  assert.equal(replanned.routes[0].positioningSeconds, 0);
  assert.equal(replanned.replan.previousPlanSha256, combined.planSha256);

  const missing = planCoverage(model({
    routes: model().routes.filter((item) => !item.coversCheckpointIds.includes("cp.gamma"))
  }), request(["cp.gamma"]));
  assert.equal(missing.status, "incomplete");
  assert.deepEqual(missing.uncoveredCheckpointIds, ["cp.gamma"]);
  const settingMismatch = planCoverage(model({
    setupProfiles: [{
      id: "default", initialStateId: "lobby", setupSeconds: 10, resetSeconds: 5,
      playerCount: { min: 2, max: 8 }, gameSettings: { mode: "other" }
    }]
  }), request(["cp.alpha"]));
  assert.equal(settingMismatch.status, "incomplete");

  const deterministicModel = model({
    checkpoints: [{ id: "cp.alpha" }],
    routes: [
      { id: "route.a-random", coversCheckpointIds: ["cp.alpha"], setupProfileId: "default", startStateId: "lobby", endStateId: "done", estimatedSeconds: 5, deterministic: false },
      { id: "route.z-stable", coversCheckpointIds: ["cp.alpha"], setupProfileId: "default", startStateId: "lobby", endStateId: "done", estimatedSeconds: 5, deterministic: true }
    ],
    transitions: []
  });
  assert.equal(planCoverage(deterministicModel, request(["cp.alpha"])).routes[0].routeId, "route.z-stable");
  const lexicalModel = {
    ...deterministicModel,
    routes: deterministicModel.routes.map((item) => ({ ...item, deterministic: true }))
  };
  assert.equal(planCoverage(lexicalModel, request(["cp.alpha"])).routes[0].routeId, "route.a-random");

  const resetTieModel = model({
    checkpoints: [{ id: "cp.alpha" }, { id: "cp.beta" }],
    setupProfiles: [
      { id: "p1", initialStateId: "lobby", setupSeconds: 0, resetSeconds: 0, playerCount: { min: 2, max: 8 } },
      { id: "p2", initialStateId: "lobby", setupSeconds: 0, resetSeconds: 0, playerCount: { min: 2, max: 8 } }
    ],
    routes: [
      { id: "route.a-reset-alpha", coversCheckpointIds: ["cp.alpha"], setupProfileId: "p1", startStateId: "lobby", endStateId: "isolated", estimatedSeconds: 4 },
      { id: "route.b-reset-beta", coversCheckpointIds: ["cp.beta"], setupProfileId: "p2", startStateId: "lobby", endStateId: "done", estimatedSeconds: 6 },
      { id: "route.z-stay-alpha", coversCheckpointIds: ["cp.alpha"], setupProfileId: "p1", startStateId: "lobby", endStateId: "middle", estimatedSeconds: 4 },
      { id: "route.zz-stay-beta", coversCheckpointIds: ["cp.beta"], setupProfileId: "p1", startStateId: "middle", endStateId: "done", estimatedSeconds: 6 }
    ],
    transitions: []
  });
  const resetTie = planCoverage(resetTieModel, request(["cp.alpha", "cp.beta"]));
  assert.deepEqual(resetTie.routes.map((item) => item.routeId), ["route.z-stay-alpha", "route.zz-stay-beta"]);
  assert.equal(resetTie.resetCount, 0);

  assert.deepEqual(reusedCheckpointIds({ candidates: [
    { classification: "partial_reuse", reusableCheckpointIds: ["cp.alpha"] },
    { classification: "historical_only", matched: { checkpointIds: ["cp.beta"] } }
  ] }), ["cp.alpha"]);

  const first = planCoverage(model(), request(["cp.alpha", "cp.beta"]));
  const second = planCoverage(model(), request(["cp.alpha", "cp.beta"]));
  assert.deepEqual(second, first);
  assert.match(first.planSha256, /^[a-f0-9]{64}$/);

  const approvedPlan = { coveragePlan: first };
  const coverageTimeline = [{
    type: "coverage_plan_created",
    writerOrder: 1,
    planSha256: first.planSha256,
    targetCheckpointIds: first.targetCheckpointIds,
    reusedCheckpointIds: first.reusedCheckpointIds,
    pendingCheckpointIds: first.pendingCheckpointIds,
    routeIds: first.routes.map((route) => route.routeId),
    totalEstimatedSeconds: first.totalEstimatedSeconds,
    coveragePlan: first
  }];
  first.routes.forEach((route, index) => {
    coverageTimeline.push({
      type: "coverage_route_started",
      writerOrder: index * 2 + 2,
      gameIndex: 1,
      routeId: route.routeId,
      checkpointIds: route.checkpointIds,
      setupProfileId: route.setupProfileId,
      startStateId: route.startStateId,
      estimatedSeconds: route.estimatedSeconds
    });
    coverageTimeline.push({
      type: "coverage_route_completed",
      writerOrder: index * 2 + 3,
      gameIndex: 1,
      routeId: route.routeId,
      checkpointIds: route.checkpointIds,
      setupProfileId: route.setupProfileId,
      endStateId: route.endStateId,
      durationMs: route.routeSeconds * 1000,
      evidenceRefs: route.checkpointIds.map((id) => `public:${id}`)
    });
  });
  first.pendingCheckpointIds.forEach((checkpointId) => coverageTimeline.push({
    type: "checkpoint_result",
    checkpointId,
    passed: true,
    evidenceRefs: [`public:${checkpointId}`]
  }));
  const coverageErrors = [];
  validateCoverageExecution(coverageTimeline, approvedPlan, coverageErrors);
  assert.deepEqual(coverageErrors, []);
  const incompleteErrors = [];
  validateCoverageExecution(coverageTimeline.filter((event) => event.type !== "checkpoint_result"), approvedPlan, incompleteErrors);
  assert(incompleteErrors.some((message) => message.includes("passing checkpoint_result")));

  const initialMultiRoute = planCoverage(model(), request(["cp.alpha", "cp.beta"], {
    excludedRouteIds: ["route.combined", "route.beta-direct"]
  }));
  const remainingPlan = planCoverage(model(), request(["cp.alpha", "cp.beta"], {
    completedCheckpointIds: ["cp.alpha"],
    excludedRouteIds: ["route.combined"],
    currentSetupProfileId: "default",
    currentStateId: "alpha",
    replanReason: "observed route unavailable",
    previousPlanSha256: initialMultiRoute.planSha256
  }));
  const replanTimeline = [
    {
      type: "coverage_plan_created", writerOrder: 1,
      planSha256: initialMultiRoute.planSha256,
      targetCheckpointIds: initialMultiRoute.targetCheckpointIds,
      reusedCheckpointIds: [], pendingCheckpointIds: initialMultiRoute.pendingCheckpointIds,
      routeIds: initialMultiRoute.routes.map((route) => route.routeId), totalEstimatedSeconds: initialMultiRoute.totalEstimatedSeconds,
      coveragePlan: initialMultiRoute
    },
    {
      type: "coverage_route_started", writerOrder: 2, gameIndex: 1,
      routeId: "route.alpha", checkpointIds: ["cp.alpha"], setupProfileId: "default", startStateId: "lobby", estimatedSeconds: 22
    },
    {
      type: "coverage_route_completed", writerOrder: 3, gameIndex: 1,
      routeId: "route.alpha", checkpointIds: ["cp.alpha"], setupProfileId: "default", endStateId: "alpha",
      durationMs: 12000, evidenceRefs: ["public:cp.alpha"]
    },
    { type: "checkpoint_result", writerOrder: 4, checkpointId: "cp.alpha", passed: true, evidenceRefs: ["public:cp.alpha"] },
    {
      type: "coverage_replanned", writerOrder: 5, gameIndex: 1,
      previousPlanSha256: initialMultiRoute.planSha256, newPlanSha256: remainingPlan.planSha256,
      remainingCheckpointIds: ["cp.beta"], reason: "observed route unavailable"
    },
    {
      type: "coverage_plan_created", writerOrder: 6, replanOf: initialMultiRoute.planSha256,
      planSha256: remainingPlan.planSha256, targetCheckpointIds: remainingPlan.targetCheckpointIds,
      reusedCheckpointIds: [], pendingCheckpointIds: remainingPlan.pendingCheckpointIds,
      routeIds: remainingPlan.routes.map((route) => route.routeId), totalEstimatedSeconds: remainingPlan.totalEstimatedSeconds,
      coveragePlan: remainingPlan
    },
    {
      type: "coverage_route_started", writerOrder: 7, gameIndex: 1,
      routeId: "route.beta", checkpointIds: ["cp.beta"], setupProfileId: "default", startStateId: "alpha", estimatedSeconds: 12
    },
    {
      type: "coverage_route_completed", writerOrder: 8, gameIndex: 1,
      routeId: "route.beta", checkpointIds: ["cp.beta"], setupProfileId: "default", endStateId: "beta",
      durationMs: 12000, evidenceRefs: ["public:cp.beta"]
    },
    { type: "checkpoint_result", writerOrder: 9, checkpointId: "cp.beta", passed: true, evidenceRefs: ["public:cp.beta"] }
  ];
  const replanErrors = [];
  validateCoverageExecution(replanTimeline, { coveragePlan: initialMultiRoute }, replanErrors);
  assert.deepEqual(replanErrors, []);

  assert.throws(() => validateCoverageModel(model({
    checkpoints: [
      { id: "cp.alpha", prerequisiteCheckpointIds: ["cp.beta"] },
      { id: "cp.beta", prerequisiteCheckpointIds: ["cp.alpha"] }
    ],
    routes: model().routes.filter((item) => !item.coversCheckpointIds.includes("cp.gamma"))
  })), /cycle/);
  assert.throws(() => validateCoverageModel(model({
    routes: [{ id: "route.bad", coversCheckpointIds: ["cp.missing"], setupProfileId: "default", startStateId: "lobby", endStateId: "done", estimatedSeconds: 1 }]
  })), /unknown checkpoint/);

  return true;
}

if (require.main === module) {
  runCoveragePlannerTests();
  process.stdout.write("coverage planner tests passed\n");
}

module.exports = { runCoveragePlannerTests };
