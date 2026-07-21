#!/usr/bin/env node
"use strict";

const path = require("path");
const { catalog, parseArgs, readJson, writeJson } = require("./core");
const { loadAdapter } = require("./adapters");
const { deriveCoverageModel, planCoverage } = require("./coverage-planner");

function reusedCheckpointIds(assessment) {
  if (!assessment || !Array.isArray(assessment.candidates)) return [];
  return [...new Set(assessment.candidates.flatMap((candidate) => {
    if (Array.isArray(candidate.reusableCheckpointIds)) return candidate.reusableCheckpointIds;
    return candidate.classification === "exact_reuse" ? (candidate.matched?.checkpointIds || []) : [];
  }))].sort();
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.request) {
    throw new Error("Usage: node plan-coverage.js --request <coverage-request.json> [--index <evidence-index.json>] [--evidence <assessment.json>] [--output <coverage-plan.json>]");
  }
  const request = readJson(path.resolve(args.request));
  const registry = catalog().games || {};
  const entry = registry[request.game];
  if (!entry) throw new Error(`Unknown game: ${request.game}.`);
  const adapter = loadAdapter(entry);
  const coverageModel = deriveCoverageModel(adapter, entry, request.game);
  if (!coverageModel) {
    throw new Error(`Adapter ${request.game} does not declare CoverageModel checkpoints; all-checkpoint planning is unavailable until the Adapter adds them.`);
  }
  if (args.evidence) {
    const assessment = readJson(path.resolve(args.evidence));
    request.reusedCheckpointIds = [...new Set([
      ...(request.reusedCheckpointIds || []),
      ...reusedCheckpointIds(assessment)
    ])].sort();
  }
  const evidenceIndex = args.index ? readJson(path.resolve(args.index)) : null;
  const plan = planCoverage(coverageModel, request, { evidenceIndex });
  if (args.output) writeJson(path.resolve(args.output), plan);
  process.stdout.write(`${JSON.stringify({
    status: plan.status,
    planSha256: plan.planSha256,
    targetCheckpoints: plan.targetCheckpointIds.length,
    reusedCheckpoints: plan.reusedCheckpointIds.length,
    routes: plan.routes.length,
    estimatedSeconds: plan.totalEstimatedSeconds,
    resets: plan.resetCount,
    uncoveredCheckpointIds: plan.uncoveredCheckpointIds,
    output: args.output ? path.resolve(args.output) : null
  }, null, 2)}\n`);
  return plan;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, reusedCheckpointIds };
