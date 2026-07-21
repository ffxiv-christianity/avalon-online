#!/usr/bin/env node
"use strict";

const path = require("path");
const { DEFAULT_ARTIFACT_ROOT, parseArgs, readJson, writeJson } = require("./core");
const { indexRuns, queryEvidence } = require("./evidence-history");

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.query) throw new Error("Usage: node query-evidence.js --query <query.json> [--index <index.json> | --runs <runs-dir>] [--output <assessment.json>]");
  if (args.index && args.runs) throw new Error("Use either --index or --runs, not both.");
  const index = args.index
    ? readJson(path.resolve(args.index))
    : indexRuns(path.resolve(args.runs || path.join(DEFAULT_ARTIFACT_ROOT, "runs")));
  const assessment = queryEvidence(index, readJson(path.resolve(args.query)));
  if (args.output) writeJson(path.resolve(args.output), assessment);
  process.stdout.write(`${JSON.stringify({ disposition: assessment.disposition, candidates: assessment.candidates.length, assessmentSha256: assessment.assessmentSha256, output: args.output ? path.resolve(args.output) : null }, null, 2)}\n`);
  return assessment;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
