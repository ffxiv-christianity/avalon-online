#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { parseArgs, readJson } = require("./core");
const { auditRun } = require("./audit-run");
const { normalizeProductIdentity } = require("./product-identity");

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .flatMap((line) => {
      try { return [JSON.parse(line)]; } catch (_error) { return []; }
    });
}

function valueList(values) {
  return Array.isArray(values) && values.length ? values.join(", ") : "none";
}

function purposeLines(run, timeline) {
  const purpose = run.testPurpose || {};
  if (String(run.schemaVersion) === "1.1") {
    const criteria = timeline.filter((event) => event.type === "criterion_result");
    return [
      `- Selection: \`${purpose.selectionSource || "unknown"}\``,
      `- Objective: ${purpose.objective || "not recorded"}`,
      `- Approach: \`${purpose.approach || "unknown"}\``,
      `- User perspective: \`${purpose.userPerspective || "unknown"}\``,
      `- Focus areas: ${valueList(purpose.focusAreas)}`,
      `- User journeys: ${valueList(purpose.journeyIds)}`,
      `- Targeted scenarios: ${valueList(purpose.scenarioIds)}`,
      `- Completion requirements: ${valueList((purpose.completionRequirements || []).map((item) => `${item.id}:${item.kind}:${item.scope || "per_execution"}`))}`,
      ...(purpose.recommendationRationale ? [`- AI recommendation rationale: ${purpose.recommendationRationale}`] : []),
      "",
      "### Success criteria",
      "",
      ...(purpose.successCriteria || []).map((criterion) => {
        const result = criteria.find((event) => event.criterionId === criterion.id);
        return `- \`${criterion.id}\`: ${result ? (result.passed ? "pass" : "fail") : "not evaluated"} — ${criterion.description}`;
      })
    ];
  }
  const participation = timeline.filter((event) => event.type === "vote_participation");
  return [
    `- Legacy mode: \`${purpose.mode || "legacy"}\``,
    `- Vote participation: \`${purpose.voteParticipation || "legacy"}\``,
    `- Settlement trigger: \`${purpose.settlementTrigger || "legacy"}\``,
    ...participation.map((event) => `- Game ${event.gameIndex}: voters ${valueList(event.actualVoterIds)}; non-voters ${valueList(event.nonVoterIds)}; trigger \`${event.actualSettlementTrigger}\``)
  ];
}

function reportFor(run, audit, timeline = []) {
  const speed = run.speed || {};
  const productBuild = run.productBuild || {};
  let productIdentity = null;
  try { productIdentity = normalizeProductIdentity(productBuild); } catch (_error) { /* reported by audit */ }
  const capability = run.capability || {};
  const games = Array.isArray(run.games) ? run.games : [];
  const behavior = timeline.filter((event) => event.type === "behavior_evaluation");
  const behaviorCounts = behavior.reduce((counts, event) => {
    const key = String(event.observedIntent || "unknown");
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const resultDetails = timeline.filter((event) => ["result_detail", "settlement_detail"].includes(event.type));
  const journeyCompletions = timeline.filter((event) => event.type === "journey_completed");
  const resourceCleanup = timeline.find((event) => event.type === "resource_cleanup");

  const summary = [
    "# AI Boardgame E2E Summary",
    "",
    `- Run: \`${run.runId}\``,
    `- Game: \`${run.game}\``,
    `- Players / executions: ${run.playerCount} / ${run.gamesToPlay ?? games.length ?? 1}`,
    `- Status: \`${run.status}\``,
    `- Product verdict: \`${run.productVerdict || "not_evaluated"}\``,
    `- Information isolation: \`${run.informationIsolationLevel || "behavioral"}\``,
    `- Audit: ${audit.passed ? "pass" : "fail"} (${audit.counts.errors} errors, ${audit.counts.warnings} warnings)`,
    "",
    "## Test purpose and user perspective",
    "",
    ...purposeLines(run, timeline),
    "",
    "## User-visible results",
    "",
    ...journeyCompletions.map((event) => `- Execution ${event.gameIndex}: journey \`${event.journeyId}\` completed (${valueList(event.requirementIds)})`),
    ...resultDetails.map((result) => `- Execution ${result.gameIndex}: ${result.summary || result.headline || result.outcomeId || "result recorded"}`),
    ...(!journeyCompletions.length && !resultDetails.length && games.length
      ? games.map((game) => `- Execution ${game.gameIndex}: \`${game.status}\``)
      : []),
    ...(!journeyCompletions.length && !resultDetails.length && !games.length
      ? ["- No completed journey result was recorded."]
      : []),
    "",
    "Gameplay wins, losses, incorrect deductions, silence, and inaction are outcomes, not automatic E2E failures.",
    "",
    "## Observed communication behavior",
    "",
    ...(behavior.length
      ? Object.entries(behaviorCounts).sort().map(([key, count]) => `- \`${key}\`: ${count}`)
      : ["- No forced communication coverage was requested."]),
    "",
    "## Speed and timing fidelity",
    "",
    `- Profile: \`${speed.requestedProfile || "legacy"}\``,
    `- Operation / DOM poll: ${speed.operationDelayMs ?? "n/a"} ms / ${speed.pollIntervalMs ?? "n/a"} ms`,
    `- Server time scale: ${speed.serverTimeScale ?? 1}`,
    `- Timing fidelity: \`${speed.timingFidelity || audit.timingFidelity}\``,
    `- Server management: \`${run.serverManagedBySkill || speed.serverManagedBySkill || "unknown"}\``,
    `- Capability: status=${capability.status ?? (capability.enabled ? 200 : "n/a")}; enabled=${capability.enabled ?? "n/a"}`,
    "",
    "## Resource cleanup",
    "",
    `- Policy: \`${run.resourceLifecycle?.policyVersion || "legacy_not_recorded"}\``,
    `- Status: \`${resourceCleanup?.status || "not_recorded"}\``,
    `- Run-owned tabs / contexts closed: ${resourceCleanup?.ownedTabsClosed ?? "n/a"} / ${resourceCleanup?.ownedContextsClosed ?? "n/a"}`,
    `- Run-owned processes / servers stopped: ${resourceCleanup?.ownedProcessesStopped ?? "n/a"} / ${resourceCleanup?.ownedServersStopped ?? "n/a"}`,
    `- Isolated players released: ${resourceCleanup?.isolatedPlayersReleased ?? "n/a"}`,
    `- Reused resources preserved: ${resourceCleanup?.reusedResourcesPreserved ?? "n/a"}`,
    `- Unresolved resources: ${valueList(resourceCleanup?.unresolvedResources)}`,
    "",
    "## Product and agent provenance",
    "",
    `- Product test: \`${productBuild.command || "n/a"}\``,
    `- Product test scope: \`${productBuild.testScope || (productIdentity?.kind === "local_source" ? "local_product_tests" : "n/a")}\``,
    `- Product identity: \`${productIdentity?.kind || "invalid_or_missing"}\``,
    ...(productIdentity?.kind === "deployed_web_assets" ? [
      `- Deployed entry URL: ${productIdentity.entryUrl}`,
      `- Deployed HTML/JS/CSS fingerprint SHA-256: \`${productIdentity.fingerprintSha256}\` (${productIdentity.assets.length} assets)`,
      "- Local Git commit/source-tree identity: not claimed by this deployed Run."
    ] : [
      `- Git: \`${productIdentity?.gitHead || productBuild.gitHead || "n/a"}\`; dirty=${productIdentity?.sourceTreeDirty ?? productBuild.sourceTreeDirty ?? "n/a"}`,
      `- Product source SHA-256: \`${productIdentity?.productSourceSha256 || productBuild.productSourceSha256 || "n/a"}\``
    ]),
    `- Player agents: \`${run.agentProvenance?.mode || "n/a"}\`; ${run.agentProvenance?.players?.length ?? 0} players`,
    `- Auditor SHA-256: \`${audit.auditorSha256}\``,
    "",
    "## Evidence counts",
    "",
    `- Observations: ${audit.counts.observations}`,
    `- Decisions: ${audit.counts.decisions}`,
    `- Public timeline events: ${audit.counts.publicTimelineEvents}`,
    `- Final states: ${audit.counts.finalStates}`
  ].join("\n");

  const findings = run.findings || {};
  const findingsText = [
    "# Findings",
    "",
    "| Severity | Count |",
    "|---|---:|",
    `| P0 | ${Number(findings.P0 || 0)} |`,
    `| P1 | ${Number(findings.P1 || 0)} |`,
    `| P2 | ${Number(findings.P2 || 0)} |`,
    `| Decision-isolation failures | ${Number(findings.decisionIsolationFailures || 0)} |`,
    "",
    ...(audit.errors.length ? ["## Audit errors", "", ...audit.errors.map((value) => `- ${value}`), ""] : []),
    ...(audit.warnings.length ? ["## Audit warnings", "", ...audit.warnings.map((value) => `- ${value}`)] : [])
  ].join("\n");
  return { summary: `${summary}\n`, findings: `${findingsText}\n` };
}

function buildReport(runDir) {
  const resolvedRun = path.resolve(runDir);
  const run = readJson(path.join(resolvedRun, "run.json"));
  const audit = auditRun(resolvedRun);
  const timeline = readJsonLines(path.join(resolvedRun, "public", "timeline.jsonl"));
  const report = reportFor(run, audit, timeline);
  fs.writeFileSync(path.join(resolvedRun, "summary.md"), report.summary, "utf8");
  fs.writeFileSync(path.join(resolvedRun, "findings.md"), report.findings, "utf8");
  return { audit, ...report };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const runDir = args.run || args.positional[0];
  if (!runDir) throw new Error("Usage: node build-report.js --run <run-dir>");
  const result = buildReport(runDir);
  process.stdout.write(`${JSON.stringify({ built: true, auditPassed: result.audit.passed })}\n`);
  if (!result.audit.passed) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { reportFor, buildReport, main };
