"use strict";

const assert = require("assert");
const {
  CARD_DEFS,
  DEFAULT_TARGET_SCORES,
  makeRoom,
  joinRoom,
  applyRoomAction,
  makeView,
  buildDeckWithInstances,
  highestHandValue
} = require("../game");

let uid = 1;

function inst(card) {
  return { uid: `${card}-test-${uid++}`, card };
}

function setup(count = 4) {
  const { room, player: host } = makeRoom("P1", "LOVE01");
  room.settings.playerCount = count;
  room.settings.targetScore = DEFAULT_TARGET_SCORES[count];
  const players = [host];
  for (let index = 2; index <= count; index += 1) players.push(joinRoom(room, `P${index}`).player);
  players.forEach((player, index) => {
    player.roll = 100 - index;
    player.rollTie = 1000 - index;
    player.ready = true;
  });
  return { room, host, players };
}

function forceTurn(room, player) {
  room.phase = "playing";
  room.currentPlayerId = player.id;
  room.pendingAction = null;
}

function setHands(room, hands) {
  room.players.forEach((player, index) => {
    player.hand = hands[index].map(inst);
    player.discardPile = [];
    player.actionInfo = null;
    player.eliminated = false;
    player.protected = false;
  });
}

function playFirst(room, player, payload = {}) {
  return applyRoomAction(room, player, "playCard", {
    cardId: player.hand[0].uid,
    ...payload
  });
}

function playCardByName(room, player, card, payload = {}) {
  const cardInstance = player.hand.find((item) => item.card === card);
  assert(cardInstance, `${player.name} should have ${card}`);
  return applyRoomAction(room, player, "playCard", {
    cardId: cardInstance.uid,
    ...payload
  });
}

function testDeckAndSetup() {
  const { room } = setup(2);
  const deck = buildDeckWithInstances(room);
  assert.strictEqual(deck.length, 21);
  Object.entries(CARD_DEFS).forEach(([card, def]) => {
    assert.strictEqual(deck.filter((item) => item.card === card).length, def.count);
  });
}

function testAllPlayerCountsSetup() {
  for (let count = 2; count <= 6; count += 1) {
    const { room, host } = setup(count);
    assert.strictEqual(applyRoomAction(room, host, "startGame"), null);
    assert.strictEqual(room.players.length, count);
    assert.strictEqual(room.publicBurnCards.length, count === 2 ? 3 : 0);
    assert.strictEqual(room.burnCard.card.length > 0, true);
    assert.strictEqual(room.players.reduce((sum, player) => sum + player.hand.length, 0), count + 1, "current player draws at turn start");
    assert.strictEqual(room.deck.length, 21 - 1 - (count === 2 ? 3 : 0) - count - 1);
    assert.strictEqual(room.players[0].id, host.id);
    room.players.forEach((player) => {
      const view = makeView(room, player.id);
      assert.strictEqual(view.room.players.length, count);
      assert.strictEqual(view.room.publicBurnCards.length, count === 2 ? 3 : 0);
      assert(view.you.actionInfo.messages.every((message) => message.includes("你從牌庫抽到了")));
      assert.strictEqual(view.you.actionInfo.messages.length, player.id === room.currentPlayerId ? 2 : 1);
      assert(!Object.hasOwn(view.room, "burnCard"), "暗置牌不得出現在公開 View");
      assert(view.room.players.every((publicPlayer) => !Object.hasOwn(publicPlayer, "hand")), "公開玩家資料不得含手牌");
    });
  }
}

function testSettingsAndLobby() {
  const { room, host } = setup(4);
  assert.strictEqual(applyRoomAction(room, host, "updateSettings", { playerCount: 5 }), null);
  assert.strictEqual(room.settings.targetScore, 3);
  assert.strictEqual(applyRoomAction(room, host, "updateSettings", { playerCount: 5, targetScore: 7 }), null);
  assert.strictEqual(room.settings.targetScore, 7);
  const validation = applyRoomAction(room, host, "startGame");
  assert(validation.includes("需要 5 位玩家"));
}

function testLobbyAndActionValidation() {
  const { room, host, players } = setup(3);
  assert.strictEqual(applyRoomAction(room, players[1], "updateSettings", { playerCount: 4 }), "只有房主可以更改設定。");
  assert.strictEqual(applyRoomAction(room, host, "updateSettings", { playerCount: 7 }), "玩家人數必須是 2 到 6 人。");
  assert.strictEqual(applyRoomAction(room, host, "chat", { message: "  hi   there  " }), null);
  assert.strictEqual(room.chat.at(-1).message, "hi there");
  assert.strictEqual(applyRoomAction(room, host, "chat", { message: "   " }), "聊天訊息不能是空的。");
  assert.strictEqual(applyRoomAction(room, host, "roll"), "你已經擲過 d100。");
  assert.strictEqual(applyRoomAction(room, { id: "ghost" }, "playCard", {}), "現在不能出牌。");
  assert.strictEqual(applyRoomAction(room, host, "unknown"), "未知的操作。");
}

function testInvalidPlayAndTargetValidation() {
  const { room, players } = setup(3);
  setHands(room, [
    ["guard", "spy"],
    ["princess"],
    ["baron"]
  ]);
  room.deck = [inst("spy"), inst("spy")];
  forceTurn(room, players[0]);

  assert.strictEqual(playFirst(room, players[1], { targetId: players[0].id, guessCardId: "princess" }), "還沒輪到你。");
  assert.strictEqual(applyRoomAction(room, players[0], "playCard", { cardId: "missing" }), "你沒有這張牌。");
  assert.strictEqual(playFirst(room, players[0], { guessCardId: "princess" }), "請指定一位未受保護的其他玩家。");
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id, guessCardId: "guard" }), "衛兵必須猜一張非衛兵的牌。");
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id, guessCardId: "not-a-card" }), "衛兵必須猜一張非衛兵的牌。");

  setHands(room, [
    ["priest", "spy"],
    ["princess"],
    ["baron"]
  ]);
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0], { targetId: players[0].id }), "請指定一位未受保護的其他玩家。");
  players[1].protected = true;
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id }), "請指定一位未受保護的其他玩家。");

  setHands(room, [
    ["prince", "spy"],
    ["princess"],
    ["baron"]
  ]);
  forceTurn(room, players[0]);
  players[1].eliminated = true;
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id }), "請指定一位仍在局內的玩家。");
  players[1].eliminated = false;
  players[1].protected = true;
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id }), "不能指定受侍女保護的玩家。");
  assert.strictEqual(playFirst(room, players[0], { targetId: players[0].id }), null, "Prince may target self");
}

function testCountessAndGuard() {
  const { room, players } = setup(3);
  setHands(room, [
    ["king", "countess"],
    ["princess"],
    ["spy"]
  ]);
  room.deck = [inst("guard"), inst("guard")];
  forceTurn(room, players[0]);
  assert(playFirst(room, players[0], { targetId: players[1].id }).includes("伯爵夫人"));
  const view = makeView(room, players[0].id);
  assert.strictEqual(view.you.playableCards.find((card) => card.id === "king").playable, false);
  assert.strictEqual(view.you.playableCards.find((card) => card.id === "countess").playable, true);
  const countess = players[0].hand.find((card) => card.card === "countess");
  assert.strictEqual(applyRoomAction(room, players[0], "playCard", { cardId: countess.uid }), null);

  setHands(room, [
    ["guard", "spy"],
    ["princess"],
    ["priest"]
  ]);
  room.deck = [inst("spy"), inst("spy")];
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id, guessCardId: "princess" }), null);
  assert.strictEqual(players[1].eliminated, true);
  const guardHitView = makeView(room, players[0].id);
  assert(guardHitView.you.actionInfo.messages.some((message) => message.includes("#1 P1 猜 #2 P2 是 9 公主：猜中，#2 P2 出局")));

  setHands(room, [
    ["guard", "spy"],
    ["princess"],
    ["priest"]
  ]);
  room.deck = [inst("spy"), inst("spy")];
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id, guessCardId: "priest" }), null);
  assert.strictEqual(players[1].eliminated, false);
  const guardMissView = makeView(room, players[2].id);
  assert(guardMissView.you.actionInfo.messages.some((message) => message.includes("#1 P1 猜 #2 P2 是 2 神父：未猜中")));

  setHands(room, [
    ["guard", "spy"],
    ["princess"],
    ["priest"]
  ]);
  room.deck = [inst("spy"), inst("spy")];
  players[1].protected = true;
  players[2].protected = true;
  forceTurn(room, players[0]);
  assert.deepStrictEqual(makeView(room, players[0].id).you.legalTargets.guard, []);
  assert.strictEqual(playFirst(room, players[0]), null);
  assert.strictEqual(players[1].eliminated, false);
  assert.strictEqual(players[2].eliminated, false);
  const guardNoTargetView = makeView(room, players[0].id);
  assert(guardNoTargetView.you.actionInfo.messages.some((message) => message.includes("打出 1 衛兵，但沒有可指定的目標，無效果")));
}

function testPriestBaronAndPrivacy() {
  const { room, players } = setup(3);
  setHands(room, [
    ["priest", "spy"],
    ["princess"],
    ["guard"]
  ]);
  room.deck = [inst("spy"), inst("spy")];
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id }), null);
  const priestView = makeView(room, players[0].id);
  const otherView = makeView(room, players[2].id);
  assert.strictEqual(priestView.you.actionInfo.messages.length, 2);
  assert.strictEqual(otherView.you.actionInfo.messages.length, 1);
  assert(priestView.you.actionInfo.messages.some((message) => message.includes("#1 P1 打出 2 神父，指定 #2 P2。")));
  assert(priestView.you.actionInfo.messages.some((message) => message.includes("#2 P2 的手牌是 9 公主。")));
  assert(otherView.you.actionInfo.messages[0].includes("P1"));
  assert(otherView.you.actionInfo.messages[0].includes("P2"));
  assert(JSON.stringify(priestView.you.actionInfo).includes("公主"));
  assert(!JSON.stringify(otherView.you.actionInfo || {}).includes("公主"));

  setHands(room, [
    ["baron", "guard"],
    ["princess"],
    ["spy"]
  ]);
  room.deck = [inst("spy"), inst("spy")];
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id }), null);
  assert.strictEqual(players[0].eliminated, true);
  const baronOtherView = makeView(room, players[2].id);
  assert(baronOtherView.you.actionInfo.messages.some((message) => message.includes("#1 P1 與 #2 P2 使用 3 男爵進行比牌：#2 P2 的手牌點數較大，#1 P1 出局")));

  setHands(room, [
    ["baron", "princess"],
    ["guard"],
    ["spy"]
  ]);
  room.deck = [inst("spy"), inst("spy")];
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id }), null);
  assert.strictEqual(players[1].eliminated, true);
  assert(makeView(room, players[0].id).you.actionInfo.messages.some((message) => message.includes("#1 P1 的手牌點數較大，#2 P2 出局")));

  setHands(room, [
    ["baron", "guard"],
    ["guard"],
    ["spy"]
  ]);
  room.deck = [inst("spy"), inst("spy")];
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id }), null);
  assert.strictEqual(players[0].eliminated, false);
  assert.strictEqual(players[1].eliminated, false);
  assert(makeView(room, players[2].id).you.actionInfo.messages.some((message) => message.includes("手牌點數相同，無人出局")));
}

function testProtectedOpponentsDoNotBlockTargetCards() {
  for (const card of ["guard", "priest", "baron", "king"]) {
    const { room, players } = setup(3);
    setHands(room, [
      [card, "spy"],
      ["princess"],
      ["guard"]
    ]);
    room.deck = [inst("spy"), inst("spy")];
    players[1].protected = true;
    players[2].protected = true;
    forceTurn(room, players[0]);

    assert.deepStrictEqual(makeView(room, players[0].id).you.legalTargets[card], []);
    assert.strictEqual(playCardByName(room, players[0], card), null, `${card} should be playable without a target`);
    assert(players[0].discardPile.some((item) => item.card === card));
    assert(makeView(room, players[0].id).you.actionInfo.messages.some((message) => message.includes("但沒有可指定的目標，無效果")));
  }
}

function testHandmaidPrinceKing() {
  const { room, players } = setup(3);
  setHands(room, [
    ["handmaid", "spy"],
    ["king"],
    ["guard"]
  ]);
  room.deck = [inst("spy"), inst("spy")];
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0]), null);
  assert.strictEqual(players[0].protected, true);
  forceTurn(room, players[1]);
  assert(playFirst(room, players[1], { targetId: players[0].id }).includes("未受保護"));

  setHands(room, [
    ["prince", "spy"],
    ["guard"],
    ["baron"]
  ]);
  room.deck = [inst("spy"), inst("spy")];
  players[1].protected = true;
  players[2].protected = true;
  forceTurn(room, players[0]);
  assert.deepStrictEqual(makeView(room, players[0].id).you.legalTargets.prince, [players[0].id]);
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id }), "不能指定受侍女保護的玩家。");

  setHands(room, [
    ["spy", "guard"],
    ["handmaid"],
    ["baron"]
  ]);
  room.deck = [inst("spy")];
  players[1].protected = true;
  forceTurn(room, players[0]);
  assert.strictEqual(playCardByName(room, players[0], "spy"), null);
  assert.strictEqual(room.currentPlayerId, players[1].id);
  assert.strictEqual(players[1].protected, false, "Protection ends at the start of that player's next turn");

  setHands(room, [
    ["prince", "spy"],
    ["princess"],
    ["guard"]
  ]);
  room.deck = [inst("spy"), inst("spy")];
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id }), null);
  assert.strictEqual(players[1].eliminated, true);
  const princePrincessView = makeView(room, players[0].id);
  assert(princePrincessView.you.actionInfo.messages.some((message) => message.includes("#1 P1 使用 5 王子，#2 P2 棄掉 9 公主並出局")));

  setHands(room, [
    ["prince", "spy"],
    ["guard"],
    ["baron"]
  ]);
  room.deck = [inst("priest")];
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id }), null);
  assert.strictEqual(players[1].hand[0].card, "priest");
  const princeTargetView = makeView(room, players[1].id);
  const princeOtherView = makeView(room, players[2].id);
  assert(princeTargetView.you.actionInfo.messages.some((message) => message.includes("你從牌庫抽到了 2 神父")));
  assert(princeOtherView.you.actionInfo.messages.some((message) => message.includes("#1 P1 使用 5 王子，#2 P2 棄掉手牌並從牌庫抽一張")));
  assert(!JSON.stringify(princeOtherView.you.actionInfo || {}).includes("你從牌庫抽到了"));

  setHands(room, [
    ["prince", "spy"],
    ["guard"],
    ["baron"]
  ]);
  room.deck = [];
  room.burnCard = inst("baron");
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id }), null);
  assert.strictEqual(players[1].hand[0].card, "baron");
  const princeBurnTargetView = makeView(room, players[1].id);
  const princeBurnOtherView = makeView(room, players[2].id);
  assert(princeBurnTargetView.you.actionInfo.messages.some((message) => message.includes("你從蓋牌抽到了 3 男爵")));
  assert(princeBurnTargetView.you.actionInfo.messages.some((message) => message.includes("#1 P1 使用 5 王子，#2 P2 抽走了蓋牌")));
  assert(princeBurnOtherView.you.actionInfo.messages.some((message) => message.includes("#1 P1 使用 5 王子，#2 P2 抽走了蓋牌")));
  assert(!JSON.stringify(princeBurnOtherView.you.actionInfo || {}).includes("你從蓋牌抽到了 3 男爵"));

  setHands(room, [
    ["king", "spy"],
    ["guard"],
    ["baron"]
  ]);
  room.deck = [inst("spy"), inst("spy")];
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id }), null);
  assert.strictEqual(players[0].hand[0].card, "guard");
  assert.strictEqual(players[1].hand[0].card, "spy");
  const kingActorView = makeView(room, players[0].id);
  const kingTargetView = makeView(room, players[1].id);
  const kingOtherView = makeView(room, players[2].id);
  assert(kingActorView.you.actionInfo.messages.some((message) => message.includes("你用 0 間諜 和 #2 P2 交換了 1 衛兵")));
  assert(kingTargetView.you.actionInfo.messages.some((message) => message.includes("你用 1 衛兵 和 #1 P1 交換了 0 間諜")));
  assert(kingTargetView.you.actionInfo.messages.some((message) => message.includes("你從牌庫抽到了")));
  assert(kingOtherView.you.actionInfo.messages.some((message) => message.includes("#1 P1 與 #2 P2 交換了手牌")));
}

function testChancellor() {
  const { room, players } = setup(3);
  setHands(room, [
    ["chancellor", "guard"],
    ["spy"],
    ["baron"]
  ]);
  room.deck = [inst("priest"), inst("princess")];
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0]), null);
  assert.strictEqual(room.phase, "pendingChancellor");
  assert.strictEqual(players[0].hand.length, 3);
  const pendingView = makeView(room, players[0].id);
  assert.strictEqual(pendingView.room.pendingAction.type, "chancellor");
  assert.strictEqual(pendingView.you.pendingAction.cards.length, 3);
  assert.strictEqual(makeView(room, players[1].id).you.pendingAction, null);
  assert(pendingView.you.actionInfo.messages.some((message) => message.includes("你從牌庫抽到了 9 公主")));
  assert(pendingView.you.actionInfo.messages.some((message) => message.includes("你從牌庫抽到了 2 神父")));
  assert.strictEqual(applyRoomAction(room, players[1], "chooseChancellorKeep", {
    keepCardInstanceId: players[0].hand[0].uid,
    bottomCardInstanceIds: []
  }), "只有打出大臣的玩家可以選牌。");
  assert.strictEqual(applyRoomAction(room, players[0], "chooseChancellorKeep", {
    keepCardInstanceId: "missing",
    bottomCardInstanceIds: players[0].hand.slice(1).map((card) => card.uid)
  }), "請選擇要保留的牌。");
  assert.strictEqual(applyRoomAction(room, players[0], "chooseChancellorKeep", {
    keepCardInstanceId: players[0].hand[0].uid,
    bottomCardInstanceIds: []
  }), "請排好要放回牌庫底的牌。");
  const keep = players[0].hand.find((card) => card.card === "princess");
  assert.strictEqual(applyRoomAction(room, players[0], "chooseChancellorKeep", {
    keepCardInstanceId: keep.uid,
    bottomCardInstanceIds: players[0].hand.filter((card) => card.uid !== keep.uid).map((card) => card.uid)
  }), null);
  assert.strictEqual(players[0].hand.length, 1);
  assert.strictEqual(players[0].hand[0].card, "princess");
  assert.strictEqual(room.deck.length, 1);
  const actorView = makeView(room, players[0].id);
  const otherView = makeView(room, players[1].id);
  assert.strictEqual(actorView.you.actionInfo.messages.length, 2);
  assert.strictEqual(otherView.you.actionInfo.messages.length, 1);
  assert(!JSON.stringify(otherView.you.actionInfo || {}).includes("公主"));

  setHands(room, [
    ["chancellor", "guard"],
    ["spy"],
    ["baron"]
  ]);
  room.deck = [];
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0]), null);
  assert.notStrictEqual(room.phase, "pendingChancellor", "Chancellor with empty deck should not create a pending action");
}

function testRoundEndScoringAndSpy() {
  const { room, players } = setup(2);
  setHands(room, [
    ["guard", "spy"],
    ["princess"]
  ]);
  room.deck = [inst("spy")];
  players[0].discardPile.push(inst("spy"));
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0], { targetId: players[1].id, guessCardId: "princess" }), null);
  assert.strictEqual(room.phase, "roundResult");
  assert.strictEqual(room.roundResult.roundScores[players[0].id], 2, "winner gets 1 plus solo spy bonus");
  assert.strictEqual(room.roundResult.revealedHands.length, 2, "all settlements must reveal remaining hands");
  assert(room.roundResult.revealedHands.some((entry) => entry.playerId === players[0].id && entry.cards.some((card) => card.id === "spy")));
  assert.strictEqual(applyRoomAction(room, players[1], "nextRound"), "只有房主可以開始下一局。");
  assert.strictEqual(applyRoomAction(room, players[0], "resetMatch"), "整場結束後才能返回大廳。");
  assert.strictEqual(applyRoomAction(room, players[0], "nextRound"), null);
  assert.strictEqual(room.phase, "playing");
  assert.strictEqual(room.roundStartPlayerId, players[0].id);
  assert.strictEqual(room.roundNumber, 1);

  const eliminatedScenario = setup(2);
  const eliminatedRoom = eliminatedScenario.room;
  const [survivor, eliminatedSpy] = eliminatedScenario.players;
  setHands(eliminatedRoom, [
    ["countess", "guard"],
    []
  ]);
  eliminatedRoom.deck = [];
  eliminatedSpy.eliminated = true;
  eliminatedSpy.discardPile.push(inst("spy"));
  forceTurn(eliminatedRoom, survivor);
  assert.strictEqual(playCardByName(eliminatedRoom, survivor, "countess"), null);
  assert.strictEqual(eliminatedRoom.roundResult.spyBonusPlayerId, null);
  assert.strictEqual(eliminatedRoom.roundResult.roundScores[eliminatedSpy.id], 0, "eliminated Spy player must not score");
}

function testDeckEmptyTieAndMatchEnd() {
  const { room, players } = setup(3);
  room.settings.targetScore = 1;
  setHands(room, [
    ["spy"],
    ["king"],
    ["king"]
  ]);
  room.deck = [];
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0]), null);
  assert.strictEqual(room.phase, "matchResult");
  assert.deepStrictEqual(room.roundResult.winnerIds.sort(), [players[1].id, players[2].id].sort());
  assert.strictEqual(highestHandValue(players[1]), 7);
  assert.deepStrictEqual(
    room.roundResult.revealedHands.map((entry) => ({
      playerId: entry.playerId,
      highestValue: entry.highestValue,
      cards: entry.cards.map((card) => card.id),
      isWinner: entry.isWinner
    })),
    [
      { playerId: players[0].id, highestValue: -1, cards: [], isWinner: false },
      { playerId: players[1].id, highestValue: 7, cards: ["king"], isWinner: true },
      { playerId: players[2].id, highestValue: 7, cards: ["king"], isWinner: true }
    ],
    "settlement must publicly reveal every player's remaining hand and comparison value"
  );
  const view = makeView(room, players[0].id);
  assert.deepStrictEqual(view.room.roundResult.revealedHands, room.roundResult.revealedHands);
  assert(view.you.actionInfo.messages.some((message) => message.includes("公開所有未出局玩家手牌")));
}

function testPrincessAndNoWinnerEdgeCases() {
  const { room, players } = setup(3);
  setHands(room, [
    ["princess", "spy"],
    ["guard"],
    ["baron"]
  ]);
  room.deck = [inst("spy"), inst("spy")];
  forceTurn(room, players[0]);
  assert.strictEqual(playFirst(room, players[0]), null);
  assert.strictEqual(players[0].eliminated, true);
  assert(room.phase === "playing" || room.phase === "roundResult");

  setHands(room, [
    ["guard"],
    ["spy"],
    ["baron"]
  ]);
  players.forEach((player) => { player.eliminated = true; });
  room.deck = [];
  forceTurn(room, players[0]);
  assert.strictEqual(applyRoomAction(room, players[0], "playCard", { cardId: players[0].hand[0].uid, targetId: players[1].id, guessCardId: "spy" }), "你已經出局。");
}

function testResetMatch() {
  const { room, host, players } = setup(3);
  players[0].score = 3;
  room.phase = "roundResult";
  assert.strictEqual(applyRoomAction(room, host, "resetMatch"), "整場結束後才能返回大廳。");
  room.phase = "matchResult";
  assert.strictEqual(applyRoomAction(room, host, "resetMatch"), null);
  assert.strictEqual(room.phase, "lobby");
  assert(room.players.every((player) => player.score === 0));
  assert.deepStrictEqual(room.chat.map((entry) => entry.playerId), ["system"]);
}

function runSuite() {
  testDeckAndSetup();
  testAllPlayerCountsSetup();
  testSettingsAndLobby();
  testLobbyAndActionValidation();
  testInvalidPlayAndTargetValidation();
  testCountessAndGuard();
  testPriestBaronAndPrivacy();
  testProtectedOpponentsDoNotBlockTargetCards();
  testHandmaidPrinceKing();
  testChancellor();
  testRoundEndScoringAndSpy();
  testDeckEmptyTieAndMatchEnd();
  testPrincessAndNoWinnerEdgeCases();
  testResetMatch();
}

for (let run = 1; run <= 10; run += 1) runSuite();

console.log("love letter game tests passed (10 runs)");
