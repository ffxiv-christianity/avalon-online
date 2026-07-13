"use strict";

const assert = require("assert");
const {
  MAX_PLAYER_NAME_WIDTH,
  playerNameWidth,
  limitPlayerName,
  cleanPlayerName
} = require("../Shared/public/player-name");
const Avalon = require("../Avalon/server");
const Wolf = require("../Onenightwolf/game");
const CriminalDance = require("../CriminalDance/game");
const LoveLetter = require("../LoveLetter/game");

assert.strictEqual(MAX_PLAYER_NAME_WIDTH, 12);
assert.strictEqual(playerNameWidth("ABCDEFGHIJKL"), 12);
assert.strictEqual(playerNameWidth("玩家ABC"), 7);
assert.strictEqual(playerNameWidth("ＡＢＣ"), 6);
assert.strictEqual(playerNameWidth("ｱｲｳ"), 3);
assert.strictEqual(playerNameWidth("👨‍👩‍👧‍👦"), 2, "one emoji grapheme must count as one full-width character");
assert.strictEqual(limitPlayerName("ABCDEFGHIJKLM"), "ABCDEFGHIJKL");
assert.strictEqual(limitPlayerName("玩家玩家玩家玩家"), "玩家玩家玩家");
assert.strictEqual(cleanPlayerName("  玩家   ABCDEFGHI  "), "玩家 ABCDEFG");

const avalonRoom = Avalon.makeRoom("玩家玩家玩家玩家").room;
assert.strictEqual(avalonRoom.players[0].name, "玩家玩家玩家");
assert.strictEqual(playerNameWidth(avalonRoom.players[0].name), 12);
Avalon.rooms.delete(avalonRoom.code);

[
  ["Onenightwolf", Wolf],
  ["CriminalDance", CriminalDance],
  ["LoveLetter", LoveLetter]
].forEach(([label, game]) => {
  const { room } = game.makeRoom("ABCDEFGHIJKLM", `NAME${label.slice(0, 2).toUpperCase()}`);
  assert.strictEqual(room.players[0].name, "ABCDEFGHIJKL", `${label} host name must use the Shared limit`);
  const joined = game.joinRoom(room, "玩家玩家玩家玩家");
  assert.ifError(joined.error);
  assert.strictEqual(joined.player.name, "玩家玩家玩家", `${label} joined name must use the Shared limit`);
  assert.strictEqual(playerNameWidth(joined.player.name), 12);
});

console.log("shared player name contract tests passed");
