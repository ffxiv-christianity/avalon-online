"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const criminal = require("../server");
const game = require("../game");

const root = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "public", "criminaldance.js"), "utf8");

[
  "/shared/styles.css",
  "/shared/client-state.js",
  "/shared/room-ui.js",
  'data-shell-view="join"',
  'data-shell-view="room"',
  'data-shell-layout="game"',
  'data-shell-region="info-sidebar"',
  'data-shell-panel="chat"',
  'data-shell-panel="players"',
  'data-shell-panel="main"',
  'data-shell-template="lobby"',
  'data-shell-panel="host-settings"',
  'data-shell-panel="deck"'
].forEach((token) => assert(page.includes(token), `CriminalDance page missing ${token}`));

assert(script.includes("page.lobbyTemplate.content.cloneNode(true)"));
assert(script.includes("page.mainPanel.replaceChildren(fragment)"));
assert(!script.includes("page.roomView.innerHTML"));
assert(script.includes("/ws/criminaldance"));
assert(script.includes("SharedRoomClient.createActionRequest"));
assert(script.includes("SharedRoomUI.bindHostControls"));

const created = game.makeRoom("Host", "CDSTAT");
const duplicateJoin = game.joinRoom(created.room, "host");
assert(duplicateJoin.error.includes("名字"), "玩家名稱不可重複，大小寫不同也不可");
const reconnectHost = game.joinRoom(created.room, "Ignored Name", created.player.id);
assert.ifError(reconnectHost.error);
assert.strictEqual(reconnectHost.player.id, created.player.id, "既有玩家重連不應被重複名稱檢查擋住");
criminal.rooms.set(created.room.code, created.room);
const stats = criminal.statsSnapshot();
assert(stats.roomList.some((room) => room.code === "CDSTAT"));
assert(stats.roomList.every((room) => !Object.hasOwn(room, "playerNames")));

const nextHost = game.joinRoom(created.room, "Next").player;
created.player.online = false;
nextHost.online = true;
assert.strictEqual(criminal.updateHostTransfer(created.room, 1000), true);
assert.strictEqual(criminal.updateHostTransfer(created.room, 1000 + (2 * 60 * 1000)), true);
assert.strictEqual(created.room.hostId, nextHost.id);

criminal.rooms.delete(created.room.code);

(async () => {
  const server = http.createServer((req, res) => criminal.serveStatic(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/CriminalDance/`);
    assert.strictEqual(response.status, 200);
    const html = await response.text();
    assert(html.includes("犯人在跳舞"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  console.log("criminal dance room contract tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
