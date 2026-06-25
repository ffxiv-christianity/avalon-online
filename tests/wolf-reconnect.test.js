"use strict";

const assert = require("assert");
const { createServer } = require("../server");
const wolf = require("../Onenightwolf/server");

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    const alreadySynced = await sendAndCollect(
      third,
      { type: "sync", version: rolledState.room.version },
      (messages) => messages.some((message) => message.type === "syncOk")
    );
    assert.strictEqual(alreadySynced.find((message) => message.type === "syncOk").version, rolledState.room.version);
    assert(!alreadySynced.some((message) => message.type === "state"), "latest sync must not resend full state");

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
        action: "startGame",
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
        type: "takeControl",
        roomCode: joined.roomCode,
        playerId: joined.playerId
      },
      (messages) => messages.some((message) => message.type === "controlGranted")
        && messages.some((message) => message.type === "state")
    );
    assert(takeover.some((message) => message.type === "controlGranted"));
    assert.strictEqual((await replacedThird).code, "SESSION_REPLACED");
    assert.strictEqual(
      takeover.filter((message) => message.type === "state").at(-1).room.code,
      joined.roomCode,
      "taking control must keep the original room"
    );
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

    const voteSockets = [];
    const voteErrors = [];
    const host = await openSocket(`ws://127.0.0.1:${port}/ws/onenightwolf`);
    voteSockets.push(host);
    const hostMessages = await sendAndCollect(
      host,
      { type: "createRoom", name: "WolfVoteHost" },
      (messages) => messages.some((message) => message.type === "joined")
        && messages.some((message) => message.type === "state")
    );
    const hostJoin = hostMessages.find((message) => message.type === "joined");
    const votePlayerIds = [hostJoin.playerId];
    host.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "error") voteErrors.push(message);
    });
    for (let index = 2; index <= 3; index += 1) {
      const socket = await openSocket(`ws://127.0.0.1:${port}/ws/onenightwolf`);
      voteSockets.push(socket);
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "error") voteErrors.push(message);
      });
      const joinedMessages = await sendAndCollect(
        socket,
        { type: "joinRoom", roomCode: hostJoin.roomCode, name: `WolfVoteP${index}` },
        (messages) => messages.some((message) => message.type === "joined")
          && messages.some((message) => message.type === "state")
      );
      votePlayerIds.push(joinedMessages.find((message) => message.type === "joined").playerId);
    }
    const voteRoom = wolf.rooms.get(hostJoin.roomCode);
    voteRoom.phase = "discussion";
    voteRoom.version = 200;
    voteRoom.votes = {};
    voteRoom.discussionEndsAt = Date.now() + 60 * 1000;
    voteRoom.effectiveRoles = Object.fromEntries(votePlayerIds.map((playerId) => [playerId, "villager"]));
    const broadcastsBefore = wolf.realtimeMetrics.snapshot(voteRoom.code).broadcasts;
    voteSockets.forEach((socket, index) => {
      socket.send(JSON.stringify({
        type: "action",
        action: "vote",
        payload: { targetId: votePlayerIds[(index + 1) % votePlayerIds.length] },
        roomVersion: 200,
        actionId: `wolf-vote-burst:${index + 1}`
      }));
    });
    await delay(150);
    assert.strictEqual(Object.keys(voteRoom.votes).length, votePlayerIds.length);
    assert(["result", "hunter"].includes(voteRoom.phase));
    assert(!voteErrors.some((message) => message.code === "STALE_ROOM_VERSION"), "simultaneous wolf votes must not fail only because another player voted first");
    const broadcastsAfter = wolf.realtimeMetrics.snapshot(voteRoom.code).broadcasts;
    assert.strictEqual(broadcastsAfter - broadcastsBefore, 1, "simultaneous wolf vote burst should be coalesced into one broadcast");
    await Promise.all(voteSockets.map(closeSocket));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("one night wolf quick reconnect tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
