#!/usr/bin/env node
"use strict";

const path = require("path");
const { DEFAULT_ARTIFACT_ROOT, parseArgs, writeJson } = require("./core");
const { indexRuns } = require("./evidence-history");

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const runsRoot = path.resolve(args.runs || path.join(DEFAULT_ARTIFACT_ROOT, "runs"));
  const index = indexRuns(runsRoot);
  if (args.output) writeJson(path.resolve(args.output), index);
  process.stdout.write(`${JSON.stringify({ runs: index.runs.length, indexSha256: index.indexSha256, output: args.output ? path.resolve(args.output) : null }, null, 2)}\n`);
  return index;
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
