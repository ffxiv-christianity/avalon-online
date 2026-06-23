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
    await closeSocket(second);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("one night wolf quick reconnect tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
