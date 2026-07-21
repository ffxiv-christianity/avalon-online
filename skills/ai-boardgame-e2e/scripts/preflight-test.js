#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { catalog, resolveConfig, writeJson } = require("./core");
const { loadAdapter } = require("./adapters");
const { deriveCoverageModel, planCoverage } = require("./coverage-planner");
const {
  approvePlan,
  createDraftPlan,
  validateQuestionnaire,
  verifyApprovedPlan
} = require("./plan-contract");
const { queryEvidence, sanitizedResultEvents } = require("./evidence-history");

function expectError(callback, expression) {
  let error;
  try {
    callback();
  } catch (caught) {
    error = caught;
  }
  assert(error, "Expected callback to throw.");
  assert(expression.test(error.message), `Unexpected error: ${error.message}`);
}

function config(artifactRoot) {
  return {
    schemaVersion: "1.1",
    game: "onenightwolf",
    entryUrl: "http://localhost:4175/Onenightwolf/",
    playerCount: 3,
    gamesToPlay: 1,
    gameSettings: { deckPreset: "recommended", discussionSeconds: 300 },
    testPurpose: {
      selectionSource: "user_questionnaire",
      objective: "Verify three users can complete one visible game with consistent results.",
      approach: "natural_user",
      userPerspective: "mixed_experience",
      focusAreas: ["core_gameplay", "information_isolation", "result_consistency"],
      journeyIds: ["create_join_complete_game"],
      scenarioIds: [],
      scenarioParameters: {},
      successCriteria: [{
        id: "visible_result",
        description: "Every tab shows the same visible terminal result.",
        oracle: "cross_tab_consistency",
        required: true
      }]
    },
    speed: { profile: "fast" },
    players: [],
    interaction: { maximumDecisionPasses: 2, allowInaction: true, userPacing: "human_like" },
    evidence: { mode: "logs_only" },
    reconnect: { mode: "none" },
    limits: { maxInvalidDecisions: 3, maxDecisionSeconds: 120, maxMinutesPerGame: 30 },
    allowExperimental: true,
    artifactRoot
  };
}

function questionnaire() {
  return {
    schemaVersion: "1.0",
    answers: {
      game: "onenightwolf",
      testType: "natural_user",
      objective: "Verify three users can complete one visible game with consistent results.",
      userPerspective: "mixed_experience",
      focusAreas: ["core_gameplay", "information_isolation", "result_consistency"],
      journeyIntent: "Create, join, and complete one game.",
      scenarioIntent: "none",
      playerCount: 3,
      gamesToPlay: 1,
      gameSettings: { deckPreset: "recommended", discussionSeconds: 300 },
      speedProfile: { profile: "fast" },
      reconnectMode: "none",
      playerBehavior: "Natural bounded decisions.",
      completionStatement: "All tabs display a visible terminal state.",
      passRules: [{ id: "visible_result", description: "All terminal results match.", oracle: "cross_tab_consistency" }],
      failRules: [{ id: "result_mismatch", description: "Any terminal result differs.", severity: "P1" }],
      notEvaluated: ["Real countdown duration"],
      stopConditions: ["User interacts with a test tab"],
      evidenceReuse: { policy: "prefer_reuse", requireCurrentBuild: true, requireProductionTiming: false }
    },
    delegatedFields: [],
    unanswered: [],
    conflicts: []
  };
}

function indexedRun(digest) {
  return {
    runId: "fixture-pass",
    runDir: "C:\\immutable\\fixture-pass",
    game: "onenightwolf",
    status: "complete",
    productVerdict: "pass",
    playerCount: 3,
    gameSettings: { deckPreset: "recommended", discussionSeconds: 300 },
    journeyIds: ["create_join_complete_game"],
    scenarioIds: [],
    objective: "Verify visible result consistency.",
    timingFidelity: "production",
    findings: { P0: 0, P1: 0, decisionIsolationFailures: 0 },
    isolation: { playerTabs: "pass", privateUi: "pass", agentDecisionContext: "pass", evidenceRefs: "pass" },
    audit: { passed: true, errorCount: 0, warningCount: 0 },
    productIdentity: { gitHead: "abc", productSourceSha256: digest, sourceTreeDirty: false },
    criteria: [{ id: "visible_result", description: "All terminal results match.", passed: true, evidenceRefs: ["g1-terminal"] }],
    checkpoints: [
      { id: "visible_terminal", passed: true, evidenceRefs: ["g1-terminal"] },
      { id: "reconnect_identity_preserved", passed: true, evidenceRefs: ["g1-reconnect"] }
    ],
    journeys: [
      { id: "create_join_complete_game", requirementIds: ["visible_terminal"], evidenceRefs: ["g1-terminal"] },
      { id: "reconnect_identity", requirementIds: ["reconnect_identity_preserved"], evidenceRefs: ["g1-reconnect"] }
    ]
  };
}

function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-boardgame-e2e-preflight-"));
  try {
    const rawConfig = config(tempRoot);
    const normalizedQuestionnaire = validateQuestionnaire(questionnaire());
    assert.strictEqual(normalizedQuestionnaire.answers.testType, "natural_user");
    const unresolved = questionnaire();
    unresolved.unanswered = ["passRules"];
    expectError(() => validateQuestionnaire(unresolved), /unanswered fields/);

    const digest = "a".repeat(64);
    const index = { schemaVersion: "1.0", runsRoot: tempRoot, runs: [indexedRun(digest)], indexSha256: "index-fixture" };
    const baseQuery = {
      schemaVersion: "1.0",
      game: "onenightwolf",
      expectedResult: "pass",
      requiredCriterionIds: ["visible_result"],
      requiredCheckpointIds: ["visible_terminal"],
      requiredJourneyIds: ["create_join_complete_game"],
      searchTerms: ["result"],
      playerCount: 3,
      gameSettings: { deckPreset: "recommended" },
      requireCurrentBuild: true,
      currentProductSourceSha256: digest,
      requireProductionTiming: false,
      requireIsolation: true
    };
    const exactAssessment = queryEvidence(index, baseQuery);
    const draft = createDraftPlan({ questionnaire: questionnaire(), config: rawConfig, evidenceAssessment: exactAssessment });
    assert.strictEqual(draft.executionDecision, "reuse_only");
    expectError(() => approvePlan(draft, { approvedBy: "user", confirmation: "yes" }), /APPROVE/);
    const approved = approvePlan(draft, {
      approvedBy: "user",
      confirmation: "APPROVE",
      now: new Date("2026-01-01T00:00:00.000Z")
    });
    const resolved = resolveConfig(rawConfig);
    const verified = verifyApprovedPlan(approved, resolved);
    assert.strictEqual(verified.executionDecision, "reuse_only");
    expectError(() => verifyApprovedPlan(approved, resolved, { forExecution: true }), /do not initialize/);
    const changed = resolveConfig({ ...rawConfig, gamesToPlay: 2 });
    expectError(() => verifyApprovedPlan(approved, changed), /config hash mismatch/);

    const featureConfig = {
      ...rawConfig,
      testPurpose: {
        ...rawConfig.testPurpose,
        objective: "Verify reconnect identity checkpoint.",
        approach: "mixed",
        focusAreas: ["reconnect"],
        journeyIds: ["reconnect_identity"],
        successCriteria: [{
          id: "reconnect_cp",
          description: "Identity remains stable after reconnect.",
          oracle: "visible_ui",
          required: true
        }]
      }
    };
    const featureQuestionnaire = questionnaire();
    Object.assign(featureQuestionnaire.answers, {
      testType: "feature_cp",
      checkpointCoverage: { mode: "selected", checkpointIds: ["reconnect_identity_preserved"] },
      objective: "Verify reconnect identity checkpoint.",
      focusAreas: ["reconnect"],
      journeyIntent: "Run only the reconnect identity journey.",
      passRules: [{ id: "reconnect_cp", description: "Identity remains stable after reconnect.", oracle: "visible_ui" }],
      evidenceReuse: { policy: "ignore_history", requireCurrentBuild: true, requireProductionTiming: false }
    });
    const oneNightEntry = catalog().games.onenightwolf;
    const coverageModel = deriveCoverageModel(loadAdapter(oneNightEntry), oneNightEntry, "onenightwolf");
    const coveragePlan = planCoverage(coverageModel, {
      schemaVersion: "1.0",
      game: "onenightwolf",
      targetCheckpointIds: ["reconnect_identity_preserved"],
      playerCount: 3,
      gameSettings: featureConfig.gameSettings
    });
    const featureDraft = createDraftPlan({
      questionnaire: featureQuestionnaire,
      config: featureConfig,
      evidenceAssessment: { schemaVersion: "1.0", disposition: "no_evidence", candidates: [] },
      coveragePlan
    });
    assert.strictEqual(featureDraft.coveragePlan.planSha256, coveragePlan.planSha256);
    const featureApproved = approvePlan(featureDraft, { approvedBy: "user", confirmation: "APPROVE" });
    assert.strictEqual(verifyApprovedPlan(featureApproved, resolveConfig(featureConfig), { forExecution: true }).coveragePlanSha256, coveragePlan.planSha256);
    const tamperedCoverage = JSON.parse(JSON.stringify(featureApproved));
    tamperedCoverage.coveragePlan.routes[0].routeSeconds += 1;
    expectError(() => verifyApprovedPlan(tamperedCoverage, resolveConfig(featureConfig)), /CoveragePlan hash mismatch/);

    const reuseFeatureQuestionnaire = JSON.parse(JSON.stringify(featureQuestionnaire));
    reuseFeatureQuestionnaire.answers.evidenceReuse.policy = "prefer_reuse";
    const featureAssessment = queryEvidence(index, {
      ...baseQuery,
      requiredCriterionIds: [],
      requiredCheckpointIds: ["reconnect_identity_preserved"],
      requiredJourneyIds: ["reconnect_identity"],
      searchTerms: []
    });
    const reusedCoveragePlan = planCoverage(coverageModel, {
      schemaVersion: "1.0",
      game: "onenightwolf",
      targetCheckpointIds: ["reconnect_identity_preserved"],
      reusedCheckpointIds: ["reconnect_identity_preserved"],
      playerCount: 3,
      gameSettings: featureConfig.gameSettings
    });
    const reusedFeatureDraft = createDraftPlan({
      questionnaire: reuseFeatureQuestionnaire,
      config: featureConfig,
      evidenceAssessment: featureAssessment,
      coveragePlan: reusedCoveragePlan
    });
    assert.strictEqual(reusedFeatureDraft.executionDecision, "reuse_only");
    assert.deepStrictEqual(reusedFeatureDraft.coveragePlan.routes, []);
    expectError(() => createDraftPlan({
      questionnaire: reuseFeatureQuestionnaire,
      config: featureConfig,
      evidenceAssessment: featureAssessment,
      coveragePlan
    }), /reused checkpoints/);

    const configPath = path.join(tempRoot, "config.json");
    const approvedPlanPath = path.join(tempRoot, "approved-plan.json");
    writeJson(configPath, rawConfig);
    const missingPlan = childProcess.spawnSync(process.execPath, [path.join(__dirname, "init-run.js"), "--config", configPath], { encoding: "utf8" });
    assert.notStrictEqual(missingPlan.status, 0);
    assert(missingPlan.stderr.includes("require --plan"));
    const executionDraft = createDraftPlan({
      questionnaire: questionnaire(),
      config: rawConfig,
      evidenceAssessment: queryEvidence(index, {
        ...baseQuery,
        requiredCriterionIds: [],
        requiredCheckpointIds: [],
        requiredJourneyIds: [],
        searchTerms: ["unseen_feature_boundary"]
      })
    });
    const executionPlan = approvePlan(executionDraft, {
      approvedBy: "user",
      confirmation: "APPROVE",
      now: new Date("2026-01-01T00:00:00.000Z")
    });
    writeJson(approvedPlanPath, executionPlan);
    const initialized = childProcess.spawnSync(process.execPath, [
      path.join(__dirname, "init-run.js"),
      "--config", configPath,
      "--plan", approvedPlanPath,
      "--run-id", "approved-preflight-fixture"
    ], { encoding: "utf8" });
    assert.strictEqual(initialized.status, 0, initialized.stderr);
    const initializedResult = JSON.parse(initialized.stdout);
    assert(fs.existsSync(path.join(initializedResult.runDir, "plan.approved.json")));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(initializedResult.runDir, "run.json"), "utf8")).preflightPlan.executionDecision, "full_run");

    const exact = queryEvidence(index, baseQuery);
    assert.strictEqual(exact.disposition, "exact_reuse");
    assert.deepStrictEqual(exact.candidates[0].evidenceRefs, ["g1-terminal"]);
    const partial = queryEvidence(index, { ...baseQuery, requiredCheckpointIds: ["visible_terminal", "missing_cp"] });
    assert.strictEqual(partial.disposition, "partial_reuse");
    assert.deepStrictEqual(partial.candidates[0].missing.checkpointIds, ["missing_cp"]);
    assert.deepStrictEqual(partial.candidates[0].reusableCheckpointIds, ["visible_terminal"]);
    const historical = queryEvidence(index, { ...baseQuery, currentProductSourceSha256: "b".repeat(64) });
    assert.strictEqual(historical.disposition, "historical_only");
    assert(historical.candidates[0].blockers.includes("product_source_mismatch"));
    const termOnly = queryEvidence(index, {
      ...baseQuery,
      requiredCriterionIds: [],
      requiredCheckpointIds: [],
      requiredJourneyIds: [],
      searchTerms: ["visible result"]
    });
    assert.strictEqual(termOnly.disposition, "partial_reuse");

    const sanitized = sanitizedResultEvents([{
      type: "criterion_result",
      criterionId: "visible_result",
      passed: true,
      evidenceRefs: ["P1-private-ref"],
      privateFacts: ["secret role"],
      notes: "secret explanation"
    }, {
      type: "coverage_route_completed",
      routeId: "journey.fixture",
      setupProfileId: "default",
      checkpointIds: ["visible_terminal"],
      durationMs: 1250,
      privateRationale: "must not be indexed"
    }], rawConfig);
    const serialized = JSON.stringify(sanitized);
    assert(serialized.includes("P1-private-ref"));
    assert(!serialized.includes("secret role"));
    assert(!serialized.includes("secret explanation"));
    assert(!serialized.includes("must not be indexed"));
    assert.strictEqual(sanitized.coverageRoutes[0].durationMs, 1250);
    return true;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    run();
    process.stdout.write("ai-boardgame-e2e preflight tests passed\n");
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { run };
