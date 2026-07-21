#!/usr/bin/env node
"use strict";

const path = require("path");
const { parseArgs, readJson, resolveConfig, initializeRun } = require("./core");
const { verifyApprovedPlan } = require("./plan-contract");

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const configPath = args.config || args.positional[0];
  if (!configPath) throw new Error("用法：node init-run.js --config <config.json> [--run-id <id>]");
  const config = readJson(path.resolve(configPath));
  const resolved = resolveConfig(config);
  let approvedPlan = null;
  let planVerification = null;
  if (String(config.schemaVersion || "") === "1.1") {
    if (!args.plan) throw new Error("New schemaVersion 1.1 Runs require --plan <approved-plan.json>.");
    approvedPlan = readJson(path.resolve(args.plan));
    planVerification = verifyApprovedPlan(approvedPlan, resolved, { forExecution: true });
  }
  const result = initializeRun(resolved, {
    runId: args["run-id"],
    approvedPlan,
    planVerification
  });
  process.stdout.write(`${JSON.stringify({ runId: result.runId, runDir: result.runDir }, null, 2)}\n`);
  return result;
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
