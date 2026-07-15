"use strict";

const assert = require("assert");
const {
  makeRoom,
  joinRoom,
  applyRoomAction,
  validateLobby,
  makeView
} = require("../game");

const { room, player: host } = makeRoom("Host", "GS01");
assert.strictEqual(room.phase, "lobby");
assert.strictEqual(room.settings.playerCount, 4);
assert.strictEqual(room.settings.mapId, "classic");
assert.strictEqual(room.settings.randomMap, false);

assert.strictEqual(applyRoomAction(room, host, "updateSettings", { playerCount: 2, mapId: "test-map", randomMap: false }), null);
const joined = joinRoom(room, "Explorer");
assert.ifError(joined.error);
const explorer = joined.player;
assert(joinRoom(room, "explorer").error.includes("名字"));
assert(joinRoom(room, "Third").error.includes("人數已滿"));

assert(applyRoomAction(room, host, "toggleReady").includes("棋子文字"));
assert(applyRoomAction(room, host, "updateTokenLabel", { tokenLabel: "勇者" }).includes("一個字"));
assert.strictEqual(applyRoomAction(room, host, "updateTokenLabel", { tokenLabel: "勇" }), null);
assert.strictEqual(applyRoomAction(room, explorer, "updateTokenLabel", { tokenLabel: "探" }), null);
assert.strictEqual(applyRoomAction(room, explorer, "chooseRole", { role: "mummy" }), null);
assert(applyRoomAction(room, host, "chooseRole", { role: "mummy" }).includes("已選擇"));
assert(applyRoomAction(room, explorer, "roll").includes("冒險者"));
assert(applyRoomAction(room, host, "toggleReady").includes("d100"));
assert.strictEqual(applyRoomAction(room, host, "roll"), null);
assert(host.roll >= 1 && host.roll <= 100);
assert.strictEqual(applyRoomAction(room, host, "roll"), "你已經擲過 d100。");
assert(applyRoomAction(room, explorer, "updateSettings", { playerCount: 2, mapId: "classic", randomMap: true }).includes("房主"));
assert.strictEqual(applyRoomAction(room, host, "updateSettings", { playerCount: 2, mapId: "test-map", randomMap: true }), null);
const hiddenMapView = makeView(room, host.id);
assert.strictEqual(hiddenMapView.room.settings.randomMap, true);
assert.strictEqual(hiddenMapView.room.settings.mapId, "");
assert.strictEqual(hiddenMapView.room.selectedMap, null);
assert.strictEqual(applyRoomAction(room, host, "toggleReady"), null);
assert.strictEqual(applyRoomAction(room, explorer, "toggleReady"), null);
assert.deepStrictEqual(validateLobby(room).errors, []);
assert(applyRoomAction(room, explorer, "startGame").includes("房主"));
assert.strictEqual(applyRoomAction(room, host, "startGame"), null);
assert.strictEqual(room.phase, "adventurer_roll");
assert.strictEqual(room.players.length, 2);
assert.strictEqual(room.players[0].seat, 0);
assert.strictEqual(room.players[0].id, host.id);
assert.strictEqual(room.players[1].role, "mummy");
assert(joinRoom(room, "Late").error.includes("無法加入"));

const view = makeView(room, host.id);
assert.strictEqual(view.type, "state");
assert(["classic", "test-map"].includes(view.room.selectedMap.id));
assert.strictEqual(view.room.selectedMap.treasures.length, 23);
assert.deepStrictEqual(view.room.maps.map((map) => map.id), ["classic", "test-map"]);
assert.strictEqual(view.room.game.pieces.length, 2);
assert.strictEqual(view.room.game.hand.length, 10);
assert.strictEqual(view.room.game.mummy.target, 3);
assert.strictEqual(view.room.players.find((player) => player.id === host.id).tokenLabel, "勇");
assert.strictEqual(view.room.players.find((player) => player.id === explorer.id).role, "mummy");
assert.strictEqual(view.you.isHost, true);
room.log.push("較早記錄一", "較早記錄二", "最新記錄");
assert.deepStrictEqual(makeView(room, host.id).room.log, room.log.slice(-5));

assert(applyRoomAction(room, explorer, "returnLobby").includes("房主"));
assert.strictEqual(applyRoomAction(room, host, "chat", { message: "game message" }), null);
assert.strictEqual(applyRoomAction(room, host, "returnLobby"), null);
assert.strictEqual(room.phase, "lobby");
assert.strictEqual(room.log.length, 0);
assert.strictEqual(room.chat.length, 1);
assert.strictEqual(room.chat[0].playerId, "system");
assert(room.players.every((player) => !player.ready));
assert.strictEqual(explorer.role, "mummy");
assert.strictEqual(host.tokenLabel, "勇");
assert(room.players.every((player) => !player.roll));

assert(applyRoomAction(room, host, "updateSettings", { playerCount: 6, mapId: "classic" }).includes("2 到 5"));
assert(applyRoomAction(room, host, "updateSettings", { playerCount: 2, mapId: "missing", randomMap: false }).includes("地圖"));

assert.strictEqual(applyRoomAction(room, host, "updateSettings", {
  playerCount: 2,
  mapId: "test-map",
  randomMap: false
}), null);
assert.strictEqual(applyRoomAction(room, host, "roll"), null);
assert.strictEqual(applyRoomAction(room, host, "toggleReady"), null);
assert.strictEqual(applyRoomAction(room, explorer, "toggleReady"), null);
assert.strictEqual(applyRoomAction(room, host, "startGame"), null);
const replayView = makeView(room, host.id);
assert.strictEqual(replayView.room.selectedMap.id, "test-map");
assert.strictEqual(replayView.room.selectedMap.name, "蟹制地圖1");
assert.strictEqual(replayView.room.selectedMap.width, 10);
assert.strictEqual(replayView.room.selectedMap.height, 7);
assert.strictEqual(replayView.room.selectedMap.treasures.length, 23);

console.log("Gangsi lobby game tests passed");
