"use strict";

const assert = require("assert");
process.env.ADMIN_TOKEN = "test-admin-token";
const rootServer = require("../server");
const avalon = require("../Avalon/server");
const wolf = require("../Onenightwolf/server");
const wolfGame = require("../Onenightwolf/game");

const avalonRoom = avalon.makeRoom("AdminAvalon").room;
const wolfCreated = wolfGame.makeRoom("AdminWolf", "ADMINW");
wolf.rooms.set(wolfCreated.room.code, wolfCreated.room);

const stats = rootServer.combinedStats();
assert(stats.games.avalon.roomList.some((room) => room.code === avalonRoom.code));
assert(stats.games.onenightwolf.roomList.some((room) => room.code === wolfCreated.room.code));
assert.strictEqual(stats.totals.rooms, stats.games.avalon.rooms + stats.games.onenightwolf.rooms);
assert(stats.games.avalon.roomList.every((room) => !Object.hasOwn(room, "playerNames")));
assert(stats.games.onenightwolf.roomList.every((room) => !Object.hasOwn(room, "playerNames")));

const originalHost = wolfCreated.player;
const nextHost = wolfGame.joinRoom(wolfCreated.room, "BackupHost").player;
originalHost.online = false;
nextHost.online = true;
assert.strictEqual(wolf.updateHostTransfer(wolfCreated.room, 1000), true);
assert.strictEqual(wolf.updateHostTransfer(wolfCreated.room, 1000 + (2 * 60 * 1000) - 1), false);
assert.strictEqual(wolf.updateHostTransfer(wolfCreated.room, 1000 + (2 * 60 * 1000)), true);
assert.strictEqual(wolfCreated.room.hostId, nextHost.id);

(async () => {
  const server = rootServer.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/admin/stats?token=test-admin-token`);
    assert.strictEqual(response.status, 200);
    const payload = await response.json();
    assert(payload.games.avalon);
    assert(payload.games.onenightwolf);
    assert(payload.totals);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    avalon.rooms.delete(avalonRoom.code);
    wolf.rooms.delete(wolfCreated.room.code);
    delete process.env.ADMIN_TOKEN;
  }
  console.log("shared admin stats tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
