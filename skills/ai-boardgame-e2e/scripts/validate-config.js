#!/usr/bin/env node
"use strict";

const path = require("path");
const { parseArgs, readJson, resolveConfig, writeJson } = require("./core");

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const configPath = args.config || args.positional[0];
  if (!configPath) throw new Error("用法：node validate-config.js --config <config.json> [--write-resolved <path>]");
  const resolved = resolveConfig(readJson(path.resolve(configPath)), { allowUnverified: Boolean(args["allow-unverified"]) });
  if (args["write-resolved"]) writeJson(path.resolve(args["write-resolved"]), resolved);
  process.stdout.write(`${JSON.stringify({ valid: true, resolved }, null, 2)}\n`);
  return resolved;
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
