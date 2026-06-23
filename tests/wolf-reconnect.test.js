"use strict";

const assert = require("assert");
const { createServer } = require("../server");

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
}

function sendAndCollect(socket, payload, done) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket response timeout"));
    }, 3000);
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      messages.push(message);
      if (!done(messages, message)) return;
      cleanup();
      resolve(messages);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify(payload));
  });
}

function closeSocket(socket) {
  return new Promise((resolve) => {
    socket.addEventListener("close", resolve, { once: true });
    socket.close();
  });
}

function waitForMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket message timeout"));
    }, 3000);
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
    };
    socket.addEventListener("message", onMessage);
  });
}

(async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const first = await openSocket(`ws://127.0.0.1:${port}/ws/onenightwolf`);
    const created = await sendAndCollect(
      first,
      { type: "createRoom", name: "ReconnectTester" },
      (messages) => messages.some((message) => message.type === "joined")
        && messages.some((message) => message.type === "state")
    );
    const joined = created.find((message) => message.type === "joined");
    const initialState = created.find((message) => message.type === "state");
    assert.strictEqual(initialState.room.players.length, 1);
    assert.strictEqual(initialState.you.id, joined.playerId);
    await closeSocket(first);

    const second = await openSocket(`ws://127.0.0.1:${port}/ws/onenightwolf`);
    const reconnected = await sendAndCollect(
      second,
      {
        type: "joinRoom",
        roomCode: joined.roomCode,
        playerId: joined.playerId,
        name: "ReconnectTester"
      },
      (messages) => messages.some((message) => message.type === "joined")
        && messages.some((message) => message.type === "state")
    );
    const reconnectState = reconnected.find((message) => message.type === "state");
    assert.strictEqual(reconnectState.room.players.length, 1, "quick reconnect must not duplicate the player");
    assert.strictEqual(reconnectState.you.id, joined.playerId, "quick reconnect must restore the same identity");

    const replacedSecond = waitForMessage(
      second,
      (message) => message.type === "error" && message.code === "SESSION_REPLACED"
    );
    const third = await openSocket(`ws://127.0.0.1:${port}/ws/onenightwolf`);
    const thirdJoin = await sendAndCollect(
      third,
      {
        type: "joinRoom",
        roomCode: joined.roomCode,
        playerId: joined.playerId,
        name: "ReconnectTester"
      },
      (messages) => messages.some((message) => message.type === "joined")
        && messages.some((message) => message.type === "state")
    );
    assert.strictEqual((await replacedSecond).code, "SESSION_REPLACED");
    const thirdState = thirdJoin.find((message) => message.type === "state");

    const readonlyError = await sendAndCollect(
      second,
      {
        type: "action",
        action: "roll",
        payload: {},
        roomVersion: thirdState.room.version,
        actionId: "readonly:1"
      },
      (messages) => messages.some((message) => message.type === "error")
    );
    assert.strictEqual(readonlyError.find((message) => message.type === "error").code, "SESSION_REPLACED");

    const validAction = {
      type: "action",
      action: "roll",
      payload: {},
      roomVersion: thirdState.room.version,
      actionId: "third:1"
    };
    const rolled = await sendAndCollect(
      third,
      validAction,
      (messages) => messages.some((message) => message.type === "state" && message.you?.id === joined.playerId)
    );
    const rolledState = rolled.filter((message) => message.type === "state").at(-1);
    assert(rolledState.room.players.find((player) => player.id === joined.playerId).roll);

    const duplicate = await sendAndCollect(
      third,
      validAction,
      (messages) => messages.some((message) => message.type === "error")
    );
    assert.strictEqual(
      duplicate.find((message) => message.type === "error").code,
      "ACTION_ALREADY_CONFIRMED"
    );

    const stale = await sendAndCollect(
      third,
      {
        type: "action",
        action: "toggleReady",
        payload: {},
        roomVersion: thirdState.room.version,
        actionId: "third:2"
      },
      (messages) => messages.some((message) => message.type === "error")
    );
    assert.strictEqual(stale.find((message) => message.type === "error").code, "STALE_ROOM_VERSION");

    const replacedThird = waitForMessage(
      third,
      (message) => message.type === "error" && message.code === "SESSION_REPLACED"
    );
    const takeover = await sendAndCollect(
      second,
      {
        type: "joinRoom",
        roomCode: joined.roomCode,
        playerId: joined.playerId,
        name: "ReconnectTester"
      },
      (messages) => messages.some((message) => message.type === "joined")
        && messages.some((message) => message.type === "state")
    );
    assert(takeover.some((message) => message.type === "joined"));
    assert.strictEqual((await replacedThird).code, "SESSION_REPLACED");
    await closeSocket(second);
    await closeSocket(third);

    const missing = await openSocket(`ws://127.0.0.1:${port}/ws/onenightwolf`);
    const staleMessages = await sendAndCollect(
      missing,
      {
        type: "joinRoom",
        roomCode: "FFFFFF",
        playerId: "missing-player",
        name: "ReconnectTester"
      },
      (messages) => messages.some((message) => message.type === "error")
    );
    const staleError = staleMessages.find((message) => message.type === "error");
    assert.strictEqual(staleError.code, "ROOM_NOT_FOUND", "stale quick reconnect must return a stable cleanup code");
    assert.strictEqual(staleError.message, "找不到這個房間，可能已經過期。");
    await closeSocket(missing);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("one night wolf quick reconnect tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
