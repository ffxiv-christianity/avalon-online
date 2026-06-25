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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const rolledState = rolled.filter((message) => message.type === "state").at(-1);
    assert(rolledState.room.players[0].roll);

    const alreadySynced = await sendAndCollect(
      second,
      { type: "syncState", version: rolledState.room.version },
      (messages) => messages.some((message) => message.type === "syncOk")
    );
    assert.strictEqual(alreadySynced.find((message) => message.type === "syncOk").version, rolledState.room.version);
    assert(!alreadySynced.some((message) => message.type === "state"), "latest sync must not resend full state");

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

    const secondReplaced = waitForMessage(
      second,
      (message) => message.type === "error" && message.code === "SESSION_REPLACED"
    );
    const takeover = await sendAndCollect(
      first,
      {
        type: "takeControl",
        roomCode: joined.roomCode,
        playerId: joined.playerId
      },
      (messages) => messages.some((message) => message.type === "controlGranted")
        && messages.some((message) => message.type === "state")
    );
    assert(takeover.some((message) => message.type === "controlGranted"));
    assert.strictEqual((await secondReplaced).code, "SESSION_REPLACED");
    assert.strictEqual(
      takeover.filter((message) => message.type === "state").at(-1).room.code,
      joined.roomCode,
      "taking control must keep the original room"
    );

    const secondReadonly = await sendAndCollect(
      second,
      {
        type: "action",
        action: "setReady",
        payload: { ready: true },
        roomVersion: takeover.filter((message) => message.type === "state").at(-1).room.version,
        actionId: "avalon-second:2"
      },
      (messages) => messages.some((message) => message.type === "error")
    );
    assert.strictEqual(secondReadonly.find((message) => message.type === "error").code, "SESSION_REPLACED");

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

    const missingTakeover = await openSocket(`ws://127.0.0.1:${port}/ws`);
    const missingTakeoverMessages = await sendAndCollect(
      missingTakeover,
      { type: "takeControl", roomCode: "FFFFFF", playerId: joined.playerId },
      (messages) => messages.some((message) => message.type === "error")
    );
    assert.strictEqual(
      missingTakeoverMessages.find((message) => message.type === "error").code,
      "ROOM_NOT_FOUND"
    );
    await closeSocket(missingTakeover);

    const voteSockets = [];
    const voteErrors = [];
    const host = await openSocket(`ws://127.0.0.1:${port}/ws`);
    voteSockets.push(host);
    const hostMessages = await sendAndCollect(
      host,
      { type: "createRoom", name: "VoteHost" },
      (messages) => messages.some((message) => message.type === "joined")
        && messages.some((message) => message.type === "state")
    );
    const hostJoin = hostMessages.find((message) => message.type === "joined");
    const votePlayerIds = [hostJoin.playerId];
    for (let index = 2; index <= 5; index += 1) {
      const socket = await openSocket(`ws://127.0.0.1:${port}/ws`);
      voteSockets.push(socket);
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "error") voteErrors.push(message);
      });
      const joinedMessages = await sendAndCollect(
        socket,
        { type: "joinRoom", roomCode: hostJoin.roomCode, name: `VoteP${index}` },
        (messages) => messages.some((message) => message.type === "joined")
          && messages.some((message) => message.type === "state")
      );
      votePlayerIds.push(joinedMessages.find((message) => message.type === "joined").playerId);
    }
    host.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "error") voteErrors.push(message);
    });
    const voteRoom = require("../Avalon/server").rooms.get(hostJoin.roomCode);
    voteRoom.phase = "vote";
    voteRoom.version = 100;
    voteRoom.votes = {};
    voteRoom.resultDelaySeconds = 0;
    const broadcastsBefore = require("../Avalon/server").realtimeMetrics.snapshot(voteRoom.code).broadcasts;
    voteSockets.forEach((socket, index) => {
      socket.send(JSON.stringify({
        type: "action",
        action: "castVote",
        payload: { vote: index % 2 ? "reject" : "approve" },
        roomVersion: 100,
        actionId: `vote-burst:${index + 1}`
      }));
    });
    await delay(150);
    assert.strictEqual(Object.keys(voteRoom.votes).length, votePlayerIds.length);
    assert.strictEqual(voteRoom.phase, "voteResult");
    assert(!voteErrors.some((message) => message.code === "STALE_ROOM_VERSION"), "simultaneous votes must not fail only because another player voted first");
    const broadcastsAfter = require("../Avalon/server").realtimeMetrics.snapshot(voteRoom.code).broadcasts;
    assert.strictEqual(broadcastsAfter - broadcastsBefore, 1, "simultaneous vote burst should be coalesced into one broadcast");
    await Promise.all(voteSockets.map(closeSocket));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("avalon realtime contract tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
