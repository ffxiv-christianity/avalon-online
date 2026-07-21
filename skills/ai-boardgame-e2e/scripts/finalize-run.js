#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseArgs, readJson, writeJson } = require("./core");
const { appendEvent, withWriterLock } = require("./append-event");
const { buildReport } = require("./build-report");
const { auditRun } = require("./audit-run");

const STATUSES = new Set(["complete", "incomplete", "aborted"]);
const VERDICTS = new Set(["pass", "fail", "not_evaluated"]);

function inputFromArgs(args) {
  if (args.json) return JSON.parse(args.json);
  if (args["json-base64"]) return JSON.parse(Buffer.from(args["json-base64"], "base64").toString("utf8"));
  if (args.input) return readJson(path.resolve(args.input));
  if (!process.stdin.isTTY) {
    const text = fs.readFileSync(0, "utf8").trim();
    if (text) return JSON.parse(text);
  }
  throw new Error("請使用 --json、--json-base64、--input，或 stdin 提供結束資料。");
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function finishEvent(updated) {
  return {
    at: updated.finishedAt,
    type: "run_finished",
    status: updated.status,
    productVerdict: updated.productVerdict,
    findings: updated.findings,
    finishedAt: updated.finishedAt
  };
}

function matchingFinishEvent(event, updated) {
  return event?.type === "run_finished"
    && event.status === updated.status
    && event.productVerdict === updated.productVerdict
    && event.finishedAt === updated.finishedAt
    && JSON.stringify(event.findings || {}) === JSON.stringify(updated.findings || {});
}

function resumeValidatedFinalization(resolvedRun, pending, options = {}) {
  const runPath = path.join(resolvedRun, "run.json");
  const timelinePath = path.join(resolvedRun, "public", "timeline.jsonl");
  const pendingPath = path.join(resolvedRun, "finalization-pending.json");
  const updated = pending.updated;
  const timeline = fs.existsSync(timelinePath)
    ? fs.readFileSync(timelinePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    : [];
  const finishEvents = timeline.filter((event) => event.type === "run_finished");
  if (finishEvents.length > 1 || (finishEvents.length === 1 && !matchingFinishEvent(finishEvents[0], updated))) {
    throw new Error("Pending finalization conflicts with recorded run_finished evidence.");
  }
  if (!finishEvents.length) {
    appendEvent({
      runDir: resolvedRun,
      scope: "public",
      kind: "timeline",
      event: finishEvent(updated),
      allowFinalized: true
    });
  }
  withWriterLock(resolvedRun, () => {
    writeJson(runPath, updated);
    if (fs.existsSync(pendingPath)) fs.unlinkSync(pendingPath);
  });
  const report = options.buildReport === false ? null : buildReport(resolvedRun);
  return { run: updated, report };
}

function preflightCandidate(resolvedRun, updated) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-boardgame-e2e-finalize-"));
  const candidateRun = path.join(temporaryRoot, "run");
  try {
    fs.cpSync(resolvedRun, candidateRun, { recursive: true });
    writeJson(path.join(candidateRun, "run.json"), updated);
    appendEvent({
      runDir: candidateRun,
      scope: "public",
      kind: "timeline",
      event: finishEvent(updated),
      allowFinalized: true
    });
    const structuralAudit = auditRun(candidateRun, { write: false, ignoreBlockingFindings: true });
    if (updated.status === "complete" && !structuralAudit.passed) {
      throw new Error(`Finalization structural audit failed:\n${structuralAudit.errors.join("\n")}`);
    }
    const candidateAudit = auditRun(candidateRun, { write: false });
    if (updated.status === "complete" && updated.productVerdict === "pass" && !candidateAudit.passed) {
      throw new Error(`Finalization audit failed:\n${candidateAudit.errors.join("\n")}`);
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function finalizeRun(runDir, result, options = {}) {
  const resolvedRun = path.resolve(runDir);
  const runPath = path.join(resolvedRun, "run.json");
  const pendingPath = path.join(resolvedRun, "finalization-pending.json");
  if (fs.existsSync(pendingPath)) {
    const pending = readJson(pendingPath);
    if (pending.ownerPid !== process.pid && processIsAlive(Number(pending.ownerPid))) {
      throw new Error("Another process is finalizing this Run.");
    }
    if (pending.phase === "validated" && pending.updated) {
      return resumeValidatedFinalization(resolvedRun, pending, options);
    }
    withWriterLock(resolvedRun, () => {
      if (fs.existsSync(pendingPath)) fs.unlinkSync(pendingPath);
    });
  }
  const run = readJson(runPath);
  const configPath = path.join(resolvedRun, "config.resolved.json");
  const config = fs.existsSync(configPath) ? readJson(configPath) : null;
  const strictContract = Object.hasOwn(config || {}, "testPurpose");
  const exploratoryRun = String(config?.testPurpose?.approach || "") === "exploratory";
  if (["complete", "incomplete", "aborted"].includes(String(run.status || ""))) {
    throw new Error(`Run 已經 ${run.status}，不得重複結案或回填證據。`);
  }
  const status = String(result.status || "");
  const productVerdict = String(result.productVerdict || "");
  if (!STATUSES.has(status)) throw new Error("status 必須是 complete、incomplete 或 aborted。");
  if (!VERDICTS.has(productVerdict)) throw new Error("productVerdict 必須是 pass、fail 或 not_evaluated。");
  if (productVerdict === "pass" && status !== "complete") {
    throw new Error("productVerdict pass requires status complete.");
  }
  if (status === "complete" && exploratoryRun && productVerdict !== "not_evaluated") {
    throw new Error("Exploratory Adapter discovery cannot claim a product pass or fail; use productVerdict not_evaluated.");
  }
  if (status === "complete" && !exploratoryRun && !["pass", "fail"].includes(productVerdict)) {
    throw new Error("complete runs require productVerdict pass or fail.");
  }
  if (["incomplete", "aborted"].includes(status) && productVerdict !== "not_evaluated") {
    throw new Error(`${status} runs must use productVerdict not_evaluated.`);
  }
  const findings = {
    P0: Number(result.findings?.P0 || 0),
    P1: Number(result.findings?.P1 || 0),
    P2: Number(result.findings?.P2 || 0),
    decisionIsolationFailures: Number(result.findings?.decisionIsolationFailures || 0)
  };
  if (Object.values(findings).some((value) => !Number.isInteger(value) || value < 0)) throw new Error("findings 必須是非負整數。");
  if (productVerdict === "pass" && (findings.P0 || findings.P1 || findings.decisionIsolationFailures)) {
    throw new Error("含 P0、P1 或決策隔離失敗的 Run 不得判定 pass。");
  }
  if (strictContract && result.finishedAt !== undefined) {
    throw new Error("Strict-contract finishedAt is assigned by the finalizer and cannot be supplied by the caller.");
  }
  const finishedAt = result.finishedAt || new Date().toISOString();
  const updated = {
    ...run,
    status,
    finishedAt,
    productVerdict,
    findings,
    games: Array.isArray(result.games) ? result.games : run.games,
    isolation: result.isolation || run.isolation || null,
    notes: Array.isArray(result.notes) ? result.notes : run.notes || []
  };
  if (result.speed && typeof result.speed === "object") updated.speed = { ...run.speed, ...result.speed };
  if (result.serverManagedBySkill !== undefined) {
    updated.serverManagedBySkill = result.serverManagedBySkill;
    updated.speed = { ...updated.speed, serverManagedBySkill: result.serverManagedBySkill };
  }
  if (result.capability !== undefined) updated.capability = result.capability;
  if (result.agentProvenance !== undefined) updated.agentProvenance = result.agentProvenance;
  if (result.productBuild !== undefined) updated.productBuild = result.productBuild;
  const pending = {
    schemaVersion: "1.0",
    phase: "preparing",
    ownerPid: process.pid,
    createdAt: new Date().toISOString(),
    updated
  };
  withWriterLock(resolvedRun, () => writeJson(pendingPath, pending, { exclusive: true }));
  try {
    preflightCandidate(resolvedRun, updated);
    pending.phase = "validated";
    pending.validatedAt = new Date().toISOString();
    withWriterLock(resolvedRun, () => writeJson(pendingPath, pending));
  } catch (error) {
    withWriterLock(resolvedRun, () => {
      if (fs.existsSync(pendingPath)) fs.unlinkSync(pendingPath);
    });
    throw error;
  }
  return resumeValidatedFinalization(resolvedRun, pending, options);
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.run) throw new Error("用法：node finalize-run.js --run <run-dir> --input <result.json>");
  const result = finalizeRun(args.run, inputFromArgs(args));
  process.stdout.write(`${JSON.stringify({ finalized: true, status: result.run.status, productVerdict: result.run.productVerdict })}\n`);
  if (result.report && !result.report.audit.passed) process.exitCode = 1;
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

module.exports = { finalizeRun, main };
