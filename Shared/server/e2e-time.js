"use strict";

const MIN_TIME_SCALE = 0.1;
const MAX_TIME_SCALE = 1;
const SCALABLE_WAITS = Object.freeze([
  "onenightwolf.night-placeholder",
  "onenightwolf.doppel-insomniac",
  "avalon.public-result"
]);

function config(env = process.env) {
  const requestedScale = Number(env.AI_E2E_TIME_SCALE);
  const validScale = Number.isFinite(requestedScale)
    && requestedScale >= MIN_TIME_SCALE
    && requestedScale <= MAX_TIME_SCALE;
  const enabled = env.AI_E2E_MODE === "1" && validScale;
  return {
    enabled,
    timeScale: enabled ? requestedScale : 1,
    timingFidelity: enabled && requestedScale < 1 ? "accelerated_waits" : "production",
    scalableWaits: [...SCALABLE_WAITS]
  };
}

function scaleNonDecisionWait(milliseconds, env = process.env) {
  const value = Math.max(0, Number(milliseconds) || 0);
  const { timeScale } = config(env);
  return Math.max(value > 0 ? 1 : 0, Math.round(value * timeScale));
}

function deadlineAfter(milliseconds, now = Date.now(), env = process.env) {
  return Number(now) + scaleNonDecisionWait(milliseconds, env);
}

function capabilities(env = process.env) {
  return config(env);
}

module.exports = {
  MIN_TIME_SCALE,
  MAX_TIME_SCALE,
  SCALABLE_WAITS,
  config,
  scaleNonDecisionWait,
  deadlineAfter,
  capabilities
};
