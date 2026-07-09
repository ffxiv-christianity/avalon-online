"use strict";

const {
  randomIntInclusive,
  randomTieBreak,
  shuffle,
  roomCode,
  playerId
} = require("../Shared/server/random");
const {
  transferHost: sharedTransferHost,
  kickOfflinePlayer: sharedKickOfflinePlayer
} = require("../Shared/server/room-actions");

const CARD_DEFS = Object.freeze({
  spy: { name: "間諜", english: "Spy", value: 0, count: 2 },
  guard: { name: "衛兵", english: "Guard", value: 1, count: 6 },
  priest: { name: "神父", english: "Priest", value: 2, count: 2 },
  baron: { name: "男爵", english: "Baron", value: 3, count: 2 },
  handmaid: { name: "侍女", english: "Handmaid", value: 4, count: 2 },
  prince: { name: "王子", english: "Prince", value: 5, count: 2 },
  chancellor: { name: "大臣", english: "Chancellor", value: 6, count: 2 },
  king: { name: "國王", english: "King", value: 7, count: 1 },
  countess: { name: "伯爵夫人", english: "Countess", value: 8, count: 1 },
  princess: { name: "公主", english: "Princess", value: 9, count: 1 }
});

const CARD_ORDER = Object.freeze(["spy", "guard", "priest", "baron", "handmaid", "prince", "chancellor", "king", "countess", "princess"]);
const PLAYER_COUNTS = Object.freeze([2, 3, 4, 5, 6]);
const DEFAULT_TARGET_SCORES = Object.freeze({ 2: 6, 3: 5, 4: 4, 5: 3, 6: 3 });

function makeRoom(hostName, code = roomCode()) {
  const room = {
    code,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    emptySince: null,
    version: 1,
    phase: "lobby",
    hostId: null,
    hostOfflineSince: null,
    settings: {
      playerCount: 4,
      targetScore: DEFAULT_TARGET_SCORES[4]
    },
    players: [],
    playerJoinSerial: 0,
    playerJoinEvents: [],
    deck: [],
    burnCard: null,
    publicBurnCards: [],
    cardSerial: 1,
    currentPlayerId: null,
    roundStartPlayerId: null,
    roundNumber: 0,
    pendingAction: null,
    roundResult: null,
    matchResult: null,
    chat: [],
    nextChatId: 1,
    log: []
  };
  const player = makePlayer(hostName);
  room.hostId = player.id;
  room.players.push(player);
  recordPlayerJoin(room, player);
  addSystemMessage(room, `${player.name} 建立房間。`);
  return { room, player };
}

function makePlayer(name) {
  return {
    id: playerId(),
    name: cleanName(name),
    online: true,
    ready: false,
    roll: null,
    rollTie: null,
    score: 0,
    hand: [],
    discardPile: [],
    eliminated: false,
    protected: false,
    actionInfo: null,
    pendingDrawActionPhaseKey: null
  };
}

function joinRoom(room, name, requestedPlayerId = "") {
  if (requestedPlayerId) {
    const existing = room.players.find((player) => player.id === requestedPlayerId);
    if (!existing) return { error: "找不到你的玩家身分。" };
    existing.online = true;
    return { player: existing };
  }
  if (room.phase !== "lobby") return { error: "遊戲已開始，無法加入。" };
  if (room.players.length >= room.settings.playerCount) return { error: "房間人數已滿。" };
  const clean = cleanName(name);
  if (!clean) return { error: "請輸入名字。" };
  if (room.players.some((player) => normalizedName(player.name) === normalizedName(clean))) {
    return { error: "這個名字已經有人使用。" };
  }
  const player = makePlayer(clean);
  room.players.push(player);
  room.players.forEach((roomPlayer) => { roomPlayer.ready = false; });
  recordPlayerJoin(room, player);
  addSystemMessage(room, `${player.name} 加入房間。`);
  touch(room);
  return { player };
}

function applyRoomAction(room, actor, action, payload = {}) {
  if (!room || !actor) return "找不到房間或玩家。";
  switch (action) {
    case "transferHost": return transferHost(room, actor, payload.playerId);
    case "kickOfflinePlayer": return kickOfflinePlayer(room, actor, payload.playerId);
    case "updateSettings": return updateSettings(room, actor, payload);
    case "roll": return roll(room, actor);
    case "toggleReady": return toggleReady(room, actor);
    case "startGame": return startGame(room, actor);
    case "playCard": return playCard(room, actor, payload);
    case "chooseChancellorKeep": return chooseChancellorKeep(room, actor, payload);
    case "nextRound": return nextRound(room, actor);
    case "resetMatch": return resetMatch(room, actor);
    case "chat": return chat(room, actor, payload.message);
    default: return "未知的操作。";
  }
}

function transferHost(room, actor, targetPlayerId) {
  const error = sharedTransferHost({
    room,
    actor,
    playerId: targetPlayerId,
    addLog: (message) => addLog(room, message),
    addSystemMessage: (message) => addSystemMessage(room, message)
  });
  if (!error) touch(room);
  return error;
}

function kickOfflinePlayer(room, actor, targetPlayerId) {
  const error = sharedKickOfflinePlayer({
    room,
    actor,
    playerId: targetPlayerId,
    markEveryoneUnready: () => room.players.forEach((player) => { player.ready = false; }),
    addLog: (message) => addLog(room, message),
    addSystemMessage: (message) => addSystemMessage(room, message),
    afterKick: (target) => resetPlayerRoundState(target)
  });
  if (!error) touch(room);
  return error;
}

function updateSettings(room, actor, payload) {
  if (room.phase !== "lobby") return "遊戲開始後不能更改設定。";
  if (actor.id !== room.hostId) return "只有房主可以更改設定。";
  const playerCount = Number(payload.playerCount);
  if (!PLAYER_COUNTS.includes(playerCount)) return "玩家人數必須是 2 到 6 人。";
  if (room.players.length > playerCount) return "目前玩家數超過新的房間人數。";
  const requestedTarget = Number(payload.targetScore);
  room.settings.playerCount = playerCount;
  room.settings.targetScore = Number.isInteger(requestedTarget) && requestedTarget >= 1 && requestedTarget <= 9
    ? requestedTarget
    : DEFAULT_TARGET_SCORES[playerCount];
  room.players.forEach((player) => { player.ready = false; });
  touch(room);
  return null;
}

function roll(room, actor) {
  if (room.phase !== "lobby") return "遊戲開始後不能擲骰。";
  if (actor.roll) return "你已經擲過 d100。";
  actor.roll = randomIntInclusive(1, 100);
  actor.rollTie = randomTieBreak();
  actor.ready = false;
  touch(room);
  return null;
}

function toggleReady(room, actor) {
  if (room.phase !== "lobby") return "遊戲已開始。";
  if (!actor.roll) return "請先擲 d100。";
  actor.ready = !actor.ready;
  touch(room);
  return null;
}

function startGame(room, actor) {
  if (room.phase !== "lobby" && room.phase !== "roundResult") return "現在不能開始遊戲。";
  if (actor.id !== room.hostId) return "只有房主可以開始遊戲。";
  if (room.phase === "lobby") {
    const validation = validateLobby(room);
    if (validation.errors.length) return validation.errors[0];
    room.players = playersByRoll(room);
    room.players.forEach((player, index) => { player.seat = index; });
  }
  setupRound(room, room.players[0]?.id);
  addLog(room, "新的一局開始。");
  touch(room);
  return null;
}

function nextRound(room, actor) {
  if (room.phase !== "roundResult") return "現在不能開始下一局。";
  if (actor.id !== room.hostId) return "只有房主可以開始下一局。";
  const winnerIds = room.roundResult?.winnerIds || [];
  const startId = winnerIds.length ? winnerIds[randomIntInclusive(0, winnerIds.length - 1)] : room.players[0]?.id;
  setupRound(room, startId);
  room.chat = [];
  room.log = [];
  addSystemMessage(room, "房主開始下一局。");
  touch(room);
  return null;
}

function resetMatch(room, actor) {
  if (actor.id !== room.hostId) return "只有房主可以重置整場遊戲。";
  if (room.phase !== "matchResult") return "整場結束後才能返回大廳。";
  room.players.forEach((player) => {
    player.score = 0;
    player.ready = false;
    player.roll = null;
    player.rollTie = null;
    resetPlayerRoundState(player);
  });
  room.phase = "lobby";
  room.deck = [];
  room.burnCard = null;
  room.publicBurnCards = [];
  room.currentPlayerId = null;
  room.roundStartPlayerId = null;
  room.roundNumber = 0;
  room.pendingAction = null;
  room.roundResult = null;
  room.matchResult = null;
  room.chat = [];
  room.log = [];
  addSystemMessage(room, "房主重置整場遊戲。");
  touch(room);
  return null;
}

function validateLobby(room) {
  const errors = [];
  if (room.players.length !== room.settings.playerCount) {
    errors.push(`需要 ${room.settings.playerCount} 位玩家，目前 ${room.players.length} 位。`);
  }
  if (room.players.some((player) => !player.roll)) errors.push("所有玩家都需要先擲 d100。");
  if (room.players.some((player) => !player.ready)) errors.push("所有玩家都需要準備。");
  return { errors, warnings: [] };
}

function setupRound(room, startPlayerId = null) {
  room.roundNumber += 1;
  room.deck = buildDeckWithInstances(room);
  room.burnCard = room.deck.pop() || null;
  room.publicBurnCards = room.settings.playerCount === 2 ? [room.deck.pop(), room.deck.pop(), room.deck.pop()].filter(Boolean) : [];
  room.players.forEach(resetPlayerRoundState);
  room.players.forEach((player) => {
    drawFromDeckToPlayer(room, player);
  });
  room.roundResult = null;
  room.matchResult = null;
  room.pendingAction = null;
  room.phase = "playing";
  room.roundStartPlayerId = room.players.some((player) => player.id === startPlayerId) ? startPlayerId : room.players[0]?.id;
  beginTurn(room, room.roundStartPlayerId);
}

function buildDeckWithInstances(room) {
  const cards = CARD_ORDER.flatMap((card) => Array.from({ length: CARD_DEFS[card].count }, () => ({
    uid: `${card}-${room.cardSerial++}`,
    card
  })));
  return shuffle(cards);
}

function beginTurn(room, playerId) {
  const next = nextActivePlayer(room, playerId, { includeCurrent: true });
  if (!next) return endRoundByRemaining(room);
  next.protected = false;
  room.currentPlayerId = next.id;
  const phaseKey = next.pendingDrawActionPhaseKey && next.actionInfo?.phaseKey === next.pendingDrawActionPhaseKey
    ? next.pendingDrawActionPhaseKey
    : null;
  next.pendingDrawActionPhaseKey = null;
  if (!drawFromDeckToPlayer(room, next, { phaseKey })) return endRoundByDeck(room);
  room.phase = "playing";
}

function playCard(room, actor, payload) {
  if (room.phase !== "playing") return "現在不能出牌。";
  if (room.currentPlayerId !== actor.id) return "還沒輪到你。";
  if (actor.eliminated) return "你已經出局。";
  const cardInstance = actor.hand.find((item) => item.uid === payload.cardId);
  if (!cardInstance) return "你沒有這張牌。";
  const legalError = validatePlayableCard(actor, cardInstance.card);
  if (legalError) return legalError;
  const payloadError = validatePlayPayload(room, actor, cardInstance.card, payload);
  if (payloadError) return payloadError;

  removeCardInstance(actor.hand, cardInstance.uid);
  actor.discardPile.push(cardInstance);
  const actionPhase = actionPhaseKey(room, cardInstance.card);
  const publicActionMessage = `${playerSeatLabel(room, actor)} 打出 ${cardName(cardInstance.card)}${payload.targetId ? `，指定 ${playerSeatLabelById(room, payload.targetId)}` : ""}。`;
  addLog(room, publicActionMessage);
  setPublicActionInfo(room, actionPhase, publicActionMessage);

  const effectError = applyCardEffect(room, actor, cardInstance, payload);
  if (effectError) return effectError;
  if (room.phase === "pendingChancellor" || room.phase === "roundResult" || room.phase === "matchResult") {
    touch(room);
    return null;
  }
  completeTurn(room, actor);
  touch(room);
  return null;
}

function validatePlayableCard(actor, card) {
  const cards = actor.hand.map((item) => item.card);
  if (card !== "countess" && cards.includes("countess") && (cards.includes("king") || cards.includes("prince"))) {
    return "你同時持有伯爵夫人與國王或王子時，必須打出伯爵夫人。";
  }
  return null;
}

function validatePlayPayload(room, actor, card, payload) {
  if (card === "guard") {
    if (legalOpponentTargets(room, actor).length === 0) return null;
    if (!targetableOpponent(room, actor.id, payload.targetId)) return "請指定一位未受保護的其他玩家。";
    if (!CARD_DEFS[payload.guessCardId] || payload.guessCardId === "guard") return "衛兵必須猜一張非衛兵的牌。";
  }
  if (["priest", "baron", "king"].includes(card) && !targetableOpponent(room, actor.id, payload.targetId)) {
    return `請指定一位未受保護的其他玩家。`;
  }
  if (card === "prince") {
    const target = playerById(room, payload.targetId);
    if (!target || target.eliminated) return "請指定一位仍在局內的玩家。";
    if (target.id !== actor.id && target.protected) return "不能指定受侍女保護的玩家。";
  }
  return null;
}

function applyCardEffect(room, actor, cardInstance, payload) {
  const card = cardInstance.card;
  if (card === "spy" || card === "countess") return null;
  if (card === "guard") {
    if (legalOpponentTargets(room, actor).length === 0) {
      publishPublicActionInfo(room, actionPhaseKey(room, "guard"), `${playerSeatLabel(room, actor)} 打出衛兵，但沒有可指定的目標，無效果。`);
      return null;
    }
    const target = playerById(room, payload.targetId);
    const phaseKey = actionPhaseKey(room, "guard");
    const guessed = cardName(payload.guessCardId);
    const isHit = target.hand.some((item) => item.card === payload.guessCardId);
    if (isHit) {
      publishPublicActionInfo(room, phaseKey, `${playerSeatLabel(room, actor)} 猜 ${playerSeatLabel(room, target)} 是 ${guessed}：猜中，${playerSeatLabel(room, target)} 出局。`);
      eliminatePlayer(room, target, `${actor.name} 用衛兵猜中 ${target.name} 的 ${guessed}。`);
    } else {
      publishPublicActionInfo(room, phaseKey, `${playerSeatLabel(room, actor)} 猜 ${playerSeatLabel(room, target)} 是 ${guessed}：未猜中。`);
    }
    return null;
  }
  if (card === "priest") {
    const target = playerById(room, payload.targetId);
    setPrivateActionInfo(actor, actionPhaseKey(room, "priest"), `${target.name} 的手牌是 ${target.hand.map((item) => cardName(item.card)).join("、")}。`);
    return null;
  }
  if (card === "baron") {
    const target = playerById(room, payload.targetId);
    const actorValue = highestHandValue(actor);
    const targetValue = highestHandValue(target);
    const phaseKey = actionPhaseKey(room, "baron");
    setPrivateActionInfo(actor, phaseKey, `你與 ${target.name} 比牌：你是 ${actorValue}，對方是 ${targetValue}。`);
    setPrivateActionInfo(target, phaseKey, `${actor.name} 與你比牌：對方是 ${actorValue}，你是 ${targetValue}。`);
    if (actorValue > targetValue) {
      publishPublicActionInfo(room, phaseKey, `${playerSeatLabel(room, actor)} 與 ${playerSeatLabel(room, target)} 發動男爵比牌：${playerSeatLabel(room, actor)} 的手牌點數較大，${playerSeatLabel(room, target)} 出局。`);
      eliminatePlayer(room, target, `${target.name} 在男爵比牌中出局。`);
    }
    if (targetValue > actorValue) {
      publishPublicActionInfo(room, phaseKey, `${playerSeatLabel(room, actor)} 與 ${playerSeatLabel(room, target)} 發動男爵比牌：${playerSeatLabel(room, target)} 的手牌點數較大，${playerSeatLabel(room, actor)} 出局。`);
      eliminatePlayer(room, actor, `${actor.name} 在男爵比牌中出局。`);
    }
    if (actorValue === targetValue) {
      publishPublicActionInfo(room, phaseKey, `${playerSeatLabel(room, actor)} 與 ${playerSeatLabel(room, target)} 發動男爵比牌：手牌點數相同，無人出局。`);
    }
    return null;
  }
  if (card === "handmaid") {
    actor.protected = true;
    return null;
  }
  if (card === "prince") {
    const target = playerById(room, payload.targetId);
    discardHandForPrince(room, actor, target);
    return null;
  }
  if (card === "chancellor") {
    const drawn = [drawFromDeck(room), drawFromDeck(room)].filter(Boolean);
    if (!drawn.length) return null;
    actor.hand.push(...drawn);
    drawn.forEach((item) => setDrawActionInfo(room, actor, item, actionPhaseKey(room, "chancellor")));
    room.phase = "pendingChancellor";
    room.pendingAction = {
      type: "chancellor",
      actorId: actor.id,
      drawnCardIds: drawn.map((item) => item.uid)
    };
    return null;
  }
  if (card === "king") {
    const target = playerById(room, payload.targetId);
    const actorHand = actor.hand;
    const targetHand = target.hand;
    actor.hand = targetHand;
    target.hand = actorHand;
    const phaseKey = actionPhaseKey(room, "king");
    publishPublicActionInfo(room, phaseKey, `${playerSeatLabel(room, actor)} 與 ${playerSeatLabel(room, target)} 交換了手牌。`);
    setPrivateActionInfo(actor, phaseKey, `你用 ${cardsLabel(actorHand)} 和 ${playerSeatLabel(room, target)} 交換了 ${cardsLabel(targetHand)}。`);
    setPrivateActionInfo(target, phaseKey, `你用 ${cardsLabel(targetHand)} 和 ${playerSeatLabel(room, actor)} 交換了 ${cardsLabel(actorHand)}。`);
    target.pendingDrawActionPhaseKey = phaseKey;
    return null;
  }
  if (card === "princess") {
    eliminatePlayer(room, actor, `${actor.name} 打出公主並出局。`);
  }
  return null;
}

function chooseChancellorKeep(room, actor, payload) {
  const pending = room.pendingAction;
  if (room.phase !== "pendingChancellor" || pending?.type !== "chancellor") return "現在沒有大臣效果。";
  if (pending.actorId !== actor.id) return "只有打出大臣的玩家可以選牌。";
  const keepId = String(payload.keepCardInstanceId || "");
  const bottomIds = Array.isArray(payload.bottomCardInstanceIds) ? payload.bottomCardInstanceIds.map(String) : [];
  const availableIds = actor.hand.map((item) => item.uid);
  if (!availableIds.includes(keepId)) return "請選擇要保留的牌。";
  const expectedBottomCount = actor.hand.length - 1;
  if (bottomIds.length !== expectedBottomCount || new Set(bottomIds).size !== bottomIds.length) return "請排好要放回牌庫底的牌。";
  if (bottomIds.some((id) => id === keepId || !availableIds.includes(id))) return "放回牌庫底的牌不正確。";
  const bottomCards = bottomIds.map((id) => actor.hand.find((item) => item.uid === id));
  actor.hand = actor.hand.filter((item) => item.uid === keepId);
  room.deck.unshift(...bottomCards);
  const phaseKey = actionPhaseKey(room, "chancellor");
  publishPublicActionInfo(room, phaseKey, `${playerSeatLabel(room, actor)} 完成大臣效果。`);
  setPrivateActionInfo(actor, phaseKey, `你保留 ${cardName(actor.hand[0].card)}，將 ${bottomCards.length} 張牌放回牌庫底。`);
  room.pendingAction = null;
  room.phase = "playing";
  completeTurn(room, actor);
  touch(room);
  return null;
}

function discardHandForPrince(room, actor, target) {
  const discarded = target.hand.splice(0);
  target.discardPile.push(...discarded);
  const phaseKey = actionPhaseKey(room, "prince");
  if (discarded.some((item) => item.card === "princess")) {
    publishPublicActionInfo(room, phaseKey, `${playerSeatLabel(room, actor)} 使用王子，${playerSeatLabel(room, target)} 棄掉公主並出局。`);
    eliminatePlayer(room, target, `${target.name} 因王子棄掉公主並出局。`);
    return;
  }
  const deckReplacement = drawFromDeck(room);
  const replacement = deckReplacement || takeBurnCard(room);
  if (replacement && !target.eliminated) {
    target.hand.push(replacement);
    if (deckReplacement) {
      setDrawActionInfo(room, target, replacement, phaseKey);
      publishPublicActionInfo(room, phaseKey, `${playerSeatLabel(room, actor)} 使用王子，${playerSeatLabel(room, target)} 棄掉手牌並從牌庫抽一張。`);
    } else {
      setPrivateActionInfo(target, phaseKey, `你從蓋牌抽到了 ${cardName(replacement.card)}。`);
      publishPublicActionInfo(room, phaseKey, `${playerSeatLabel(room, actor)} 使用王子，${playerSeatLabel(room, target)} 抽走了蓋牌。`);
    }
  }
}

function completeTurn(room, actor) {
  if (activePlayers(room).length <= 1) return endRoundByRemaining(room);
  if (room.deck.length === 0) return endRoundByDeck(room);
  const next = nextActivePlayerAfter(room, actor.id);
  if (!next) return endRoundByRemaining(room);
  beginTurn(room, next.id);
}

function endRoundByRemaining(room) {
  const winners = activePlayers(room);
  return endRound(room, {
    type: "lastStanding",
    winnerIds: winners.map((player) => player.id),
    reason: "只剩一位玩家仍在局內。"
  });
}

function endRoundByDeck(room) {
  const contenders = activePlayers(room);
  if (contenders.length <= 1) return endRoundByRemaining(room);
  const high = Math.max(...contenders.map(highestHandValue));
  const winners = contenders.filter((player) => highestHandValue(player) === high);
  const winnerIds = winners.map((player) => player.id);
  appendPublicActionInfo(
    room,
    actionPhaseKey(room, "deck_empty"),
    `牌庫耗盡，公開所有未出局玩家手牌。${winners.map((player) => playerSeatLabel(room, player)).join("、")} 點數最大，本局得分。`
  );
  return endRound(room, {
    type: "deckEmpty",
    winnerIds,
    reason: "牌庫耗盡，比較手牌數值。"
  });
}

function endRound(room, outcome) {
  const roundScores = Object.fromEntries(room.players.map((player) => [player.id, 0]));
  outcome.winnerIds.forEach((winnerId) => { roundScores[winnerId] += 1; });
  const spyPlayers = room.players.filter((player) => player.discardPile.some((item) => item.card === "spy"));
  if (spyPlayers.length === 1) roundScores[spyPlayers[0].id] += 1;
  Object.entries(roundScores).forEach(([targetPlayerId, score]) => {
    playerById(room, targetPlayerId).score += score;
  });
  const topScore = Math.max(...room.players.map((player) => player.score));
  const matchWinners = topScore >= room.settings.targetScore
    ? room.players.filter((player) => player.score === topScore).map(publicPlayer)
    : [];
  room.roundResult = {
    type: outcome.type,
    reason: outcome.reason,
    winnerIds: outcome.winnerIds,
    spyBonusPlayerId: spyPlayers.length === 1 ? spyPlayers[0].id : null,
    revealedHands: revealedHandsForRound(room, outcome.winnerIds),
    roundScores,
    totalScores: Object.fromEntries(room.players.map((player) => [player.id, player.score])),
    reachedMatchEnd: matchWinners.length > 0
  };
  room.matchResult = matchWinners.length ? {
    winners: matchWinners,
    scores: Object.fromEntries(room.players.map((player) => [player.id, player.score]))
  } : null;
  room.pendingAction = null;
  room.currentPlayerId = null;
  room.phase = matchWinners.length ? "matchResult" : "roundResult";
  addLog(room, roundResultText(room));
}

function revealedHandsForRound(room, winnerIds = []) {
  const winners = new Set(winnerIds);
  return room.players.map((player) => ({
    playerId: player.id,
    cards: player.hand.map(publicCard),
    highestValue: highestHandValue(player),
    isWinner: winners.has(player.id)
  }));
}

function eliminatePlayer(room, player, message) {
  player.eliminated = true;
  player.protected = false;
  addLog(room, message);
  if (activePlayers(room).length <= 1) endRoundByRemaining(room);
}

function makeView(room, playerId) {
  const you = playerById(room, playerId);
  return {
    type: "state",
    room: {
      code: room.code,
      version: room.version,
      phase: room.phase,
      hostId: room.hostId,
      hostOfflineSince: room.hostOfflineSince,
      settings: { ...room.settings },
      players: room.players.map((player, index) => ({
        id: player.id,
        name: player.name,
        online: player.online,
        ready: player.ready,
        roll: player.roll,
        score: player.score,
        handCount: player.hand.length,
        discardPile: player.discardPile.map(publicCard),
        eliminated: player.eliminated,
        protected: player.protected,
        index
      })),
      deckCount: room.deck.length,
      publicBurnCards: room.publicBurnCards.map(publicCard),
      currentPlayerId: room.currentPlayerId,
      roundStartPlayerId: room.roundStartPlayerId,
      roundNumber: room.roundNumber,
      pendingAction: publicPendingAction(room.pendingAction),
      roundResult: room.roundResult ? { ...room.roundResult } : null,
      matchResult: room.matchResult ? { ...room.matchResult } : null,
      chat: room.chat.slice(),
      log: room.log.slice(),
      playerJoinEvents: room.playerJoinEvents.slice(-20)
    },
    you: you ? {
      id: you.id,
      name: you.name,
      isHost: you.id === room.hostId,
      hand: you.hand.map(privateCard),
      actionInfo: you.actionInfo ? {
        phaseKey: you.actionInfo.phaseKey,
        messages: [...you.actionInfo.messages]
      } : null,
      playableCards: you.hand.map((item) => ({
        ...privateCard(item),
        playable: !validatePlayableCard(you, item.card)
      })),
      legalTargets: legalTargetsForView(room, you),
      pendingAction: privatePendingAction(room, you.id)
    } : null,
    cards: CARD_DEFS
  };
}

function publicPendingAction(pending) {
  if (!pending) return null;
  if (pending.type === "chancellor") return { type: "chancellor", actorId: pending.actorId };
  return { type: pending.type };
}

function privatePendingAction(room, targetPlayerId) {
  const pending = room.pendingAction;
  if (pending?.type === "chancellor" && pending.actorId === targetPlayerId) {
    const actor = playerById(room, targetPlayerId);
    return {
      type: "chancellor",
      cards: actor.hand.map(privateCard),
      drawnCardIds: [...pending.drawnCardIds]
    };
  }
  return null;
}

function legalTargetsForView(room, actor) {
  const opponentTargets = legalOpponentTargets(room, actor).map((player) => player.id);
  return {
    guard: opponentTargets,
    priest: opponentTargets,
    baron: opponentTargets,
    king: opponentTargets,
    prince: room.players.filter((player) => !player.eliminated && (player.id === actor.id || !player.protected)).map((player) => player.id)
  };
}

function legalOpponentTargets(room, actor) {
  return room.players.filter((player) => targetableOpponent(room, actor.id, player.id));
}

function targetableOpponent(room, actorId, targetPlayerId) {
  const target = playerById(room, targetPlayerId);
  return Boolean(target && target.id !== actorId && !target.eliminated && !target.protected);
}

function drawFromDeckToPlayer(room, player, { phaseKey = null } = {}) {
  const card = drawFromDeck(room);
  if (!card) return false;
  player.hand.push(card);
  setDrawActionInfo(room, player, card, phaseKey || drawPhaseKey(room));
  return true;
}

function drawFromDeck(room) {
  return room.deck.pop() || null;
}

function takeBurnCard(room) {
  const card = room.burnCard;
  room.burnCard = null;
  return card;
}

function activePlayers(room) {
  return room.players.filter((player) => !player.eliminated);
}

function nextActivePlayerAfter(room, playerId) {
  const start = room.players.findIndex((player) => player.id === playerId);
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const player = room.players[(start + offset + room.players.length) % room.players.length];
    if (!player.eliminated) return player;
  }
  return null;
}

function nextActivePlayer(room, playerId, { includeCurrent = false } = {}) {
  const start = room.players.findIndex((player) => player.id === playerId);
  const firstOffset = includeCurrent ? 0 : 1;
  for (let offset = firstOffset; offset < room.players.length + firstOffset; offset += 1) {
    const player = room.players[(start + offset + room.players.length) % room.players.length];
    if (!player.eliminated) return player;
  }
  return null;
}

function highestHandValue(player) {
  if (!player?.hand?.length) return -1;
  return Math.max(...player.hand.map((item) => CARD_DEFS[item.card].value));
}

function resetPlayerRoundState(player) {
  player.hand = [];
  player.discardPile = [];
  player.eliminated = false;
  player.protected = false;
  player.actionInfo = null;
  player.pendingDrawActionPhaseKey = null;
  player.ready = false;
}

function playersByRoll(room) {
  return [...room.players].sort((left, right) => (
    Number(right.roll || 0) - Number(left.roll || 0)
    || Number(right.rollTie || 0) - Number(left.rollTie || 0)
  ));
}

function publicCard(item) {
  return { uid: item.uid, id: item.card, name: cardName(item.card), value: CARD_DEFS[item.card].value };
}

function privateCard(item) {
  return publicCard(item);
}

function publicPlayer(player) {
  return { id: player.id, name: player.name, score: player.score };
}

function playerById(room, targetPlayerId) {
  return room.players.find((player) => player.id === targetPlayerId);
}

function playerName(room, targetPlayerId) {
  return playerById(room, targetPlayerId)?.name || "未知玩家";
}

function playerSeatLabel(room, player) {
  if (!player) return "未知玩家";
  const index = room.players.findIndex((item) => item.id === player.id);
  return index >= 0 ? `#${index + 1} ${player.name}` : player.name;
}

function playerSeatLabelById(room, targetPlayerId) {
  return playerSeatLabel(room, playerById(room, targetPlayerId));
}

function removeCardInstance(cards, uid) {
  const index = cards.findIndex((item) => item.uid === uid);
  if (index >= 0) cards.splice(index, 1);
}

function cardName(card) {
  return CARD_DEFS[card]?.name || card;
}

function cardsLabel(cards) {
  return cards.map((item) => cardName(item.card)).join("、") || "沒有手牌";
}

function actionPhaseKey(room, card) {
  return `${card}:${room.version}`;
}

function drawPhaseKey(room) {
  return `draw:${room.roundNumber}:${room.version}`;
}

function setDrawActionInfo(room, player, card, phaseKey = drawPhaseKey(room)) {
  setPrivateActionInfo(player, phaseKey, `你從牌庫抽到了 ${cardName(card.card)}。`);
}

function roundResultText(room) {
  const winners = (room.roundResult?.winnerIds || []).map((winnerId) => playerName(room, winnerId)).join("、");
  return `本局結束：${winners || "無人"} 得分。`;
}

function chat(room, actor, message) {
  const clean = String(message || "").replace(/\s+/g, " ").trim().slice(0, 240);
  if (!clean) return "聊天訊息不能是空的。";
  room.chat.push({ id: room.nextChatId++, playerId: actor.id, name: actor.name, message: clean, at: Date.now() });
  touch(room);
  return null;
}

function setPublicActionInfo(room, phaseKey, messages) {
  room.players.forEach((player) => appendActionInfo(player, phaseKey, messages));
}

function publishPublicActionInfo(room, phaseKey, message) {
  addLog(room, message);
  setPublicActionInfo(room, phaseKey, message);
}

function appendPublicActionInfo(room, fallbackPhaseKey, message) {
  addLog(room, message);
  room.players.forEach((player) => appendActionInfo(player, player.actionInfo?.phaseKey || fallbackPhaseKey, message));
}

function setPrivateActionInfo(player, phaseKey, messages) {
  appendActionInfo(player, phaseKey, messages);
}

function appendActionInfo(player, phaseKey, messages) {
  const nextMessages = Array.isArray(messages) ? messages : [messages];
  if (player.actionInfo?.phaseKey === phaseKey) {
    player.actionInfo.messages.push(...nextMessages);
    return;
  }
  player.actionInfo = { phaseKey, messages: [...nextMessages] };
}

function addSystemMessage(room, message) {
  room.chat.push({ id: room.nextChatId++, playerId: "system", name: "", message, at: Date.now() });
  addLog(room, message);
}

function addLog(room, message) {
  room.log.push(message);
}

function recordPlayerJoin(room, player) {
  room.playerJoinSerial += 1;
  room.playerJoinEvents.push({ serial: room.playerJoinSerial, playerId: player.id });
}

function touch(room) {
  room.version += 1;
  room.updatedAt = Date.now();
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 16);
}

function normalizedName(value) {
  return cleanName(value).toLocaleLowerCase();
}

module.exports = {
  CARD_DEFS,
  CARD_ORDER,
  PLAYER_COUNTS,
  DEFAULT_TARGET_SCORES,
  makeRoom,
  makePlayer,
  joinRoom,
  applyRoomAction,
  makeView,
  validateLobby,
  playersByRoll,
  buildDeckWithInstances,
  highestHandValue
};
