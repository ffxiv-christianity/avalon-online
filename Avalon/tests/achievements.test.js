const assert = require("assert");
const {
  ACHIEVEMENT_THRESHOLDS,
  makeRoom,
  joinRoom,
  applyRoomAction,
  makeView
} = require("../server");

function setupRoom() {
  const { room, player: merlin } = makeRoom("Merlin");
  const assassin = joinRoom(room.code, "Assassin").player;
  const percival = joinRoom(room.code, "Percival").player;
  const morgana = joinRoom(room.code, "Morgana").player;
  const servant = joinRoom(room.code, "Servant").player;

  setRole(merlin, "merlin", "good");
  setRole(assassin, "assassin", "evil");
  setRole(percival, "percival", "good");
  setRole(morgana, "morgana", "evil");
  setRole(servant, "servant", "good");

  room.players.forEach((player, index) => {
    player.roll = 50 + index;
    player.ready = false;
  });
  room.currentGame = { missionCounts: {}, mordredThreeAwarded: {} };
  return { room, merlin, assassin, percival, morgana, servant };
}

function setRole(player, role, side) {
  player.role = role;
  player.side = side;
}

function achievementIds(room, viewerId, playerId) {
  return makeView(room, viewerId)
    .room.players.find((player) => player.id === playerId)
    .achievements.map((achievement) => achievement.id);
}

function achievementDetails(room, viewerId, playerId) {
  return makeView(room, viewerId)
    .room.players.find((player) => player.id === playerId)
    .achievements;
}

function achievementById(room, viewerId, playerId, id) {
  return achievementDetails(room, viewerId, playerId).find((achievement) => achievement.id === id);
}

function assertHas(room, viewerId, playerId, id) {
  assert(
    achievementIds(room, viewerId, playerId).includes(id),
    `expected ${id}`
  );
}

function assertNotHas(room, viewerId, playerId, id) {
  assert(
    !achievementIds(room, viewerId, playerId).includes(id),
    `did not expect ${id}`
  );
}

function assassinate(room, assassin, target) {
  room.phase = "assassination";
  room.gameStatsRecorded = false;
  const error = applyRoomAction(room, assassin, "assassinate", { playerId: target.id });
  assert.strictEqual(error, null);
}

function approveTeam(room, leader, team) {
  room.phase = "voteResult";
  room.voteResult = { approve: room.players.length, reject: 0, passed: true, votes: {} };
  room.resultReadyAt = Date.now() - 1;
  room.selectedTeam = team.map((player) => player.id);
  const leaderIndex = room.players.findIndex((player) => player.id === leader.id);
  assert.notStrictEqual(leaderIndex, -1);
  room.leaderIndex = leaderIndex;
  const error = applyRoomAction(room, leader, "continueVote", {});
  assert.strictEqual(error, null);
}

function completeMission(room, team) {
  assert.strictEqual(room.phase, "mission");
  team.forEach((player) => {
    const error = applyRoomAction(room, player, "submitMission", { card: "success" });
    assert.strictEqual(error, null);
  });
  assert.strictEqual(room.phase, "missionResult");
}

function completeApprovedTeam(room, leader, team) {
  approveTeam(room, leader, team);
  completeMission(room, team);
}

function testDiceAchievements() {
  const { room, merlin, assassin } = setupRoom();
  merlin.roll = 95;
  assassin.roll = 5;
  assertHas(room, merlin.id, merlin.id, "dice-god");
  assertHas(room, merlin.id, assassin.id, "fate-joke");
  assert.strictEqual(achievementById(room, merlin.id, merlin.id, "dice-god").count, 1);

  merlin.roll = 94;
  assassin.roll = 6;
  assertNotHas(room, merlin.id, merlin.id, "dice-god");
  assertNotHas(room, merlin.id, assassin.id, "fate-joke");
}

function testDiceAchievementAfterRollAction() {
  const { room, merlin } = setupRoom();
  merlin.roll = null;
  const error = applyRoomAction(room, merlin, "roll", {});
  assert.strictEqual(error, null);
  assert(Number.isInteger(merlin.roll) && merlin.roll >= 1 && merlin.roll <= 100);
}

function testGoodWinAndMerlinThresholds() {
  const { room, merlin, assassin, percival } = setupRoom();
  for (let wins = 1; wins <= ACHIEVEMENT_THRESHOLDS.goodWins; wins += 1) {
    assassinate(room, assassin, percival);
    if (wins >= ACHIEVEMENT_THRESHOLDS.merlinGoodWins) {
      assertHas(room, merlin.id, merlin.id, "hidden-mirror");
    } else {
      assertNotHas(room, merlin.id, merlin.id, "hidden-mirror");
    }
    if (wins >= ACHIEVEMENT_THRESHOLDS.goodWins) {
      assertHas(room, merlin.id, merlin.id, "good-light");
    } else {
      assertNotHas(room, merlin.id, merlin.id, "good-light");
    }
  }

  assertHas(room, merlin.id, merlin.id, "good-light");
  assert.strictEqual(achievementById(room, merlin.id, merlin.id, "good-light").count, ACHIEVEMENT_THRESHOLDS.goodWins);
  assert(achievementById(room, merlin.id, merlin.id, "good-light").detail.includes(`${ACHIEVEMENT_THRESHOLDS.goodWins} 次解鎖`));
  assertHas(room, merlin.id, merlin.id, "hidden-mirror");
  assert.strictEqual(achievementById(room, merlin.id, merlin.id, "hidden-mirror").count, ACHIEVEMENT_THRESHOLDS.goodWins);
  assert(
    achievementById(room, merlin.id, merlin.id, "hidden-mirror").priority > achievementById(room, merlin.id, merlin.id, "good-light").priority,
    "role achievements should outrank broad win achievements"
  );
}

function testAssassinAndEvilThresholds() {
  const { room, merlin, assassin, morgana } = setupRoom();
  const winsNeeded = Math.max(
    ACHIEVEMENT_THRESHOLDS.assassinHits,
    ACHIEVEMENT_THRESHOLDS.evilWins,
    ACHIEVEMENT_THRESHOLDS.morganaEvilWins
  );
  for (let wins = 1; wins <= winsNeeded; wins += 1) {
    assassinate(room, assassin, merlin);
    if (wins >= ACHIEVEMENT_THRESHOLDS.assassinHits) assertHas(room, assassin.id, assassin.id, "top-assassin");
    else assertNotHas(room, assassin.id, assassin.id, "top-assassin");
    if (wins >= ACHIEVEMENT_THRESHOLDS.evilWins) assertHas(room, assassin.id, assassin.id, "evil-king");
    else assertNotHas(room, assassin.id, assassin.id, "evil-king");
    if (wins >= ACHIEVEMENT_THRESHOLDS.morganaEvilWins) assertHas(room, assassin.id, morgana.id, "puppet-regime");
    else assertNotHas(room, assassin.id, morgana.id, "puppet-regime");
  }

  assertHas(room, assassin.id, assassin.id, "top-assassin");
  assertHas(room, assassin.id, assassin.id, "evil-king");
  assertHas(room, assassin.id, morgana.id, "puppet-regime");
}

function testAssassinMissAndTopStaff() {
  const { room, merlin, assassin, percival } = setupRoom();
  assassinate(room, assassin, percival);
  assertHas(room, merlin.id, percival.id, "top-staff");
  assert(achievementById(room, merlin.id, percival.id, "top-staff").detail.includes("1 次解鎖。目前共 1 次"));
  assertNotHas(room, merlin.id, assassin.id, "slipped-hand");

  assassinate(room, assassin, percival);
  assertHas(room, merlin.id, assassin.id, "slipped-hand");
}

function testServantStreak() {
  const { room, merlin, assassin, percival, servant } = setupRoom();
  assassinate(room, assassin, percival);
  assassinate(room, assassin, percival);
  assertNotHas(room, merlin.id, servant.id, "village-chief");

  assassinate(room, assassin, percival);
  assertHas(room, merlin.id, servant.id, "village-chief");

  setRole(servant, "percival", "good");
  assassinate(room, assassin, servant);
  assertHas(room, merlin.id, servant.id, "village-chief");
}

function testOberonThreshold() {
  const { room, merlin, assassin, morgana } = setupRoom();
  setRole(morgana, "oberon", "evil");
  assassinate(room, assassin, merlin);
  assassinate(room, assassin, merlin);
  assertNotHas(room, assassin.id, morgana.id, "what-am-i-doing");

  assassinate(room, assassin, merlin);
  assertHas(room, assassin.id, morgana.id, "what-am-i-doing");
}

function testMordredMissionAchievement() {
  const { room, merlin, morgana } = setupRoom();
  setRole(morgana, "mordred", "evil");
  room.currentGame = { missionCounts: {}, mordredThreeAwarded: {} };

  completeApprovedTeam(room, merlin, [morgana]);
  room.phase = "team";
  completeApprovedTeam(room, merlin, [morgana]);
  assertNotHas(room, merlin.id, morgana.id, "sorry-spy");

  room.phase = "team";
  completeApprovedTeam(room, merlin, [morgana]);
  assertHas(room, merlin.id, morgana.id, "sorry-spy");

  room.phase = "team";
  completeApprovedTeam(room, merlin, [morgana]);
  const detail = achievementDetails(room, merlin.id, morgana.id).find((item) => item.id === "sorry-spy").detail;
  assert(detail.includes("1 場"), "mordred achievement should be awarded once per game");
}

function testClearEyedLeaderThreshold() {
  const { room, merlin, percival, servant, morgana } = setupRoom();
  for (let index = 1; index < ACHIEVEMENT_THRESHOLDS.leaderGoodTeams; index += 1) {
    completeApprovedTeam(room, merlin, [merlin, percival]);
    room.phase = "team";
  }
  assertNotHas(room, merlin.id, merlin.id, "clear-eyed-leader");

  completeApprovedTeam(room, merlin, [servant, morgana]);
  room.phase = "team";
  assertNotHas(room, merlin.id, merlin.id, "clear-eyed-leader");

  approveTeam(room, merlin, [merlin, servant]);
  assertNotHas(room, merlin.id, merlin.id, "clear-eyed-leader");
  completeMission(room, [merlin, servant]);
  assertHas(room, merlin.id, merlin.id, "clear-eyed-leader");
  const detail = achievementDetails(room, merlin.id, merlin.id).find((item) => item.id === "clear-eyed-leader").detail;
  assert(detail.includes(`${ACHIEVEMENT_THRESHOLDS.leaderGoodTeams} 次`), "leader achievement should show the dynamic count");
}

testDiceAchievements();
testDiceAchievementAfterRollAction();
testGoodWinAndMerlinThresholds();
testAssassinAndEvilThresholds();
testAssassinMissAndTopStaff();
testServantStreak();
testOberonThreshold();
testMordredMissionAchievement();
testClearEyedLeaderThreshold();

console.log("achievement unit tests passed");
