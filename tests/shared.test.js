"use strict";

const assert = require("assert");
const {
  randomIntInclusive,
  randomTieBreak,
  shuffle,
  roomCode,
  playerId,
  randomDelay
} = require("../Shared/server/random");
const { transferHost, kickOfflinePlayer } = require("../Shared/server/room-actions");
const { connectionStatusText, formatCountUnit } = require("../Shared/public/room-ui");

for (let index = 0; index < 100; index += 1) {
  const roll = randomIntInclusive(1, 100);
  assert(roll >= 1 && roll <= 100);
  assert(Number.isInteger(randomTieBreak()));
  assert(randomDelay(5, 9) >= 5 && randomDelay(5, 9) <= 9);
}

const original = ["a", "b", "c", "d"];
assert.deepStrictEqual([...shuffle([...original])].sort(), original);
assert(/^[A-F0-9]{6}$/.test(roomCode(new Set())));
assert(/^[a-f0-9]{16}$/.test(playerId()));

const room = {
  phase: "lobby",
  hostId: "host",
  hostOfflineSince: 123,
  players: [
    { id: "host", name: "Host", online: true, ready: true },
    { id: "next", name: "Next", online: true, ready: true },
    { id: "offline", name: "Offline", online: false, ready: true }
  ]
};
const host = room.players[0];
assert.strictEqual(transferHost({ room, actor: host, playerId: "next" }), null);
assert.strictEqual(room.hostId, "next");
assert.strictEqual(room.hostOfflineSince, null);

const nextHost = room.players[1];
assert.strictEqual(kickOfflinePlayer({
  room,
  actor: nextHost,
  playerId: "offline",
  markEveryoneUnready: () => room.players.forEach((player) => { player.ready = false; })
}), null);
assert(!room.players.some((player) => player.id === "offline"));
assert(room.players.every((player) => !player.ready));

assert.strictEqual(connectionStatusText(0), "已連線");
assert.strictEqual(connectionStatusText(12), "已同步 12 次");
assert.strictEqual(connectionStatusText(1234), "已同步 1.2K 次");
assert.strictEqual(connectionStatusText(12000), "已同步 12K 次");
assert.strictEqual(formatCountUnit(1250000), "1.3M 次");

console.log("shared framework tests passed");
