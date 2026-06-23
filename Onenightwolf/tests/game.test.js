"use strict";

const assert = require("assert");
const {
  ROLE_DEFS,
  RECOMMENDED_DECKS,
  makeRoom,
  joinRoom,
  applyRoomAction,
  makeView,
  validateLobby,
  advanceTimedNight,
  NIGHT_ORDER,
  finishVote
} = require("../game");

function setup(count = 4) {
  const { room, player: host } = makeRoom("P1", "TEST01");
  room.settings.playerCount = count;
  room.settings.deck = [...RECOMMENDED_DECKS[count]];
  const players = [host];
  for (let index = 2; index <= count; index += 1) {
    players.push(joinRoom(room, `P${index}`).player);
  }
  players.forEach((player, index) => {
    player.roll = 100 - index;
    player.rollTie = index;
    player.ready = true;
  });
  return { room, host, players };
}

function setNightStage(room, role, actorIds) {
  room.phase = "night";
  room.nightStage = { role, actorIds, completedIds: [], delayUntil: null };
}

function testRecommendedDecks() {
  for (let count = 3; count <= 10; count += 1) {
    assert.strictEqual(RECOMMENDED_DECKS[count].length, count + 3);
    RECOMMENDED_DECKS[count].forEach((role) => assert(ROLE_DEFS[role], `unknown role ${role}`));
  }
}

function testMasonsMustBePaired() {
  const { room } = setup(4);
  room.settings.deck = ["werewolf", "seer", "robber", "troublemaker", "drunk", "mason", "villager"];
  assert(validateLobby(room).errors.some((message) => message.includes("守夜人")));
}

function testRollRequiredAndOrdersPlayers() {
  const { room, players } = setup(4);
  players[0].roll = null;
  players[0].ready = false;
  assert.strictEqual(applyRoomAction(room, players[0], "toggleReady"), "請先擲 d100");
  assert.strictEqual(applyRoomAction(room, players[0], "roll"), null);
  assert(players[0].roll >= 1 && players[0].roll <= 100);
  assert.strictEqual(applyRoomAction(room, players[0], "roll"), "每局只能擲一次");

  players[0].roll = 12;
  players[1].roll = 91;
  players[2].roll = 37;
  players[3].roll = 50;
  const view = makeView(room, players[0].id);
  assert.deepStrictEqual(view.room.players.map((player) => player.id), [
    players[1].id,
    players[3].id,
    players[2].id,
    players[0].id
  ]);
}

function testHostTransferAndKickOfflinePlayer() {
  const { room, host, players } = setup(4);
  assert(applyRoomAction(room, players[1], "transferHost", { playerId: players[2].id }).includes("只有房主"));
  assert.strictEqual(applyRoomAction(room, host, "transferHost", { playerId: players[1].id }), null);
  assert.strictEqual(room.hostId, players[1].id);
  assert(room.log.at(-1).includes("轉移給"));

  assert(applyRoomAction(room, players[1], "kickOfflinePlayer", { playerId: players[2].id }).includes("離線"));
  players[2].online = false;
  assert.strictEqual(applyRoomAction(room, players[1], "kickOfflinePlayer", { playerId: players[2].id }), null);
  assert(!room.players.some((player) => player.id === players[2].id));
  assert(room.players.every((player) => !player.ready));

  room.phase = "night";
  players[3].online = false;
  assert(applyRoomAction(room, players[1], "kickOfflinePlayer", { playerId: players[3].id }).includes("準備房間"));
}

function testDoppelgangerCopiesAndActsImmediately() {
  const { room, players } = setup(4);
  room.phase = "night";
  room.initialCards = {
    [players[0].id]: "doppelganger",
    [players[1].id]: "seer",
    [players[2].id]: "werewolf",
    [players[3].id]: "villager"
  };
  room.cards = { ...room.initialCards };
  room.centerCards = ["robber", "drunk", "werewolf"];
  room.privateInfo = Object.fromEntries(players.map((player) => [player.id, []]));
  room.effectiveRoles = { ...room.initialCards };
  setNightStage(room, "doppelganger", [players[0].id]);
  assert.strictEqual(applyRoomAction(room, players[0], "nightAction", { targetId: players[1].id }), null);
  assert.strictEqual(room.doppelCopiedRole, "seer");
  assert.strictEqual(room.doppelPendingRole, players[0].id);
  assert.strictEqual(room.nightStage.completedIds.length, 0);
  assert.strictEqual(applyRoomAction(room, players[0], "nightAction", { mode: "center", centerIndexes: [0, 1] }), null);
  assert(room.privateInfo[players[0].id].some((message) => message.includes("中央第 1 張")));
}

function testDoppelgangerNightOrderByCopiedRole() {
  const { room, players } = setup(4);
  room.phase = "night";
  room.initialCards = {
    [players[0].id]: "doppelganger",
    [players[1].id]: "werewolf",
    [players[2].id]: "mason",
    [players[3].id]: "insomniac"
  };
  room.cards = { ...room.initialCards };
  room.centerCards = ["seer", "robber", "villager"];
  room.privateInfo = Object.fromEntries(players.map((player) => [player.id, []]));
  room.effectiveRoles = { ...room.initialCards };
  room.settings.deck = ["doppelganger", "werewolf", "mason", "mason", "insomniac", "seer", "villager"];
  room.nightRoleIndex = NIGHT_ORDER.indexOf("doppelganger");
  setNightStage(room, "doppelganger", [players[0].id]);
  assert.strictEqual(applyRoomAction(room, players[0], "nightAction", { targetId: players[1].id }), null);
  assert.strictEqual(room.nightStage.role, "werewolf");
  assert.deepStrictEqual(new Set(room.nightStage.actorIds), new Set([players[0].id, players[1].id]));
}

function testDoppelgangerMinionAndInsomniacOrder() {
  const { room, players } = setup(4);
  room.phase = "night";
  room.initialCards = {
    [players[0].id]: "doppelganger",
    [players[1].id]: "minion",
    [players[2].id]: "werewolf",
    [players[3].id]: "insomniac"
  };
  room.cards = { ...room.initialCards };
  room.centerCards = ["seer", "robber", "villager"];
  room.privateInfo = Object.fromEntries(players.map((player) => [player.id, []]));
  room.effectiveRoles = { ...room.initialCards };
  room.settings.deck = ["doppelganger", "werewolf", "minion", "insomniac", "seer", "robber", "villager"];
  room.nightRoleIndex = NIGHT_ORDER.indexOf("doppelganger");
  setNightStage(room, "doppelganger", [players[0].id]);
  assert.strictEqual(applyRoomAction(room, players[0], "nightAction", { targetId: players[1].id }), null);
  assert(room.privateInfo[players[0].id].some((message) => message.includes("狼人是")));
  assert.strictEqual(room.nightStage.role, "werewolf");

  room.nightRoleIndex = NIGHT_ORDER.indexOf("doppelganger");
  setNightStage(room, "doppelganger", [players[0].id]);
  room.privateInfo[players[0].id] = [];
  assert.strictEqual(applyRoomAction(room, players[0], "nightAction", { targetId: players[3].id }), null);
  assert.strictEqual(room.doppelCopiedRole, "insomniac");
  assert(NIGHT_ORDER.indexOf("doppelInsomniac") > NIGHT_ORDER.indexOf("insomniac"));
}

function testMasonRecognition() {
  const { room, players } = setup(4);
  room.phase = "night";
  room.initialCards = {
    [players[0].id]: "mason",
    [players[1].id]: "mason",
    [players[2].id]: "werewolf",
    [players[3].id]: "villager"
  };
  room.cards = { ...room.initialCards };
  room.privateInfo = Object.fromEntries(players.map((player) => [player.id, []]));
  room.effectiveRoles = { ...room.initialCards };
  setNightStage(room, "mason", [players[0].id]);
  assert.strictEqual(applyRoomAction(room, players[0], "nightAction"), null);
  assert(room.privateInfo[players[0].id][0].includes(players[1].name));
}

function testStartAndPrivateView() {
  const { room, host, players } = setup(4);
  assert.strictEqual(applyRoomAction(room, host, "startGame"), null);
  assert.strictEqual(room.phase, "reveal");
  assert.strictEqual(Object.keys(room.cards).length, 4);
  assert.strictEqual(room.centerCards.length, 3);
  const view = makeView(room, players[0].id);
  assert(view.you.initialRole);
  assert(!view.room.players.some((player) => Object.hasOwn(player, "role")), "roles must remain private");
  players.forEach((player) => {
    assert.strictEqual(applyRoomAction(room, player, "confirmReveal"), null);
  });
  assert.strictEqual(room.phase, "night");
  assert(!room.chat.some((entry) => entry.message.includes("夜晚開始")));
  assert(room.log.some((entry) => entry.includes("夜晚開始")));
}

function testCenterRoleDelayAndMissingRoleSkip() {
  const { room, players } = setup(4);
  room.phase = "night";
  room.settings.deck = ["werewolf", "seer", "robber", "troublemaker", "drunk", "villager", "villager"];
  room.initialCards = {
    [players[0].id]: "werewolf",
    [players[1].id]: "robber",
    [players[2].id]: "troublemaker",
    [players[3].id]: "drunk"
  };
  room.effectiveRoles = { ...room.initialCards };
  room.nightRoleIndex = NIGHT_ORDER.indexOf("seer");
  room.nightStage = {
    role: "seer",
    actorIds: [],
    completedIds: [],
    delayUntil: Date.now() + 6000
  };
  assert.strictEqual(advanceTimedNight(room, Date.now() + 4000), false);
  assert.strictEqual(advanceTimedNight(room, Date.now() + 7000), true);
  assert.strictEqual(room.nightStage.role, "robber");
}

function testSameRolePlayersActInOneStage() {
  const { room, players } = setup(4);
  room.phase = "night";
  room.settings.deck = ["werewolf", "werewolf", "seer", "robber", "troublemaker", "villager", "villager"];
  room.initialCards = {
    [players[0].id]: "werewolf",
    [players[1].id]: "werewolf",
    [players[2].id]: "robber",
    [players[3].id]: "troublemaker"
  };
  room.cards = { ...room.initialCards };
  room.centerCards = ["seer", "robber", "villager"];
  room.effectiveRoles = { ...room.initialCards };
  room.privateInfo = Object.fromEntries(players.map((player) => [player.id, []]));
  room.nightRoleIndex = NIGHT_ORDER.indexOf("werewolf");
  setNightStage(room, "werewolf", [players[0].id, players[1].id]);
  assert.strictEqual(applyRoomAction(room, players[0], "nightAction"), null);
  assert.strictEqual(room.nightStage.role, "werewolf");
  assert.strictEqual(room.nightStage.completedIds.length, 1);
  assert.strictEqual(applyRoomAction(room, players[1], "nightAction"), null);
  assert.notStrictEqual(room.nightStage.role, "werewolf");
}

function testWerewolfContextsAndRules() {
  const { room, players } = setup(4);
  room.phase = "night";
  room.initialCards = {
    [players[0].id]: "werewolf",
    [players[1].id]: "werewolf",
    [players[2].id]: "seer",
    [players[3].id]: "villager"
  };
  room.cards = { ...room.initialCards };
  room.centerCards = ["seer", "robber", "villager"];
  room.effectiveRoles = { ...room.initialCards };
  room.privateInfo = Object.fromEntries(players.map((player) => [player.id, []]));
  setNightStage(room, "werewolf", [players[0].id, players[1].id]);
  let view = makeView(room, players[0].id);
  assert.strictEqual(view.you.nightContext.loneWerewolf, false);
  assert.deepStrictEqual(view.you.nightContext.teammates.map((player) => player.id), [players[1].id]);
  assert.strictEqual(applyRoomAction(room, players[0], "nightAction", { centerIndex: 1 }), null);
  assert(room.privateInfo[players[0].id][0].includes(players[1].name));
  assert(!room.privateInfo[players[0].id][0].includes("中央"), "多名狼人只能相認，不得取得中央牌資訊");

  room.effectiveRoles[players[1].id] = "villager";
  room.initialCards[players[1].id] = "villager";
  room.privateInfo[players[0].id] = [];
  setNightStage(room, "werewolf", [players[0].id]);
  view = makeView(room, players[0].id);
  assert.strictEqual(view.you.nightContext.loneWerewolf, true);
  assert.strictEqual(view.you.nightContext.teammates.length, 0);
  assert(applyRoomAction(room, players[0], "nightAction", {}).includes("唯一的狼人"));
  assert.strictEqual(applyRoomAction(room, players[0], "nightAction", { centerIndex: 1 }), null);
  assert(room.privateInfo[players[0].id][0].includes("中央第 2 張"));
}

function testMinionMasonAndPrivateContexts() {
  const { room, players } = setup(4);
  room.phase = "night";
  room.initialCards = {
    [players[0].id]: "minion",
    [players[1].id]: "werewolf",
    [players[2].id]: "mason",
    [players[3].id]: "mason"
  };
  room.cards = { ...room.initialCards };
  room.effectiveRoles = { ...room.initialCards };
  room.privateInfo = Object.fromEntries(players.map((player) => [player.id, []]));
  setNightStage(room, "minion", [players[0].id]);
  assert.deepStrictEqual(makeView(room, players[0].id).you.nightContext.werewolves.map((player) => player.id), [players[1].id]);
  assert.strictEqual(makeView(room, players[1].id).you.nightContext, null);
  assert.strictEqual(applyRoomAction(room, players[0], "nightAction"), null);

  setNightStage(room, "mason", [players[2].id, players[3].id]);
  assert.deepStrictEqual(makeView(room, players[2].id).you.nightContext.masons.map((player) => player.id), [players[3].id]);
  assert.deepStrictEqual(makeView(room, players[3].id).you.nightContext.masons.map((player) => player.id), [players[2].id]);
}

function testNightActionValidationMatrix() {
  const { room, players } = setup(4);
  room.phase = "night";
  room.initialCards = {
    [players[0].id]: "seer",
    [players[1].id]: "robber",
    [players[2].id]: "troublemaker",
    [players[3].id]: "drunk"
  };
  room.cards = { ...room.initialCards };
  room.effectiveRoles = { ...room.initialCards };
  room.centerCards = ["werewolf", "villager", "insomniac"];
  room.privateInfo = Object.fromEntries(players.map((player) => [player.id, []]));

  setNightStage(room, "seer", [players[0].id]);
  assert(applyRoomAction(room, players[0], "nightAction", { mode: "center", centerIndexes: [0] }));
  assert(applyRoomAction(room, players[0], "nightAction", { mode: "player", targetId: players[0].id }));
  assert.strictEqual(applyRoomAction(room, players[0], "nightAction", { mode: "center", centerIndexes: [0, 1] }), null);

  setNightStage(room, "robber", [players[1].id]);
  assert(applyRoomAction(room, players[1], "nightAction", {}));
  assert.strictEqual(applyRoomAction(room, players[1], "nightAction", { skip: true }), null);

  setNightStage(room, "troublemaker", [players[2].id]);
  assert(applyRoomAction(room, players[2], "nightAction", { targetIds: [players[0].id] }));
  assert.strictEqual(applyRoomAction(room, players[2], "nightAction", { skip: true }), null);

  setNightStage(room, "drunk", [players[3].id]);
  assert(applyRoomAction(room, players[3], "nightAction", { centerIndex: 5 }));
  assert.strictEqual(applyRoomAction(room, players[3], "nightAction", { centerIndex: 2 }), null);
}

function testJoinEventsForUnreadRoster() {
  const { room, player: host } = makeRoom("P1", "JOIN01");
  assert.deepStrictEqual(room.playerJoinEvents, [{ serial: 1, playerId: host.id }]);
  const joined = joinRoom(room, "P2").player;
  assert.deepStrictEqual(room.playerJoinEvents.at(-1), { serial: 2, playerId: joined.id });
  joinRoom(room, "", joined.id);
  assert.strictEqual(room.playerJoinEvents.length, 2);
}

function testTenPlayerFullRoomAndAllRolesFlow() {
  const { room, player: host } = makeRoom("P1", "FULL10");
  room.settings.playerCount = 10;
  room.settings.deck = [
    "doppelganger", "werewolf", "minion", "mason", "mason", "seer", "robber",
    "troublemaker", "drunk", "insomniac", "villager", "tanner", "hunter"
  ];
  const players = [host];
  for (let index = 2; index <= 10; index += 1) {
    const joined = joinRoom(room, `P${index}`);
    assert(joined.player);
    players.push(joined.player);
  }
  assert.strictEqual(joinRoom(room, "P11").error, "房間人數已滿");
  players.forEach((player, index) => {
    player.roll = 100 - index;
    player.rollTie = index;
    player.ready = true;
  });
  assert.strictEqual(validateLobby(room).errors.length, 0);
  assert.strictEqual(applyRoomAction(room, host, "startGame"), null);
  assert.strictEqual(room.phase, "reveal");
  players.forEach((player) => assert.strictEqual(applyRoomAction(room, player, "confirmReveal"), null));

  let guard = 0;
  while (room.phase === "night" && guard < 100) {
    guard += 1;
    const stage = room.nightStage;
    if (stage.delayUntil) {
      assert.strictEqual(advanceTimedNight(room, stage.delayUntil + 1), true);
      continue;
    }
    for (const playerId of [...stage.actorIds]) {
      if (stage.completedIds.includes(playerId)) continue;
      const actor = room.players.find((player) => player.id === playerId);
      let role = stage.role === "doppelInsomniac" ? "insomniac" : stage.role;
      if (stage.role === "doppelganger" && room.doppelPendingRole === playerId) role = room.doppelCopiedRole;
      let payload = {};
      if (role === "doppelganger") {
        const preferred = room.players.find((player) => player.id !== playerId && room.initialCards[player.id] === "villager")
          || room.players.find((player) => player.id !== playerId);
        payload = { targetId: preferred.id };
      } else if (role === "werewolf") {
        payload = { centerIndex: 0 };
      } else if (role === "seer") {
        payload = { mode: "center", centerIndexes: [0, 1] };
      } else if (role === "robber" || role === "troublemaker") {
        payload = { skip: true };
      } else if (role === "drunk") {
        payload = { centerIndex: 0 };
      }
      assert.strictEqual(applyRoomAction(room, actor, "nightAction", payload), null);
      if (stage.role === "doppelganger" && room.doppelPendingRole === playerId) {
        const copied = room.doppelCopiedRole;
        const copiedPayload = copied === "seer"
          ? { mode: "center", centerIndexes: [0, 1] }
          : copied === "robber" || copied === "troublemaker"
            ? { skip: true }
            : copied === "drunk"
              ? { centerIndex: 0 }
              : {};
        assert.strictEqual(applyRoomAction(room, actor, "nightAction", copiedPayload), null);
      }
    }
  }
  assert(guard < 100, "all-role night should complete");
  assert.strictEqual(room.phase, "discussion");
  const voteTarget = room.players[0].id;
  room.players.forEach((player) => {
    const targetId = player.id === voteTarget ? room.players[1].id : voteTarget;
    assert.strictEqual(applyRoomAction(room, player, "vote", { targetId }), null);
  });
  if (room.phase === "hunter") {
    while (room.phase === "hunter") {
      const hunter = room.players.find((player) => player.id === room.pendingHunterIds[0]);
      const target = room.players.find((player) => player.id !== hunter.id);
      assert.strictEqual(applyRoomAction(room, hunter, "hunterShot", { targetId: target.id }), null);
    }
  }
  assert.strictEqual(room.phase, "result");
  assert.strictEqual(room.result.finalCards, undefined);
  assert.strictEqual(makeView(room, host.id).room.result.finalCards.length, 10);
}

function testCustomAndRecommendedDeckSettings() {
  const { room, host } = setup(4);
  const customDeck = ["werewolf", "seer", "robber", "troublemaker", "drunk", "insomniac", "villager"];
  assert.strictEqual(applyRoomAction(room, host, "updateSettings", {
    playerCount: 4,
    discussionSeconds: 420,
    deck: customDeck
  }), null);
  assert.deepStrictEqual(room.settings.deck, customDeck);
  assert.strictEqual(room.settings.discussionSeconds, 420);
  assert.strictEqual(applyRoomAction(room, host, "updateSettings", {
    playerCount: 5,
    discussionSeconds: 600,
    deck: ["werewolf", "werewolf", "werewolf"]
  }), "牌庫包含無效角色或超過角色上限");
  assert.strictEqual(room.settings.playerCount, 4);
  assert.strictEqual(room.settings.discussionSeconds, 420);
  assert.strictEqual(applyRoomAction(room, host, "updateSettings", {
    playerCount: 4,
    discussionSeconds: 300,
    useRecommended: true
  }), null);
  assert.deepStrictEqual(room.settings.deck, RECOMMENDED_DECKS[4]);
}

function testLobbyValidation() {
  const { room, players } = setup(4);
  room.settings.deck = ["werewolf"];
  let validation = validateLobby(room);
  assert(validation.errors.some((message) => message.includes("牌庫需要 7 張")));
  room.settings.deck = [...RECOMMENDED_DECKS[4]];
  players[0].ready = false;
  validation = validateLobby(room);
  assert(validation.errors.some((message) => message.includes("所有玩家")));
  players[0].ready = true;
  assert.strictEqual(validateLobby(room).errors.length, 0);
}

function testRobberSwap() {
  const { room, players } = setup(4);
  room.phase = "night";
  room.initialCards = {
    [players[0].id]: "robber",
    [players[1].id]: "werewolf",
    [players[2].id]: "seer",
    [players[3].id]: "villager"
  };
  room.cards = { ...room.initialCards };
  room.centerCards = ["troublemaker", "drunk", "werewolf"];
  room.privateInfo = Object.fromEntries(players.map((player) => [player.id, []]));
  setNightStage(room, "robber", [players[0].id]);
  assert.strictEqual(applyRoomAction(room, players[0], "nightAction", { targetId: players[1].id }), null);
  assert.strictEqual(room.cards[players[0].id], "werewolf");
  assert.strictEqual(room.cards[players[1].id], "robber");
  assert(room.privateInfo[players[0].id][0].includes("狼人"));
}

function testTroublemakerThenInsomniac() {
  const { room, players } = setup(4);
  room.phase = "night";
  room.initialCards = {
    [players[0].id]: "troublemaker",
    [players[1].id]: "insomniac",
    [players[2].id]: "werewolf",
    [players[3].id]: "villager"
  };
  room.cards = { ...room.initialCards };
  room.centerCards = ["seer", "robber", "werewolf"];
  room.privateInfo = Object.fromEntries(players.map((player) => [player.id, []]));
  setNightStage(room, "troublemaker", [players[0].id]);
  assert.strictEqual(applyRoomAction(room, players[0], "nightAction", { targetIds: [players[1].id, players[2].id] }), null);
  setNightStage(room, "insomniac", [players[1].id]);
  assert.strictEqual(applyRoomAction(room, players[1], "nightAction"), null);
  assert(room.privateInfo[players[1].id][0].includes("狼人"));
}

function testVoteResolution() {
  const { room, players } = setup(4);
  room.phase = "discussion";
  room.cards = {
    [players[0].id]: "werewolf",
    [players[1].id]: "seer",
    [players[2].id]: "robber",
    [players[3].id]: "villager"
  };
  room.votes = {
    [players[0].id]: players[1].id,
    [players[1].id]: players[0].id,
    [players[2].id]: players[0].id,
    [players[3].id]: players[0].id
  };
  finishVote(room);
  assert.strictEqual(room.phase, "result");
  assert.strictEqual(room.result.winner, "village");
}

function testVoteAndWinConditionMatrix() {
  const scenarios = [
    { name: "有狼人但狼人未死亡", roles: ["werewolf", "minion", "seer", "villager"], eliminated: [2], teams: ["werewolf"] },
    { name: "有狼人且狼人死亡", roles: ["werewolf", "minion", "seer", "villager"], eliminated: [0], teams: ["village"] },
    { name: "無狼人與爪牙且無人死亡", roles: ["seer", "robber", "troublemaker", "villager"], eliminated: [], teams: ["everyone"] },
    { name: "無狼人與爪牙但有人死亡", roles: ["seer", "robber", "troublemaker", "villager"], eliminated: [1], teams: ["none"] },
    { name: "只有爪牙且非爪牙死亡", roles: ["minion", "seer", "robber", "villager"], eliminated: [1], teams: ["werewolf"] },
    { name: "只有爪牙且爪牙死亡", roles: ["minion", "seer", "robber", "villager"], eliminated: [0], teams: ["village"] },
    { name: "只有爪牙且無人死亡", roles: ["minion", "seer", "robber", "villager"], eliminated: [], teams: ["village"] },
    { name: "皮匠死亡但狼人未死", roles: ["tanner", "werewolf", "seer", "villager"], eliminated: [0], teams: ["tanner"] },
    { name: "皮匠與狼人同時死亡", roles: ["tanner", "werewolf", "seer", "villager"], eliminated: [0, 1], teams: ["tanner", "village"] },
    { name: "沒有狼人且皮匠死亡", roles: ["tanner", "seer", "robber", "villager"], eliminated: [0], teams: ["tanner"] }
  ];

  scenarios.forEach((scenario) => {
    const { room, players } = setup(4);
    room.phase = "discussion";
    room.cards = Object.fromEntries(players.map((player, index) => [player.id, scenario.roles[index]]));
    const targets = scenario.eliminated.map((index) => players[index].id);
    if (!targets.length) {
      room.votes = Object.fromEntries(players.map((player, index) => [player.id, players[(index + 1) % players.length].id]));
    } else if (targets.length === 1) {
      room.votes = Object.fromEntries(players.map((player) => [player.id, targets[0]]));
    } else {
      room.votes = {
        [players[0].id]: targets[0],
        [players[1].id]: targets[0],
        [players[2].id]: targets[1],
        [players[3].id]: targets[1]
      };
    }
    finishVote(room);
    assert.deepStrictEqual(room.result.winnerTeams, scenario.teams, scenario.name);
  });
}

function testCannotVoteForSelf() {
  const { room, players } = setup(4);
  room.phase = "discussion";
  assert(applyRoomAction(room, players[0], "vote", { targetId: players[0].id }));
  assert.strictEqual(room.votes[players[0].id], undefined);
  assert.strictEqual(applyRoomAction(room, players[0], "vote", { targetId: players[1].id }), null);
  assert(applyRoomAction(room, players[0], "vote", { targetId: players[2].id }).includes("不能更改"));
  assert.strictEqual(room.votes[players[0].id], players[1].id);
}

function testHunterTakesVotedPlayerDown() {
  const { room, players } = setup(4);
  room.phase = "discussion";
  room.cards = {
    [players[0].id]: "hunter",
    [players[1].id]: "werewolf",
    [players[2].id]: "seer",
    [players[3].id]: "villager"
  };
  room.votes = {
    [players[0].id]: players[1].id,
    [players[1].id]: players[0].id,
    [players[2].id]: players[0].id,
    [players[3].id]: players[0].id
  };
  finishVote(room);
  assert.strictEqual(room.phase, "hunter");
  assert.strictEqual(room.pendingHunterIds[0], players[0].id);
  assert.strictEqual(applyRoomAction(room, players[0], "hunterShot", { targetId: players[1].id }), null);
  assert(room.result.eliminatedIds.includes(players[0].id));
  assert(room.result.eliminatedIds.includes(players[1].id));
  assert(room.result.winnerTeams.includes("village"));
}

function testTannerAndVillageCanBothWin() {
  const { room, players } = setup(4);
  room.phase = "discussion";
  room.cards = {
    [players[0].id]: "tanner",
    [players[1].id]: "werewolf",
    [players[2].id]: "seer",
    [players[3].id]: "villager"
  };
  room.votes = {
    [players[0].id]: players[1].id,
    [players[1].id]: players[0].id,
    [players[2].id]: players[0].id,
    [players[3].id]: players[1].id
  };
  finishVote(room);
  assert.deepStrictEqual(room.result.eliminatedIds.sort(), [players[0].id, players[1].id].sort());
  assert(room.result.winnerTeams.includes("tanner"));
  assert(room.result.winnerTeams.includes("village"));
}

function testNoWolfNoMinionOutcomes() {
  const { room, players } = setup(4);
  room.phase = "discussion";
  room.cards = {
    [players[0].id]: "villager",
    [players[1].id]: "seer",
    [players[2].id]: "robber",
    [players[3].id]: "hunter"
  };
  room.votes = {
    [players[0].id]: players[1].id,
    [players[1].id]: players[2].id,
    [players[2].id]: players[3].id,
    [players[3].id]: players[0].id
  };
  finishVote(room);
  assert.deepStrictEqual(room.result.winnerTeams, ["everyone"]);
}

function testMinionWithoutWerewolf() {
  const { room, players } = setup(4);
  room.phase = "discussion";
  room.cards = {
    [players[0].id]: "minion",
    [players[1].id]: "seer",
    [players[2].id]: "robber",
    [players[3].id]: "villager"
  };
  room.votes = {
    [players[0].id]: players[1].id,
    [players[1].id]: players[1].id,
    [players[2].id]: players[1].id,
    [players[3].id]: players[0].id
  };
  finishVote(room);
  assert.deepStrictEqual(room.result.winnerTeams, ["werewolf"]);

  room.phase = "discussion";
  room.votes = {
    [players[0].id]: players[0].id,
    [players[1].id]: players[0].id,
    [players[2].id]: players[0].id,
    [players[3].id]: players[1].id
  };
  finishVote(room);
  assert.deepStrictEqual(room.result.winnerTeams, ["village"]);
}

function testTannerWinsAloneWithoutWerewolf() {
  const { room, players } = setup(4);
  room.phase = "discussion";
  room.cards = {
    [players[0].id]: "tanner",
    [players[1].id]: "seer",
    [players[2].id]: "robber",
    [players[3].id]: "villager"
  };
  room.votes = {
    [players[0].id]: players[1].id,
    [players[1].id]: players[0].id,
    [players[2].id]: players[0].id,
    [players[3].id]: players[0].id
  };
  finishVote(room);
  assert.deepStrictEqual(room.result.winnerTeams, ["tanner"]);
  assert.deepStrictEqual(room.result.winningPlayerIds, [players[0].id]);
}

function testMovedDoppelgangerKeepsCopiedRole() {
  const { room, players } = setup(4);
  room.phase = "discussion";
  room.doppelCopiedRole = "tanner";
  room.cards = {
    [players[0].id]: "seer",
    [players[1].id]: "doppelganger",
    [players[2].id]: "robber",
    [players[3].id]: "villager"
  };
  room.votes = {
    [players[0].id]: players[1].id,
    [players[1].id]: players[0].id,
    [players[2].id]: players[1].id,
    [players[3].id]: players[1].id
  };
  finishVote(room);
  assert.deepStrictEqual(room.result.winnerTeams, ["tanner"]);
  assert.deepStrictEqual(room.result.winningPlayerIds, [players[1].id]);
}

function testReloadRequiresExplicitRejoinData() {
  const { room, players } = setup(4);
  const rejoined = joinRoom(room, "", players[1].id);
  assert.strictEqual(rejoined.player.id, players[1].id);
  assert(joinRoom(room, "", "missing").error);
}

function testNightOrderViewStatesAndDoppelInsomniacMapping() {
  const { room, players } = setup(4);
  room.phase = "night";
  room.settings.deck = [
    "doppelganger",
    "werewolf",
    "seer",
    "robber",
    "troublemaker",
    "insomniac",
    "villager"
  ];
  room.nightStage = {
    role: "seer",
    actorIds: [players[0].id],
    completedIds: [],
    delayUntil: null
  };

  let order = makeView(room, players[0].id).room.night.order;
  assert.deepStrictEqual(order.map((step) => step.role), NIGHT_ORDER.filter((role) => role !== "doppelInsomniac"));
  assert.strictEqual(order.length, 9);
  assert.strictEqual(order.find((step) => step.role === "doppelganger").state, "done");
  assert.strictEqual(order.find((step) => step.role === "werewolf").state, "done");
  assert.strictEqual(order.find((step) => step.role === "minion").state, "disabled");
  assert.strictEqual(order.find((step) => step.role === "seer").state, "active");
  assert.strictEqual(order.find((step) => step.role === "robber").state, "upcoming");

  room.nightStage.role = "doppelInsomniac";
  order = makeView(room, players[0].id).room.night.order;
  assert.strictEqual(order.find((step) => step.role === "insomniac").state, "active");
  assert(!order.some((step) => step.role === "doppelInsomniac"));
}

testRecommendedDecks();
testStartAndPrivateView();
testCenterRoleDelayAndMissingRoleSkip();
testSameRolePlayersActInOneStage();
testWerewolfContextsAndRules();
testMinionMasonAndPrivateContexts();
testNightActionValidationMatrix();
testJoinEventsForUnreadRoster();
testTenPlayerFullRoomAndAllRolesFlow();
testCustomAndRecommendedDeckSettings();
testLobbyValidation();
testMasonsMustBePaired();
testRollRequiredAndOrdersPlayers();
testHostTransferAndKickOfflinePlayer();
testDoppelgangerCopiesAndActsImmediately();
testDoppelgangerNightOrderByCopiedRole();
testDoppelgangerMinionAndInsomniacOrder();
testMasonRecognition();
testRobberSwap();
testTroublemakerThenInsomniac();
testVoteResolution();
testVoteAndWinConditionMatrix();
testCannotVoteForSelf();
testHunterTakesVotedPlayerDown();
testTannerAndVillageCanBothWin();
testNoWolfNoMinionOutcomes();
testMinionWithoutWerewolf();
testTannerWinsAloneWithoutWerewolf();
testMovedDoppelgangerKeepsCopiedRole();
testReloadRequiresExplicitRejoinData();
testNightOrderViewStatesAndDoppelInsomniacMapping();
console.log("onenightwolf game tests passed");
