"use strict";

const assert = require("assert");
const {
  RECOMMENDED_DECKS,
  makeRoom,
  joinRoom,
  applyRoomAction,
  validateLobby
} = require("../game");

function createRoomWithPlayers(count = 4) {
  const { room, player: host } = makeRoom("Host", "WOLFCT");
  const players = [host];
  for (let index = 2; index <= count; index += 1) {
    const joined = joinRoom(room, `P${index}`);
    assert.ifError(joined.error);
    players.push(joined.player);
  }
  return { room, host, players };
}

function rollAndReady(room, players) {
  players.forEach((player) => {
    if (!player.roll) assert.ifError(applyRoomAction(room, player, "roll"));
    if (!player.ready) assert.ifError(applyRoomAction(room, player, "toggleReady"));
  });
}

function testHostSettingsResetReadyAndValidateCapacity() {
  const { room, host, players } = createRoomWithPlayers(4);
  rollAndReady(room, players);

  const nonHostError = applyRoomAction(room, players[1], "updateSettings", {
    playerCount: 5,
    discussionSeconds: 90,
    useRecommended: true
  });
  assert(nonHostError, "非房主不能修改準備房間設定");
  assert.strictEqual(room.settings.playerCount, 4);
  assert.deepStrictEqual(room.settings.deck, RECOMMENDED_DECKS[4]);

  assert.ifError(applyRoomAction(room, host, "updateSettings", {
    playerCount: 5,
    discussionSeconds: 999,
    useRecommended: true
  }));
  assert.strictEqual(room.settings.playerCount, 5);
  assert.strictEqual(room.settings.discussionSeconds, 900, "討論時間需被限制在上限內");
  assert.deepStrictEqual(room.settings.deck, RECOMMENDED_DECKS[5], "推薦牌庫需跟隨人數");
  assert.deepStrictEqual(room.players.map((player) => player.ready), [false, false, false, false]);

  const tooSmallError = applyRoomAction(room, host, "updateSettings", {
    playerCount: 3,
    discussionSeconds: 300,
    useRecommended: true
  });
  assert(tooSmallError, "不能把人數設定成小於目前房內玩家數");
  assert.strictEqual(room.settings.playerCount, 5);

  const fifth = joinRoom(room, "P5");
  assert.ifError(fifth.error);
  players.push(fifth.player);
  assert(validateLobby(room).errors.length > 0, "新增玩家後必須重新擲骰與準備");

  rollAndReady(room, players);
  assert.deepStrictEqual(validateLobby(room).errors, []);
}

function testLobbyJoinReconnectAndStartedRoomRestrictions() {
  const { room, host, players } = createRoomWithPlayers(3);

  assert.ifError(applyRoomAction(room, host, "updateSettings", {
    playerCount: 3,
    discussionSeconds: 300,
    useRecommended: true
  }));
  assert.strictEqual(room.settings.deck.length, 6, "一夜狼人牌庫數量應為玩家數 + 3");

  const fullJoin = joinRoom(room, "P4");
  assert(fullJoin.error, "滿房時不能新增玩家");
  assert.strictEqual(room.players.length, 3);

  const lobbyReconnect = joinRoom(room, "Ignored Name", players[1].id);
  assert.ifError(lobbyReconnect.error);
  assert.strictEqual(lobbyReconnect.player.id, players[1].id, "滿房時仍應允許既有玩家快速重連");
  assert.strictEqual(room.players.length, 3);

  rollAndReady(room, players);
  assert.ifError(applyRoomAction(room, host, "startGame"));
  assert.notStrictEqual(room.phase, "lobby");

  const lateJoin = joinRoom(room, "Late Player");
  assert(lateJoin.error, "遊戲開始後不能新增玩家");

  const startedReconnect = joinRoom(room, "Ignored Name", players[2].id);
  assert.ifError(startedReconnect.error);
  assert.strictEqual(startedReconnect.player.id, players[2].id, "遊戲開始後仍應允許既有玩家重連");
  assert.strictEqual(room.players.length, 3);
}

function testReturnLobbyClearsTransientRoomStateButKeepsPlayers() {
  const { room, host, players } = createRoomWithPlayers(4);
  rollAndReady(room, players);
  assert.ifError(applyRoomAction(room, host, "startGame"));
  assert.notStrictEqual(room.phase, "lobby");
  assert(Object.keys(room.initialCards).length > 0);
  assert(room.centerCards.length > 0);

  assert.ifError(applyRoomAction(room, players[1], "chat", { message: "準備下一局" }));
  room.log.push("測試記錄");
  room.votes[players[0].id] = players[1].id;
  room.phase = "result";
  room.result = { winnerTeams: ["village"], winningPlayerIds: [players[0].id] };

  assert.ifError(applyRoomAction(room, host, "returnLobby"));
  assert.strictEqual(room.phase, "lobby");
  assert.strictEqual(room.players.length, 4, "回到準備房間不應移除玩家");
  assert.deepStrictEqual(room.players.map((player) => [player.ready, player.roll, player.rollTie]), [
    [false, null, null],
    [false, null, null],
    [false, null, null],
    [false, null, null]
  ]);
  assert.deepStrictEqual(room.initialCards, {});
  assert.deepStrictEqual(room.cards, {});
  assert.deepStrictEqual(room.centerCards, []);
  assert.deepStrictEqual(room.privateInfo, {});
  assert.deepStrictEqual(room.effectiveRoles, {});
  assert.deepStrictEqual(room.votes, {});
  assert.deepStrictEqual(room.hunterShots, {});
  assert.strictEqual(room.pendingVoteResult, null);
  assert.strictEqual(room.result, null);
  assert.strictEqual(room.discussionEndsAt, null);
  assert.deepStrictEqual(room.chat, []);
  assert.deepStrictEqual(room.log, []);
}

function run() {
  testHostSettingsResetReadyAndValidateCapacity();
  testLobbyJoinReconnectAndStartedRoomRestrictions();
  testReturnLobbyClearsTransientRoomStateButKeepsPlayers();
  console.log("One Night Werewolf room contract tests passed");
}

run();
