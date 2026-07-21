"use strict";

const assert = require("assert");
const http = require("http");
const e2eTime = require("../Shared/server/e2e-time");
const { createServer } = require("../server");

function requestJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: "127.0.0.1", port, path: pathname }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.on("error", reject);
  });
}

async function withServer(env, callback) {
  const previousMode = process.env.AI_E2E_MODE;
  const previousScale = process.env.AI_E2E_TIME_SCALE;
  if (env.AI_E2E_MODE === undefined) delete process.env.AI_E2E_MODE;
  else process.env.AI_E2E_MODE = env.AI_E2E_MODE;
  if (env.AI_E2E_TIME_SCALE === undefined) delete process.env.AI_E2E_TIME_SCALE;
  else process.env.AI_E2E_TIME_SCALE = env.AI_E2E_TIME_SCALE;

  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousMode === undefined) delete process.env.AI_E2E_MODE;
    else process.env.AI_E2E_MODE = previousMode;
    if (previousScale === undefined) delete process.env.AI_E2E_TIME_SCALE;
    else process.env.AI_E2E_TIME_SCALE = previousScale;
  }
}

async function run() {
  assert.deepStrictEqual(e2eTime.config({}), {
    enabled: false,
    timeScale: 1,
    timingFidelity: "production",
    scalableWaits: [...e2eTime.SCALABLE_WAITS]
  });
  assert.strictEqual(e2eTime.scaleNonDecisionWait(8000, {
    AI_E2E_MODE: "1",
    AI_E2E_TIME_SCALE: "0.25"
  }), 2000);
  assert.strictEqual(e2eTime.deadlineAfter(5000, 1000, {
    AI_E2E_MODE: "1",
    AI_E2E_TIME_SCALE: "0.1"
  }), 1500);
  assert.strictEqual(e2eTime.config({ AI_E2E_MODE: "1", AI_E2E_TIME_SCALE: "0.01" }).enabled, false);
  assert.strictEqual(e2eTime.scaleNonDecisionWait(5000, {
    AI_E2E_MODE: "1",
    AI_E2E_TIME_SCALE: "invalid"
  }), 5000);

  await withServer({}, async (port) => {
    const response = await requestJson(port, "/__ai-e2e/capabilities");
    assert.strictEqual(response.status, 404);
    assert.strictEqual(response.body.error, "AI E2E mode is not enabled");
  });

  await withServer({ AI_E2E_MODE: "1", AI_E2E_TIME_SCALE: "0.1" }, async (port) => {
    const response = await requestJson(port, "/__ai-e2e/capabilities");
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.body.enabled, true);
    assert.strictEqual(response.body.timeScale, 0.1);
    assert.strictEqual(response.body.timingFidelity, "accelerated_waits");
    assert.deepStrictEqual(response.body.scalableWaits, [...e2eTime.SCALABLE_WAITS]);
    assert(!Object.hasOwn(response.body, "rooms"));
    assert(!Object.hasOwn(response.body, "players"));
  });

  console.log("AI E2E time tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
