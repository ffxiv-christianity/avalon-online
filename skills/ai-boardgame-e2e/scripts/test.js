#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveConfig, initializeRun, readJson, writeJson, catalog, SKILL_ROOT } = require("./core");
const { containsForbiddenPublicKey, appendEvent } = require("./append-event");
const {
  validateVoteParticipation,
  validateDeadlineEvidence,
  validateServerCapabilityEvidence,
  validateJourneyCompletion,
  auditRun
} = require("./audit-run");
const { finalizeRun } = require("./finalize-run");
const { loadAdapter } = require("./adapters");
const oneNightAdapter = require("./adapters/onenightwolf");
const avalonAdapter = require("./adapters/avalon");
const gangsiAdapter = require("./adapters/gangsi");
const criminalDanceAdapter = require("./adapters/criminaldance");
const loveLetterAdapter = require("./adapters/loveletter");
const { run: runPreflightTests } = require("./preflight-test");
const { runCoveragePlannerTests } = require("./coverage-planner-test");
const { planCoverage, validateCoverageModel } = require("./coverage-planner");
const {
  PRODUCT_IDENTITY_KINDS,
  computeDeployedFingerprint,
  normalizeProductIdentity,
  sameProductIdentity
} = require("./product-identity");
const { discoverAssetUrls } = require("./deployed-asset-fingerprint");
const { validateQuery: validateEvidenceQuery } = require("./evidence-history");

function baseConfig(artifactRoot) {
  return {
    schemaVersion: "1.0",
    game: "onenightwolf",
    playerCount: 3,
    gamesToPlay: 1,
    gameSettings: { deckPreset: "recommended", discussionSeconds: 300 },
    speed: { profile: "watch" },
    players: [],
    discussion: {
      maximumPublicPasses: 2,
      allowStrategicSilence: true,
      behaviorMix: "balanced",
      enforceBehaviorCoverage: false
    },
    testPurpose: {
      mode: "natural_play",
      voteParticipation: "agent_decides",
      settlementTrigger: "natural",
      decisionPacing: "human_like",
      allowNonVoting: true
    },
    evidence: { mode: "logs_only" },
    reconnect: { mode: "none" },
    limits: { maxInvalidDecisions: 3, maxDecisionSeconds: 120, maxMinutesPerGame: 30 },
    allowExperimental: true,
    artifactRoot
  };
}

function genericConfig(artifactRoot) {
  return {
    schemaVersion: "1.1",
    game: "onenightwolf",
    entryUrl: "http://localhost:4175/Onenightwolf/",
    playerCount: 3,
    gamesToPlay: 1,
    gameSettings: { deckPreset: "recommended", discussionSeconds: 300 },
    testPurpose: {
      selectionSource: "user_questionnaire",
      objective: "Check whether ordinary users can complete one game and see a consistent result.",
      approach: "natural_user",
      userPerspective: "mixed_experience",
      focusAreas: ["core_gameplay", "information_isolation", "result_consistency"],
      journeyIds: ["create_join_complete_game"],
      scenarioIds: [],
      scenarioParameters: {},
      successCriteria: [{
        id: "complete_game",
        description: "Every player reaches the same visible terminal result.",
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
    allowDiscovery: false,
    artifactRoot
  };
}

function avalonConfig(artifactRoot) {
  return {
    schemaVersion: "1.1",
    game: "avalon",
    playerCount: 5,
    gamesToPlay: 1,
    gameSettings: {
      deckPreset: "recommended",
      leaderMode: "standard",
      publicResultDelaySeconds: 0,
      excalibur: false,
      ladyOfTheLake: false,
      questTeamSizes: [2, 3, 2, 3, 3]
    },
    testPurpose: {
      selectionSource: "ai_recommended",
      objective: "Check whether five isolated users can complete the visible Avalon baseline with private information isolated.",
      approach: "natural_user",
      userPerspective: "mixed_experience",
      focusAreas: ["room_flow", "settings", "core_gameplay", "information_isolation", "result_consistency"],
      journeyIds: ["create_join_complete_game"],
      scenarioIds: [],
      scenarioParameters: {},
      successCriteria: [{
        id: "complete_visible_game",
        description: "All five tabs reach one normalized visible terminal result.",
        oracle: "cross_tab_consistency",
        required: true
      }],
      recommendationRationale: "The visible five-player recommended baseline is the smallest core Avalon journey."
    },
    speed: { profile: "fast" },
    players: [],
    interaction: { maximumDecisionPasses: 3, allowInaction: true, userPacing: "human_like" },
    evidence: { mode: "logs_only" },
    reconnect: { mode: "none" },
    limits: { maxInvalidDecisions: 3, maxDecisionSeconds: 120, maxMinutesPerGame: 45 },
    allowExperimental: true,
    allowDiscovery: false,
    artifactRoot
  };
}

function gangsiConfig(artifactRoot, mode = "classic") {
  const hunt = mode === "hunt";
  return {
    schemaVersion: "1.1",
    game: "gangsi",
    playerCount: 3,
    gamesToPlay: 1,
    gameSettings: hunt
      ? { mode: "hunt", mapSelection: "random" }
      : { mode: "classic", mapSelection: "fixed", mapId: "classic" },
    testPurpose: {
      selectionSource: "provided_config",
      objective: `Complete one visible three-player ${mode} Gangsi game with isolated natural users.`,
      approach: "natural_user",
      userPerspective: "mixed_experience",
      focusAreas: ["room_flow", "settings", "core_gameplay", "information_isolation", "result_consistency"],
      journeyIds: [hunt ? "create_join_complete_hunt_game" : "create_join_complete_classic_game"],
      scenarioIds: [],
      scenarioParameters: {},
      successCriteria: [{
        id: "complete_game",
        description: "Every tab reaches one visible normalized terminal and reset lobby.",
        oracle: "cross_tab_consistency",
        required: true
      }]
    },
    speed: { profile: "fast" },
    players: [],
    interaction: { maximumDecisionPasses: 3, allowInaction: true, userPacing: "human_like" },
    evidence: { mode: "logs_only" },
    reconnect: { mode: "lobby_reload" },
    limits: { maxInvalidDecisions: 3, maxDecisionSeconds: 120, maxMinutesPerGame: 180 },
    allowExperimental: true,
    allowDiscovery: false,
    artifactRoot
  };
}

function gangsiFeatureConfig(artifactRoot) {
  return {
    schemaVersion: "1.1",
    game: "gangsi",
    entryUrl: "https://avalon-online-lhem.onrender.com/Gangsi/",
    playerCount: 5,
    gamesToPlay: 3,
    gameSettings: {
      mode: "hunt",
      mapSchedule: [
        { journey: 1, mapSelection: "fixed", mapId: "classic" },
        { journey: 2, mapSelection: "fixed", mapId: "test-map" },
        { journey: 3, mapSelection: "random", mapId: null }
      ]
    },
    testPurpose: {
      selectionSource: "provided_config",
      objective: "Verify the declared five-player Hunt feature checkpoints through the approved visible-UI map schedule.",
      approach: "mixed",
      userPerspective: "experienced_player",
      focusAreas: ["settings", "core_gameplay", "information_isolation", "result_consistency"],
      journeyIds: ["execute_hunt5_feature_coverage"],
      scenarioIds: ["hunt5_trap_core_escape", "hunt5_invisible_last_survivor", "hunt5_knife_targeted"],
      scenarioParameters: {},
      successCriteria: [{
        id: "all_hunt_checkpoints_visible",
        description: "Every declared Hunt checkpoint has scoped visible evidence and a passing checkpoint result.",
        oracle: "visible_ui",
        required: true
      }]
    },
    speed: { profile: "fast" },
    players: [],
    interaction: { maximumDecisionPasses: 3, allowInaction: true, userPacing: "fast_decisions" },
    evidence: { mode: "logs_only" },
    reconnect: { mode: "none" },
    limits: { maxInvalidDecisions: 3, maxDecisionSeconds: 120, maxMinutesPerGame: 180 },
    allowExperimental: true,
    allowDiscovery: false,
    certificationCandidate: false,
    artifactRoot
  };
}

function expectError(callback, pattern) {
  assert.throws(callback, pattern);
}

function execFile(file, args) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}\n${stderr}`));
      else resolve(stdout);
    });
  });
}

async function run() {
  runPreflightTests();
  runCoveragePlannerTests();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-boardgame-e2e-"));
  try {
    const registry = catalog();
    Object.entries(registry.games).forEach(([gameId, entry]) => {
      assert.strictEqual(entry.adapterContractVersion, "2.2", `${gameId} Catalog contract drifted.`);
      assert(String(entry.gameReference || ""), `${gameId} is missing gameReference.`);
      assert(fs.existsSync(path.join(SKILL_ROOT, entry.gameReference)), `${gameId} gameReference does not exist.`);
      const adapter = loadAdapter(entry);
      assert.strictEqual(adapter.id, gameId, `${gameId} Adapter id differs from Catalog.`);
      assert.strictEqual(adapter.contractVersion, entry.adapterContractVersion, `${gameId} Adapter contract differs from Catalog.`);
      for (const journey of entry.capabilities?.journeys || []) {
        assert(Array.isArray(journey.completionRequirements) && journey.completionRequirements.length > 0,
          `${gameId}/${journey.id} must declare completionRequirements in the single journey framework.`);
      }
    });

    const watch = resolveConfig(baseConfig(tempRoot));
    assert.strictEqual(watch.speed.operationDelayMs, 800);
    assert.strictEqual(watch.speed.serverTimeScale, 1);
    assert.strictEqual(watch.speed.timingFidelity, "production");
    assert.strictEqual(watch.players.length, 3);
    assert.strictEqual(watch.players[0].style, "evidence_first");
    assert.deepStrictEqual(
      watch.players.map((player) => player.communicationBehavior),
      ["evidence_sharing", "selective_disclosure", "deceptive_claim"]
    );
    assert.deepStrictEqual(watch.testPurpose, {
      mode: "natural_play",
      voteParticipation: "agent_decides",
      settlementTrigger: "natural",
      decisionPacing: "human_like",
      allowNonVoting: true
    });

    const generic = resolveConfig(genericConfig(tempRoot));
    assert.strictEqual(generic.schemaVersion, "1.1");
    assert.deepStrictEqual(generic.resourceLifecycle, { policyVersion: "1.0", cleanupAfterRun: true });
    const disabledCleanup = genericConfig(tempRoot);
    disabledCleanup.resourceLifecycle = { policyVersion: "1.0", cleanupAfterRun: false };
    expectError(() => resolveConfig(disabledCleanup), /cannot disable cleanupAfterRun/);
    assert.strictEqual(generic.adapter.id, "onenightwolf");
    assert.strictEqual(generic.testPurpose.approach, "natural_user");
    assert.deepStrictEqual(generic.testPurpose.completionRequirements, [
      { id: "cross_tab_result", kind: "cross_tab_final_state" },
      { id: "visible_terminal", kind: "terminal_visible" }
    ]);
    const weakenedCompletion = genericConfig(tempRoot);
    weakenedCompletion.testPurpose.completionRequirements = [{
      id: "only_checkpoint",
      kind: "checkpoint",
      checkpointId: "only_checkpoint"
    }];
    expectError(() => resolveConfig(weakenedCompletion), /Adapter-derived and cannot differ/);
    const checkpointCompletionErrors = [];
    validateJourneyCompletion([
      {
        type: "checkpoint_result",
        gameIndex: 1,
        checkpointId: "feature_visible",
        passed: true,
        source: "evidence_refs",
        evidenceRefs: ["P1:feature-visible"],
        writerOrder: 2
      },
      {
        type: "journey_completed",
        gameIndex: 1,
        journeyId: "feature_journey",
        requirementIds: ["feature_visible"],
        source: "requirements_satisfied",
        evidenceRefs: ["P1:feature-visible"],
        writerOrder: 3
      }
    ], [], {
      players: [{ id: "P1" }],
      testPurpose: {
        journeyIds: ["feature_journey"],
        completionRequirements: [{
          id: "feature_visible",
          kind: "checkpoint",
          checkpointId: "feature_visible"
        }]
      }
    }, {
      gamesToPlay: 1,
      playerCount: 1,
      productVerdict: "pass"
    }, new Map([["P1:feature-visible", { gameIndex: 1, writerOrder: 1 }]]), checkpointCompletionErrors);
    assert.deepStrictEqual(checkpointCompletionErrors, []);
    const runScopedCheckpointIds = Array.from({ length: 20 }, (_value, index) => `cp.coverage.${String(index + 1).padStart(2, "0")}`);
    const runScopedTimeline = [];
    const runScopedEvidence = new Map();
    let runScopedOrder = 1;
    const perGameCheckpointIds = [
      runScopedCheckpointIds.slice(0, 8),
      runScopedCheckpointIds.slice(8, 15),
      runScopedCheckpointIds.slice(15)
    ];
    perGameCheckpointIds.forEach((checkpointIds, gameOffset) => {
      const gameIndex = gameOffset + 1;
      const refs = [];
      for (const checkpointId of checkpointIds) {
        const ref = `P1:${checkpointId}`;
        runScopedEvidence.set(ref, { gameIndex, writerOrder: runScopedOrder++ });
        runScopedTimeline.push({
          type: "checkpoint_result",
          gameIndex,
          checkpointId,
          passed: true,
          source: "evidence_refs",
          evidenceRefs: [ref],
          writerOrder: runScopedOrder++
        });
        refs.push(ref);
      }
      runScopedTimeline.push({
        type: "journey_completed",
        gameIndex,
        journeyId: "coverage_journey",
        requirementIds: checkpointIds,
        source: "requirements_satisfied",
        evidenceRefs: refs,
        writerOrder: runScopedOrder++
      });
    });
    const runScopedCompletionErrors = [];
    validateJourneyCompletion(runScopedTimeline, [], {
      players: [{ id: "P1" }],
      testPurpose: {
        journeyIds: ["coverage_journey"],
        completionRequirements: runScopedCheckpointIds.map((checkpointId) => ({
          id: checkpointId,
          kind: "checkpoint",
          checkpointId
        }))
      }
    }, {
      gamesToPlay: 3,
      playerCount: 1,
      productVerdict: "pass"
    }, runScopedEvidence, runScopedCompletionErrors, {
      approvedPlan: {
        coveragePlan: {
          targetCheckpointIds: runScopedCheckpointIds,
          pendingCheckpointIds: runScopedCheckpointIds,
          reusedCheckpointIds: []
        }
      }
    });
    assert.deepStrictEqual(runScopedCompletionErrors, [], runScopedCompletionErrors.join("\n"));

    const deployedAssets = [
      { url: "https://example.test/Game/", contentType: "text/html", bytes: 20, sha256: "1".repeat(64) },
      { url: "https://example.test/assets/app.js", contentType: "application/javascript", bytes: 30, sha256: "2".repeat(64) },
      { url: "https://example.test/assets/app.css", contentType: "text/css", bytes: 40, sha256: "3".repeat(64) }
    ];
    const deployedComputed = computeDeployedFingerprint(deployedAssets);
    const deployedIdentity = normalizeProductIdentity({
      identity: {
        kind: PRODUCT_IDENTITY_KINDS.DEPLOYED_WEB_ASSETS,
        entryUrl: "https://example.test/Game/#ignored",
        fingerprintSha256: deployedComputed.fingerprintSha256,
        assets: [...deployedAssets].reverse()
      }
    });
    assert.strictEqual(deployedIdentity.entryUrl, "https://example.test/Game/");
    assert.strictEqual(deployedIdentity.assets.length, 3);
    assert(sameProductIdentity({ identity: deployedIdentity }, { identity: { ...deployedIdentity, assets: [...deployedIdentity.assets].reverse() } }));
    expectError(() => normalizeProductIdentity({
      identity: { ...deployedIdentity, fingerprintSha256: "f".repeat(64) }
    }), /does not match its asset manifest/);
    assert.deepStrictEqual(discoverAssetUrls(
      '<script src="/assets/app.js"></script><link href="/assets/app.css" rel="stylesheet">',
      "https://example.test/Game/"
    ), [
      "https://example.test/Game/",
      "https://example.test/assets/app.js",
      "https://example.test/assets/app.css"
    ]);
    const remoteEvidenceQuery = validateEvidenceQuery({
      schemaVersion: "1.0",
      game: "gangsi",
      requiredCheckpointIds: ["cp.coverage.01"],
      currentProductIdentityKind: "deployed_web_assets",
      currentProductFingerprintSha256: deployedComputed.fingerprintSha256
    });
    assert.strictEqual(remoteEvidenceQuery.currentProductIdentityKind, "deployed_web_assets");
    assert.strictEqual(remoteEvidenceQuery.currentProductFingerprintSha256, deployedComputed.fingerprintSha256);
    const remoteCapabilityRun = {
      serverManagedBySkill: "reused_remote_not_owned",
      speed: {
        serverTimeScale: 1,
        serverManagedBySkill: "reused_remote_not_owned",
        scalableWaits: []
      },
      capability: {
        status: "not_applicable_remote_production",
        enabled: false,
        timeScale: 1,
        timingFidelity: "production"
      }
    };
    const remoteCapabilityEvent = {
      type: "server_capability",
      status: "not_applicable_remote_production",
      serverManagement: "reused_remote_not_owned"
    };
    const validRemoteCapabilityErrors = [];
    validateServerCapabilityEvidence(
      remoteCapabilityEvent,
      { entryUrl: "https://example.test/Game/" },
      remoteCapabilityRun,
      validRemoteCapabilityErrors
    );
    assert.deepStrictEqual(validRemoteCapabilityErrors, []);
    const privateRemoteCapabilityErrors = [];
    validateServerCapabilityEvidence(
      { ...remoteCapabilityEvent, endpoint: "https://example.test/__ai-e2e/capabilities", response: { enabled: false } },
      { entryUrl: "https://example.test/Game/" },
      remoteCapabilityRun,
      privateRemoteCapabilityErrors
    );
    assert(privateRemoteCapabilityErrors.some((message) => message.includes("must not probe or record")));
    assert(privateRemoteCapabilityErrors.some((message) => message.includes("must not claim a capability response")));
    for (const discussionSeconds of [180, 300, 420, 600]) {
      const selectableTime = genericConfig(tempRoot);
      selectableTime.gameSettings.discussionSeconds = discussionSeconds;
      assert.strictEqual(resolveConfig(selectableTime).gameSettings.discussionSeconds, discussionSeconds);
    }
    for (const discussionSeconds of [120, 900]) {
      const hiddenTime = genericConfig(tempRoot);
      hiddenTime.gameSettings.discussionSeconds = discussionSeconds;
      expectError(() => resolveConfig(hiddenTime), /must match a visible UI option/);
    }
    const legacyHiddenTime = baseConfig(tempRoot);
    legacyHiddenTime.gameSettings.discussionSeconds = 120;
    assert.strictEqual(resolveConfig(legacyHiddenTime).gameSettings.discussionSeconds, 120);
    const invalidResultErrors = [];
    oneNightAdapter.validateResult({ headline: "Game over" }, { gameIndex: 1 }, invalidResultErrors);
    assert(invalidResultErrors.some((message) => message.includes("requires winner")));
    const validResultErrors = [];
    oneNightAdapter.validateResult({
      headline: "Village wins",
      reason: "The visible settlement explains the outcome.",
      winner: "village",
      eliminated: [],
      votes: {},
      finalRoles: { P1: "villager", P2: "seer", P3: "robber" },
      centerCards: ["werewolf", "minion", "tanner"],
      nightHistory: []
    }, { gameIndex: 1 }, validResultErrors);
    assert.deepStrictEqual(validResultErrors, []);
    const scenarioAuditErrors = [];
    oneNightAdapter.auditRun({
      config: {
        gamesToPlay: 1,
        players: generic.players,
        testPurpose: {
          scenarioIds: ["vote_partial_submission"],
          scenarioParameters: { voterIds: ["P1"] }
        }
      },
      timeline: [
        {
          type: "vote_participation",
          gameIndex: 1,
          actualVoterIds: ["P1"],
          nonVoterIds: ["P2", "P3"],
          actualSettlementTrigger: "deadline"
        },
        { type: "deadline_reached", gameIndex: 1 }
      ]
    }, scenarioAuditErrors);
    assert.deepStrictEqual(scenarioAuditErrors, []);
    const mismatchedScenarioErrors = [];
    oneNightAdapter.auditRun({
      config: {
        gamesToPlay: 1,
        players: generic.players,
        testPurpose: {
          scenarioIds: ["vote_partial_submission"],
          scenarioParameters: { voterIds: ["P1"] }
        }
      },
      timeline: [{
        type: "vote_participation",
        gameIndex: 1,
        actualVoterIds: ["P2"],
        nonVoterIds: ["P1", "P3"],
        actualSettlementTrigger: "all_submitted"
      }]
    }, mismatchedScenarioErrors);
    assert(mismatchedScenarioErrors.some((message) => message.includes("wrong voter set")));
    const genericHookRun = initializeRun(generic, { runId: "generic-adapter-hook" });
    expectError(() => appendEvent({
      runDir: genericHookRun.runDir,
      scope: "public",
      kind: "timeline",
      event: { type: "vote_participation", gameIndex: 1, actualSettlementTrigger: "deadline" }
    }), /Adapter public-event validation failed/);

    const avalon = resolveConfig(avalonConfig(tempRoot));
    assert.strictEqual(avalon.adapter.id, "avalon");
    assert.strictEqual(avalon.adapterStatus, "experimental");
    assert.deepStrictEqual(avalon.gameSettings.questTeamSizes, [2, 3, 2, 3, 3]);
    assert.strictEqual(avalon.gameSettings.leaderMode, "standard");
    const invalidAvalonExpansion = avalonConfig(tempRoot);
    invalidAvalonExpansion.gameSettings.excalibur = true;
    expectError(() => resolveConfig(invalidAvalonExpansion), /expansion rules are mapped/);
    const invalidAvalonLeader = avalonConfig(tempRoot);
    invalidAvalonLeader.gameSettings.leaderMode = "appoint";
    expectError(() => resolveConfig(invalidAvalonLeader), /standard clockwise leader mode/);
    const invalidAvalonCount = avalonConfig(tempRoot);
    invalidAvalonCount.playerCount = 6;
    expectError(() => resolveConfig(invalidAvalonCount), /five-player baseline/);

    const visibleAssignments = {
      P1: "merlin",
      P2: "percival",
      P3: "loyal_servant",
      P4: "morgana",
      P5: "assassin"
    };
    const visibleQuests = [
      { questIndex: 1, outcome: "success", teamIds: ["P1", "P2"], failCards: 0, failsRequired: 1 },
      { questIndex: 2, outcome: "success", teamIds: ["P1", "P2", "P3"], failCards: 0, failsRequired: 1 },
      { questIndex: 3, outcome: "success", teamIds: ["P1", "P2"], failCards: 0, failsRequired: 1 }
    ];
    const validAvalonResult = {
      outcomeId: "evil_assassination_hit",
      winner: "evil",
      reason: "assassin_hit_merlin",
      summary: "The visible Assassin targeted P1 after three successful quests.",
      assassinationTargetId: "P1",
      revealedAssignments: visibleAssignments,
      quests: visibleQuests
    };
    const validAvalonResultErrors = [];
    avalonAdapter.validateResult(validAvalonResult, { gameIndex: 1, config: avalon }, validAvalonResultErrors);
    assert.deepStrictEqual(validAvalonResultErrors, []);
    const invalidAvalonResultErrors = [];
    avalonAdapter.validateResult({ ...validAvalonResult, winner: "good" }, { gameIndex: 1, config: avalon }, invalidAvalonResultErrors);
    assert(invalidAvalonResultErrors.some((message) => message.includes("winner/reason")));

    const publicEvidence = {
      source: "visible_dom",
      evidenceId: "visible-evidence",
      evidenceText: "Visible public Avalon UI.",
      contentClass: "public_ui",
      visibleToPlayerIds: avalon.players.map((player) => player.id)
    };
    const invalidAvalonEventErrors = [];
    avalonAdapter.validatePublicEvent("timeline", {
      type: "avalon_team_vote_settled",
      gameIndex: 1,
      questIndex: 1,
      proposalIndex: 1,
      leaderId: "P1",
      teamIds: ["P1", "P2"],
      ballots: { P1: "approve", P2: "approve", P3: "approve", P4: "reject", P5: "reject" },
      approvals: 5,
      rejections: 0,
      approved: true,
      rejectionStreakAfter: 0,
      ...publicEvidence
    }, { config: avalon }, invalidAvalonEventErrors);
    assert(invalidAvalonEventErrors.some((message) => message.includes("totals do not match")));

    const allApprove = Object.fromEntries(avalon.players.map((player) => [player.id, "approve"]));
    const settingsEvent = {
      type: "avalon_settings_verified",
      gameIndex: 1,
      settings: avalon.gameSettings,
      selectionSource: "ai_recommended",
      rationale: "The visible five-player recommended baseline removes optional rules.",
      rosterOrder: ["P1", "P2", "P3", "P4", "P5"]
    };
    const proposals = [
      { type: "avalon_proposal_settled", gameIndex: 1, questIndex: 1, proposalIndex: 1, leaderId: "P1", teamIds: ["P1", "P2"], requiredTeamSize: 2 },
      { type: "avalon_proposal_settled", gameIndex: 1, questIndex: 2, proposalIndex: 1, leaderId: "P2", teamIds: ["P1", "P2", "P3"], requiredTeamSize: 3 },
      { type: "avalon_proposal_settled", gameIndex: 1, questIndex: 3, proposalIndex: 1, leaderId: "P3", teamIds: ["P1", "P2"], requiredTeamSize: 2 }
    ];
    const votes = proposals.map((proposal) => ({
      type: "avalon_team_vote_settled",
      gameIndex: 1,
      questIndex: proposal.questIndex,
      proposalIndex: proposal.proposalIndex,
      leaderId: proposal.leaderId,
      teamIds: proposal.teamIds,
      ballots: allApprove,
      approvals: 5,
      rejections: 0,
      approved: true,
      rejectionStreakAfter: 0
    }));
    const questEvents = visibleQuests.map((quest) => ({
      type: "avalon_quest_settled",
      gameIndex: 1,
      ...quest,
      submissionCount: quest.teamIds.length
    }));
    const validAvalonAuditErrors = [];
    avalonAdapter.auditRun({
      config: avalon,
      timeline: [
        settingsEvent,
        proposals[0], votes[0], questEvents[0],
        { type: "avalon_leader_rotated", gameIndex: 1, questIndex: 2, fromLeaderId: "P1", toLeaderId: "P2", leaderMode: "standard" },
        proposals[1], votes[1], questEvents[1],
        { type: "avalon_leader_rotated", gameIndex: 1, questIndex: 3, fromLeaderId: "P2", toLeaderId: "P3", leaderMode: "standard" },
        proposals[2], votes[2], questEvents[2],
        { type: "avalon_assassination_settled", gameIndex: 1, targetId: "P1", outcomeId: "evil_assassination_hit" },
        { type: "result_detail", gameIndex: 1, result: validAvalonResult }
      ]
    }, validAvalonAuditErrors);
    assert.deepStrictEqual(validAvalonAuditErrors, []);

    const gangsiClassic = resolveConfig(gangsiConfig(tempRoot, "classic"));
    const gangsiHunt = resolveConfig(gangsiConfig(tempRoot, "hunt"));
    assert.strictEqual(gangsiClassic.adapter.id, "gangsi");
    assert.strictEqual(gangsiClassic.adapterStatus, "experimental");
    assert.deepStrictEqual(gangsiClassic.gameSettings, { mode: "classic", mapSelection: "fixed", mapId: "classic" });
    assert.deepStrictEqual(gangsiHunt.gameSettings, { mode: "hunt", mapSelection: "random", mapId: null });
    const gangsiClassicTwoPlayers = gangsiConfig(tempRoot, "classic");
    gangsiClassicTwoPlayers.playerCount = 2;
    gangsiClassicTwoPlayers.players = gangsiClassicTwoPlayers.players.slice(0, 2);
    assert.strictEqual(resolveConfig(gangsiClassicTwoPlayers).playerCount, 2);
    const gangsiClassicFivePlayers = gangsiConfig(tempRoot, "classic");
    gangsiClassicFivePlayers.playerCount = 5;
    assert.strictEqual(resolveConfig(gangsiClassicFivePlayers).playerCount, 5);
    const gangsiHuntFivePlayers = gangsiConfig(tempRoot, "hunt");
    gangsiHuntFivePlayers.playerCount = 5;
    assert.strictEqual(resolveConfig(gangsiHuntFivePlayers).playerCount, 5);
    const invalidGangsiCount = gangsiConfig(tempRoot, "classic");
    invalidGangsiCount.playerCount = 6;
    expectError(() => resolveConfig(invalidGangsiCount), /classic mode requires 2-5 players/);
    const invalidGangsiHuntCount = gangsiConfig(tempRoot, "hunt");
    invalidGangsiHuntCount.playerCount = 2;
    invalidGangsiHuntCount.players = invalidGangsiHuntCount.players.slice(0, 2);
    expectError(() => resolveConfig(invalidGangsiHuntCount), /Hunt mode requires 3-5 players/);
    const invalidGangsiClassicMap = gangsiConfig(tempRoot, "classic");
    delete invalidGangsiClassicMap.gameSettings.mapId;
    expectError(() => resolveConfig(invalidGangsiClassicMap), /fixed map selection requires a visible mapId/);
    const validGangsiClassicAlternateMap = gangsiConfig(tempRoot, "classic");
    validGangsiClassicAlternateMap.gameSettings.mapId = "test-map";
    assert.strictEqual(resolveConfig(validGangsiClassicAlternateMap).gameSettings.mapId, "test-map");
    const invalidGangsiHuntMap = gangsiConfig(tempRoot, "hunt");
    invalidGangsiHuntMap.gameSettings.mapId = "classic";
    expectError(() => resolveConfig(invalidGangsiHuntMap), /must not declare the resolved mapId before start/);
    const validGangsiHuntFixedMap = gangsiConfig(tempRoot, "hunt");
    validGangsiHuntFixedMap.gameSettings = { mode: "hunt", mapSelection: "fixed", mapId: "classic" };
    assert.strictEqual(resolveConfig(validGangsiHuntFixedMap).gameSettings.mapId, "classic");
    const gangsiFeature = resolveConfig(gangsiFeatureConfig(tempRoot));
    assert.deepStrictEqual(gangsiFeature.gameSettings, {
      mode: "hunt",
      mapSchedule: ["fixed:classic", "fixed:test-map", "random"]
    });
    assert.strictEqual(gangsiFeature.gamesToPlay, 3);
    assert.strictEqual(gangsiFeature.playerCount, 5);
    assert.strictEqual(gangsiFeature.testPurpose.completionRequirements.length, 20);
    const gangsiCoverageModel = validateCoverageModel(gangsiAdapter.coverageModel);
    assert.strictEqual(gangsiCoverageModel.checkpoints.length, 20);
    assert.deepStrictEqual(gangsiCoverageModel.setupProfiles.map((profile) => profile.id), [
      "hunt5.classic", "hunt5.random", "hunt5.test_map"
    ]);
    const gangsiCoveragePlan = planCoverage(gangsiCoverageModel, {
      schemaVersion: "1.0",
      game: "gangsi",
      targetCheckpointIds: gangsiCoverageModel.checkpoints.map((checkpoint) => checkpoint.id),
      completedCheckpointIds: [],
      reusedCheckpointIds: [],
      excludedRouteIds: [],
      playerCount: 5,
      gameSettings: gangsiFeature.gameSettings,
      currentSetupProfileId: null,
      currentStateId: null
    });
    assert.strictEqual(gangsiCoveragePlan.status, "complete");
    assert.strictEqual(gangsiCoveragePlan.totalEstimatedSeconds, 8070);
    assert.strictEqual(gangsiCoveragePlan.resetCount, 2);
    assert.strictEqual(gangsiCoveragePlan.randomDependencyCount, 4);
    assert.deepStrictEqual(gangsiCoveragePlan.routes.map((route) => route.routeId), [
      "route.hunt5.01_trap_core_escape",
      "route.hunt5.02_invisible_last_survivor",
      "route.hunt5.03_knife_targeted"
    ]);
    assert.strictEqual(
      gangsiCoveragePlan.planSha256,
      "fb4166aa59efa5db318f3be3421f30addad9590ee75bcafc8bcd818e79c32ef8"
    );
    const invalidFeatureSchedule = gangsiFeatureConfig(tempRoot);
    invalidFeatureSchedule.gameSettings.mapSchedule[1].mapId = "classic";
    expectError(() => resolveConfig(invalidFeatureSchedule), /feature mapSchedule must be/);

    const validGangsiClassicResult = {
      outcomeId: "classic_mummy_life_tokens",
      mode: "classic",
      winner: "mummy",
      winnerPlayerId: "P3",
      mapId: "classic",
      mapName: "經典古墓",
      summary: "提燈怪取得 4 / 4 生命標記。",
      classic: { mummyScore: 4, mummyTarget: 4, winnerCompletedTasks: null, winnerTotalTasks: null },
      hunt: null
    };
    const validGangsiClassicErrors = [];
    gangsiAdapter.validateResult(validGangsiClassicResult, { gameIndex: 1, config: gangsiClassic }, validGangsiClassicErrors);
    assert.deepStrictEqual(validGangsiClassicErrors, []);
    const invalidGangsiClassicErrors = [];
    gangsiAdapter.validateResult({
      ...validGangsiClassicResult,
      classic: { ...validGangsiClassicResult.classic, mummyScore: 3 }
    }, { gameIndex: 1, config: gangsiClassic }, invalidGangsiClassicErrors);
    assert(invalidGangsiClassicErrors.some((message) => message.includes("life-token target")));

    const validGangsiHuntResult = {
      outcomeId: "hunt_adventurer_escape",
      mode: "hunt",
      winner: "adventurer",
      winnerPlayerId: "P1",
      mapId: "test-map",
      mapName: "蟹制地圖1",
      summary: "1 名冒險者逃出古墓。",
      classic: null,
      hunt: {
        teamTreasures: 5,
        teamTreasureTarget: 5,
        mechanisms: { A: 3, B: 3 },
        escapedCount: 1,
        deadCount: 1,
        adventurerResults: [
          { playerId: "P1", profession: "doctor", completedTasks: 3, mechanismActions: 1, outcome: "escaped" },
          { playerId: "P2", profession: "mage", completedTasks: 2, mechanismActions: 0, outcome: "dead" }
        ],
        mummyResult: { playerId: "P3", type: "invisible", abilityTriggers: 2 }
      }
    };
    const validGangsiHuntErrors = [];
    gangsiAdapter.validateResult(validGangsiHuntResult, { gameIndex: 1, config: gangsiHunt }, validGangsiHuntErrors);
    assert.deepStrictEqual(validGangsiHuntErrors, []);
    const invalidGangsiHuntErrors = [];
    gangsiAdapter.validateResult({
      ...validGangsiHuntResult,
      winner: "mummy",
      outcomeId: "hunt_mummy_elimination"
    }, { gameIndex: 1, config: gangsiHunt }, invalidGangsiHuntErrors);
    assert(invalidGangsiHuntErrors.some((message) => message.includes("escape totals")));

    const gangsiPublicEvidence = {
      source: "visible_dom",
      evidenceId: "gangsi-visible",
      evidenceText: "Visible Gangsi UI on all three tabs.",
      contentClass: "public_ui",
      visibleToPlayerIds: ["P1", "P2", "P3"]
    };
    const invalidGangsiSetupErrors = [];
    gangsiAdapter.validatePublicEvent("timeline", {
      type: "gangsi_game_setup",
      gameIndex: 1,
      mode: "hunt",
      mapSelection: "random",
      mapId: "test-map",
      mapName: "蟹制地圖1",
      playerCount: 3,
      adventurerPlayerIds: ["P1", "P2"],
      mummyPlayerId: "P3",
      professionByPlayerId: { P1: "doctor" },
      mummyType: "invisible",
      ...gangsiPublicEvidence
    }, { config: gangsiHunt }, invalidGangsiSetupErrors);
    assert(invalidGangsiSetupErrors.some((message) => message.includes("one visible profession")));

    const featurePublicEvidence = {
      source: "visible_dom",
      evidenceId: "gangsi-feature-visible",
      evidenceText: "The approved Gangsi feature boundary is visible in the owning UI.",
      contentClass: "public_ui",
      visibleToPlayerIds: ["P1", "P2", "P3", "P4", "P5"]
    };
    const validKnifeCheckpointErrors = [];
    gangsiAdapter.validatePublicEvent("timeline", {
      type: "adapter_checkpoint",
      gameIndex: 3,
      checkpointId: "cp.hunt.mummy.knife",
      status: "observed",
      data: { assertionResults: {
        choose_cardinal_direction_before_roll: true,
        throw_ends_turn_without_roll_or_move: true,
        ray_blockers_respected: true,
        first_adventurer_only: true,
        hit_injures_or_guard_blocks: true,
        coordinate_public_identity_private: true,
        cooldown_two_normal_turns: true,
        miss_not_counted_as_trigger: true
      } },
      ...featurePublicEvidence
    }, { config: gangsiFeature }, validKnifeCheckpointErrors);
    assert.deepStrictEqual(validKnifeCheckpointErrors, []);
    const invalidKnifeCheckpointErrors = [];
    gangsiAdapter.validatePublicEvent("timeline", {
      type: "adapter_checkpoint",
      gameIndex: 2,
      checkpointId: "cp.hunt.mummy.knife",
      status: "observed",
      data: { assertionResults: {} },
      ...featurePublicEvidence
    }, { config: gangsiFeature }, invalidKnifeCheckpointErrors);
    assert(invalidKnifeCheckpointErrors.some((message) => message.includes("another approved Gangsi route")));
    const invalidFeatureRouteErrors = [];
    gangsiAdapter.validatePublicEvent("timeline", {
      type: "coverage_route_started",
      gameIndex: 2,
      routeId: "route.hunt5.01_trap_core_escape",
      checkpointIds: [],
      setupProfileId: "hunt5.classic"
    }, { config: gangsiFeature }, invalidFeatureRouteErrors);
    assert(invalidFeatureRouteErrors.some((message) => message.includes("does not match the approved Gangsi route")));

    const gangsiSettingsEvent = {
      type: "gangsi_settings_verified",
      gameIndex: 1,
      settings: gangsiClassic.gameSettings,
      selectionSource: "provided_config",
      rationale: "The requested three-player classic fixed-map profile.",
      rosterOrder: ["P1", "P2", "P3"]
    };
    const gangsiSetupEvent = {
      type: "gangsi_game_setup",
      gameIndex: 1,
      mode: "classic",
      mapSelection: "fixed",
      mapId: "classic",
      mapName: "經典古墓",
      playerCount: 3,
      adventurerPlayerIds: ["P1", "P2"],
      mummyPlayerId: "P3",
      professionByPlayerId: {},
      mummyType: null
    };
    const gangsiTerminal = {
      type: "gangsi_terminal_settled",
      gameIndex: 1,
      outcomeId: validGangsiClassicResult.outcomeId,
      mode: "classic",
      winnerSide: "mummy",
      winnerPlayerId: "P3",
      mapId: "classic",
      summary: validGangsiClassicResult.summary
    };
    const validGangsiAuditErrors = [];
    gangsiAdapter.auditRun({
      config: gangsiClassic,
      timeline: [
        gangsiSettingsEvent,
        gangsiSetupEvent,
        { type: "gangsi_turn_completed", gameIndex: 1, turnIndex: 1, actorId: "P1" },
        { type: "gangsi_turn_completed", gameIndex: 1, turnIndex: 2, actorId: "P2" },
        { type: "gangsi_turn_completed", gameIndex: 1, turnIndex: 3, actorId: "P3" },
        gangsiTerminal,
        { type: "result_detail", gameIndex: 1, result: validGangsiClassicResult },
        { type: "gangsi_returned_to_lobby", gameIndex: 1, readyReset: true }
      ]
    }, validGangsiAuditErrors);
    assert.deepStrictEqual(validGangsiAuditErrors, []);
    const missingGangsiReturnErrors = [];
    gangsiAdapter.auditRun({
      config: gangsiClassic,
      timeline: [
        gangsiSettingsEvent,
        gangsiSetupEvent,
        { type: "gangsi_turn_completed", gameIndex: 1, turnIndex: 1, actorId: "P1" },
        { type: "gangsi_turn_completed", gameIndex: 1, turnIndex: 2, actorId: "P2" },
        { type: "gangsi_turn_completed", gameIndex: 1, turnIndex: 3, actorId: "P3" },
        gangsiTerminal,
        { type: "result_detail", gameIndex: 1, result: validGangsiClassicResult }
      ]
    }, missingGangsiReturnErrors);
    assert(missingGangsiReturnErrors.some((message) => message.includes("gangsi_returned_to_lobby")));

    assert.strictEqual(criminalDanceAdapter.id, "criminaldance");
    assert.strictEqual(criminalDanceAdapter.contractVersion, "2.2");
    assert.deepStrictEqual(
      criminalDanceAdapter.evidenceContract.requiredRunStartEvents,
      ["product_test", "game_started"]
    );
    const criminalDecisionObservation = {
      observationId: "P1-g1-decision-contract",
      legalActions: ["play_detective:P2"],
      publicFacts: [{ text: "P1 is the current player." }],
      privateFacts: [{ text: "Detective is enabled." }],
      ownMemory: []
    };
    const criminalObservationContractErrors = [];
    criminalDanceAdapter.validateObservation(criminalDecisionObservation, {
      playerId: "P1",
      config: { players: ["P1", "P2", "P3", "P4"].map((id) => ({ id })) }
    }, criminalObservationContractErrors);
    assert.deepStrictEqual(criminalObservationContractErrors, []);
    const criminalDecisionContractErrors = [];
    criminalDanceAdapter.validateDecision({
      observationId: criminalDecisionObservation.observationId,
      action: "play_detective",
      targets: ["P2"],
      evidenceRefs: ["publicFacts[0]", "privateFacts[0]", "legalActions[0]"]
    }, criminalDecisionObservation, { playerId: "P1" }, criminalDecisionContractErrors);
    assert.deepStrictEqual(criminalDecisionContractErrors, []);
    const criminalTradeObservation = {
      observationId: "P1-g1-trade-contract",
      legalActions: ["play_trade_give_alibi:P2"],
      publicFacts: [{ text: "P1 may target P2." }],
      privateFacts: [{ text: "P1 may give Alibi." }],
      ownMemory: []
    };
    const criminalTradeObservationErrors = [];
    criminalDanceAdapter.validateObservation(criminalTradeObservation, {
      playerId: "P1",
      config: { players: ["P1", "P2", "P3", "P4"].map((id) => ({ id })) }
    }, criminalTradeObservationErrors);
    assert.deepStrictEqual(criminalTradeObservationErrors, []);
    const criminalTradeDecisionErrors = [];
    criminalDanceAdapter.validateDecision({
      observationId: criminalTradeObservation.observationId,
      action: "play_trade_give_alibi",
      targets: ["P2"],
      evidenceRefs: ["publicFacts[0]", "privateFacts[0]", "legalActions[0]"]
    }, criminalTradeObservation, { playerId: "P1" }, criminalTradeDecisionErrors);
    assert.deepStrictEqual(criminalTradeDecisionErrors, []);
    const criminalRawEvidenceRefErrors = [];
    criminalDanceAdapter.validateDecision({
      observationId: criminalDecisionObservation.observationId,
      action: "play",
      targets: ["P2"],
      evidenceRefs: ["visible-evidence-id"]
    }, criminalDecisionObservation, { playerId: "P1" }, criminalRawEvidenceRefErrors);
    assert(criminalRawEvidenceRefErrors.some((message) => message.includes("canonical action")));
    assert(criminalRawEvidenceRefErrors.some((message) => message.includes("same-Observation array indexes")));
    assert.deepStrictEqual(
      criminalDanceAdapter.validateSettings({}, { playerCount: 4, catalogEntry: { status: "planned" } }, []),
      { inspector: false, juvenile: false }
    );
    const criminalSettingErrors = [];
    criminalDanceAdapter.validateSettings({ inspector: true, juvenile: false }, {
      playerCount: 4,
      catalogEntry: { status: "experimental" }
    }, criminalSettingErrors);
    assert.deepStrictEqual(criminalSettingErrors, []);
    const criminalUnknownSettingErrors = [];
    criminalDanceAdapter.validateSettings({ deckPreset: "base" }, {
      playerCount: 4,
      catalogEntry: { status: "planned" }
    }, criminalUnknownSettingErrors);
    assert(criminalUnknownSettingErrors.some((message) => message.includes("Unknown Criminal Dance")));

    const inspectorPurpose = {
      approach: "targeted_scenario",
      journeyIds: ["create_join_complete_match"],
      scenarioIds: ["inspector_public_marker"],
      scenarioParameters: {}
    };
    const inspectorPurposeErrors = [];
    criminalDanceAdapter.resolvePurpose(inspectorPurpose, {
      gameSettings: { inspector: true, juvenile: false }
    }, inspectorPurposeErrors);
    assert.deepStrictEqual(inspectorPurposeErrors, []);
    const mismatchedInspectorPurposeErrors = [];
    criminalDanceAdapter.resolvePurpose({ ...inspectorPurpose, scenarioIds: [] }, {
      gameSettings: { inspector: true, juvenile: false }
    }, mismatchedInspectorPurposeErrors);
    assert(mismatchedInspectorPurposeErrors.some((message) => message.includes("inspector_public_marker")));
    const combinedExpansionPurpose = {
      ...inspectorPurpose,
      scenarioIds: ["inspector_public_marker", "juvenile_opening_clue"]
    };
    const combinedExpansionPurposeErrors = [];
    criminalDanceAdapter.resolvePurpose(combinedExpansionPurpose, {
      gameSettings: { inspector: true, juvenile: true }
    }, combinedExpansionPurposeErrors);
    assert.deepStrictEqual(combinedExpansionPurposeErrors, []);
    const naturalExpansionPurposeErrors = [];
    criminalDanceAdapter.resolvePurpose({ ...inspectorPurpose, approach: "natural_user" }, {
      gameSettings: { inspector: true, juvenile: false }
    }, naturalExpansionPurposeErrors);
    assert(naturalExpansionPurposeErrors.some((message) => message.includes("targeted_scenario or mixed")));

    const criminalPlayers = ["P1", "P2", "P3", "P4"].map((id) => ({ id, name: id }));
    const criminalRounds = Array.from({ length: 4 }, (_unused, index) => ({
      roundIndex: index + 1,
      outcomeId: "dog_caught_culprit",
      actorId: "P1",
      culpritId: "P2",
      scoreDeltas: { P1: 3, P2: 0, P3: 1, P4: 1 },
      totalScores: { P1: (index + 1) * 3, P2: 0, P3: index + 1, P4: index + 1 },
      playedCards: { P1: ["dog"], P2: [], P3: [], P4: ["first_finder"] },
      publicCards: { P1: [], P2: [], P3: [], P4: [] }
    }));
    const criminalResult = {
      outcomeId: "match_score_threshold",
      winnerIds: ["P1"],
      targetScore: 10,
      totalScores: { P1: 12, P2: 0, P3: 4, P4: 4 },
      rounds: criminalRounds,
      summary: "Every tab visibly shows P1 as the top scorer at the match threshold."
    };
    const criminalResultErrors = [];
    criminalDanceAdapter.validateResult(criminalResult, {
      gameIndex: 1,
      config: { players: criminalPlayers }
    }, criminalResultErrors);
    assert.deepStrictEqual(criminalResultErrors, []);
    const invalidCriminalResultErrors = [];
    criminalDanceAdapter.validateResult({
      ...criminalResult,
      rounds: criminalRounds.map((round, index) => index === 2
        ? { ...round, totalScores: { ...round.totalScores, P3: 99 } }
        : round)
    }, { gameIndex: 1, config: { players: criminalPlayers } }, invalidCriminalResultErrors);
    assert(invalidCriminalResultErrors.some((message) => message.includes("score continuity")));

    const criminalEvidence = {
      source: "visible_dom",
      evidenceId: "criminal-visible-evidence",
      evidenceText: "The same public Criminal Dance state is visible on every player tab.",
      contentClass: "public_ui",
      visibleToPlayerIds: criminalPlayers.map((player) => player.id)
    };
    const criminalEventErrors = [];
    criminalDanceAdapter.validatePublicEvent("timeline", {
      type: "criminaldance_card_played",
      gameIndex: 1,
      roundIndex: 1,
      actorId: "P1",
      cardId: "detective",
      targetId: null,
      noEffectTrade: false,
      ...criminalEvidence
    }, { config: { players: criminalPlayers } }, criminalEventErrors);
    assert(criminalEventErrors.some((message) => message.includes("requires another configured target")));
    const criminalInspectorEventErrors = [];
    criminalDanceAdapter.validatePublicEvent("timeline", {
      type: "criminaldance_inspector_marker_observed",
      gameIndex: 1,
      roundIndex: 1,
      actorId: "P1",
      targetId: "P2",
      markerVisibleToAll: true,
      overrideOutcomeId: null,
      ...criminalEvidence
    }, { config: { players: criminalPlayers } }, criminalInspectorEventErrors);
    assert.deepStrictEqual(criminalInspectorEventErrors, []);
    const criminalJuvenileEventErrors = [];
    criminalDanceAdapter.validatePublicEvent("timeline", {
      type: "criminaldance_juvenile_clue_isolation_checked",
      gameIndex: 1,
      roundIndex: 1,
      participantCount: 4,
      holderPromptCount: 1,
      nonHolderPromptCount: 1,
      privateEvidenceRefs: ["private-observation-p3-opening"],
      ...criminalEvidence
    }, { config: { players: criminalPlayers } }, criminalJuvenileEventErrors);
    assert(criminalJuvenileEventErrors.some((message) => message.includes("zero non-holder prompts")));

    const criminalFormalConfig = {
      gamesToPlay: 1,
      players: criminalPlayers,
      gameSettings: { inspector: false, juvenile: false },
      testPurpose: { approach: "natural_user" }
    };
    const criminalStarts = criminalRounds.map((round) => ({
      type: "criminaldance_round_started",
      gameIndex: 1,
      roundIndex: round.roundIndex,
      firstFinderId: "P4",
      turnOrder: ["P1", "P2", "P3", "P4"],
      startingHandSize: 4
    }));
    const criminalSettlements = criminalRounds.map((round) => ({
      type: "criminaldance_round_settled",
      gameIndex: 1,
      ...round
    }));
    const criminalAuditErrors = [];
    criminalDanceAdapter.auditRun({
      config: criminalFormalConfig,
      timeline: [
        { type: "criminaldance_settings_verified", gameIndex: 1 },
        ...criminalStarts.flatMap((start, index) => [start, criminalSettlements[index]]),
        {
          type: "criminaldance_match_settled",
          gameIndex: 1,
          winnerIds: ["P1"],
          totalScores: criminalResult.totalScores,
          targetScore: 10
        },
        { type: "result_detail", gameIndex: 1, result: criminalResult }
      ]
    }, criminalAuditErrors, []);
    assert.deepStrictEqual(criminalAuditErrors, []);
    const criminalExpansionConfig = {
      ...criminalFormalConfig,
      gameSettings: { inspector: true, juvenile: true },
      testPurpose: {
        approach: "targeted_scenario",
        scenarioIds: ["inspector_public_marker", "juvenile_opening_clue"]
      }
    };
    const criminalExpansionTimeline = [
      { type: "criminaldance_settings_verified", gameIndex: 1 },
      {
        type: "criminaldance_inspector_marker_observed",
        gameIndex: 1,
        roundIndex: 1,
        actorId: "P1",
        targetId: "P2",
        markerVisibleToAll: true,
        overrideOutcomeId: null
      },
      {
        type: "criminaldance_juvenile_clue_isolation_checked",
        gameIndex: 1,
        roundIndex: 1,
        participantCount: 4,
        holderPromptCount: 1,
        nonHolderPromptCount: 0,
        privateEvidenceRefs: ["private-observation-p3-opening"]
      },
      ...criminalStarts.flatMap((start, index) => [start, criminalSettlements[index]]),
      {
        type: "criminaldance_match_settled",
        gameIndex: 1,
        winnerIds: ["P1"],
        totalScores: criminalResult.totalScores,
        targetScore: 10
      },
      { type: "result_detail", gameIndex: 1, result: criminalResult }
    ];
    const criminalExpansionAuditErrors = [];
    criminalDanceAdapter.auditRun({
      config: criminalExpansionConfig,
      timeline: criminalExpansionTimeline
    }, criminalExpansionAuditErrors, []);
    assert.deepStrictEqual(criminalExpansionAuditErrors, []);
    const missingJuvenileExpansionAuditErrors = [];
    criminalDanceAdapter.auditRun({
      config: criminalExpansionConfig,
      timeline: criminalExpansionTimeline.filter((event) => event.type !== "criminaldance_juvenile_clue_isolation_checked")
    }, missingJuvenileExpansionAuditErrors, []);
    assert(missingJuvenileExpansionAuditErrors.some((message) => message.includes("juvenile_opening_clue")));
    const invalidCriminalAuditErrors = [];
    criminalDanceAdapter.auditRun({
      config: criminalFormalConfig,
      timeline: [
        { type: "criminaldance_settings_verified", gameIndex: 1 },
        criminalStarts[0],
        criminalSettlements[0],
        { type: "result_detail", gameIndex: 1, result: criminalResult }
      ]
    }, invalidCriminalAuditErrors, []);
    assert(invalidCriminalAuditErrors.some((message) => message.includes("match_settled")));

    assert.strictEqual(loveLetterAdapter.id, "loveletter");
    assert.strictEqual(loveLetterAdapter.contractVersion, "2.2");
    assert.deepStrictEqual(loveLetterAdapter.timing.scalableWaits, []);
    assert.deepStrictEqual(loveLetterAdapter.certificationEvidence.strictCertificationEvidence, []);
    const loveSettingErrors = [];
    assert.deepStrictEqual(
      loveLetterAdapter.validateSettings({}, { playerCount: 2 }, loveSettingErrors),
      { targetHearts: 6 }
    );
    assert.deepStrictEqual(loveSettingErrors, []);
    const customLoveSettingErrors = [];
    assert.deepStrictEqual(
      loveLetterAdapter.validateSettings({ targetHearts: 1 }, { playerCount: 4 }, customLoveSettingErrors),
      { targetHearts: 1 }
    );
    assert.deepStrictEqual(customLoveSettingErrors, []);
    const invalidLoveSettingErrors = [];
    loveLetterAdapter.validateSettings({ targetHearts: 10, deckPreset: "hidden" }, { playerCount: 7 }, invalidLoveSettingErrors);
    assert(invalidLoveSettingErrors.some((message) => message.includes("Unknown Love Letter")));
    assert(invalidLoveSettingErrors.some((message) => message.includes("2 to 6")));
    assert(invalidLoveSettingErrors.some((message) => message.includes("1 to 9")));

    const lovePlayers = ["P1", "P2"].map((id) => ({ id, name: id }));
    const loveObservation = {
      observationId: "P1-g1-love-contract",
      legalActions: ["play_card:guard:P2", "play_card:princess"],
      publicFacts: [{ text: "P1 is current and P2 is a rendered target." }],
      privateFacts: [{ text: "P1 owns Guard and Princess." }],
      ownMemory: []
    };
    const loveObservationErrors = [];
    loveLetterAdapter.validateObservation(loveObservation, {
      playerId: "P1",
      config: { players: lovePlayers }
    }, loveObservationErrors);
    assert.deepStrictEqual(loveObservationErrors, []);
    const loveDecisionErrors = [];
    loveLetterAdapter.validateDecision({
      observationId: loveObservation.observationId,
      action: "play_card:guard",
      targets: ["P2"],
      evidenceRefs: ["publicFacts[0]", "privateFacts[0]", "legalActions[0]"]
    }, loveObservation, { playerId: "P1" }, loveDecisionErrors);
    assert.deepStrictEqual(loveDecisionErrors, []);
    const loveNoTargetObservationErrors = [];
    loveLetterAdapter.validateObservation({
      observationId: "P1-g1-love-no-target",
      legalActions: ["play_card:priest", "play_card:countess"],
      publicFacts: [], privateFacts: [], ownMemory: []
    }, { playerId: "P1", config: { players: lovePlayers } }, loveNoTargetObservationErrors);
    assert.deepStrictEqual(loveNoTargetObservationErrors, []);
    const invalidLoveDecisionErrors = [];
    loveLetterAdapter.validateDecision({
      observationId: loveObservation.observationId,
      action: "play_card:guard",
      targets: [],
      evidenceRefs: ["raw-visible-evidence-id"]
    }, loveObservation, { playerId: "P1" }, invalidLoveDecisionErrors);
    assert(invalidLoveDecisionErrors.some((message) => message.includes("exactly match")));
    assert(invalidLoveDecisionErrors.some((message) => message.includes("array indexes")));

    const loveConfig = {
      gamesToPlay: 1,
      playerCount: 2,
      players: lovePlayers,
      gameSettings: { targetHearts: 1 },
      testPurpose: { approach: "natural_user" }
    };
    const loveRound = {
      roundIndex: 1,
      endCause: "one_active_player",
      winnerIds: ["P1"],
      eliminatedPlayerIds: ["P2"],
      heartDeltas: { P1: 1, P2: 0 },
      totalHearts: { P1: 1, P2: 0 },
      revealedRemainingCards: { P1: ["princess"], P2: ["countess"] }
    };
    const loveResult = {
      outcomeId: "target_hearts_reached",
      winnerIds: ["P1"],
      targetHearts: 1,
      heartTotals: { P1: 1, P2: 0 },
      roundCount: 1,
      rounds: [loveRound],
      summary: "Both tabs visibly show P1 at the one-heart target."
    };
    const loveResultErrors = [];
    loveLetterAdapter.validateResult(loveResult, { gameIndex: 1, config: loveConfig }, loveResultErrors);
    assert.deepStrictEqual(loveResultErrors, []);
    const invalidLoveResultErrors = [];
    loveLetterAdapter.validateResult({
      ...loveResult,
      heartTotals: { P1: 2, P2: 0 }
    }, { gameIndex: 1, config: loveConfig }, invalidLoveResultErrors);
    assert(invalidLoveResultErrors.some((message) => message.includes("final round totals")));

    const loveEvidence = {
      source: "visible_dom",
      evidenceId: "love-visible-evidence",
      evidenceText: "The same public Love Letter state is visible on both tabs.",
      contentClass: "public_ui",
      visibleToPlayerIds: lovePlayers.map((player) => player.id)
    };
    const loveSettingsEventErrors = [];
    loveLetterAdapter.validatePublicEvent("timeline", {
      type: "loveletter_settings_verified",
      gameIndex: 1,
      settings: { targetHearts: 1 },
      playerCount: 2,
      targetRange: { min: 1, max: 9 },
      selectionSource: "ai_selected_visible_ui",
      rationale: "One heart differs from the visible default.",
      ...loveEvidence
    }, { config: loveConfig }, loveSettingsEventErrors);
    assert.deepStrictEqual(loveSettingsEventErrors, []);
    const loveGuardEventErrors = [];
    loveLetterAdapter.validatePublicEvent("timeline", {
      type: "loveletter_card_played",
      gameIndex: 1,
      roundIndex: 1,
      actorId: "P1",
      cardId: "guard",
      targetId: "P2",
      guessCardId: "guard",
      noLegalTarget: false,
      ...loveEvidence
    }, { config: loveConfig }, loveGuardEventErrors);
    assert(loveGuardEventErrors.some((message) => message.includes("non-Guard guess")));

    const loveAuditTimeline = [
      { type: "loveletter_settings_verified", gameIndex: 1 },
      { type: "loveletter_information_isolation_checked", gameIndex: 1 },
      { type: "loveletter_round_started", gameIndex: 1, roundIndex: 1 },
      { type: "loveletter_round_settled", gameIndex: 1, ...loveRound },
      {
        type: "loveletter_match_settled",
        gameIndex: 1,
        winnerIds: ["P1"],
        heartTotals: { P1: 1, P2: 0 },
        targetHearts: 1,
        roundCount: 1
      },
      { type: "result_detail", gameIndex: 1, result: loveResult }
    ];
    const loveAuditErrors = [];
    loveLetterAdapter.auditRun({ config: loveConfig, timeline: loveAuditTimeline }, loveAuditErrors, []);
    assert.deepStrictEqual(loveAuditErrors, []);
    const missingLoveIsolationErrors = [];
    loveLetterAdapter.auditRun({
      config: loveConfig,
      timeline: loveAuditTimeline.filter((event) => event.type !== "loveletter_information_isolation_checked")
    }, missingLoveIsolationErrors, []);
    assert(missingLoveIsolationErrors.some((message) => message.includes("information_isolation_checked")));

    const unknownJourney = genericConfig(tempRoot);
    unknownJourney.testPurpose.journeyIds = ["core_assumed_journey"];
    expectError(() => resolveConfig(unknownJourney), /does not declare user journey/);

    const forcedNaturalScenario = genericConfig(tempRoot);
    forcedNaturalScenario.testPurpose.scenarioIds = ["vote_all_submission"];
    expectError(() => resolveConfig(forcedNaturalScenario), /natural_user cannot force scenarioIds/);

    const targetedWithoutScenario = genericConfig(tempRoot);
    targetedWithoutScenario.testPurpose.approach = "targeted_scenario";
    expectError(() => resolveConfig(targetedWithoutScenario), /requires at least one Adapter-declared scenarioId/);

    const partialScenario = genericConfig(tempRoot);
    partialScenario.testPurpose.approach = "targeted_scenario";
    partialScenario.testPurpose.scenarioIds = ["vote_partial_submission"];
    partialScenario.testPurpose.scenarioParameters = { voterIds: ["P1"] };
    assert.deepStrictEqual(resolveConfig(partialScenario).testPurpose.scenarioParameters.voterIds, ["P1"]);
    partialScenario.speed = { profile: "accelerated" };
    expectError(() => resolveConfig(partialScenario), /discussion deadline is not scalable/);

    const aiRecommended = genericConfig(tempRoot);
    aiRecommended.testPurpose.selectionSource = "ai_recommended";
    expectError(() => resolveConfig(aiRecommended), /requires recommendationRationale/);
    aiRecommended.testPurpose.recommendationRationale = "A small natural journey is the lowest-cost playability check.";
    assert.strictEqual(resolveConfig(aiRecommended).testPurpose.selectionSource, "ai_recommended");

    const discovery = genericConfig(tempRoot);
    discovery.game = "gangsi";
    delete discovery.entryUrl;
    discovery.playerCount = 3;
    discovery.gameSettings = { mode: "classic", mapSelection: "fixed", mapId: "classic" };
    discovery.allowExperimental = false;
    discovery.allowDiscovery = true;
    discovery.testPurpose = {
      ...discovery.testPurpose,
      selectionSource: "ai_recommended",
      recommendationRationale: "The planned Adapter must be mapped before formal playability testing.",
      approach: "exploratory",
      userPerspective: "first_time_player",
      journeyIds: ["discover_user_journeys"],
      focusAreas: ["onboarding", "core_gameplay"],
      successCriteria: [{
        id: "draft_visible_map",
        description: "Visible journeys and semantic controls are mapped.",
        oracle: "visible_ui",
        required: true
      }]
    };
    expectError(() => resolveConfig(discovery), /exploratory is reserved|experimental/);
    const invalidDiscovery = structuredClone(discovery);
    invalidDiscovery.testPurpose.approach = "natural_user";
    expectError(() => resolveConfig(invalidDiscovery), /experimental/);
    const experimentalBaseline = genericConfig(tempRoot);
    experimentalBaseline.game = "criminaldance";
    delete experimentalBaseline.entryUrl;
    experimentalBaseline.playerCount = 8;
    experimentalBaseline.players = [];
    experimentalBaseline.gameSettings = { inspector: false, juvenile: false };
    experimentalBaseline.allowExperimental = true;
    experimentalBaseline.allowDiscovery = false;
    experimentalBaseline.testPurpose = {
      ...experimentalBaseline.testPurpose,
      journeyIds: ["create_join_complete_match"]
    };
    const resolvedExperimentalBaseline = resolveConfig(experimentalBaseline);
    assert.strictEqual(resolvedExperimentalBaseline.adapterStatus, "experimental");
    assert.strictEqual(resolvedExperimentalBaseline.certificationCandidate, false);
    assert.strictEqual(resolvedExperimentalBaseline.playerCount, 8);
    const invalidCandidateType = structuredClone(experimentalBaseline);
    invalidCandidateType.certificationCandidate = "yes";
    expectError(() => resolveConfig(invalidCandidateType), /certificationCandidate must be a boolean/);
    const obsoleteCandidate = structuredClone(experimentalBaseline);
    obsoleteCandidate.certificationCandidate = true;
    expectError(() => resolveConfig(obsoleteCandidate), /only valid while the Catalog entry remains planned/);
    assert.strictEqual(
      resolveConfig(obsoleteCandidate, { allowUnverified: true }).certificationCandidate,
      true,
      "Auditors must be able to revalidate an immutable certification-candidate config after Catalog promotion."
    );
    const discoveryRun = initializeRun({
      ...gangsiClassic,
      testPurpose: { ...gangsiClassic.testPurpose, approach: "exploratory" }
    }, { runId: "adapter-discovery" });
    expectError(() => finalizeRun(discoveryRun.runDir, {
      status: "complete",
      productVerdict: "pass",
      findings: { P0: 0, P1: 0, P2: 0, decisionIsolationFailures: 0 }
    }), /cannot claim a product pass or fail/);

    const allVoteInput = baseConfig(tempRoot);
    allVoteInput.testPurpose = { mode: "rules_matrix", voteParticipation: "all" };
    assert.deepStrictEqual(resolveConfig(allVoteInput).testPurpose, {
      mode: "rules_matrix",
      voteParticipation: "all",
      settlementTrigger: "all_submitted",
      decisionPacing: "scripted",
      voterIds: ["P1", "P2", "P3"]
    });

    const noVoteInput = baseConfig(tempRoot);
    noVoteInput.testPurpose = { mode: "rules_matrix", voteParticipation: "none" };
    assert.deepStrictEqual(resolveConfig(noVoteInput).testPurpose, {
      mode: "rules_matrix",
      voteParticipation: "none",
      settlementTrigger: "deadline",
      decisionPacing: "scripted",
      voterIds: []
    });

    const partialVoteInput = baseConfig(tempRoot);
    partialVoteInput.testPurpose = {
      mode: "rules_matrix",
      voteParticipation: "partial",
      settlementTrigger: "deadline",
      voterIds: ["P1", "P3"]
    };
    assert.deepStrictEqual(resolveConfig(partialVoteInput).testPurpose.voterIds, ["P1", "P3"]);

    const missingPartialVoters = baseConfig(tempRoot);
    missingPartialVoters.testPurpose = { mode: "rules_matrix", voteParticipation: "partial" };
    expectError(() => resolveConfig(missingPartialVoters), /non-empty proper subset/);

    const forcedNaturalVote = baseConfig(tempRoot);
    forcedNaturalVote.testPurpose = { mode: "natural_play", voteParticipation: "all" };
    expectError(() => resolveConfig(forcedNaturalVote), /agent_decides/);

    const missingPurpose = baseConfig(tempRoot);
    delete missingPurpose.testPurpose;
    expectError(() => resolveConfig(missingPurpose), /testPurpose must be an object/);

    const stringSpeed = baseConfig(tempRoot);
    stringSpeed.speed = "accelerated";
    expectError(() => resolveConfig(stringSpeed), /speed must be an object/);

    const unsafePlayerId = baseConfig(tempRoot);
    unsafePlayerId.players = [
      { id: "P1", name: "One", style: "evidence_first" },
      { id: "..\\escaped", name: "Two", style: "social_persuasion" },
      { id: "P3", name: "Three", style: "risk_tolerant_contrarian" }
    ];
    expectError(() => resolveConfig(unsafePlayerId), /cannot contain path separators/);

    const forcedNaturalParticipation = baseConfig(tempRoot);
    forcedNaturalParticipation.testPurpose.allowNonVoting = false;
    expectError(() => resolveConfig(forcedNaturalParticipation), /must allow an agent to decide not to vote/);

    const forcedNaturalSpeech = baseConfig(tempRoot);
    forcedNaturalSpeech.discussion.allowStrategicSilence = false;
    expectError(() => resolveConfig(forcedNaturalSpeech), /must allow strategic silence/);

    const acceleratedDeadline = baseConfig(tempRoot);
    acceleratedDeadline.speed = { profile: "accelerated" };
    acceleratedDeadline.testPurpose = { mode: "rules_matrix", voteParticipation: "none" };
    expectError(() => resolveConfig(acceleratedDeadline), /require serverTimeScale: 1\.0/);

    const voteErrors = [];
    validateVoteParticipation(
      { mode: "rules_matrix", voterIds: ["P1", "P3"], settlementTrigger: "deadline" },
      ["P1", "P2", "P3"],
      {
        actualVoterIds: ["P1", "P3"],
        nonVoterIds: ["P2"],
        actualSettlementTrigger: "deadline",
        source: "visible_dom"
      },
      1,
      voteErrors
    );
    assert.deepStrictEqual(voteErrors, []);

    const invalidVoteErrors = [];
    validateVoteParticipation(
      { mode: "rules_matrix", voterIds: ["P1"], settlementTrigger: "deadline" },
      ["P1", "P2", "P3"],
      {
        actualVoterIds: ["P1", "P2"],
        nonVoterIds: ["P2"],
        actualSettlementTrigger: "all_submitted",
        source: "server_state"
      },
      1,
      invalidVoteErrors
    );
    assert(invalidVoteErrors.some((error) => error.includes("partition every configured player")));
    assert(invalidVoteErrors.some((error) => error.includes("voter set differs")));
    assert(invalidVoteErrors.some((error) => error.includes("settlement trigger differs")));
    assert(invalidVoteErrors.some((error) => error.includes("visible_dom")));

    const validDeadlineErrors = [];
    validateDeadlineEvidence([
      {
        type: "discussion_started",
        gameIndex: 1,
        at: "2026-07-17T00:00:00.000Z",
        writerMonotonicMs: 100000,
        writerOrder: 1,
        deadlineAt: "2026-07-17T00:02:00.000Z",
        discussionSeconds: 120,
        source: "visible_dom"
      },
      {
        type: "deadline_reached",
        gameIndex: 1,
        at: "2026-07-17T00:02:00.100Z",
        writerMonotonicMs: 220100,
        writerOrder: 2,
        remainingSeconds: 0,
        source: "visible_dom"
      }
    ], { gameSettings: { discussionSeconds: 120 } }, 1, validDeadlineErrors);
    assert.deepStrictEqual(validDeadlineErrors, []);

    const earlyDeadlineErrors = [];
    validateDeadlineEvidence([
      {
        type: "discussion_started",
        gameIndex: 1,
        at: "2026-07-17T00:00:00.000Z",
        writerMonotonicMs: 100000,
        writerOrder: 1,
        deadlineAt: "2026-07-17T00:02:00.000Z",
        discussionSeconds: 120,
        source: "visible_dom"
      },
      {
        type: "deadline_reached",
        gameIndex: 1,
        at: "2026-07-17T00:00:20.000Z",
        writerMonotonicMs: 120000,
        writerOrder: 2,
        remainingSeconds: 0,
        source: "visible_dom"
      }
    ], { gameSettings: { discussionSeconds: 120 } }, 1, earlyDeadlineErrors);
    assert(earlyDeadlineErrors.some((error) => error.includes("before the real discussion deadline")));

    const adversarialInput = baseConfig(tempRoot);
    adversarialInput.playerCount = 5;
    adversarialInput.discussion.behaviorMix = "adversarial";
    const adversarial = resolveConfig(adversarialInput);
    assert.deepStrictEqual(
      adversarial.players.map((player) => player.communicationBehavior),
      ["deceptive_claim", "strategic_silence", "selective_disclosure", "deceptive_claim", "adaptive"]
    );

    const behaviorMatrixInput = baseConfig(tempRoot);
    behaviorMatrixInput.testPurpose.mode = "behavior_matrix";
    behaviorMatrixInput.discussion.enforceBehaviorCoverage = true;
    assert.strictEqual(resolveConfig(behaviorMatrixInput).testPurpose.mode, "behavior_matrix");

    const forcedNaturalBehavior = baseConfig(tempRoot);
    forcedNaturalBehavior.discussion.enforceBehaviorCoverage = true;
    expectError(() => resolveConfig(forcedNaturalBehavior), /Only behavior_matrix/);

    const customBehaviorInput = baseConfig(tempRoot);
    customBehaviorInput.discussion.behaviorMix = "custom";
    expectError(() => resolveConfig(customBehaviorInput), /must be provided explicitly/);

    const fastInput = baseConfig(tempRoot);
    fastInput.speed = { profile: "fast" };
    const fast = resolveConfig(fastInput).speed;
    assert.deepStrictEqual(
      { operationDelayMs: fast.operationDelayMs, pollIntervalMs: fast.pollIntervalMs, serverTimeScale: fast.serverTimeScale },
      { operationDelayMs: 0, pollIntervalMs: 100, serverTimeScale: 1 }
    );

    const acceleratedInput = baseConfig(tempRoot);
    acceleratedInput.speed = { profile: "accelerated" };
    const accelerated = resolveConfig(acceleratedInput).speed;
    assert.deepStrictEqual(
      { operationDelayMs: accelerated.operationDelayMs, pollIntervalMs: accelerated.pollIntervalMs, serverTimeScale: accelerated.serverTimeScale },
      { operationDelayMs: 0, pollIntervalMs: 100, serverTimeScale: 0.1 }
    );

    const customInput = baseConfig(tempRoot);
    customInput.speed = {
      profile: "custom",
      operationDelayMs: 300,
      pollIntervalMs: 100,
      serverTimeScale: 0.25,
      narration: "none"
    };
    const custom = resolveConfig(customInput).speed;
    assert.deepStrictEqual(
      {
        operationDelayMs: custom.operationDelayMs,
        pollIntervalMs: custom.pollIntervalMs,
        serverTimeScale: custom.serverTimeScale,
        narration: custom.narration,
        timingFidelity: custom.timingFidelity
      },
      {
        operationDelayMs: 300,
        pollIntervalMs: 100,
        serverTimeScale: 0.25,
        narration: "none",
        timingFidelity: "accelerated_waits"
      }
    );

    const remoteInput = baseConfig(tempRoot);
    remoteInput.entryUrl = "https://example.com/Onenightwolf/";
    remoteInput.speed = { profile: "accelerated" };
    expectError(() => resolveConfig(remoteInput), /Server 加速只允許/);

    const ipv6Input = baseConfig(tempRoot);
    ipv6Input.entryUrl = "http://[::1]:4173/Onenightwolf/";
    ipv6Input.speed = { profile: "accelerated" };
    assert.strictEqual(resolveConfig(ipv6Input).speed.serverTimeScale, 0.1);

    const experimentalInput = baseConfig(tempRoot);
    experimentalInput.game = "criminaldance";
    experimentalInput.playerCount = 3;
    experimentalInput.allowExperimental = false;
    expectError(() => resolveConfig(experimentalInput), /experimental/);

    const invalidSpeed = baseConfig(tempRoot);
    invalidSpeed.speed = { profile: "custom", operationDelayMs: 4000, pollIntervalMs: 1, serverTimeScale: 0.01 };
    expectError(() => resolveConfig(invalidSpeed), /speed\.operationDelayMs/);

    const invalidPoll = baseConfig(tempRoot);
    invalidPoll.speed = { profile: "custom", operationDelayMs: 0, pollIntervalMs: 49, serverTimeScale: 1 };
    expectError(() => resolveConfig(invalidPoll), /speed\.pollIntervalMs/);

    const invalidScale = baseConfig(tempRoot);
    invalidScale.speed = { profile: "custom", operationDelayMs: 0, pollIntervalMs: 50, serverTimeScale: 1.01 };
    expectError(() => resolveConfig(invalidScale), /speed\.serverTimeScale/);

    const customDeck = baseConfig(tempRoot);
    customDeck.gameSettings = {
      deckPreset: "custom",
      discussionSeconds: 300,
      customDeck: ["werewolf", "seer"]
    };
    expectError(() => resolveConfig(customDeck), /deck size must equal playerCount \+ 3/);

    const first = initializeRun(watch, { runId: "fixed-run", now: new Date("2026-07-17T00:00:00Z") });
    const second = initializeRun(watch, { runId: "fixed-run", now: new Date("2026-07-17T00:00:00Z") });
    expectError(() => initializeRun(watch, { runId: "..\\escaped" }), /cannot traverse directories/);
    assert.notStrictEqual(first.runDir, second.runDir);
    assert(!fs.existsSync(path.join(first.runDir, "public", "screenshots")));
    expectError(() => appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: { at: "2020-01-01T00:00:00.000Z", type: "forged_timestamp" }
    }), /timestamps are assigned by the writer/);
    expectError(() => appendEvent({
      runDir: first.runDir,
      scope: "player",
      kind: "console",
      playerId: "P4",
      event: { type: "unconfigured_player" }
    }), /not a configured Run participant/);
    expectError(() => appendEvent({
      runDir: first.runDir,
      scope: "player",
      kind: "console",
      playerId: "..\\P1",
      event: { type: "escaped_player" }
    }), /not a configured Run participant/);

    const appendScript = path.join(__dirname, "append-event.js");
    await Promise.all(["P1", "P2", "P3"].map((playerId) => {
      const payload = Buffer.from(JSON.stringify({
        type: "writer_concurrency_probe",
        playerId,
        gameIndex: 1
      }), "utf8").toString("base64");
      return execFile(process.execPath, [
        appendScript,
        "--run", first.runDir,
        "--scope", "player",
        "--kind", "console",
        "--player", playerId,
        "--json-base64", payload
      ]);
    }));
    const concurrentOrders = ["P1", "P2", "P3"].flatMap((playerId) => fs.readFileSync(
      path.join(first.runDir, "players", playerId, "console.jsonl"), "utf8"
    ).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).writerOrder));
    assert.strictEqual(new Set(concurrentOrders).size, 3);
    assert.strictEqual(readJson(path.join(first.runDir, "writer-state.json")).nextOrder, Math.max(...concurrentOrders) + 1);

    expectError(() => appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: { type: "game_started", gameIndex: 1, privateFacts: ["secret"] }
    }), /privateFacts/);
    expectError(() => appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: { type: "bad_semantic_leak", facts: ["P1 is a werewolf"] }
    }), /unexpected fields|不得包含 facts/);
    expectError(() => appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: { type: "game_started", gameIndex: 1, payload: "P1 is a werewolf" }
    }), /unexpected fields: payload/);
    expectError(() => appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "final-state",
      event: { gameIndex: 1, playerId: "P1", normalizedResult: { finalRoles: { P1: "werewolf" } }, tabIndex: 1 }
    }), /requires a prior visible settlement marker/);
    assert.strictEqual(containsForbiddenPublicKey({ private_facts: ["secret"] }), "private_facts");
    assert.strictEqual(containsForbiddenPublicKey({ role: "werewolf" }), "role");
    assert.strictEqual(containsForbiddenPublicKey({ finalRoles: { P1: "werewolf" } }), "finalRoles");
    assert.strictEqual(containsForbiddenPublicKey({ facts: ["P1 is a werewolf"] }), "facts");
    assert.strictEqual(containsForbiddenPublicKey({ payload: "data:image/png;base64,AA==" }), "embedded_image");
    assert.strictEqual(containsForbiddenPublicKey({ payload: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" }), "embedded_image");
    const bmpPayload = Buffer.concat([Buffer.from("BM", "ascii"), Buffer.alloc(64)]).toString("base64");
    assert.strictEqual(containsForbiddenPublicKey({ payload: bmpPayload }), "embedded_image");
    const tiffPayload = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(64)]).toString("base64");
    assert.strictEqual(containsForbiddenPublicKey({ payload: tiffPayload }), "embedded_image");
    const avif = Buffer.alloc(64);
    avif.writeUInt32BE(64, 0);
    avif.write("ftyp", 4, "ascii");
    avif.write("avif", 8, "ascii");
    const wrappedAvifPayload = avif.toString("base64").match(/.{1,8}/g).join(" \n");
    assert.strictEqual(containsForbiddenPublicKey({ payload: wrappedAvifPayload }), "embedded_image");
    expectError(() => appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: { type: "public_observation", gameIndex: 1, screenshot: "data:image/png;base64,AA==" }
    }), /screenshot/);
    expectError(() => appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        type: "public_observation",
        gameIndex: 1,
        phase: "lobby",
        source: "visible_dom",
        evidenceId: "bad-base64-image",
        evidenceText: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        contentClass: "public_ui",
        visibleToPlayerIds: ["P1", "P2", "P3"]
      }
    }), /embedded_image/);
    expectError(() => appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        type: "public_observation",
        gameIndex: 1,
        phase: "lobby",
        source: "visible_dom",
        evidenceId: "bad-bmp-base64-image",
        evidenceText: bmpPayload,
        contentClass: "public_ui",
        visibleToPlayerIds: ["P1", "P2", "P3"]
      }
    }), /embedded_image/);
    expectError(() => appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        type: "public_observation",
        gameIndex: 1,
        phase: "role_reveal",
        source: "visible_dom",
        evidenceId: "bad-private-ui",
        evidenceText: "PRIVATE ROLE P1 = SEER",
        contentClass: "public_ui",
        visibleToPlayerIds: ["P1", "P2", "P3"]
      }
    }), /private-role marker/);

    const gitHead = "0".repeat(40);
    const productSourceSha256 = "a".repeat(64);
    expectError(() => appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        type: "product_test",
        command: "PRIVATE ROLE P1 = SEER",
        passed: true,
        gitHead,
        productSourceSha256,
        sourceTreeDirty: false
      }
    }), /private-role marker/);
    const serverManagedBySkill = "reused_existing_server";
    const agentPlayers = watch.players.map((player) => ({ id: player.id, agent: `fixture-${player.id}` }));
    const normalizedResult = {
      headline: "Wolves win",
      reason: "No werewolf was executed in the synthetic fixture",
      winner: "wolf",
      execution: [],
      votes: [
        { voter: "P1", target: "P2" },
        { voter: "P2", target: "P3" },
        { voter: "P3", target: "P1" }
      ],
      finalRoles: { P1: "seer", P2: "werewolf", P3: "villager" },
      centerCards: ["robber", "drunk", "insomniac"],
      nightHistory: ["Synthetic night completed"]
    };

    appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: { type: "product_test", command: "synthetic fixture", passed: true, gitHead, productSourceSha256, sourceTreeDirty: false }
    });
    appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        type: "server_capability",
        endpoint: "http://localhost:4173/__ai-e2e/capabilities",
        status: 404,
        response: { error: "AI E2E mode is not enabled" },
        serverManagement: serverManagedBySkill
      }
    });
    appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        type: "agent_provenance",
        mode: "isolated_subagents",
        forkTurns: "none",
        browserAccess: false,
        projectAccess: false,
        players: agentPlayers
      }
    });
    watch.players.forEach((player) => appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "chat",
      event: {
        type: "identity_message",
        playerId: player.id,
        playerName: player.name,
        message: `IDENTITY_CHECK ${player.id} ${player.name}`,
        source: "visible_dom",
        contentClass: "public_chat",
        visibleToPlayerIds: watch.players.map((entry) => entry.id)
      }
    }));
    appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        type: "identity_check",
        passed: true,
        reload: false
      }
    });
    appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        type: "game_started",
        gameIndex: 1,
        evidenceId: "g1-room-ready",
        evidenceText: "room ready",
        source: "visible_dom",
        contentClass: "public_ui",
        visibleToPlayerIds: watch.players.map((entry) => entry.id)
      }
    });
    appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        type: "discussion_started",
        gameIndex: 1,
        discussionSeconds: 300,
        deadlineAt: "2026-07-17T00:05:00.000Z",
        evidenceId: "g1-discussion-open",
        evidenceText: "discussion opened",
        source: "visible_dom",
        contentClass: "public_ui",
        visibleToPlayerIds: watch.players.map((entry) => entry.id)
      }
    });

    watch.players.forEach((player, index) => {
      const observationId = `${player.id}-g1-001`;
      appendEvent({
        runDir: first.runDir,
        scope: "player",
        kind: "observation",
        playerId: player.id,
        event: {
          observationId,
          gameIndex: 1,
          phase: "lobby",
          publicFacts: [{
            text: "room ready",
            evidenceId: "g1-room-ready",
            visibility: "public",
            source: "visible_dom"
          }],
          privateFacts: [],
          legalActions: ["confirm"],
          ownMemory: []
        }
      });
      appendEvent({
        runDir: first.runDir,
        scope: "player",
        kind: "decision",
        playerId: player.id,
        event: {
          observationId,
          action: "confirm",
          targets: [],
          publicMessage: null,
          privateRationale: "only action",
          evidenceRefs: ["publicFacts[0]", "legalActions[0]"],
          readyToVote: false
        }
      });
      const discussionObservationId = `${player.id}-g1-discussion-1`;
      const messages = [
        "I have a concrete result that supports the village case.",
        "I will share only part of my result for now.",
        "I was the robber and verified P1."
      ];
      appendEvent({
        runDir: first.runDir,
        scope: "player",
        kind: "console",
        playerId: player.id,
        event: {
          type: "private_dom_fact",
          playerId: player.id,
          gameIndex: 1,
          evidenceId: `${player.id}-g1-private-role`,
          evidenceText: "synthetic private role",
          source: "visible_dom"
        }
      });
      appendEvent({
        runDir: first.runDir,
        scope: "player",
        kind: "observation",
        playerId: player.id,
        event: {
          observationId: discussionObservationId,
          gameIndex: 1,
          phase: "discussion_pass_1",
          publicFacts: [{
            text: "discussion opened",
            evidenceId: "g1-discussion-open",
            visibility: "public",
            source: "visible_dom"
          }],
          privateFacts: [{
            text: "synthetic private role",
            evidenceId: `${player.id}-g1-private-role`,
            visibility: "private",
            source: "visible_dom",
            sourcePlayerId: player.id
          }],
          legalActions: ["send_chat", "stay_silent"],
          ownMemory: []
        }
      });
      appendEvent({
        runDir: first.runDir,
        scope: "player",
        kind: "decision",
        playerId: player.id,
        event: {
          observationId: discussionObservationId,
          action: "send_chat",
          targets: [],
          publicMessage: messages[index],
          communicationIntent: index === 0 ? "adaptive" : player.communicationBehavior,
          privateRationale: "exercise configured communication behavior",
          evidenceRefs: ["publicFacts[0]", "privateFacts[0]", "legalActions[0]"],
          readyToVote: false
        }
      });
      appendEvent({
        runDir: first.runDir,
        scope: "public",
        kind: "chat",
        event: {
          type: "message",
          gameIndex: 1,
          phase: "discussion_pass_1",
          observationId: discussionObservationId,
          playerId: player.id,
          playerName: player.name,
          message: messages[index],
          source: "visible_dom",
          contentClass: "public_chat",
          visibleToPlayerIds: watch.players.map((entry) => entry.id)
        }
      });
      const voteTarget = ["P2", "P3", "P1"][index];
      const voteObservationId = `${player.id}-g1-vote`;
      appendEvent({
        runDir: first.runDir,
        scope: "player",
        kind: "observation",
        playerId: player.id,
        event: {
          observationId: voteObservationId,
          gameIndex: 1,
          phase: "vote",
          publicFacts: [{
            text: "discussion opened",
            evidenceId: "g1-discussion-open",
            visibility: "public",
            source: "visible_dom"
          }],
          privateFacts: [{
            text: "synthetic private role",
            evidenceId: `${player.id}-g1-private-role`,
            visibility: "private",
            source: "visible_dom",
            sourcePlayerId: player.id
          }],
          legalActions: [`vote:${voteTarget}`],
          ownMemory: [{
            text: "I already made one public claim.",
            sourceObservationId: discussionObservationId
          }]
        }
      });
      appendEvent({
        runDir: first.runDir,
        scope: "player",
        kind: "decision",
        playerId: player.id,
        event: {
          observationId: voteObservationId,
          action: "vote",
          targets: [voteTarget],
          publicMessage: null,
          timingIntent: "vote_now",
          privateRationale: "synthetic autonomous vote",
          evidenceRefs: ["publicFacts[0]", "privateFacts[0]", "legalActions[0]", "ownMemory[0]"],
          readyToVote: true
        }
      });
      appendEvent({
        runDir: first.runDir,
        scope: "player",
        kind: "console",
        playerId: player.id,
        event: {
          type: "vote_action",
          playerId: player.id,
          gameIndex: 1,
          targetId: voteTarget,
          evidenceId: `${player.id}-g1-vote-action`,
          evidenceText: `Vote submitted for ${voteTarget}`,
          source: "visible_dom"
        }
      });
    });

    appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        type: "isolation_check",
        gameIndex: 1,
        playerTabs: true,
        privateUi: true,
        agentContext: true,
        evidenceRefs: true
      }
    });

    appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        type: "settlement_visible",
        gameIndex: 1,
        evidenceId: "g1-settlement-visible",
        evidenceText: "settlement visible",
        source: "visible_dom",
        contentClass: "public_ui",
        visibleToPlayerIds: watch.players.map((entry) => entry.id)
      }
    });

    appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        type: "vote_participation",
        gameIndex: 1,
        actualVoterIds: ["P1", "P2", "P3"],
        nonVoterIds: [],
        actualSettlementTrigger: "all_submitted",
        source: "visible_dom"
      }
    });

    appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        type: "settlement_detail",
        gameIndex: 1,
        headline: "Wolves win",
        reason: "No werewolf was executed in the synthetic fixture",
        winner: "wolf",
        eliminated: [],
        votes: [
          { voter: "P1", target: "P2" },
          { voter: "P2", target: "P3" },
          { voter: "P3", target: "P1" }
        ],
        finalRoles: { P1: "seer", P2: "werewolf", P3: "villager" },
        centerCards: ["robber", "drunk", "insomniac"],
        nightHistory: ["Synthetic night completed"]
      }
    });
    watch.players.forEach((player, index) => appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "final-state",
      event: { gameIndex: 1, playerId: player.id, normalizedResult, tabIndex: index + 1 }
    }));
    watch.players.forEach((player, index) => appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        type: "behavior_evaluation",
        gameIndex: 1,
        playerId: player.id,
        configuredBehavior: player.communicationBehavior,
        observedIntent: index === 0 ? "adaptive" : player.communicationBehavior,
        spoke: true,
        claimAssessment: ["truthful", "partial", "false"][index],
        settlementEvidence: index === 2 ? "Night history shows P3 did not rob P1." : ""
      }
    }));
    appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        type: "resource_cleanup",
        policyVersion: "1.0",
        status: "passed",
        ownedTabsClosed: 3,
        ownedContextsClosed: 0,
        ownedProcessesStopped: 0,
        ownedServersStopped: 0,
        isolatedPlayersReleased: 3,
        temporaryArtifactsRemoved: 0,
        reusedResourcesPreserved: true,
        unresolvedResources: []
      }
    });
    appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: { type: "product_build_verified", gitHead, productSourceSha256, sourceTreeDirty: false }
    });

    expectError(() => finalizeRun(first.runDir, {
      status: "complete",
      productVerdict: "pass",
      finishedAt: "2020-01-01T00:00:00.000Z",
      findings: { P0: 0, P1: 0, P2: 0, decisionIsolationFailures: 0 }
    }), /finishedAt is assigned by the finalizer/);

    const final = finalizeRun(first.runDir, {
      status: "complete",
      productVerdict: "pass",
      findings: { P0: 0, P1: 0, P2: 0, decisionIsolationFailures: 0 },
      games: [{ gameIndex: 1, status: "complete" }],
      isolation: { playerTabs: "pass", privateUi: "pass", agentDecisionContext: "pass", evidenceRefs: "pass" },
      serverManagedBySkill,
      capability: { enabled: false, status: 404, timeScale: 1, timingFidelity: "production" },
      agentProvenance: {
        mode: "isolated_subagents",
        forkTurns: "none",
        browserAccess: false,
        projectAccess: false,
        players: agentPlayers
      },
      productBuild: {
        passed: true,
        command: "synthetic fixture",
        gitHead,
        productSourceSha256,
        sourceTreeDirty: false
      }
    });
    assert.strictEqual(final.report.audit.passed, true, final.report.audit.errors.join("\n"));
    assert(final.report.summary.includes("## Resource cleanup"));
    assert(final.report.summary.includes("Status: `passed`"));
    assert.strictEqual(final.run.speed.serverManagedBySkill, serverManagedBySkill);
    const deployedIdentityRun = path.join(tempRoot, "deployed-identity-run");
    fs.cpSync(first.runDir, deployedIdentityRun, { recursive: true });
    const deployedRunJsonPath = path.join(deployedIdentityRun, "run.json");
    const deployedRunJson = readJson(deployedRunJsonPath);
    deployedRunJson.serverManagedBySkill = "reused_remote_not_owned";
    deployedRunJson.speed.serverManagedBySkill = "reused_remote_not_owned";
    deployedRunJson.capability = {
      status: "not_applicable_remote_production",
      enabled: false,
      timeScale: 1,
      timingFidelity: "production"
    };
    deployedRunJson.productBuild = {
      passed: true,
      command: "capture deployed entry assets",
      testScope: "deployed_asset_fingerprint",
      identity: deployedIdentity
    };
    writeJson(deployedRunJsonPath, deployedRunJson);
    const deployedConfigPath = path.join(deployedIdentityRun, "config.resolved.json");
    const deployedConfig = readJson(deployedConfigPath);
    deployedConfig.entryUrl = deployedIdentity.entryUrl;
    writeJson(deployedConfigPath, deployedConfig);
    const deployedTimelinePath = path.join(deployedIdentityRun, "public", "timeline.jsonl");
    const deployedTimeline = fs.readFileSync(deployedTimelinePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
      const event = JSON.parse(line);
      if (event.type === "product_test") {
        return {
          ...event,
          command: "capture deployed entry assets",
          testScope: "deployed_asset_fingerprint",
          identity: deployedIdentity,
          gitHead: undefined,
          productSourceSha256: undefined,
          sourceTreeDirty: undefined
        };
      }
      if (event.type === "product_build_verified") {
        return {
          ...event,
          identity: deployedIdentity,
          gitHead: undefined,
          productSourceSha256: undefined,
          sourceTreeDirty: undefined
        };
      }
      if (event.type === "server_capability") {
        return {
          ...event,
          endpoint: undefined,
          status: "not_applicable_remote_production",
          response: undefined,
          serverManagement: "reused_remote_not_owned"
        };
      }
      return event;
    });
    fs.writeFileSync(deployedTimelinePath, `${deployedTimeline.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
    const deployedIdentityAudit = auditRun(deployedIdentityRun, { write: false });
    assert.strictEqual(deployedIdentityAudit.passed, true, deployedIdentityAudit.errors.join("\n"));
    const missingCleanupRun = path.join(tempRoot, "missing-cleanup-run");
    fs.cpSync(first.runDir, missingCleanupRun, { recursive: true });
    const missingCleanupTimeline = path.join(missingCleanupRun, "public", "timeline.jsonl");
    const withoutCleanup = fs.readFileSync(missingCleanupTimeline, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.includes('"type":"resource_cleanup"'))
      .join("\n");
    fs.writeFileSync(missingCleanupTimeline, `${withoutCleanup}\n`, "utf8");
    assert(auditRun(missingCleanupRun, { write: false }).errors.some((message) => message.includes("resource_cleanup")));
    const reconnectRequiredRun = path.join(tempRoot, "reconnect-required-run");
    fs.cpSync(first.runDir, reconnectRequiredRun, { recursive: true });
    const reconnectRequiredConfigPath = path.join(reconnectRequiredRun, "config.resolved.json");
    const reconnectRequiredConfig = readJson(reconnectRequiredConfigPath);
    reconnectRequiredConfig.reconnect = { mode: "in_game_reload" };
    writeJson(reconnectRequiredConfigPath, reconnectRequiredConfig);
    const reconnectRequiredAudit = auditRun(reconnectRequiredRun, { write: false });
    assert.strictEqual(reconnectRequiredAudit.passed, false);
    assert(reconnectRequiredAudit.errors.some((error) => error.includes("one-tab reload identity persistence")));
    expectError(() => appendEvent({
      runDir: first.runDir,
      scope: "public",
      kind: "timeline",
      event: { type: "late_evidence" }
    }), /禁止回填證據/);
    assert(fs.existsSync(path.join(first.runDir, "summary.md")));
    assert(fs.existsSync(path.join(first.runDir, "findings.md")));

    const recoveryFixture = initializeRun(watch, { runId: "pending-finalization-recovery" });
    const recoveryFinishedAt = new Date().toISOString();
    const recoveryUpdated = {
      ...readJson(path.join(recoveryFixture.runDir, "run.json")),
      status: "aborted",
      finishedAt: recoveryFinishedAt,
      productVerdict: "not_evaluated",
      findings: { P0: 0, P1: 0, P2: 0, decisionIsolationFailures: 0 },
      notes: ["simulated interruption after final event append"]
    };
    writeJson(path.join(recoveryFixture.runDir, "finalization-pending.json"), {
      schemaVersion: "1.0",
      phase: "validated",
      ownerPid: 999999,
      updated: recoveryUpdated
    }, { exclusive: true });
    appendEvent({
      runDir: recoveryFixture.runDir,
      scope: "public",
      kind: "timeline",
      event: {
        at: recoveryFinishedAt,
        type: "run_finished",
        status: "aborted",
        productVerdict: "not_evaluated",
        findings: recoveryUpdated.findings,
        finishedAt: recoveryFinishedAt
      },
      allowFinalized: true
    });
    assert.strictEqual(readJson(path.join(recoveryFixture.runDir, "run.json")).status, "initialized");
    const recovered = finalizeRun(recoveryFixture.runDir, {
      status: "aborted",
      productVerdict: "not_evaluated",
      findings: recoveryUpdated.findings
    }, { buildReport: false });
    assert.strictEqual(recovered.run.status, "aborted");
    assert(!fs.existsSync(path.join(recoveryFixture.runDir, "finalization-pending.json")));
    const recoveredFinishEvents = fs.readFileSync(
      path.join(recoveryFixture.runDir, "public", "timeline.jsonl"), "utf8"
    ).split(/\r?\n/).filter((line) => line.includes('"type":"run_finished"'));
    assert.strictEqual(recoveredFinishEvents.length, 1);

    const tamperedNaturalRun = path.join(tempRoot, "tampered-natural-run");
    fs.cpSync(first.runDir, tamperedNaturalRun, { recursive: true });
    const p1DecisionsPath = path.join(tamperedNaturalRun, "players", "P1", "decisions.jsonl");
    const withoutVoteDecision = fs.readFileSync(p1DecisionsPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.includes('"observationId":"P1-g1-vote"'))
      .join("\n");
    fs.writeFileSync(p1DecisionsPath, `${withoutVoteDecision}\n`, "utf8");
    const tamperedNaturalAudit = auditRun(tamperedNaturalRun, { write: false });
    assert.strictEqual(tamperedNaturalAudit.passed, false);
    assert(tamperedNaturalAudit.errors.some((error) => error.includes("autonomous final vote/abstain Decision")));

    const lateVoteRun = path.join(tempRoot, "late-vote-run");
    fs.cpSync(first.runDir, lateVoteRun, { recursive: true });
    const lateVoteDecisionsPath = path.join(lateVoteRun, "players", "P1", "decisions.jsonl");
    const lateVoteDecisions = fs.readFileSync(lateVoteDecisionsPath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const event = JSON.parse(line);
        if (event.observationId === "P1-g1-vote") {
          event.writerMonotonicMs = Number.MAX_SAFE_INTEGER;
          event.writerOrder = Number.MAX_SAFE_INTEGER;
        }
        return JSON.stringify(event);
      });
    fs.writeFileSync(lateVoteDecisionsPath, `${lateVoteDecisions.join("\n")}\n`, "utf8");
    const lateVoteAudit = auditRun(lateVoteRun, { write: false });
    assert.strictEqual(lateVoteAudit.passed, false);
    assert(lateVoteAudit.errors.some((error) => error.includes("recorded after vote participation/result evidence")));

    const crossGameEvidenceRun = path.join(tempRoot, "cross-game-evidence-run");
    fs.cpSync(first.runDir, crossGameEvidenceRun, { recursive: true });
    const p1ConsolePath = path.join(crossGameEvidenceRun, "players", "P1", "console.jsonl");
    const crossGameConsole = fs.readFileSync(p1ConsolePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const event = JSON.parse(line);
        if (event.evidenceId === "P1-g1-private-role") {
          event.gameIndex = 2;
          event.writerMonotonicMs = Number.MAX_SAFE_INTEGER;
          event.writerOrder = Number.MAX_SAFE_INTEGER;
        }
        return JSON.stringify(event);
      });
    fs.writeFileSync(p1ConsolePath, `${crossGameConsole.join("\n")}\n`, "utf8");
    const crossGameAudit = auditRun(crossGameEvidenceRun, { write: false });
    assert.strictEqual(crossGameAudit.passed, false);
    assert(crossGameAudit.errors.some((error) => error.includes("comes from a different game")));
    assert(crossGameAudit.errors.some((error) => error.includes("source evidence was recorded after the Observation")));

    const beforeRejectedFinalization = fs.readFileSync(path.join(second.runDir, "run.json"), "utf8");
    expectError(() => finalizeRun(second.runDir, {
      status: "incomplete",
      productVerdict: "pass",
      findings: { P0: 0, P1: 0, P2: 0, decisionIsolationFailures: 0 }
    }), /pass requires status complete/);
    expectError(() => finalizeRun(second.runDir, {
      status: "complete",
      productVerdict: "not_evaluated",
      findings: { P0: 0, P1: 0, P2: 0, decisionIsolationFailures: 0 }
    }), /complete runs require productVerdict pass or fail/);
    expectError(() => finalizeRun(second.runDir, {
      status: "complete",
      productVerdict: "fail",
      findings: { P0: 0, P1: 1, P2: 0, decisionIsolationFailures: 0 }
    }), /Finalization structural audit failed/);
    expectError(() => finalizeRun(second.runDir, {
      status: "complete",
      productVerdict: "pass",
      findings: { P0: 0, P1: 0, P2: 0, decisionIsolationFailures: 0 }
    }), /Finalization structural audit failed/);
    assert.strictEqual(fs.readFileSync(path.join(second.runDir, "run.json"), "utf8"), beforeRejectedFinalization);
    assert(!fs.readFileSync(path.join(second.runDir, "public", "timeline.jsonl"), "utf8").includes('"type":"run_finished"'));

    fs.writeFileSync(path.join(second.runDir, "evidence.png"), "not-an-image", "utf8");
    fs.writeFileSync(path.join(second.runDir, "evidence.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    fs.mkdirSync(path.join(second.runDir, "public", "screenshots"));
    fs.appendFileSync(path.join(second.runDir, "players", "P1", "observations.jsonl"), `${JSON.stringify({
      at: new Date().toISOString(),
      observationId: "injected-cross-player-secret",
      gameIndex: 1,
      phase: "discussion",
      publicFacts: ["P2 is a werewolf"],
      privateFacts: [],
      legalActions: ["wait"],
      ownMemory: []
    })}\n`, "utf8");
    const imageAudit = auditRun(second.runDir);
    assert.strictEqual(imageAudit.passed, false);
    assert(imageAudit.errors.some((error) => error.includes("禁止圖片證據")));
    assert(imageAudit.errors.some((error) => error.includes("image payload")));
    assert(imageAudit.errors.some((error) => error.includes("screenshots 目錄")));
    assert(imageAudit.errors.some((error) => error.includes("lacks provenance")));

    console.log("ai-boardgame-e2e skill script tests passed");
  } finally {
    const resolved = path.resolve(tempRoot);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("ai-boardgame-e2e-")) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
