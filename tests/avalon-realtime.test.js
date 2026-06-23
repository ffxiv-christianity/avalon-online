"use strict";

const assert = require("assert");
const { createServer } = require("../Avalon/server");

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

function closeSocket(socket) {
  return new Promise((resolve) => {
    socket.addEventListener("close", resolve, { once: true });
    socket.close();
  });
}

(async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const first = await openSocket(`ws://127.0.0.1:${port}/ws`);
    const created = await sendAndCollect(
      first,
      { type: "createRoom", name: "AvalonRealtime" },
      (messages) => messages.some((message) => message.type === "joined")
        && messages.some((message) => message.type === "state")
    );
    const joined = created.find((message) => message.type === "joined");

    const firstReplaced = waitForMessage(
      first,
      (message) => message.type === "error" && message.code === "SESSION_REPLACED"
    );
    const second = await openSocket(`ws://127.0.0.1:${port}/ws`);
    const rejoined = await sendAndCollect(
      second,
      {
        type: "joinRoom",
        roomCode: joined.roomCode,
        playerId: joined.playerId,
        name: "AvalonRealtime"
      },
      (messages) => messages.some((message) => message.type === "joined")
        && messages.some((message) => message.type === "state")
    );
    assert.strictEqual((await firstReplaced).code, "SESSION_REPLACED");
    const state = rejoined.find((message) => message.type === "state");

    const validAction = {
      type: "action",
      action: "roll",
      payload: {},
      roomVersion: state.room.version,
      actionId: "avalon-second:1"
    };
    const rolled = await sendAndCollect(
      second,
      validAction,
      (messages) => messages.some((message) => message.type === "state")
    );
    assert(rolled.filter((message) => message.type === "state").at(-1).room.players[0].roll);

    const duplicate = await sendAndCollect(
      second,
      validAction,
      (messages) => messages.some((message) => message.type === "error")
    );
    assert.strictEqual(
      duplicate.find((message) => message.type === "error").code,
      "ACTION_ALREADY_CONFIRMED"
    );

    const readonly = await sendAndCollect(
      first,
      {
        type: "action",
        action: "setReady",
        payload: { ready: true },
        roomVersion: state.room.version,
        actionId: "avalon-first:1"
      },
      (messages) => messages.some((message) => message.type === "error")
    );
    assert.strictEqual(readonly.find((message) => message.type === "error").code, "SESSION_REPLACED");

    await closeSocket(first);
    await closeSocket(second);

    const missing = await openSocket(`ws://127.0.0.1:${port}/ws`);
    const missingMessages = await sendAndCollect(
      missing,
      { type: "joinRoom", roomCode: "FFFFFF", name: "Missing" },
      (messages) => messages.some((message) => message.type === "error")
    );
    const missingError = missingMessages.find((message) => message.type === "error");
    assert.strictEqual(missingError.code, "ROOM_NOT_FOUND");
    assert.strictEqual(missingError.message, "找不到這個房間，可能已經過期。");
    await closeSocket(missing);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("avalon realtime contract tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
