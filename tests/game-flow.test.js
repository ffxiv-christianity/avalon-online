const assert = require("assert");
const {
  makeRoom,
  joinRoom,
  applyRoomAction,
  makeView,
  validateLobby,
  cleanupRooms,
  rooms,
  clients
} = require("../server");

function action(room, actor, name, payload = {}) {
  const error = applyRoomAction(room, actor, name, payload);
  assert.strictEqual(error, null, `${name} failed: ${error}`);
}

function expectError(room, actor, name, payload = {}, text) {
  const error = applyRoomAction(room, actor, name, payload);
  assert(error, `${name} should fail`);
  if (text) assert(error.includes(text), `expected "${error}" to include "${text}"`);
}

function makePlayers(count = 5) {
  const { room, player: host } = makeRoom("P1");
  const players = [host];
  for (let index = 2; index <= count; index += 1) {
    players.push(joinRoom(room.code, `P${index}`).player);
  }
  room.settings.playerCount = count;
  room.settings.teamSizes = count === 4 ? [2, 2, 2, 3, 3] : [2, 3, 2, 3, 3];
  return { room, players, host };
}

function testEmptyRoomCleanup() {
  const { room } = makeRoom("Cleanup");
  room.emptySince = Date.now() - (31 * 60 * 1000);
  room.expiresAt = room.emptySince + (30 * 60 * 1000);
  room.players.forEach((player) => {
    player.online = false;
  });
  cleanupRooms();
  assert(!rooms.has(room.code), "empty room should be cleaned after 30 minutes");

  const { room: activeRoom, player } = makeRoom("Active");
  activeRoom.emptySince = Date.now() - (31 * 60 * 1000);
  activeRoom.expiresAt = activeRoom.emptySince + (30 * 60 * 1000);
  const fakeClient = {
    roomCode: activeRoom.code,
    playerId: player.id,
    lastSeen: Date.now(),
    socket: { destroyed: false, write() {} }
  };
  clients.add(fakeClient);
  cleanupRooms();
  clients.delete(fakeClient);
  assert(rooms.has(activeRoom.code), "room with an online player should not be cleaned");
  rooms.delete(activeRoom.code);
}

function setManualGame(room, players, roles) {
  players.forEach((player, index) => {
    const role = roles[index];
    player.role = role;
    player.side = ["merlin", "percival", "servant"].includes(role) ? "good" : "evil";
    player.roll = 100 - index;
    player.ready = false;
    player.online = true;
  });
  room.phase = "team";
  room.round = 0;
  room.leaderIndex = 0;
  room.rejectedVotes = 0;
  room.retiredLeaderIds = [];
  room.selectedTeam = [];
  room.votes = {};
  room.missionCards = {};
  room.missionResults = [];
  room.selectedExcaliburHolderId = null;
  room.activeExcaliburHolderId = null;
  room.excaliburTargetId = null;
  room.usedExcaliburHolderIds = [];
  room.ladyHolderId = null;
  room.ladyUsedIds = [];
  room.pendingLakeResult = null;
  room.revealed = {};
  room.winner = null;
  room.gameStatsRecorded = false;
  room.lastAssassination = null;
  room.currentGame = { missionCounts: {}, mordredThreeAwarded: {} };
}

function voteAll(room, players, vote) {
  players.forEach((player) => action(room, player, "castVote", { vote }));
}

function submitSuccessfulMission(room, team) {
  team.forEach((player) => action(room, player, "submitMission", { card: "success" }));
}

function proposeAndApprove(room, players, leader, team) {
  room.selectedTeam = [];
  team.forEach((player) => action(room, leader, "toggleTeam", { playerId: player.id }));
  action(room, leader, "submitTeam");
  voteAll(room, players, "approve");
  action(room, leader, "continueVote");
}

function testRoomJoinAndRejoin() {
  const { room, player: host } = makeRoom("Louis");
  assert.strictEqual(room.players.length, 1);
  assert.strictEqual(room.hostId, host.id);
  assert(joinRoom(room.code, "louis").error.includes("名字"));

  const a = joinRoom(room.code, "A").player;
  joinRoom(room.code, "B");
  joinRoom(room.code, "C");
  joinRoom(room.code, "D");
  assert(joinRoom(room.code, "E").error.includes("滿"));
  assert.strictEqual(joinRoom(room.code, "", a.id).player.id, a.id);

  room.phase = "team";
  assert(joinRoom(room.code, "Late").error.includes("遊戲已開始"));
  assert.strictEqual(joinRoom(room.code, "", a.id).player.id, a.id);
}

function testLobbySettingsReadyAndStart() {
  const { room, players, host } = makePlayers(5);
  expectError(room, players[1], "setSettings", { playerCount: 4 }, "房主");
  action(room, host, "setSettings", {
    playerCount: 5,
    roles: room.settings.roles,
    teamSizes: [2, 3, 2, 3, 3],
    leaderMode: "appoint",
    expansions: { excalibur: false, excaliburUnique: false, ladyOfLake: true }
  });
  expectError(room, host, "startGame", {}, "擲 d100");

  players.forEach((player) => {
    action(room, player, "roll");
    expectError(room, player, "roll", {}, "已經擲過");
    action(room, player, "setReady", { ready: true });
  });
  assert.strictEqual(validateLobby(room).errors.length, 0);
  expectError(room, players[1], "startGame", {}, "房主");
  action(room, host, "startGame");
  assert.strictEqual(room.phase, "reveal");
  assert.strictEqual(room.players[0].roll, Math.max(...room.players.map((player) => player.roll)));
  assert.strictEqual(makeView(room, host.id).room.leaderId, room.players[0].id);
  assert.strictEqual(room.ladyHolderId, room.players[1].id, "Lady of the Lake should start on the second-highest d100 roll");
}

function testLadyInitialHolderUsesSecondHighestRoll() {
  const { room, players, host } = makePlayers(5);
  action(room, host, "setSettings", {
    playerCount: 5,
    roles: room.settings.roles,
    teamSizes: [2, 3, 2, 3, 3],
    leaderMode: "appoint",
    expansions: { excalibur: false, excaliburUnique: false, ladyOfLake: true }
  });
  [1, 99, 2, 100, 3].forEach((roll, index) => {
    players[index].roll = roll;
    players[index].tieBreak = 0;
    players[index].ready = true;
  });

  action(room, host, "startGame");
  assert.strictEqual(room.players[0].roll, 100);
  assert.strictEqual(room.players[1].roll, 99);
  assert.strictEqual(room.ladyHolderId, players[1].id, "Lady of the Lake must not go to the lowest d100 roll");
}

function testIdentityInfo() {
  const { room, players } = makePlayers(4);
  room.settings.playerCount = 4;
  setManualGame(room, players, ["merlin", "servant", "servant", "assassin"]);
  room.phase = "reveal";
  const merlinInfo = makeView(room, players[0].id).you.privateInfo.join("");
  assert(merlinInfo.includes("四人局特殊規則"));
  assert(merlinInfo.includes(players[1].name));
  assert(!merlinInfo.includes(players[3].name), "4-player Merlin should not see evil player");

  const { room: evilRoom, players: evilPlayers } = makePlayers(5);
  setManualGame(evilRoom, evilPlayers, ["merlin", "servant", "assassin", "morgana", "oberon"]);
  evilRoom.phase = "reveal";
  const assassinInfo = makeView(evilRoom, evilPlayers[2].id).you.privateInfo.join("");
  assert(assassinInfo.includes(evilPlayers[3].name));
  assert(!assassinInfo.includes(evilPlayers[4].name), "evil players should not know Oberon");
}

function testVoteMissionAndLeaderRules() {
  const { room, players } = makePlayers(5);
  setManualGame(room, players, ["merlin", "servant", "servant", "assassin", "morgana"]);
  const leader = players[0];
  const team = [players[0], players[1]];

  expectError(room, players[1], "toggleTeam", { playerId: players[1].id }, "領袖");
  team.forEach((player) => action(room, leader, "toggleTeam", { playerId: player.id }));
  action(room, leader, "submitTeam");
  assert.strictEqual(room.phase, "vote");

  voteAll(room, players, "approve");
  assert.strictEqual(room.phase, "voteResult");
  const voteResult = makeView(room, players[2].id).room.voteResult;
  assert.strictEqual(voteResult.votes.length, 5);
  assert.strictEqual(voteResult.votes[0].vote, "approve");
  expectError(room, players[1], "continueVote", {}, "領袖");
  action(room, leader, "continueVote");
  assert.strictEqual(room.phase, "mission");
  assert.deepStrictEqual(room.retiredLeaderIds, []);

  expectError(room, players[2], "submitMission", { card: "success" }, "任務成員");
  submitSuccessfulMission(room, team);
  assert.strictEqual(room.phase, "missionResult");
  assert.strictEqual(room.missionResults.at(-1).result, "success");
  assert.strictEqual(room.missionResults.at(-1).fails, 0);
  expectError(room, players[1], "continueMission", {}, "領袖");
  action(room, leader, "continueMission");
  assert.strictEqual(room.phase, "appointLeader");
  assert(room.retiredLeaderIds.includes(leader.id), "leader retires only after completed mission");
}

function testFailedVoteRotatesWithoutRetiringLeader() {
  const { room, players } = makePlayers(5);
  setManualGame(room, players, ["merlin", "servant", "servant", "assassin", "morgana"]);
  const leader = players[0];
  action(room, leader, "toggleTeam", { playerId: players[0].id });
  action(room, leader, "toggleTeam", { playerId: players[1].id });
  action(room, leader, "submitTeam");
  voteAll(room, players, "reject");
  action(room, leader, "continueVote");
  assert.strictEqual(room.phase, "team");
  assert.strictEqual(room.leaderIndex, 1);
  assert(!room.retiredLeaderIds.includes(leader.id));
}

function testFiveRejectedVotesEvilWin() {
  const { room, players } = makePlayers(5);
  setManualGame(room, players, ["merlin", "servant", "servant", "assassin", "morgana"]);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const leader = room.players[room.leaderIndex];
    room.selectedTeam = [];
    action(room, leader, "toggleTeam", { playerId: players[0].id });
    action(room, leader, "toggleTeam", { playerId: players[1].id });
    action(room, leader, "submitTeam");
    voteAll(room, players, "reject");
    action(room, leader, "continueVote");
  }
  assert.strictEqual(room.phase, "gameOver");
  assert.strictEqual(room.winner.side, "evil");
}

function testChatReactionsAssassinationAndReset() {
  const { room, players, host } = makePlayers(5);
  setManualGame(room, players, ["merlin", "servant", "percival", "assassin", "morgana"]);
  action(room, players[1], "sendChat", { text: "123" });
  assert.strictEqual(makeView(room, host.id).room.chat.at(-1).text, "123");

  room.phase = "voteResult";
  room.voteResult = { approve: 3, reject: 2, passed: true, votes: {} };
  const reactionKey = makeView(room, host.id).room.reactionEvent.key;
  action(room, players[1], "react", { eventKey: reactionKey, reactionId: "like" });
  let reaction = makeView(room, players[1].id).room.reactionEvent.reactions.find((item) => item.id === "like");
  assert.strictEqual(reaction.count, 1);
  assert.strictEqual(reaction.active, true);
  action(room, players[1], "react", { eventKey: reactionKey, reactionId: "like" });
  reaction = makeView(room, players[1].id).room.reactionEvent.reactions.find((item) => item.id === "like");
  assert.strictEqual(reaction.count, 0);

  room.phase = "assassination";
  action(room, players[3], "assassinate", { playerId: players[0].id });
  assert.strictEqual(room.phase, "gameOver");
  assert.strictEqual(room.winner.side, "evil");
  assert.strictEqual(makeView(room, host.id).room.players.find((player) => player.id === players[0].id).role, "merlin");

  expectError(room, players[1], "resetRoom", {}, "房主");
  action(room, host, "resetRoom");
  assert.strictEqual(room.phase, "lobby");
  assert.strictEqual(room.chat.length, 0);
  assert(room.players.every((player) => player.roll === null && player.role === null));
}

function testExcaliburExpansion() {
  const { room, players } = makePlayers(5);
  room.settings.expansions = { excalibur: true, excaliburUnique: true, ladyOfLake: false };
  setManualGame(room, players, ["merlin", "servant", "servant", "assassin", "morgana"]);
  const leader = players[0];
  const evilOnTeam = players[3];

  action(room, leader, "toggleTeam", { playerId: leader.id });
  action(room, leader, "toggleTeam", { playerId: evilOnTeam.id });
  expectError(room, players[1], "setExcaliburHolder", { playerId: evilOnTeam.id }, "領袖");
  action(room, leader, "setExcaliburHolder", { playerId: evilOnTeam.id });
  assert.strictEqual(makeView(room, leader.id).room.players.find((player) => player.id === evilOnTeam.id).excaliburHolder, true);
  action(room, leader, "submitTeam");
  voteAll(room, players, "approve");
  action(room, leader, "continueVote");
  assert.strictEqual(room.phase, "mission");
  assert(room.usedExcaliburHolderIds.includes(evilOnTeam.id));

  action(room, leader, "submitMission", { card: "success" });
  action(room, evilOnTeam, "submitMission", { card: "fail" });
  assert.strictEqual(room.phase, "excalibur");
  expectError(room, leader, "useExcalibur", { playerId: evilOnTeam.id }, "王者之劍持有者");
  action(room, evilOnTeam, "useExcalibur", { playerId: evilOnTeam.id });
  assert.strictEqual(room.phase, "missionResult");
  assert.strictEqual(room.missionResults.at(-1).result, "success");
  assert.strictEqual(room.missionResults.at(-1).fails, 0);
  assert.strictEqual(room.missionResults.at(-1).excalibur.targetId, evilOnTeam.id);
  assert.strictEqual(room.missionResults.at(-1).excalibur.used, true);

  room.phase = "team";
  room.selectedTeam = [evilOnTeam.id];
  expectError(room, leader, "setExcaliburHolder", { playerId: evilOnTeam.id }, "已持有");

  const { room: skipRoom, players: skipPlayers } = makePlayers(5);
  skipRoom.settings.expansions = { excalibur: true, excaliburUnique: false, ladyOfLake: false };
  setManualGame(skipRoom, skipPlayers, ["merlin", "servant", "servant", "assassin", "morgana"]);
  const skipLeader = skipPlayers[0];
  const skipHolder = skipPlayers[3];
  action(skipRoom, skipLeader, "toggleTeam", { playerId: skipLeader.id });
  action(skipRoom, skipLeader, "toggleTeam", { playerId: skipHolder.id });
  action(skipRoom, skipLeader, "setExcaliburHolder", { playerId: skipHolder.id });
  action(skipRoom, skipLeader, "submitTeam");
  voteAll(skipRoom, skipPlayers, "approve");
  action(skipRoom, skipLeader, "continueVote");
  action(skipRoom, skipLeader, "submitMission", { card: "success" });
  action(skipRoom, skipHolder, "submitMission", { card: "fail" });
  assert.strictEqual(skipRoom.phase, "excalibur");
  action(skipRoom, skipHolder, "useExcalibur", { skip: true });
  assert.strictEqual(skipRoom.phase, "missionResult");
  assert.strictEqual(skipRoom.missionResults.at(-1).result, "fail");
  assert.strictEqual(skipRoom.missionResults.at(-1).fails, 1);
  assert.deepStrictEqual(skipRoom.missionResults.at(-1).excalibur, {
    holderId: skipHolder.id,
    targetId: null,
    used: false
  });
  assert(skipRoom.log.some((entry) => entry.includes("但沒有發動")));

  const { room: failedRoom, players: failedPlayers } = makePlayers(5);
  failedRoom.settings.expansions = { excalibur: true, excaliburUnique: true, ladyOfLake: false };
  setManualGame(failedRoom, failedPlayers, ["merlin", "servant", "servant", "assassin", "morgana"]);
  const failedLeader = failedPlayers[0];
  action(failedRoom, failedLeader, "toggleTeam", { playerId: failedPlayers[1].id });
  action(failedRoom, failedLeader, "toggleTeam", { playerId: failedPlayers[2].id });
  action(failedRoom, failedLeader, "setExcaliburHolder", { playerId: failedPlayers[1].id });
  action(failedRoom, failedLeader, "submitTeam");
  voteAll(failedRoom, failedPlayers, "reject");
  action(failedRoom, failedLeader, "continueVote");
  assert(!failedRoom.usedExcaliburHolderIds.includes(failedPlayers[1].id), "failed vote should not consume Excalibur holder");
}

function completeApprovedSuccessRound(room, players, team) {
  const leader = room.players[room.leaderIndex];
  proposeAndApprove(room, players, leader, team);
  submitSuccessfulMission(room, team);
  assert.strictEqual(room.phase, "missionResult");
  action(room, leader, "continueMission");
}

function testLadyOfLakeExpansion() {
  const { room, players } = makePlayers(5);
  room.settings.leaderMode = "standard";
  room.settings.expansions = { excalibur: false, excaliburUnique: false, ladyOfLake: true };
  setManualGame(room, players, ["merlin", "servant", "servant", "assassin", "morgana"]);
  room.ladyHolderId = players[4].id;
  room.ladyUsedIds = [players[4].id];

  completeApprovedSuccessRound(room, players, [players[0], players[1]]);
  assert.strictEqual(room.phase, "team");
  assert.strictEqual(room.round, 1);

  completeApprovedSuccessRound(room, players, [players[1], players[2], players[3]]);
  assert.strictEqual(room.phase, "lake");
  assert.strictEqual(makeView(room, players[0].id).room.players.find((player) => player.id === players[4].id).ladyHolder, true);
  expectError(room, players[0], "inspectWithLady", { playerId: players[2].id }, "湖中女神");
  action(room, players[4], "inspectWithLady", { playerId: players[2].id });
  assert.strictEqual(room.phase, "lakeResult");
  assert(makeView(room, players[4].id).room.lakeResultText.includes(`你查驗 ${players[2].name} 是正義方`));
  assert.strictEqual(makeView(room, players[0].id).room.lakeResultText, null);
  expectError(room, players[0], "confirmLakeResult", {}, "湖中女神");
  action(room, players[4], "confirmLakeResult");
  assert.strictEqual(room.phase, "team");
  assert.strictEqual(room.round, 2);
  assert.strictEqual(room.ladyHolderId, players[2].id);
  assert(room.ladyUsedIds.includes(players[2].id));
  room.phase = "lake";
  assert(makeView(room, players[2].id).room.lakeCandidateIds.includes(players[4].id));
  action(room, players[2], "inspectWithLady", { playerId: players[4].id });
  assert.strictEqual(room.phase, "lakeResult");
  assert(makeView(room, players[2].id).room.lakeResultText.includes(`你查驗 ${players[4].name} 是邪惡方`));
  assert.strictEqual(room.ladyHolderId, players[0].id, "used target should pass Lady to next unused player by d100 order");
  assert(room.ladyUsedIds.includes(players[0].id));
  action(room, players[2], "confirmLakeResult");
  assert.strictEqual(room.phase, "team");
  assert.strictEqual(room.round, 3);
}

testRoomJoinAndRejoin();
testEmptyRoomCleanup();
testLobbySettingsReadyAndStart();
testLadyInitialHolderUsesSecondHighestRoll();
testIdentityInfo();
testVoteMissionAndLeaderRules();
testFailedVoteRotatesWithoutRetiringLeader();
testFiveRejectedVotesEvilWin();
testChatReactionsAssassinationAndReset();
testExcaliburExpansion();
testLadyOfLakeExpansion();

console.log("game flow unit tests passed");
