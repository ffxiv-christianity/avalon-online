"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { auditRun } = require("./audit-run");
const { readJson, stableStringify } = require("./core");

function sha256Json(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function sanitizedResultEvents(timeline, config) {
  const criteriaById = new Map((config.testPurpose?.successCriteria || []).map((entry) => [entry.id, entry]));
  const criteria = timeline.filter((event) => event.type === "criterion_result" && event.criterionId).map((event) => ({
    id: String(event.criterionId),
    description: String(criteriaById.get(event.criterionId)?.description || ""),
    passed: event.passed === true,
    evidenceRefs: uniqueStrings(Array.isArray(event.evidenceRefs) ? event.evidenceRefs : [])
  }));
  const checkpoints = timeline.filter((event) => event.type === "checkpoint_result" && (event.checkpointId || event.requirementId)).map((event) => ({
    id: String(event.checkpointId || event.requirementId),
    passed: event.passed === true,
    evidenceRefs: uniqueStrings(Array.isArray(event.evidenceRefs) ? event.evidenceRefs : [])
  }));
  const journeys = timeline.filter((event) => event.type === "journey_completed" && event.journeyId).map((event) => ({
    id: String(event.journeyId),
    requirementIds: uniqueStrings(Array.isArray(event.requirementIds) ? event.requirementIds : []),
    evidenceRefs: uniqueStrings(Array.isArray(event.evidenceRefs) ? event.evidenceRefs : [])
  }));
  return { criteria, checkpoints, journeys };
}

function indexRun(runDir) {
  const runPath = path.join(runDir, "run.json");
  const configPath = path.join(runDir, "config.resolved.json");
  if (!fs.existsSync(runPath) || !fs.existsSync(configPath)) return null;
  const run = readJson(runPath);
  const config = readJson(configPath);
  const timeline = readJsonLines(path.join(runDir, "public", "timeline.jsonl"));
  let audit;
  try {
    const checked = auditRun(runDir, { write: false });
    audit = { passed: checked.passed === true, errorCount: checked.errors.length, warningCount: checked.warnings.length };
  } catch (_error) {
    audit = { passed: false, errorCount: 1, warningCount: 0 };
  }
  const results = sanitizedResultEvents(timeline, config);
  const buildEvent = [...timeline].reverse().find((event) => event.type === "product_build_verified") || {};
  const productBuild = run.productBuild || {};
  return {
    runId: String(run.runId || path.basename(runDir)),
    runDir: path.resolve(runDir),
    schemaVersion: String(run.schemaVersion || config.schemaVersion || ""),
    game: String(run.game || config.game || ""),
    status: String(run.status || ""),
    productVerdict: String(run.productVerdict || "not_evaluated"),
    playerCount: Number(run.playerCount || config.playerCount || 0),
    gamesToPlay: Number(run.gamesToPlay || config.gamesToPlay || 0),
    gameSettings: config.gameSettings || {},
    gameSettingsSha256: sha256Json(config.gameSettings || {}),
    journeyIds: uniqueStrings(config.testPurpose?.journeyIds || []),
    scenarioIds: uniqueStrings(config.testPurpose?.scenarioIds || []),
    objective: String(config.testPurpose?.objective || run.testPurpose?.objective || ""),
    timingFidelity: String(run.speed?.timingFidelity || run.capability?.timingFidelity || "unknown"),
    findings: {
      P0: Number(run.findings?.P0 || 0),
      P1: Number(run.findings?.P1 || 0),
      decisionIsolationFailures: Number(run.findings?.decisionIsolationFailures || 0)
    },
    isolation: {
      playerTabs: String(run.isolation?.playerTabs || "unknown"),
      privateUi: String(run.isolation?.privateUi || "unknown"),
      agentDecisionContext: String(run.isolation?.agentDecisionContext || "unknown"),
      evidenceRefs: String(run.isolation?.evidenceRefs || "unknown")
    },
    audit,
    productIdentity: {
      gitHead: String(productBuild.gitHead || buildEvent.gitHead || ""),
      productSourceSha256: String(productBuild.productSourceSha256 || buildEvent.productSourceSha256 || ""),
      sourceTreeDirty: productBuild.sourceTreeDirty === true
    },
    criteria: results.criteria,
    checkpoints: results.checkpoints,
    journeys: results.journeys
  };
}

function indexRuns(runsRoot) {
  const root = path.resolve(runsRoot);
  const runs = fs.existsSync(root)
    ? fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => indexRun(path.join(root, entry.name)))
      .filter(Boolean)
      .sort((left, right) => left.runId.localeCompare(right.runId, "en"))
    : [];
  const index = { schemaVersion: "1.0", runsRoot: root, runs };
  return { ...index, indexSha256: sha256Json(index) };
}

function isSubset(expected, actual) {
  if (Array.isArray(expected)) return Array.isArray(actual) && stableStringify(expected) === stableStringify(actual);
  if (expected && typeof expected === "object") {
    return actual && typeof actual === "object" && !Array.isArray(actual)
      && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && isSubset(value, actual[key]));
  }
  return stableStringify(expected) === stableStringify(actual);
}

function termsFor(run) {
  return [
    run.objective,
    ...run.journeyIds,
    ...run.scenarioIds,
    ...run.criteria.flatMap((entry) => [entry.id, entry.description]),
    ...run.checkpoints.map((entry) => entry.id),
    ...run.journeys.map((entry) => entry.id)
  ].join(" ").toLowerCase();
}

function validateQuery(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Evidence query must be an object.");
  if (String(input.schemaVersion || "") !== "1.0") throw new Error("Evidence query schemaVersion must be 1.0.");
  const query = {
    schemaVersion: "1.0",
    game: String(input.game || "").trim().toLowerCase(),
    expectedResult: String(input.expectedResult || "pass"),
    requiredCriterionIds: uniqueStrings(input.requiredCriterionIds || []),
    requiredCheckpointIds: uniqueStrings(input.requiredCheckpointIds || []),
    requiredJourneyIds: uniqueStrings(input.requiredJourneyIds || []),
    searchTerms: uniqueStrings(input.searchTerms || []).map((entry) => entry.toLowerCase()),
    playerCount: input.playerCount === undefined ? null : Number(input.playerCount),
    gameSettings: input.gameSettings || {},
    requireCurrentBuild: input.requireCurrentBuild !== false,
    currentProductSourceSha256: String(input.currentProductSourceSha256 || ""),
    requireProductionTiming: input.requireProductionTiming === true,
    requireIsolation: input.requireIsolation !== false
  };
  if (!query.game) throw new Error("Evidence query game is required.");
  if (!new Set(["pass", "fail", "any"]).has(query.expectedResult)) throw new Error("Evidence query expectedResult must be pass, fail, or any.");
  if (!query.requiredCriterionIds.length && !query.requiredCheckpointIds.length && !query.requiredJourneyIds.length && !query.searchTerms.length) {
    throw new Error("Evidence query requires at least one direct ID or search term.");
  }
  if (query.playerCount !== null && (!Number.isInteger(query.playerCount) || query.playerCount < 1)) throw new Error("Evidence query playerCount is invalid.");
  if (!query.gameSettings || typeof query.gameSettings !== "object" || Array.isArray(query.gameSettings)) throw new Error("Evidence query gameSettings must be an object.");
  if (query.requireCurrentBuild && !/^[a-f0-9]{64}$/i.test(query.currentProductSourceSha256)) {
    throw new Error("A current product source SHA-256 is required for current-build reuse.");
  }
  return query;
}

function resultCompatible(entries, requiredIds, expectedResult) {
  if (!requiredIds.length) return { covered: true, matchedIds: [], missingIds: [] };
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const matchedIds = [];
  const missingIds = [];
  for (const id of requiredIds) {
    const entry = byId.get(id);
    const compatible = entry && (
      expectedResult === "any"
      || (expectedResult === "pass" && entry.passed === true)
      || (expectedResult === "fail" && entry.passed === false)
    );
    if (compatible) matchedIds.push(id);
    else missingIds.push(id);
  }
  return { covered: missingIds.length === 0, matchedIds, missingIds };
}

function evaluateCandidate(run, query) {
  if (run.game !== query.game) return null;
  const criterionCoverage = resultCompatible(run.criteria, query.requiredCriterionIds, query.expectedResult);
  const checkpointCoverage = resultCompatible(run.checkpoints, query.requiredCheckpointIds, query.expectedResult);
  const journeyIds = new Set(run.journeys.map((entry) => entry.id));
  const journeyMatched = query.requiredJourneyIds.filter((id) => journeyIds.has(id));
  const journeyMissing = query.requiredJourneyIds.filter((id) => !journeyIds.has(id));
  const haystack = termsFor(run);
  const matchedTerms = query.searchTerms.filter((term) => haystack.includes(term));
  const directMatched = criterionCoverage.matchedIds.length + checkpointCoverage.matchedIds.length + journeyMatched.length;
  if (!directMatched && !matchedTerms.length) return null;

  const blockers = [];
  if (!run.audit.passed) blockers.push("current_audit_failed");
  if (run.status !== "complete") blockers.push("run_not_complete");
  if (run.findings.P0 > 0 || run.findings.P1 > 0 || run.findings.decisionIsolationFailures > 0) blockers.push("blocking_findings");
  if (query.playerCount !== null && run.playerCount !== query.playerCount) blockers.push("player_count_mismatch");
  if (!isSubset(query.gameSettings, run.gameSettings)) blockers.push("game_settings_mismatch");
  if (query.requireProductionTiming && run.timingFidelity !== "production") blockers.push("timing_fidelity_mismatch");
  if (query.requireCurrentBuild && run.productIdentity.productSourceSha256 !== query.currentProductSourceSha256) blockers.push("product_source_mismatch");
  if (query.requireIsolation && !Object.values(run.isolation).every((value) => value === "pass")) blockers.push("isolation_not_proven");
  if (query.expectedResult === "pass" && run.productVerdict !== "pass") blockers.push("product_verdict_not_pass");
  if (query.expectedResult === "fail" && run.productVerdict !== "fail") blockers.push("product_verdict_not_fail");
  const directRequested = query.requiredCriterionIds.length + query.requiredCheckpointIds.length + query.requiredJourneyIds.length;
  const directCovered = directRequested > 0
    && criterionCoverage.covered
    && checkpointCoverage.covered
    && journeyMissing.length === 0;
  const citedEntries = [
    ...run.criteria.filter((entry) => criterionCoverage.matchedIds.includes(entry.id)),
    ...run.checkpoints.filter((entry) => checkpointCoverage.matchedIds.includes(entry.id)),
    ...run.journeys.filter((entry) => journeyMatched.includes(entry.id))
  ];
  if (directCovered && citedEntries.some((entry) => Array.isArray(entry.evidenceRefs) && entry.evidenceRefs.length === 0)) {
    blockers.push("direct_result_missing_evidence_refs");
  }
  let classification;
  if (!blockers.length && directCovered) classification = "exact_reuse";
  else if (blockers.length) classification = "historical_only";
  else classification = "partial_reuse";
  return {
    runId: run.runId,
    runDir: run.runDir,
    classification,
    productVerdict: run.productVerdict,
    productSourceSha256: run.productIdentity.productSourceSha256,
    timingFidelity: run.timingFidelity,
    matched: {
      criterionIds: criterionCoverage.matchedIds,
      checkpointIds: checkpointCoverage.matchedIds,
      journeyIds: journeyMatched,
      searchTerms: matchedTerms
    },
    missing: {
      criterionIds: criterionCoverage.missingIds,
      checkpointIds: checkpointCoverage.missingIds,
      journeyIds: journeyMissing
    },
    evidenceRefs: uniqueStrings(citedEntries.flatMap((entry) => entry.evidenceRefs || [])),
    blockers: uniqueStrings(blockers)
  };
}

function queryEvidence(index, input) {
  const query = validateQuery(input);
  const candidates = index.runs.map((run) => evaluateCandidate(run, query)).filter(Boolean).sort((left, right) => {
    const rank = { exact_reuse: 0, partial_reuse: 1, historical_only: 2 };
    return rank[left.classification] - rank[right.classification] || left.runId.localeCompare(right.runId, "en");
  });
  const disposition = candidates.some((entry) => entry.classification === "exact_reuse")
    ? "exact_reuse"
    : candidates.some((entry) => entry.classification === "partial_reuse")
      ? "partial_reuse"
      : candidates.length
        ? "historical_only"
        : "no_evidence";
  const body = {
    schemaVersion: "1.0",
    disposition,
    query,
    querySha256: sha256Json(query),
    indexSha256: index.indexSha256 || sha256Json({ schemaVersion: index.schemaVersion, runsRoot: index.runsRoot, runs: index.runs }),
    candidates
  };
  return { ...body, assessmentSha256: sha256Json(body) };
}

module.exports = {
  sha256Json,
  readJsonLines,
  sanitizedResultEvents,
  indexRun,
  indexRuns,
  validateQuery,
  queryEvidence
};
