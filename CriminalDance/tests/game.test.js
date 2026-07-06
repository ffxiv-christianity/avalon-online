"use strict";

const assert = require("assert");
const {
  CARD_DEFS,
  BASE_DECK_COUNTS,
  REQUIRED_COUNTS,
  makeRoom,
  joinRoom,
  applyRoomAction,
  makeView,
  buildDeck,
  expansionAdjustedCounts,
  leftPlayer,
  rightPlayer
} = require("../game");

function setup(count = 4) {
  const { room, player: host } = makeRoom("P1", "CRIM01");
  room.settings.playerCount = count;
  const players = [host];
  for (let index = 2; index <= count; index += 1) {
    players.push(joinRoom(room, `P${index}`).player);
  }
  players.forEach((player, index) => {
    player.roll = 100 - index;
    player.rollTie = 1000 - index;
    player.ready = true;
  });
  return { room, host, players };
}

function startPrepared(count = 4) {
  const data = setup(count);
  assert.strictEqual(applyRoomAction(data.room, data.host, "startGame"), null);
  return data;
}

function forceTurn(room, player) {
  room.phase = "playing";
  room.currentPlayerId = player.id;
  room.startingPlayerId = player.id;
  room.turnNumber = 1;
}

function setHands(room, hands) {
  room.players.forEach((player, index) => {
    player.hand = [...hands[index]];
    player.tableCards = [];
    player.publicCards = [];
    player.actionInfo = null;
    player.openingConfirmed = false;
  });
}

function testDeckCounts() {
  const required = {
    3: ["first_discoverer", "culprit", "detective", "alibi"],
    4: ["first_discoverer", "culprit", "detective", "alibi", "accomplice"],
    5: ["first_discoverer", "culprit", "detective", "alibi", "alibi", "accomplice"],
    6: ["first_discoverer", "culprit", "detective", "detective", "alibi", "alibi", "accomplice", "accomplice"],
    7: ["first_discoverer", "culprit", "detective", "detective", "alibi", "alibi", "alibi", "accomplice", "accomplice"]
  };
  for (let count = 3; count <= 8; count += 1) {
    const deck = buildDeck(count);
    assert.strictEqual(deck.length, count * 4);
    if (required[count]) {
      required[count].forEach((card) => assert(deck.includes(card), `${count}p deck missing ${card}`));
    }
  }
  assert.strictEqual(Object.values(BASE_DECK_COUNTS).reduce((sum, value) => sum + value, 0), 32);
  assert.strictEqual(expansionAdjustedCounts({ inspector: true }).dog, 0);
  assert.strictEqual(expansionAdjustedCounts({ inspector: true }).inspector, 1);
  assert.strictEqual(expansionAdjustedCounts({ boy: true }).witness, 2);
  assert.strictEqual(expansionAdjustedCounts({ boy: true }).boy, 1);
  assert(Object.values(CARD_DEFS).every((card) => card.name));
}

function testStartGameShuffleDealAndViews() {
  const expansionCases = [
    { inspector: false, boy: false },
    { inspector: true, boy: false },
    { inspector: false, boy: true },
    { inspector: true, boy: true }
  ];
  for (let count = 3; count <= 8; count += 1) {
    expansionCases.forEach((expansions) => {
      const { room, host } = setup(count);
      room.settings.expansions = { ...expansions };
      assert.strictEqual(applyRoomAction(room, host, "startGame"), null);
      assert.strictEqual(room.phase, "playing");
      assert.strictEqual(room.deckList.length, count * 4);
      assert(room.players.every((player) => player.hand.length === 4), `${count}p should deal 4 cards each`);
      assert(room.players.some((player) => player.hand.includes("first_discoverer")), `${count}p deck should deal first discoverer`);
      const starter = room.players.find((player) => player.hand.includes("first_discoverer"));
      assert.strictEqual(room.startingPlayerId, starter.id);
      assert.strictEqual(room.currentPlayerId, starter.id);
      assert.deepStrictEqual(room.players.map((player) => player.seat), [...Array(count).keys()]);

      const deckCounts = countByCard(room.deckList);
      Object.entries(REQUIRED_COUNTS[count] || {}).forEach(([card, requiredCount]) => {
        assert(deckCounts[card] >= requiredCount, `${count}p deck missing required ${card}`);
      });
      if (count === 8 && expansions.inspector) {
        assert.strictEqual(deckCounts.dog || 0, 0);
        assert.strictEqual(deckCounts.inspector || 0, 1);
      }
      if (count === 8 && expansions.boy) {
        assert.strictEqual(deckCounts.witness || 0, 2);
        assert.strictEqual(deckCounts.boy || 0, 1);
      }

      room.players.forEach((player) => {
        const view = makeView(room, player.id);
        assert.strictEqual(view.you.hand.length, 4);
        assert.strictEqual(view.room.deckList.length, count * 4);
        assert(view.room.players.every((publicPlayer) => Number.isInteger(publicPlayer.handCount)));
        assert(!view.room.players.some((publicPlayer) => Object.hasOwn(publicPlayer, "hand")));
      });

      const boyHolder = room.players.find((player) => player.hand.includes("boy"));
      if (boyHolder) {
        const boyView = makeView(room, boyHolder.id);
        assert(boyView.you.openingInfo.clues.some((clue) => clue.message.includes("遊戲開始時，犯人牌在")));
      }
    });
  }
}

function countByCard(cards) {
  return cards.reduce((counts, card) => {
    counts[card] = (counts[card] || 0) + 1;
    return counts;
  }, {});
}

function testDiceReadyStartAndSeating() {
  const { room, host, players } = setup(4);
  players[0].ready = false;
  assert(applyRoomAction(room, host, "startGame").includes("準備"));
  players[0].ready = true;
  players[0].roll = 88;
  players[1].roll = 88;
  players[0].rollTie = 1;
  players[1].rollTie = 9;
  players[2].roll = 70;
  players[3].roll = 60;
  assert.strictEqual(applyRoomAction(room, host, "startGame"), null);
  assert.strictEqual(room.players[0].id, players[1].id);
  assert.strictEqual(leftPlayer(room, room.players[0].id).id, room.players[1].id);
  assert.strictEqual(rightPlayer(room, room.players[0].id).id, room.players.at(-1).id);
}

function testFirstDiscovererAndCulprit() {
  const { room, players } = startPrepared(4);
  const starter = room.players.find((player) => player.hand.includes("first_discoverer"));
  assert.strictEqual(room.currentPlayerId, starter.id);
  const openingView = makeView(room, starter.id);
  assert(openingView.you.openingInfo.clues.some((clue) => clue.type === "first_discoverer"));
  const nonFirst = starter.hand.find((card) => card !== "first_discoverer");
  assert(applyRoomAction(room, starter, "playCard", { card: nonFirst }).includes("第一發現者"));
  assert.strictEqual(applyRoomAction(room, starter, "playCard", { card: "first_discoverer" }), null);
  assert.strictEqual(makeView(room, starter.id).you.openingInfo, null);

  const culprit = room.players[0];
  forceTurn(room, culprit);
  culprit.hand = ["culprit", "ordinary"];
  assert(applyRoomAction(room, culprit, "playCard", { card: "culprit" }).includes("最後一張"));
  culprit.hand = ["culprit"];
  assert.strictEqual(applyRoomAction(room, culprit, "playCard", { card: "culprit" }), null);
  assert.strictEqual(room.phase, "roundResult");
  assert.strictEqual(room.roundResult.roundScores[culprit.id], 2);
}

function testDetectiveAlibiWitnessPrivacy() {
  const { room, players } = setup(4);
  setHands(room, [
    ["detective", "ordinary", "ordinary"],
    ["culprit", "alibi"],
    ["witness"],
    ["ordinary"]
  ]);
  forceTurn(room, players[0]);
  assert.strictEqual(applyRoomAction(room, players[0], "playCard", { card: "detective", targetId: players[1].id }), null);
  assert.strictEqual(room.phase, "pendingDetectiveResult");
  assert.strictEqual(room.pendingAction.caught, false);
  assert.strictEqual(applyRoomAction(room, players[1], "confirmDetectiveResult").includes("只有"), true);
  assert.strictEqual(applyRoomAction(room, players[0], "confirmDetectiveResult"), null);
  assert.strictEqual(room.phase, "playing");

  forceTurn(room, players[2]);
  assert.strictEqual(applyRoomAction(room, players[2], "playCard", { card: "witness", targetId: players[1].id }), null);
  const witnessView = makeView(room, players[2].id);
  const otherView = makeView(room, players[3].id);
  assert(witnessView.you.actionInfo.messages.some((message) => message.includes("犯人")));
  assert(!JSON.stringify(otherView.you.actionInfo || {}).includes("犯人"));

  setHands(room, [
    ["detective", "ordinary", "ordinary", "ordinary"],
    ["culprit"],
    ["ordinary"],
    ["ordinary"]
  ]);
  forceTurn(room, players[0]);
  assert(applyRoomAction(room, players[0], "playCard", { card: "detective", targetId: players[1].id }).includes("3 張以下"));
}

function testDetectiveScoringAndAccomplice() {
  const { room, players } = setup(4);
  setHands(room, [
    ["accomplice"],
    ["detective"],
    ["culprit"],
    ["ordinary"]
  ]);
  forceTurn(room, players[0]);
  assert.strictEqual(applyRoomAction(room, players[0], "playCard", { card: "accomplice" }), null);
  forceTurn(room, players[1]);
  assert.strictEqual(applyRoomAction(room, players[1], "playCard", { card: "detective", targetId: players[2].id }), null);
  assert.strictEqual(room.phase, "pendingDetectiveResult");
  assert.strictEqual(room.pendingAction.caught, true);
  assert.strictEqual(applyRoomAction(room, players[1], "confirmDetectiveResult"), null);
  assert.strictEqual(room.phase, "roundResult");
  assert.strictEqual(room.roundResult.roundScores[players[1].id], 2);
  assert.strictEqual(room.roundResult.roundScores[players[3].id], 1);
  assert.strictEqual(room.roundResult.roundScores[players[0].id], 0);
  assert.strictEqual(room.roundResult.roundScores[players[2].id], 0);
}

function testDogRules() {
  const { room, players } = setup(4);
  setHands(room, [
    ["dog"],
    ["ordinary", "culprit"],
    [],
    ["ordinary"]
  ]);
  forceTurn(room, players[0]);
  assert(applyRoomAction(room, players[0], "playCard", { card: "dog", targetId: players[2].id }).includes("沒有手牌"));
  assert.strictEqual(applyRoomAction(room, players[0], "playCard", { card: "dog", targetId: players[1].id }), null);
  assert.strictEqual(room.phase, "pendingDogDiscard");
  assert(applyRoomAction(room, players[0], "dogDiscard", { card: "ordinary" }).includes("只有"));
  assert.strictEqual(applyRoomAction(room, players[1], "dogDiscard", { card: "ordinary" }), null);
  assert(players[1].hand.includes("dog"), "dog card should transfer to the target if culprit was not discarded");

  setHands(room, [
    ["dog"],
    ["culprit"],
    ["ordinary"],
    ["ordinary"]
  ]);
  forceTurn(room, players[0]);
  assert.strictEqual(applyRoomAction(room, players[0], "playCard", { card: "dog", targetId: players[1].id }), null);
  assert.strictEqual(applyRoomAction(room, players[1], "dogDiscard", { card: "culprit" }), null);
  assert.strictEqual(room.phase, "roundResult");
  assert.strictEqual(room.roundResult.roundScores[players[0].id], 3);
}

function testInformationExchangeUsesSnapshot() {
  const { room, players } = setup(4);
  setHands(room, [
    ["information_exchange", "alibi"],
    [],
    ["culprit"],
    ["ordinary"]
  ]);
  forceTurn(room, players[0]);
  assert.strictEqual(applyRoomAction(room, players[0], "playCard", { card: "information_exchange" }), null);
  assert.strictEqual(room.phase, "pendingInformationExchange");
  assert.strictEqual(applyRoomAction(room, players[0], "informationExchangeSelect", { card: "alibi" }), null);
  assert.strictEqual(applyRoomAction(room, players[2], "informationExchangeSelect", { card: "culprit" }), null);
  assert.strictEqual(applyRoomAction(room, players[3], "informationExchangeSelect", { card: "ordinary" }), null);
  assert(players[1].hand.includes("alibi"));
  assert(players[3].hand.includes("culprit"));
  assert(players[0].hand.includes("ordinary"));
  assert(players[0].actionInfo.messages.some((message) => message.includes(`順時針給 #2 ${players[1].name}`)));
  assert(players[0].actionInfo.messages.some((message) => message.includes("「不在場證明」")));
  assert(players[0].actionInfo.messages.some((message) => message.includes("所有玩家完成情報交換")));
  assert(players[1].actionInfo.messages.some((message) => message.includes(`從逆時針 #1 ${players[0].name}`)));
  assert(players[1].actionInfo.messages.some((message) => message.includes("收到「不在場證明」")));
  assert(!room.log.some((message) => message.includes("不在場證明")));
}

function testRumorUsesSnapshot() {
  const { room, players } = setup(4);
  setHands(room, [
    ["rumor", "alibi"],
    [],
    ["culprit"],
    []
  ]);
  forceTurn(room, players[0]);
  assert.strictEqual(applyRoomAction(room, players[0], "playCard", { card: "rumor" }), null);
  assert.strictEqual(room.phase, "pendingRumor");
  assert.strictEqual(room.pendingAction.type, "rumor");
  const publicView = makeView(room, players[1].id);
  assert.strictEqual(publicView.room.pendingAction.type, "rumor");
  assert.strictEqual(publicView.room.pendingAction.confirmedCount, 0);
  assert.strictEqual(makeView(room, players[1].id).you.pendingAction.type, "rumorDraw");
  assert(players[0].hand.includes("alibi"), "rumor should not resolve before confirmation");
  assert.strictEqual(applyRoomAction(room, players[0], "rumorDraw"), null);
  assert.strictEqual(room.phase, "pendingRumor");
  assert.strictEqual(room.pendingAction.confirmations[players[0].id], true);
  assert.strictEqual(applyRoomAction(room, players[1], "rumorDraw"), null);
  assert.strictEqual(applyRoomAction(room, players[2], "rumorDraw"), null);
  assert.strictEqual(room.phase, "pendingRumor");
  assert.strictEqual(applyRoomAction(room, players[3], "rumorDraw"), null);
  assert.strictEqual(room.phase, "playing");
  assert(players[1].hand.includes("alibi"), "player B should draw from player A's snapshot");
  assert(!players[0].hand.includes("alibi"), "player A should lose the card drawn from their original hand");
  assert(!players[2].hand.includes("alibi"), "player C must not draw the card B just received during the same rumor");
  assert(players[3].hand.includes("culprit"), "player D should draw from player C's original snapshot");
  assert(players[0].actionInfo.messages.some((message) => message.includes(`逆時針的 #4 ${players[3].name} 沒有可抽的牌`)));
  assert(players[1].actionInfo.messages.some((message) => message.includes(`逆時針從 #1 ${players[0].name}`)));
  assert(players[1].actionInfo.messages.some((message) => message.includes("抽到「不在場證明」")));
  assert(players[0].actionInfo.messages.some((message) => message.includes(`#2 ${players[1].name} 從你這裡抽走「不在場證明」`)));
  assert(players[3].actionInfo.messages.some((message) => message.includes("抽到「犯人」")));
  assert(!players[0].actionInfo.messages.some((message) => message.includes(`順時針給 #2 ${players[1].name}`)));
  assert(!players[0].actionInfo.messages.some((message) => message.includes("所有玩家完成謠言抽牌")));
  assert(!room.log.some((message) => message.includes("不在場證明") || message.includes("犯人")));
}

function testRumorConfirmationOrderDoesNotAffectSnapshot() {
  const { room, players } = setup(4);
  setHands(room, [
    ["rumor", "alibi"],
    [],
    ["culprit"],
    []
  ]);
  forceTurn(room, players[0]);
  assert.strictEqual(applyRoomAction(room, players[0], "playCard", { card: "rumor" }), null);

  assert.strictEqual(applyRoomAction(room, players[3], "rumorDraw"), null);
  assert.strictEqual(applyRoomAction(room, players[2], "rumorDraw"), null);
  assert.strictEqual(applyRoomAction(room, players[1], "rumorDraw"), null);
  assert.strictEqual(room.phase, "pendingRumor");
  assert.strictEqual(applyRoomAction(room, players[0], "rumorDraw"), null);

  assert.strictEqual(room.phase, "playing");
  assert(players[1].hand.includes("alibi"), "player B should draw from player A's original snapshot even if B confirmed before A");
  assert(!players[2].hand.includes("alibi"), "player C must not draw the card B received in the same rumor");
  assert(players[3].hand.includes("culprit"), "player D should draw from player C's original snapshot");
}

function testSimpleCardsAndPublicCards() {
  const { room, players } = setup(4);
  setHands(room, [
    ["ordinary"],
    ["alibi"],
    ["boy"],
    ["inspector", "ordinary", "ordinary"]
  ]);

  forceTurn(room, players[0]);
  assert.strictEqual(applyRoomAction(room, players[0], "playCard", { card: "ordinary" }), null);
  assert(players[0].tableCards.includes("ordinary"));
  assert.strictEqual(room.phase, "playing");

  forceTurn(room, players[1]);
  assert.strictEqual(applyRoomAction(room, players[1], "playCard", { card: "alibi" }), null);
  assert(players[1].tableCards.includes("alibi"));
  assert.strictEqual(room.phase, "playing");

  forceTurn(room, players[2]);
  assert.strictEqual(applyRoomAction(room, players[2], "playCard", { card: "boy" }), null);
  assert(players[2].tableCards.includes("boy"));
  assert.strictEqual(room.phase, "playing");

  forceTurn(room, players[3]);
  assert.strictEqual(applyRoomAction(room, players[3], "playCard", { card: "inspector", targetId: players[0].id }), null);
  assert.deepStrictEqual(players[3].publicCards, [{ card: "inspector", targetId: players[0].id }]);
  assert.deepStrictEqual(players[0].publicCards, []);
}

function testTurnSkipsPlayersWithoutHand() {
  const { room, players } = setup(4);
  setHands(room, [
    ["ordinary"],
    [],
    ["alibi"],
    ["culprit"]
  ]);
  forceTurn(room, players[0]);
  assert.strictEqual(applyRoomAction(room, players[0], "playCard", { card: "ordinary" }), null);
  assert.strictEqual(room.phase, "playing");
  assert.strictEqual(room.currentPlayerId, players[2].id);
  assert.strictEqual(applyRoomAction(room, players[1], "playCard", { card: "ordinary" }), "還沒輪到你。");
}

function testTradeRules() {
  const { room, players } = setup(4);
  setHands(room, [
    ["trade", "alibi"],
    ["culprit"],
    [],
    ["ordinary"]
  ]);
  forceTurn(room, players[0]);
  assert(applyRoomAction(room, players[0], "playCard", { card: "trade", targetId: players[2].id, giveCard: "alibi" }).includes("沒有手牌"));
  assert.strictEqual(applyRoomAction(room, players[0], "playCard", { card: "trade", targetId: players[1].id, giveCard: "alibi" }), null);
  assert.strictEqual(room.phase, "pendingTrade");
  assert.strictEqual(applyRoomAction(room, players[1], "tradeSelect", { card: "culprit" }), null);
  assert(players[0].hand.includes("culprit"));
  assert(players[1].hand.includes("alibi"));
  assert(players[0].actionInfo.messages.some((message) => message.includes("交給") && message.includes("「不在場證明」") && message.includes("收到「犯人」")));
  assert(players[1].actionInfo.messages.some((message) => message.includes("交給") && message.includes("「犯人」") && message.includes("收到「不在場證明」")));
  assert(!room.log.some((message) => message.includes("不在場證明")));
}

function testInspectorPriorityAndMatchEnd() {
  const { room, players } = setup(4);
  players[0].score = 8;
  setHands(room, [
    ["inspector", "ordinary", "ordinary"],
    ["culprit"],
    ["ordinary"],
    ["ordinary"]
  ]);
  forceTurn(room, players[0]);
  assert.strictEqual(applyRoomAction(room, players[0], "playCard", { card: "inspector", targetId: players[1].id }), null);
  forceTurn(room, players[1]);
  assert.strictEqual(applyRoomAction(room, players[1], "playCard", { card: "culprit" }), null);
  assert.strictEqual(room.phase, "matchResult");
  assert.strictEqual(room.roundResult.type, "inspector");
  assert.strictEqual(room.roundResult.roundScores[players[0].id], 3);
  assert.deepStrictEqual(room.matchResult.winners.map((player) => player.id), [players[0].id]);
}

function testNextRoundAndResetMatch() {
  const { room, host, players } = setup(4);
  setHands(room, [
    ["culprit"],
    ["ordinary"],
    ["ordinary"],
    ["ordinary"]
  ]);
  forceTurn(room, players[0]);
  assert.strictEqual(applyRoomAction(room, players[0], "playCard", { card: "culprit" }), null);
  assert.strictEqual(applyRoomAction(room, host, "nextRound"), null);
  assert.strictEqual(room.phase, "playing");
  assert.strictEqual(room.players.length, 4);

  room.phase = "matchResult";
  assert.strictEqual(applyRoomAction(room, host, "resetMatch"), null);
  assert.strictEqual(room.phase, "lobby");
  assert(room.players.every((player) => player.score === 0));
  assert.deepStrictEqual(room.chat.map((entry) => entry.playerId), ["system"]);
}

function runSuite() {
  testDeckCounts();
  testStartGameShuffleDealAndViews();
  testDiceReadyStartAndSeating();
  testFirstDiscovererAndCulprit();
  testDetectiveAlibiWitnessPrivacy();
  testDetectiveScoringAndAccomplice();
  testDogRules();
  testInformationExchangeUsesSnapshot();
  testRumorUsesSnapshot();
  testRumorConfirmationOrderDoesNotAffectSnapshot();
  testSimpleCardsAndPublicCards();
  testTurnSkipsPlayersWithoutHand();
  testTradeRules();
  testInspectorPriorityAndMatchEnd();
  testNextRoundAndResetMatch();
}

for (let run = 1; run <= 10; run += 1) {
  runSuite();
}

console.log("criminal dance game tests passed (10 runs)");
