const assert = require("assert");
const {
  makeRoom,
  joinRoom,
  applyRoomAction,
  makeView,
  validateLobby
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
  action(room, host, "setSettings", { playerCount: 5, roles: room.settings.roles, teamSizes: [2, 3, 2, 3, 3], leaderMode: "appoint" });
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

testRoomJoinAndRejoin();
testLobbySettingsReadyAndStart();
testIdentityInfo();
testVoteMissionAndLeaderRules();
testFailedVoteRotatesWithoutRetiringLeader();
testFiveRejectedVotesEvilWin();
testChatReactionsAssassinationAndReset();

console.log("game flow unit tests passed");
