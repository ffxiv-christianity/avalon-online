#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const path = require("path");
const {
  parseArgs,
  readJson,
  resolveConfig,
  catalog,
  stableStringify,
  writeJson
} = require("./core");
const { loadAdapter } = require("./adapters");
const { computePlanHash, deriveCoverageModel, validateCoverageModel } = require("./coverage-planner");

const TEST_TYPES = new Set([
  "natural_user",
  "feature_cp",
  "bug_reproduction",
  "exploratory",
  "certification"
]);
const USER_PERSPECTIVES = new Set([
  "first_time_player",
  "regular_player",
  "experienced_player",
  "mixed_experience"
]);
const REUSE_POLICIES = new Set(["prefer_reuse", "require_new_run", "ignore_history"]);
const EVIDENCE_DISPOSITIONS = new Set(["exact_reuse", "partial_reuse", "historical_only", "no_evidence"]);
const EXECUTION_DECISIONS = new Set(["reuse_only", "minimal_run", "full_run"]);
const CHECKPOINT_COVERAGE_MODES = new Set(["all_declared", "selected"]);

function sha256Json(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function nonEmptyString(value, label, errors) {
  const text = String(value || "").trim();
  if (!text) errors.push(`${label} is required.`);
  return text;
}

function stringArray(value, label, errors, options = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array.`);
    return [];
  }
  const result = value.map((entry) => String(entry || "").trim()).filter(Boolean);
  if (options.nonEmpty && !result.length) errors.push(`${label} must not be empty.`);
  return [...new Set(result)];
}

function ruleArray(value, label, errors, kind) {
  if (!Array.isArray(value) || !value.length) {
    errors.push(`${label} must contain at least one rule.`);
    return [];
  }
  const ids = new Set();
  return value.map((entry, index) => {
    const prefix = `${label}[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${prefix} must be an object.`);
      return {};
    }
    const id = nonEmptyString(entry.id, `${prefix}.id`, errors);
    const description = nonEmptyString(entry.description, `${prefix}.description`, errors);
    if (id && !/^[a-z][a-z0-9_-]*$/.test(id)) errors.push(`${prefix}.id must be a stable lowercase identifier.`);
    if (id && ids.has(id)) errors.push(`${label} contains duplicate id ${id}.`);
    ids.add(id);
    if (kind === "pass") {
      return { id, description, oracle: nonEmptyString(entry.oracle, `${prefix}.oracle`, errors) };
    }
    const severity = String(entry.severity || "").toUpperCase();
    if (!new Set(["P0", "P1", "P2"]).has(severity)) errors.push(`${prefix}.severity must be P0, P1, or P2.`);
    return { id, description, severity };
  });
}

function isSubset(expected, actual) {
  if (Array.isArray(expected)) return Array.isArray(actual) && stableStringify(expected) === stableStringify(actual);
  if (expected && typeof expected === "object") {
    return actual && typeof actual === "object" && !Array.isArray(actual)
      && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && isSubset(value, actual[key]));
  }
  return stableStringify(expected) === stableStringify(actual);
}

function validateCheckpointCoverage(value, testType, errors) {
  if (value === undefined || value === null) {
    if (testType === "feature_cp") errors.push("answers.checkpointCoverage is required for feature_cp tests.");
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("answers.checkpointCoverage must be an object.");
    return null;
  }
  const mode = String(value.mode || "");
  if (!CHECKPOINT_COVERAGE_MODES.has(mode)) errors.push("answers.checkpointCoverage.mode must be all_declared or selected.");
  const checkpointIds = stringArray(value.checkpointIds, "answers.checkpointCoverage.checkpointIds", errors, {
    nonEmpty: mode === "selected"
  }).sort();
  for (const checkpointId of checkpointIds) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(checkpointId)) {
      errors.push(`answers.checkpointCoverage checkpoint id ${checkpointId} is invalid.`);
    }
  }
  if (mode === "all_declared" && checkpointIds.length) {
    errors.push("answers.checkpointCoverage.checkpointIds must be empty when mode is all_declared; the Adapter is authoritative.");
  }
  return { mode, checkpointIds };
}

function validateCoveragePlan(input, expectedGame) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("CoveragePlan must be an object.");
  if (input.schemaVersion !== "1.0") throw new Error("CoveragePlan schemaVersion must be 1.0.");
  if (input.game !== expectedGame) throw new Error("CoveragePlan game does not match the questionnaire/config game.");
  if (!new Set(["complete", "incomplete"]).has(input.status)) throw new Error("CoveragePlan status is invalid.");
  for (const key of ["targetCheckpointIds", "reusedCheckpointIds", "completedCheckpointIds", "pendingCheckpointIds", "supportCheckpointIds", "uncoveredCheckpointIds", "routes"]) {
    if (!Array.isArray(input[key])) throw new Error(`CoveragePlan ${key} must be an array.`);
  }
  if (!String(input.planSha256 || "").match(/^[a-f0-9]{64}$/) || input.planSha256 !== computePlanHash(input)) {
    throw new Error("CoveragePlan hash mismatch.");
  }
  const idArrays = {};
  for (const key of ["targetCheckpointIds", "reusedCheckpointIds", "completedCheckpointIds", "pendingCheckpointIds", "supportCheckpointIds", "uncoveredCheckpointIds"]) {
    const normalized = [...new Set(input[key].map(String))].sort();
    if (normalized.some((id) => !/^[a-z0-9][a-z0-9._-]*$/.test(id))
      || stableStringify(normalized) !== stableStringify(input[key])) {
      throw new Error(`CoveragePlan ${key} must contain unique sorted stable IDs.`);
    }
    idArrays[key] = normalized;
  }
  const targets = idArrays.targetCheckpointIds;
  if (!targets.length) throw new Error("CoveragePlan targetCheckpointIds must not be empty.");
  if (idArrays.reusedCheckpointIds.some((id) => !targets.includes(id))
    || idArrays.completedCheckpointIds.some((id) => !targets.includes(id))
    || idArrays.completedCheckpointIds.some((id) => idArrays.reusedCheckpointIds.includes(id))
    || idArrays.uncoveredCheckpointIds.some((id) => !idArrays.pendingCheckpointIds.includes(id))
    || idArrays.supportCheckpointIds.some((id) => targets.includes(id))) {
    throw new Error("CoveragePlan checkpoint sets are inconsistent with target/pending/support scope.");
  }
  const expectedPending = targets.filter((id) => !idArrays.reusedCheckpointIds.includes(id) && !idArrays.completedCheckpointIds.includes(id));
  if (stableStringify(expectedPending) !== stableStringify(idArrays.pendingCheckpointIds)) {
    throw new Error("CoveragePlan pendingCheckpointIds do not equal target minus reused/completed checkpoints.");
  }
  if (input.status === "complete" && idArrays.uncoveredCheckpointIds.length) throw new Error("Complete CoveragePlan cannot have uncovered checkpoints.");
  if (!Number.isFinite(input.totalEstimatedSeconds) || input.totalEstimatedSeconds < 0
    || !Number.isInteger(input.resetCount) || input.resetCount < 0
    || !Number.isInteger(input.randomDependencyCount) || input.randomDependencyCount < 0) {
    throw new Error("CoveragePlan aggregate costs are invalid.");
  }
  input.routes.forEach((route, index) => {
    if (!route || typeof route !== "object" || Array.isArray(route)
      || route.sequence !== index + 1
      || !/^[a-z0-9][a-z0-9._-]*$/.test(String(route.routeId || ""))
      || !Array.isArray(route.checkpointIds)
      || !Number.isFinite(route.estimatedSeconds) || route.estimatedSeconds < 0) {
      throw new Error(`CoveragePlan route ${index + 1} is invalid.`);
    }
  });
  return input;
}

function validateQuestionnaire(input) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Questionnaire must be a JSON object.");
  if (String(input.schemaVersion || "") !== "1.0") errors.push("Questionnaire schemaVersion must be 1.0.");
  const source = input.answers;
  if (!source || typeof source !== "object" || Array.isArray(source)) errors.push("Questionnaire answers must be an object.");
  const answers = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const game = nonEmptyString(answers.game, "answers.game", errors).toLowerCase();
  const testType = nonEmptyString(answers.testType, "answers.testType", errors);
  if (testType && !TEST_TYPES.has(testType)) errors.push("answers.testType is invalid.");
  const checkpointCoverage = validateCheckpointCoverage(answers.checkpointCoverage, testType, errors);
  const userPerspective = nonEmptyString(answers.userPerspective, "answers.userPerspective", errors);
  if (userPerspective && !USER_PERSPECTIVES.has(userPerspective)) errors.push("answers.userPerspective is invalid.");
  const playerCount = Number(answers.playerCount);
  if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > 20) errors.push("answers.playerCount must be an integer from 1 to 20.");
  const gamesToPlay = Number(answers.gamesToPlay);
  if (!Number.isInteger(gamesToPlay) || gamesToPlay < 1 || gamesToPlay > 50) errors.push("answers.gamesToPlay must be an integer from 1 to 50.");
  if (!answers.gameSettings || typeof answers.gameSettings !== "object" || Array.isArray(answers.gameSettings)) {
    errors.push("answers.gameSettings must be an object.");
  }
  if (!answers.speedProfile || typeof answers.speedProfile !== "object" || Array.isArray(answers.speedProfile)) {
    errors.push("answers.speedProfile must be an object.");
  }
  const evidenceReuse = answers.evidenceReuse;
  if (!evidenceReuse || typeof evidenceReuse !== "object" || Array.isArray(evidenceReuse)) {
    errors.push("answers.evidenceReuse must be an object.");
  }
  const policy = String(evidenceReuse?.policy || "");
  if (!REUSE_POLICIES.has(policy)) errors.push("answers.evidenceReuse.policy is invalid.");
  if (typeof evidenceReuse?.requireCurrentBuild !== "boolean") errors.push("answers.evidenceReuse.requireCurrentBuild must be boolean.");
  if (typeof evidenceReuse?.requireProductionTiming !== "boolean") errors.push("answers.evidenceReuse.requireProductionTiming must be boolean.");
  const unanswered = stringArray(input.unanswered, "unanswered", errors);
  const conflicts = stringArray(input.conflicts, "conflicts", errors);
  if (unanswered.length) errors.push(`Questionnaire still has unanswered fields: ${unanswered.join(", ")}.`);
  if (conflicts.length) errors.push(`Questionnaire still has conflicts: ${conflicts.join(", ")}.`);

  const normalized = {
    schemaVersion: "1.0",
    answers: {
      game,
      testType,
      objective: nonEmptyString(answers.objective, "answers.objective", errors),
      userPerspective,
      focusAreas: stringArray(answers.focusAreas, "answers.focusAreas", errors, { nonEmpty: true }),
      journeyIntent: nonEmptyString(answers.journeyIntent, "answers.journeyIntent", errors),
      scenarioIntent: nonEmptyString(answers.scenarioIntent, "answers.scenarioIntent", errors),
      playerCount,
      gamesToPlay,
      gameSettings: answers.gameSettings && typeof answers.gameSettings === "object" && !Array.isArray(answers.gameSettings)
        ? answers.gameSettings
        : {},
      speedProfile: answers.speedProfile && typeof answers.speedProfile === "object" && !Array.isArray(answers.speedProfile)
        ? answers.speedProfile
        : {},
      reconnectMode: nonEmptyString(answers.reconnectMode, "answers.reconnectMode", errors),
      playerBehavior: nonEmptyString(answers.playerBehavior, "answers.playerBehavior", errors),
      completionStatement: nonEmptyString(answers.completionStatement, "answers.completionStatement", errors),
      passRules: ruleArray(answers.passRules, "answers.passRules", errors, "pass"),
      failRules: ruleArray(answers.failRules, "answers.failRules", errors, "fail"),
      notEvaluated: stringArray(answers.notEvaluated, "answers.notEvaluated", errors),
      stopConditions: stringArray(answers.stopConditions, "answers.stopConditions", errors, { nonEmpty: true }),
      evidenceReuse: {
        policy,
        requireCurrentBuild: evidenceReuse?.requireCurrentBuild,
        requireProductionTiming: evidenceReuse?.requireProductionTiming
      }
    },
    delegatedFields: stringArray(input.delegatedFields, "delegatedFields", errors),
    unanswered: [],
    conflicts: []
  };
  if (checkpointCoverage || Object.hasOwn(answers, "checkpointCoverage")) {
    normalized.answers.checkpointCoverage = checkpointCoverage;
  }
  if (errors.length) throw new Error(`Questionnaire validation failed:\n- ${errors.join("\n- ")}`);
  return normalized;
}

function validateEvidenceAssessment(input) {
  const assessment = input || { schemaVersion: "1.0", disposition: "no_evidence", candidates: [] };
  if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)) throw new Error("Evidence assessment must be an object.");
  if (!EVIDENCE_DISPOSITIONS.has(assessment.disposition)) throw new Error("Evidence assessment disposition is invalid.");
  if (!Array.isArray(assessment.candidates)) throw new Error("Evidence assessment candidates must be an array.");
  if (assessment.query) {
    if (!assessment.querySha256 || assessment.querySha256 !== sha256Json(assessment.query)) {
      throw new Error("Evidence assessment query hash mismatch.");
    }
    if (!String(assessment.indexSha256 || "").trim()) throw new Error("Evidence assessment indexSha256 is required.");
    const body = { ...assessment };
    delete body.assessmentSha256;
    if (!assessment.assessmentSha256 || assessment.assessmentSha256 !== sha256Json(body)) {
      throw new Error("Evidence assessment hash mismatch.");
    }
  }
  if (assessment.disposition === "exact_reuse"
    && !assessment.candidates.some((entry) => entry?.classification === "exact_reuse")) {
    throw new Error("exact_reuse assessment requires an exact_reuse candidate.");
  }
  return assessment;
}

function defaultExecutionDecision(questionnaire, assessment) {
  const policy = questionnaire.answers.evidenceReuse.policy;
  if (policy === "require_new_run" || policy === "ignore_history") return "full_run";
  if (assessment.disposition === "exact_reuse") return "reuse_only";
  if (assessment.disposition === "partial_reuse") return "minimal_run";
  return "full_run";
}

function createDraftPlan({ questionnaire, config, evidenceAssessment, coveragePlan, executionDecision, rationale, now = new Date() }) {
  const normalizedQuestionnaire = validateQuestionnaire(questionnaire);
  const resolvedConfig = resolveConfig(config);
  const assessment = validateEvidenceAssessment(evidenceAssessment);
  const coverage = normalizedQuestionnaire.answers.testType === "feature_cp"
    ? validateCoveragePlan(coveragePlan, resolvedConfig.game)
    : (coveragePlan ? validateCoveragePlan(coveragePlan, resolvedConfig.game) : null);
  if (normalizedQuestionnaire.answers.game !== resolvedConfig.game) throw new Error("Questionnaire game does not match resolved config game.");
  if (normalizedQuestionnaire.answers.objective !== resolvedConfig.testPurpose.objective) {
    throw new Error("Questionnaire objective does not match resolved config testPurpose.objective.");
  }
  if (normalizedQuestionnaire.answers.playerCount !== resolvedConfig.playerCount) throw new Error("Questionnaire playerCount does not match resolved config.");
  if (normalizedQuestionnaire.answers.gamesToPlay !== resolvedConfig.gamesToPlay) throw new Error("Questionnaire gamesToPlay does not match resolved config.");
  if (normalizedQuestionnaire.answers.userPerspective !== resolvedConfig.testPurpose.userPerspective) {
    throw new Error("Questionnaire userPerspective does not match resolved config.");
  }
  if (!isSubset(normalizedQuestionnaire.answers.gameSettings, resolvedConfig.gameSettings)) {
    throw new Error("Questionnaire gameSettings do not match resolved config.");
  }
  if (!isSubset(normalizedQuestionnaire.answers.speedProfile, resolvedConfig.speed)) {
    throw new Error("Questionnaire speedProfile does not match resolved config.");
  }
  if (normalizedQuestionnaire.answers.reconnectMode !== resolvedConfig.reconnect.mode) {
    throw new Error("Questionnaire reconnectMode does not match resolved config.");
  }
  const configFocusAreas = new Set(resolvedConfig.testPurpose.focusAreas || []);
  if (normalizedQuestionnaire.answers.focusAreas.some((entry) => !configFocusAreas.has(entry))) {
    throw new Error("Questionnaire focusAreas do not match resolved config.");
  }
  const criterionIds = new Set((resolvedConfig.testPurpose.successCriteria || []).map((entry) => entry.id));
  if (normalizedQuestionnaire.answers.passRules.some((entry) => !criterionIds.has(entry.id))) {
    throw new Error("Every questionnaire pass rule must map to a resolved success criterion ID.");
  }
  const approach = resolvedConfig.testPurpose.approach;
  const type = normalizedQuestionnaire.answers.testType;
  const compatibleType = (type === "natural_user" && approach === "natural_user")
    || (["feature_cp", "bug_reproduction"].includes(type) && ["targeted_scenario", "mixed"].includes(approach))
    || (type === "exploratory" && approach === "exploratory")
    || (type === "certification" && resolvedConfig.certificationCandidate === true);
  if (!compatibleType) throw new Error("Questionnaire testType does not match resolved config approach/certification scope.");
  if (coverage) {
    const catalogEntry = (catalog().games || {})[resolvedConfig.game];
    const adapter = catalogEntry ? loadAdapter(catalogEntry) : null;
    const coverageModel = deriveCoverageModel(adapter, catalogEntry, resolvedConfig.game);
    if (!coverageModel) throw new Error(`Adapter ${resolvedConfig.game} must declare CoverageModel checkpoints for feature_cp coverage planning.`);
    const declaredCheckpointIds = validateCoverageModel(coverageModel).checkpoints.map((entry) => entry.id).sort();
    const requiredCheckpointIds = [...new Set((resolvedConfig.testPurpose.completionRequirements || [])
      .filter((entry) => entry.kind === "checkpoint")
      .map((entry) => entry.checkpointId || entry.id))].sort();
    if (stableStringify(requiredCheckpointIds) !== stableStringify(coverage.targetCheckpointIds)) {
      throw new Error("CoveragePlan targets must exactly match the resolved config checkpoint completion requirements.");
    }
    const questionnaireCoverage = normalizedQuestionnaire.answers.checkpointCoverage;
    if (questionnaireCoverage?.mode === "all_declared"
      && stableStringify(declaredCheckpointIds) !== stableStringify(coverage.targetCheckpointIds)) {
      throw new Error("CoveragePlan all_declared targets must contain every checkpoint declared by the Adapter.");
    }
    if (questionnaireCoverage?.mode === "selected"
      && stableStringify(questionnaireCoverage.checkpointIds) !== stableStringify(coverage.targetCheckpointIds)) {
      throw new Error("CoveragePlan targets do not match the questionnaire selected checkpoints.");
    }
    if (coverage.targetCheckpointIds.some((checkpointId) => !declaredCheckpointIds.includes(checkpointId))) {
      throw new Error("CoveragePlan references checkpoints not declared by the Adapter.");
    }
    if (coverage.completedCheckpointIds.length) {
      throw new Error("Initial approved CoveragePlan cannot claim runtime-completed checkpoints.");
    }
    const reusableFromAssessment = [...new Set(assessment.candidates.flatMap((candidate) => {
      if (Array.isArray(candidate.reusableCheckpointIds)) return candidate.reusableCheckpointIds;
      return candidate.classification === "exact_reuse" ? (candidate.matched?.checkpointIds || []) : [];
    }))].filter((checkpointId) => coverage.targetCheckpointIds.includes(checkpointId)).sort();
    const expectedReused = normalizedQuestionnaire.answers.evidenceReuse.policy === "prefer_reuse"
      ? reusableFromAssessment
      : [];
    if (stableStringify(expectedReused) !== stableStringify(coverage.reusedCheckpointIds)) {
      throw new Error("CoveragePlan reused checkpoints do not match the approved historical-evidence policy and assessment.");
    }
  }
  const reusePolicy = normalizedQuestionnaire.answers.evidenceReuse.policy;
  if (reusePolicy !== "ignore_history" && !assessment.query) {
    throw new Error("Historical evidence policy requires a generated evidence assessment with query and index hashes.");
  }
  if (assessment.query) {
    if (assessment.query.game !== resolvedConfig.game) throw new Error("Evidence assessment game does not match resolved config.");
    if (normalizedQuestionnaire.answers.evidenceReuse.requireCurrentBuild !== assessment.query.requireCurrentBuild) {
      throw new Error("Evidence assessment current-build policy does not match questionnaire.");
    }
    if (normalizedQuestionnaire.answers.evidenceReuse.requireProductionTiming !== assessment.query.requireProductionTiming) {
      throw new Error("Evidence assessment timing policy does not match questionnaire.");
    }
  }
  const decision = executionDecision || defaultExecutionDecision(normalizedQuestionnaire, assessment);
  if (!EXECUTION_DECISIONS.has(decision)) throw new Error("Execution decision is invalid.");
  if (decision === "reuse_only" && assessment.disposition !== "exact_reuse") {
    throw new Error("reuse_only requires an exact_reuse evidence assessment.");
  }
  return {
    schemaVersion: "1.0",
    kind: "ai-boardgame-e2e-plan",
    status: "draft",
    createdAt: now.toISOString(),
    questionnaire: normalizedQuestionnaire,
    questionnaireSha256: sha256Json(normalizedQuestionnaire),
    resolvedConfigSha256: sha256Json(resolvedConfig),
    evidenceAssessment: assessment,
    evidenceAssessmentSha256: sha256Json(assessment),
    coveragePlan: coverage,
    coveragePlanSha256: coverage ? sha256Json(coverage) : null,
    executionDecision: decision,
    decisionRationale: nonEmptyString(rationale || `Derived from evidence disposition ${assessment.disposition}.`, "decisionRationale", []),
    approval: null
  };
}

function approvePlan(plan, { approvedBy, confirmation, now = new Date() }) {
  if (!plan || plan.kind !== "ai-boardgame-e2e-plan" || plan.status !== "draft") throw new Error("Only a draft E2E plan can be approved.");
  if (confirmation !== "APPROVE") throw new Error("Approval requires the exact confirmation token APPROVE after explicit user consent.");
  const actor = String(approvedBy || "").trim();
  if (!actor) throw new Error("approvedBy is required.");
  const approvedContract = {
    questionnaireSha256: plan.questionnaireSha256,
    resolvedConfigSha256: plan.resolvedConfigSha256,
    evidenceAssessmentSha256: plan.evidenceAssessmentSha256,
    executionDecision: plan.executionDecision,
    decisionRationale: plan.decisionRationale
  };
  if (Object.hasOwn(plan, "coveragePlanSha256")) approvedContract.coveragePlanSha256 = plan.coveragePlanSha256 || null;
  return {
    ...plan,
    status: "approved",
    approval: {
      approvedBy: actor,
      approvedAt: now.toISOString(),
      confirmation: "APPROVE",
      approvedContractSha256: sha256Json(approvedContract)
    }
  };
}

function verifyApprovedPlan(plan, resolvedConfig, options = {}) {
  if (!plan || plan.kind !== "ai-boardgame-e2e-plan" || plan.status !== "approved") throw new Error("An approved E2E plan is required.");
  const questionnaire = validateQuestionnaire(plan.questionnaire);
  const assessment = validateEvidenceAssessment(plan.evidenceAssessment);
  if (plan.questionnaireSha256 !== sha256Json(questionnaire)) throw new Error("Approved plan questionnaire hash mismatch.");
  if (plan.evidenceAssessmentSha256 !== sha256Json(assessment)) throw new Error("Approved plan evidence assessment hash mismatch.");
  const coverage = plan.coveragePlan ? validateCoveragePlan(plan.coveragePlan, resolvedConfig.game) : null;
  if ((plan.coveragePlanSha256 || null) !== (coverage ? sha256Json(coverage) : null)) throw new Error("Approved plan CoveragePlan hash mismatch.");
  if (plan.resolvedConfigSha256 !== sha256Json(resolvedConfig)) throw new Error("Approved plan config hash mismatch; regenerate and re-approve the plan.");
  const approvalContract = {
    questionnaireSha256: plan.questionnaireSha256,
    resolvedConfigSha256: plan.resolvedConfigSha256,
    evidenceAssessmentSha256: plan.evidenceAssessmentSha256,
    executionDecision: plan.executionDecision,
    decisionRationale: plan.decisionRationale
  };
  if (Object.hasOwn(plan, "coveragePlanSha256")) approvalContract.coveragePlanSha256 = plan.coveragePlanSha256 || null;
  const expectedApprovalHash = sha256Json(approvalContract);
  if (plan.approval?.confirmation !== "APPROVE" || plan.approval?.approvedContractSha256 !== expectedApprovalHash) {
    throw new Error("Approved plan approval hash mismatch.");
  }
  if (options.forExecution && plan.executionDecision === "reuse_only") {
    throw new Error("Approved plan selected reuse_only; do not initialize a new Run.");
  }
  if (options.forExecution && questionnaire.answers.testType === "feature_cp" && coverage?.status !== "complete") {
    throw new Error("Approved feature_cp plan has incomplete checkpoint coverage and cannot initialize a Run.");
  }
  return {
    planSha256: sha256Json(plan),
    executionDecision: plan.executionDecision,
    approvedBy: plan.approval.approvedBy,
    approvedAt: plan.approval.approvedAt,
    evidenceDisposition: assessment.disposition,
    coveragePlanSha256: coverage?.planSha256 || null
  };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args.positional[0];
  if (command === "draft") {
    if (!args.questionnaire || !args.config || !args.output) {
      throw new Error("Usage: node plan-contract.js draft --questionnaire <answers.json> --config <config.json> [--evidence <assessment.json>] [--coverage <coverage-plan.json>] [--decision <value>] [--rationale <text>] --output <draft.json>");
    }
    const draft = createDraftPlan({
      questionnaire: readJson(path.resolve(args.questionnaire)),
      config: readJson(path.resolve(args.config)),
      evidenceAssessment: args.evidence ? readJson(path.resolve(args.evidence)) : undefined,
      coveragePlan: args.coverage ? readJson(path.resolve(args.coverage)) : undefined,
      executionDecision: args.decision,
      rationale: args.rationale
    });
    writeJson(path.resolve(args.output), draft);
    process.stdout.write(`${JSON.stringify({ valid: true, status: draft.status, executionDecision: draft.executionDecision }, null, 2)}\n`);
    return draft;
  }
  if (command === "approve") {
    if (!args.plan || !args.output) throw new Error("Usage: node plan-contract.js approve --plan <draft.json> --approved-by <name> --confirmation APPROVE --output <approved.json>");
    const approved = approvePlan(readJson(path.resolve(args.plan)), {
      approvedBy: args["approved-by"],
      confirmation: args.confirmation
    });
    writeJson(path.resolve(args.output), approved);
    process.stdout.write(`${JSON.stringify({ valid: true, status: approved.status, executionDecision: approved.executionDecision }, null, 2)}\n`);
    return approved;
  }
  if (command === "verify") {
    if (!args.plan || !args.config) throw new Error("Usage: node plan-contract.js verify --plan <approved.json> --config <config.json> [--for-execution]");
    const resolved = resolveConfig(readJson(path.resolve(args.config)));
    const verified = verifyApprovedPlan(readJson(path.resolve(args.plan)), resolved, { forExecution: Boolean(args["for-execution"]) });
    process.stdout.write(`${JSON.stringify({ valid: true, ...verified }, null, 2)}\n`);
    return verified;
  }
  throw new Error("Usage: node plan-contract.js <draft|approve|verify> ...");
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
  TEST_TYPES,
  EVIDENCE_DISPOSITIONS,
  EXECUTION_DECISIONS,
  CHECKPOINT_COVERAGE_MODES,
  sha256Json,
  validateQuestionnaire,
  validateCoveragePlan,
  createDraftPlan,
  approvePlan,
  verifyApprovedPlan,
  main
};
