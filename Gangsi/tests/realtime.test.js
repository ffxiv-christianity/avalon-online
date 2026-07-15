"use strict";

const assert = require("assert");
const http = require("http");
const gangsi = require("../server");
const { joinRoom, applyRoomAction } = require("../game");

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
      reject(new Error("Gangsi WebSocket response timeout"));
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

async function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise((resolve) => {
    socket.addEventListener("close", resolve, { once: true });
    socket.close();
  });
}

(async () => {
  const server = http.createServer((req, res) => gangsi.serveStatic(req, res));
  server.on("upgrade", (req, socket, head) => gangsi.handleUpgrade(req, socket, head));
  gangsi.attachMaintenance(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  let socket;
  let mummySocket;
  try {
    const mapIndexResponse = await fetch(`http://127.0.0.1:${port}/Gangsi/maps/index.json`);
    assert.strictEqual(mapIndexResponse.status, 200);
    const mapIndex = await mapIndexResponse.json();
    socket = await openSocket(`ws://127.0.0.1:${port}/ws/gangsi`);
    const created = await sendAndCollect(
      socket,
      { type: "createRoom", name: "Realtime" },
      (messages) => messages.some((message) => message.type === "joined")
        && messages.some((message) => message.type === "state")
    );
    const joined = created.find((message) => message.type === "joined");
    const state = created.filter((message) => message.type === "state").at(-1);
    assert.strictEqual(state.room.code, joined.roomCode);
    assert.deepStrictEqual(state.room.maps.map((map) => map.id), mapIndex.maps.map((map) => map.id));
    assert.deepStrictEqual(state.room.maps.map((map) => map.name), mapIndex.maps.map((map) => map.name));
    assert.strictEqual(
      gangsi.requestFailureMessage(new Error("Gangsi map catalog failed")),
      "地圖資料載入失敗，請檢查地圖清單與 JSON 內容。"
    );

    const action = {
      type: "action",
      action: "roll",
      payload: {},
      roomVersion: state.room.version,
      actionId: "gangsi-realtime:1"
    };
    const rolled = await sendAndCollect(
      socket,
      action,
      (messages) => messages.some((message) => message.type === "state")
    );
    assert(rolled.filter((message) => message.type === "state").at(-1).room.players[0].roll);

    const duplicate = await sendAndCollect(
      socket,
      action,
      (messages) => messages.some((message) => message.type === "error")
    );
    assert.strictEqual(duplicate.find((message) => message.type === "error").code, "ACTION_ALREADY_CONFIRMED");

    const stale = await sendAndCollect(
      socket,
      {
        type: "action",
        action: "updateSettings",
        payload: { playerCount: 2, mapId: "classic", randomMap: false },
        roomVersion: state.room.version,
        actionId: "gangsi-realtime:2"
      },
      (messages) => messages.some((message) => message.type === "error")
    );
    assert.strictEqual(stale.find((message) => message.type === "error").code, "STALE_ROOM_VERSION");

    const room = gangsi.rooms.get(joined.roomCode);
    const host = room.players.find((player) => player.id === joined.playerId);
    assert.strictEqual(applyRoomAction(room, host, "updateSettings", {
      playerCount: 3,
      mapId: "classic",
      randomMap: false
    }), null);
    const second = joinRoom(room, "Second").player;
    const mummy = joinRoom(room, "Mummy").player;
    assert.strictEqual(applyRoomAction(room, host, "updateTokenLabel", { tokenLabel: "即" }), null);
    assert.strictEqual(applyRoomAction(room, second, "updateTokenLabel", { tokenLabel: "時" }), null);
    assert.strictEqual(applyRoomAction(room, mummy, "chooseRole", { role: "mummy" }), null);
    assert.strictEqual(applyRoomAction(room, second, "roll"), null);
    assert.strictEqual(applyRoomAction(room, host, "toggleReady"), null);
    assert.strictEqual(applyRoomAction(room, second, "toggleReady"), null);
    assert.strictEqual(applyRoomAction(room, mummy, "toggleReady"), null);
    assert.strictEqual(applyRoomAction(room, host, "startGame"), null);

    mummySocket = await openSocket(`ws://127.0.0.1:${port}/ws/gangsi`);
    const mummyMessages = await sendAndCollect(
      mummySocket,
      { type: "joinRoom", roomCode: room.code, playerId: mummy.id, name: mummy.name },
      (messages) => messages.some((message) => message.type === "joined")
        && messages.some((message) => message.type === "state")
    );
    const mummyState = mummyMessages.filter((message) => message.type === "state").at(-1);
    assert.strictEqual(mummyState.you.role, "mummy");
    assert.strictEqual(mummyState.room.game.dice, null);
    assert.deepStrictEqual(mummyState.room.game.hand, []);
    assert(mummyState.room.game.pieces.every((piece) => !Object.hasOwn(piece, "position")));
    assert(!JSON.stringify(mummyState.room.game).includes('"position":"entrance"'));
  } finally {
    if (mummySocket) await closeSocket(mummySocket);
    if (socket) await closeSocket(socket);
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("Gangsi realtime tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
