"use strict";

const assert = require("assert");
process.env.ADMIN_TOKEN = "test-admin-token";
const rootServer = require("../server");
const avalon = require("../Avalon/server");
const wolf = require("../Onenightwolf/server");
const wolfGame = require("../Onenightwolf/game");
const criminal = require("../CriminalDance/server");
const criminalGame = require("../CriminalDance/game");
const loveletter = require("../LoveLetter/server");
const loveGame = require("../LoveLetter/game");
const gangsi = require("../Gangsi/server");
const gangsiGame = require("../Gangsi/game");

const avalonRoom = avalon.makeRoom("AdminAvalon").room;
const wolfCreated = wolfGame.makeRoom("AdminWolf", "ADMINW");
wolf.rooms.set(wolfCreated.room.code, wolfCreated.room);
const criminalCreated = criminalGame.makeRoom("AdminCriminal", "ADMINC");
criminal.rooms.set(criminalCreated.room.code, criminalCreated.room);
const loveCreated = loveGame.makeRoom("AdminLove", "ADMINL");
loveletter.rooms.set(loveCreated.room.code, loveCreated.room);
const gangsiCreated = gangsiGame.makeRoom("AdminGangsi", "ADMING");
gangsi.rooms.set(gangsiCreated.room.code, gangsiCreated.room);

const stats = rootServer.combinedStats();
assert(stats.labels);
assert(stats.labels.realtime);
assert.strictEqual(stats.labels.totals.rooms, "房間總數。");
assert.strictEqual(stats.labels.room.connections, "WebSocket 連線數。");
assert(stats.games.avalon.roomList.some((room) => room.code === avalonRoom.code));
assert(stats.games.onenightwolf.roomList.some((room) => room.code === wolfCreated.room.code));
assert(stats.games.criminaldance.roomList.some((room) => room.code === criminalCreated.room.code));
assert(stats.games.loveletter.roomList.some((room) => room.code === loveCreated.room.code));
assert(stats.games.gangsi.roomList.some((room) => room.code === gangsiCreated.room.code));
assert.strictEqual(stats.totals.rooms, stats.games.avalon.rooms + stats.games.onenightwolf.rooms + stats.games.criminaldance.rooms + stats.games.loveletter.rooms + stats.games.gangsi.rooms);
assert(stats.games.avalon.roomList.every((room) => !Object.hasOwn(room, "playerNames")));
assert(stats.games.onenightwolf.roomList.every((room) => !Object.hasOwn(room, "playerNames")));
assert(stats.games.criminaldance.roomList.every((room) => !Object.hasOwn(room, "playerNames")));
assert(stats.games.loveletter.roomList.every((room) => !Object.hasOwn(room, "playerNames")));
assert(stats.games.gangsi.roomList.every((room) => !Object.hasOwn(room, "playerNames")));
assert(stats.games.avalon.realtime);
assert(stats.games.onenightwolf.realtime);
assert(stats.games.criminaldance.realtime);
assert(stats.games.loveletter.realtime);
assert(stats.games.gangsi.realtime);
assert(stats.games.avalon.roomList.every((room) => room.realtime));
assert(stats.games.onenightwolf.roomList.every((room) => room.realtime));
assert(stats.games.criminaldance.roomList.every((room) => room.realtime));
assert(stats.games.loveletter.roomList.every((room) => room.realtime));
assert(stats.games.gangsi.roomList.every((room) => room.realtime));

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
    assert(payload.games.criminaldance);
    assert(payload.games.loveletter);
    assert(payload.games.gangsi);
    assert(payload.totals);
    assert.strictEqual(payload.labels.realtime.stateMessagesSent, "完整 state 次數。");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    avalon.rooms.delete(avalonRoom.code);
    wolf.rooms.delete(wolfCreated.room.code);
    criminal.rooms.delete(criminalCreated.room.code);
    loveletter.rooms.delete(loveCreated.room.code);
    gangsi.rooms.delete(gangsiCreated.room.code);
    delete process.env.ADMIN_TOKEN;
  }
  console.log("shared admin stats tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
