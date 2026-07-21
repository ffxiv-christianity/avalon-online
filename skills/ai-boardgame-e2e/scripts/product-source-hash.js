#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseArgs } = require("./core");

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".agents",
  ".visual-qa",
  ".vscode",
  "node_modules",
  "skills",
  "tests",
  "tmp"
]);

function sourceFiles(root) {
  const files = [];
  const stack = [path.resolve(root)];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function productSourceHash(root) {
  const resolvedRoot = path.resolve(root);
  const files = sourceFiles(resolvedRoot);
  const digest = crypto.createHash("sha256");
  for (const file of files) {
    const relative = path.relative(resolvedRoot, file).split(path.sep).join("/");
    digest.update(relative, "utf8");
    digest.update("\0");
    digest.update(fs.readFileSync(file));
    digest.update("\0");
  }
  return { root: resolvedRoot, productSourceSha256: digest.digest("hex"), fileCount: files.length };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const root = path.resolve(args.root || path.join(__dirname, "..", "..", ".."));
  const result = productSourceHash(root);
  process.stdout.write(`${JSON.stringify(result)}\n`);
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

module.exports = { EXCLUDED_DIRECTORIES, sourceFiles, productSourceHash, main };
