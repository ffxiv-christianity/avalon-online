const assert = require("assert");

const {
  applyRoomAction,
  advanceTimedDiscussion,
  advanceTimedNight,
  joinRoom,
  makeRoom,
  makeView
} = require("../game");

const MAX_DECK = [
  "doppelganger",
  "werewolf",
  "werewolf",
  "minion",
  "mason",
  "mason",
  "seer",
  "robber",
  "troublemaker",
  "drunk",
  "insomniac",
  "tanner",
  "hunter"
];

function maxDeckLayout(doppelTargetRole = "seer") {
  const remaining = [...MAX_DECK];
  removeOne(remaining, "doppelganger");
  removeOne(remaining, doppelTargetRole);
  const playerRoles = ["doppelganger", doppelTargetRole, ...remaining.slice(0, 8)];
  const centerRoles = remaining.slice(8);
  assert.strictEqual(playerRoles.length, 10);
  assert.strictEqual(centerRoles.length, 3);
  assert.deepStrictEqual([...playerRoles, ...centerRoles].sort(), [...MAX_DECK].sort());
  return { playerRoles, centerRoles };
}

function doppelCopyLayout(doppelTargetRole) {
  if (doppelTargetRole !== "villager") return maxDeckLayout(doppelTargetRole);

  const playerRoles = [
    "doppelganger",
    "villager",
    "werewolf",
    "werewolf",
    "minion",
    "mason",
    "mason",
    "seer",
    "robber",
    "troublemaker"
  ];
  const centerRoles = ["drunk", "insomniac", "hunter"];
  assert.strictEqual(playerRoles.length, 10);
  assert.strictEqual(centerRoles.length, 3);
  return { playerRoles, centerRoles };
}

function removeOne(list, role) {
  const index = list.indexOf(role);
  assert.notStrictEqual(index, -1, `${role} must exist in max deck`);
  list.splice(index, 1);
}

function makeStartedMaxRoom(layout = maxDeckLayout()) {
  const { room, player: host } = makeRoom("P1", "MAXTST");
  room.settings.playerCount = 10;
  room.settings.discussionSeconds = 300;
  room.settings.deck = [...MAX_DECK];

  const players = [host];
  for (let index = 2; index <= 10; index += 1) {
    players.push(joinRoom(room, `P${index}`).player);
  }

  players.forEach((player, index) => {
    player.roll = index + 1;
    player.ready = true;
  });

  assert.strictEqual(applyRoomAction(room, host, "startGame"), null);
  assert.strictEqual(room.phase, "reveal");

  room.centerCards = [...layout.centerRoles];
  room.initialCards = {};
  room.cards = {};
  room.effectiveRoles = {};
  players.forEach((player, index) => {
    const role = layout.playerRoles[index];
    room.initialCards[player.id] = role;
    room.cards[player.id] = role;
    room.effectiveRoles[player.id] = role;
  });

  players.forEach((player) => {
    assert.strictEqual(applyRoomAction(room, player, "confirmReveal"), null);
  });
  assert.strictEqual(room.phase, "night");

  return { room, players };
}

function runNightToDiscussion(room, players, doppelTargetId = players[1].id) {
  const seenStages = [];
  let guard = 0;

  while (room.phase === "night" && guard < 80) {
    guard += 1;
    const stage = room.nightStage;
    assert(stage, "night phase must expose a current night stage");
    seenStages.push(stage.role);

    const actorId = stage.actorIds.find((id) => !stage.completedIds.includes(id));
    if (!actorId) {
      assert(stage.delayUntil, `${stage.role} without unfinished actors must be timer-controlled`);
      assert.strictEqual(advanceTimedNight(room, stage.delayUntil + 1), true);
      continue;
    }

    const actor = players.find((player) => player.id === actorId);
    const actingRole = stage.role === "doppelganger" && room.doppelPendingRole === actorId
      ? room.doppelCopiedRole
      : stage.role === "doppelInsomniac"
        ? "insomniac"
        : stage.role;

    assert.strictEqual(
      applyRoomAction(room, actor, "nightAction", payloadForRole(room, players, actor, actingRole, doppelTargetId)),
      null,
      `${actor.name} should complete ${stage.role}/${actingRole}`
    );
  }

  assert(guard < 80, "night flow should not loop forever");
  assert.strictEqual(room.phase, "discussion");
  return seenStages;
}

function payloadForRole(room, players, actor, role, doppelTargetId) {
  if (role === "doppelganger") return { targetId: doppelTargetId };
  if (role === "werewolf") {
    const otherWerewolf = players.find((player) => player.id !== actor.id && room.effectiveRoles[player.id] === "werewolf");
    return otherWerewolf ? {} : { centerIndex: 0 };
  }
  if (role === "minion" || role === "mason" || role === "insomniac" || role === "doppelInsomniac") return {};
  if (role === "seer") return { mode: "center", centerIndexes: [0, 1] };
  if (role === "robber") return { targetId: firstOther(players, actor.id).id };
  if (role === "troublemaker") {
    const targets = players.filter((player) => player.id !== actor.id).slice(0, 2);
    return { targetIds: targets.map((player) => player.id) };
  }
  if (role === "drunk") return { centerIndex: 0 };
  return {};
}

function firstOther(players, actorId) {
  return players.find((player) => player.id !== actorId);
}

function testMaxDeckNightOrderDiscussionTimerAndPrivateInfo() {
  const { room, players } = makeStartedMaxRoom(maxDeckLayout("seer"));
  const stages = runNightToDiscussion(room, players, players[1].id);

  assert.deepStrictEqual(
    [...new Set(stages)],
    ["doppelganger", "werewolf", "minion", "mason", "seer", "robber", "troublemaker", "drunk", "insomniac", "doppelInsomniac"]
  );

  const hostView = makeView(room, players[0].id);
  const otherView = makeView(room, players[1].id);
  assert(hostView.you.privateInfo, "viewer should receive their own private night information");
  assert(otherView.you.privateInfo, "each viewer should receive only their own private night information");
  assert(!JSON.stringify(hostView.room.players).includes(otherView.you.privateInfo));

  assert.strictEqual(advanceTimedDiscussion(room, room.discussionEndsAt + 1), true);
  assert.strictEqual(room.phase, "result");
  assert(room.result, "discussion timer should settle the game");
}

function testDoppelgangerCopiesEveryRoleDeterministically() {
  const copyRoles = ["werewolf", "minion", "mason", "seer", "robber", "troublemaker", "drunk", "insomniac", "villager", "tanner", "hunter"];

  copyRoles.forEach((role) => {
    const { room, players } = makeStartedMaxRoom(doppelCopyLayout(role));
    const stages = runNightToDiscussion(room, players, players[1].id);
    assert.strictEqual(room.doppelCopiedRole, role);
    assert.strictEqual(room.effectiveRoles[players[0].id], role);
    assert(stages.includes("doppelganger"), `${role}: doppelganger stage should run`);

    if (["seer", "robber", "troublemaker", "drunk"].includes(role)) {
      assert.strictEqual(stages[0], "doppelganger", `${role}: copied ability should happen immediately in doppelganger stage`);
      assert.strictEqual(stages[1], "doppelganger", `${role}: doppelganger should stay awake for the copied action`);
    }
    if (role === "minion") {
      assert.strictEqual(stages.filter((stage) => stage === "doppelganger").length, 1);
      assert.strictEqual(stages.includes("minion"), true, "real minion stage should still run for the real minion");
    }
    if (["villager", "tanner", "hunter"].includes(role)) {
      assert.strictEqual(stages.filter((stage) => stage === "doppelganger").length, 1, `${role}: no night action should be added`);
    }
    if (role === "insomniac") {
      assert(stages.includes("doppelInsomniac"), "doppelganger copied insomniac should check after the real insomniac stage");
    }
  });
}

function testHunterVoteTargetDiesAfterAllVotes() {
  const layout = maxDeckLayout("hunter");
  const { room, players } = makeStartedMaxRoom(layout);
  runNightToDiscussion(room, players, players[1].id);

  const hunter = players.find((player) => room.cards[player.id] === "hunter");
  assert(hunter, "night actions should leave one final hunter in play");
  const shotTarget = players.find((player) => player.id !== hunter.id);
  players.filter((player) => player.id !== hunter.id).forEach((player) => {
    assert.strictEqual(applyRoomAction(room, player, "vote", { targetId: hunter.id }), null);
  });
  assert.strictEqual(applyRoomAction(room, hunter, "vote", { targetId: shotTarget.id }), null);
  assert.strictEqual(room.phase, "result");
  assert(room.result.votedOutIds.includes(hunter.id));
  assert(room.result.eliminatedIds.includes(hunter.id));
  assert(room.result.eliminatedIds.includes(shotTarget.id));
}

function makeDiscussionRoomWithRoles(roles) {
  const { room, player: host } = makeRoom("P1", "HTEST");
  room.settings.playerCount = roles.length;
  room.settings.deck = [...roles, "villager", "villager", "villager"];
  const players = [host];
  for (let index = 2; index <= roles.length; index += 1) {
    players.push(joinRoom(room, `P${index}`).player);
  }
  room.phase = "discussion";
  room.discussionEndsAt = Date.now() + 300000;
  room.votes = {};
  room.result = null;
  room.centerCards = ["villager", "villager", "villager"];
  room.initialCards = {};
  room.cards = {};
  room.effectiveRoles = {};
  players.forEach((player, index) => {
    room.initialCards[player.id] = roles[index];
    room.cards[player.id] = roles[index];
    room.effectiveRoles[player.id] = roles[index];
  });
  return { room, players };
}

function playerNames(players, ids = []) {
  return ids.map((id) => players.find((player) => player.id === id)?.name || id);
}

function testHunterVotesChainToAnotherHunterBeforeResult() {
  const { room, players } = makeDiscussionRoomWithRoles(["hunter", "hunter", "werewolf", "villager"]);

  assert.strictEqual(applyRoomAction(room, players[1], "vote", { targetId: players[2].id }), null);
  assert.strictEqual(applyRoomAction(room, players[2], "vote", { targetId: players[0].id }), null);
  assert.strictEqual(applyRoomAction(room, players[3], "vote", { targetId: players[0].id }), null);
  assert.strictEqual(applyRoomAction(room, players[0], "vote", { targetId: players[1].id }), null);
  assert.strictEqual(room.phase, "result");
  assert.deepStrictEqual(playerNames(players, room.result.eliminatedIds), ["P1", "P2", "P3"]);
}

function testDoppelgangerHunterVotesChainToRealHunterBeforeResult() {
  const { room, players } = makeDiscussionRoomWithRoles(["doppelganger", "hunter", "werewolf", "villager"]);
  room.doppelCopiedRole = "hunter";
  room.effectiveRoles[players[0].id] = "hunter";

  assert.strictEqual(applyRoomAction(room, players[1], "vote", { targetId: players[2].id }), null);
  assert.strictEqual(applyRoomAction(room, players[2], "vote", { targetId: players[0].id }), null);
  assert.strictEqual(applyRoomAction(room, players[3], "vote", { targetId: players[0].id }), null);
  assert.strictEqual(applyRoomAction(room, players[0], "vote", { targetId: players[1].id }), null);
  assert.strictEqual(room.phase, "result");
  assert.deepStrictEqual(playerNames(players, room.result.eliminatedIds), ["P1", "P2", "P3"]);
}

function testJoiningPlayerResetsAllReady() {
  const { room, player: host } = makeRoom("P1", "READYJ");
  room.settings.playerCount = 4;
  const p2 = joinRoom(room, "P2").player;
  [host, p2].forEach((player, index) => {
    player.roll = index + 1;
    player.ready = true;
  });

  const p3 = joinRoom(room, "P3").player;
  assert(p3);
  assert.deepStrictEqual(room.players.map((player) => player.ready), [false, false, false]);
}

function testHostSettingsResetAllReady() {
  const { room, player: host } = makeRoom("P1", "READYS");
  room.settings.playerCount = 3;
  const players = [host, joinRoom(room, "P2").player, joinRoom(room, "P3").player];
  players.forEach((player, index) => {
    player.roll = index + 1;
    player.ready = true;
  });

  assert.strictEqual(applyRoomAction(room, host, "updateSettings", {
    playerCount: 3,
    discussionSeconds: 420,
    deck: ["werewolf", "seer", "robber", "villager", "villager", "villager"]
  }), null);
  assert.deepStrictEqual(room.players.map((player) => player.ready), [false, false, false]);
}

function testCenterOnlyRoleUsesFakeTimedNightAction() {
  const { room, player: host } = makeRoom("P1", "DELAY");
  room.settings.playerCount = 3;
  room.settings.deck = ["werewolf", "seer", "robber", "villager", "villager", "villager"];
  const players = [host, joinRoom(room, "P2").player, joinRoom(room, "P3").player];
  players.forEach((player, index) => {
    player.roll = index + 1;
    player.ready = true;
  });
  assert.strictEqual(applyRoomAction(room, host, "startGame"), null);

  const roles = ["werewolf", "seer", "villager"];
  room.initialCards = {};
  room.cards = {};
  room.effectiveRoles = {};
  players.forEach((player, index) => {
    room.initialCards[player.id] = roles[index];
    room.cards[player.id] = roles[index];
    room.effectiveRoles[player.id] = roles[index];
  });
  room.centerCards = ["robber", "villager", "villager"];
  players.forEach((player) => assert.strictEqual(applyRoomAction(room, player, "confirmReveal"), null));

  assert.strictEqual(applyRoomAction(room, players[0], "nightAction", { centerIndex: 0 }), null);
  assert.strictEqual(applyRoomAction(room, players[1], "nightAction", { mode: "player", targetId: players[0].id }), null);
  assert.strictEqual(room.nightStage.role, "robber");
  assert.deepStrictEqual(room.nightStage.actorIds, []);
  assert(room.nightStage.delayUntil > Date.now(), "center-only enabled role should wait with a fake action delay");
  assert(room.nightStage.delayUntil - Date.now() >= 3000);
  assert(room.nightStage.delayUntil - Date.now() <= 12000);
}

testMaxDeckNightOrderDiscussionTimerAndPrivateInfo();
testDoppelgangerCopiesEveryRoleDeterministically();
testHunterVoteTargetDiesAfterAllVotes();
testHunterVotesChainToAnotherHunterBeforeResult();
testDoppelgangerHunterVotesChainToRealHunterBeforeResult();
testJoiningPlayerResetsAllReady();
testHostSettingsResetAllReady();
testCenterOnlyRoleUsesFakeTimedNightAction();

console.log("onenightwolf max deck tests passed");
