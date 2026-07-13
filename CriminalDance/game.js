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
const { cleanPlayerName } = require("../Shared/public/player-name");

const CARD_DEFS = Object.freeze({
  first_discoverer: { name: "第一發現者", basic: true },
  culprit: { name: "犯人", basic: true },
  alibi: { name: "不在場證明", basic: true },
  accomplice: { name: "共犯", basic: true },
  detective: { name: "偵探", basic: true },
  witness: { name: "目擊者", basic: true },
  ordinary: { name: "普通人", basic: true },
  dog: { name: "神犬", basic: true },
  information_exchange: { name: "情報交換", basic: true },
  rumor: { name: "謠言", basic: true },
  trade: { name: "交易", basic: true },
  inspector: { name: "警部", expansion: true },
  boy: { name: "少年", expansion: true }
});

const BASE_DECK_COUNTS = Object.freeze({
  first_discoverer: 1,
  culprit: 1,
  alibi: 5,
  accomplice: 2,
  detective: 4,
  witness: 3,
  ordinary: 2,
  dog: 1,
  information_exchange: 4,
  rumor: 5,
  trade: 4
});

const REQUIRED_COUNTS = Object.freeze({
  3: { first_discoverer: 1, culprit: 1, detective: 1, alibi: 1 },
  4: { first_discoverer: 1, culprit: 1, detective: 1, alibi: 1, accomplice: 1 },
  5: { first_discoverer: 1, culprit: 1, detective: 1, alibi: 2, accomplice: 1 },
  6: { first_discoverer: 1, culprit: 1, detective: 2, alibi: 2, accomplice: 2 },
  7: { first_discoverer: 1, culprit: 1, detective: 2, alibi: 3, accomplice: 2 }
});

const PLAYER_COUNTS = [3, 4, 5, 6, 7, 8];
const WINNING_SCORE = 10;

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
      expansions: {
        inspector: false,
        boy: false
      }
    },
    players: [],
    playerJoinSerial: 0,
    playerJoinEvents: [],
    deckList: [],
    initialCulpritId: null,
    currentPlayerId: null,
    startingPlayerId: null,
    turnNumber: 0,
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
    tableCards: [],
    publicCards: [],
    actionInfo: null,
    openingConfirmed: false
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
    case "confirmOpeningInfo": return confirmOpeningInfo(room, actor);
    case "playCard": return playCard(room, actor, payload);
    case "confirmDetectiveResult": return confirmDetectiveResult(room, actor);
    case "dogDiscard": return dogDiscard(room, actor, payload.card);
    case "informationExchangeSelect": return informationExchangeSelect(room, actor, payload.card);
    case "rumorDraw": return rumorDraw(room, actor);
    case "tradeSelect": return tradeSelect(room, actor, payload.card);
    case "nextRound": return nextRound(room, actor);
    case "resetMatch": return resetMatch(room, actor);
    case "chat": return chat(room, actor, payload.message);
    default: return "未知的操作。";
  }
}

function transferHost(room, actor, playerId) {
  const error = sharedTransferHost({
    room,
    actor,
    playerId,
    addLog: (message) => addLog(room, message),
    addSystemMessage: (message) => addSystemMessage(room, message)
  });
  if (!error) touch(room);
  return error;
}

function kickOfflinePlayer(room, actor, playerId) {
  const error = sharedKickOfflinePlayer({
    room,
    actor,
    playerId,
    markEveryoneUnready: () => room.players.forEach((player) => { player.ready = false; }),
    addLog: (message) => addLog(room, message),
    addSystemMessage: (message) => addSystemMessage(room, message),
    afterKick: (target) => {
      target.hand = [];
      target.tableCards = [];
      target.publicCards = [];
      target.actionInfo = null;
      target.openingConfirmed = false;
    }
  });
  if (!error) touch(room);
  return error;
}

function updateSettings(room, actor, payload) {
  if (room.phase !== "lobby") return "遊戲開始後不能更改設定。";
  if (actor.id !== room.hostId) return "只有房主可以更改設定。";
  const playerCount = Number(payload.playerCount);
  if (!PLAYER_COUNTS.includes(playerCount)) return "玩家人數必須是 3 到 8 人。";
  if (room.players.length > playerCount) return "目前玩家數超過新的房間人數。";
  room.settings.playerCount = playerCount;
  room.settings.expansions = {
    inspector: Boolean(payload.expansions?.inspector),
    boy: Boolean(payload.expansions?.boy)
  };
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
  }
  setupRound(room);
  addLog(room, "新的一局開始。");
  touch(room);
  return null;
}

function confirmOpeningInfo(room, actor) {
  if (room.phase !== "playing") return "現在沒有開場資訊。";
  actor.openingConfirmed = true;
  touch(room);
  return null;
}

function setupRound(room) {
  const orderedPlayers = playersByRoll(room);
  room.players = orderedPlayers;
  const deck = shuffle(buildDeck(room.settings.playerCount, room.settings.expansions));
  room.deckList = [...deck].sort(compareCardName);
  room.players.forEach((player, index) => {
    player.seat = index;
    player.hand = deck.slice(index * 4, index * 4 + 4);
    player.tableCards = [];
    player.publicCards = [];
    player.actionInfo = null;
    player.openingConfirmed = false;
    player.ready = false;
  });
  room.roundResult = null;
  room.matchResult = null;
  room.pendingAction = null;
  room.phase = "playing";
  room.turnNumber = 0;
  const firstPlayer = room.players.find((player) => player.hand.includes("first_discoverer"));
  room.startingPlayerId = firstPlayer.id;
  room.currentPlayerId = firstPlayer.id;
  const initialCulprit = room.players.find((player) => player.hand.includes("culprit"));
  room.initialCulpritId = initialCulprit?.id || null;
}

function buildDeck(playerCount, expansions = {}) {
  if (!PLAYER_COUNTS.includes(Number(playerCount))) throw new Error("invalid player count");
  const sourceCounts = expansionAdjustedCounts(expansions);
  const required = playerCount === 8 ? {} : REQUIRED_COUNTS[playerCount];
  if (playerCount === 8) return expandCounts(sourceCounts);

  const deck = expandCounts(required);
  const poolCounts = subtractCounts(sourceCounts, required);
  const pool = shuffle(expandCounts(poolCounts));
  const needed = playerCount * 4 - deck.length;
  return deck.concat(pool.slice(0, needed));
}

function expansionAdjustedCounts(expansions = {}) {
  const counts = { ...BASE_DECK_COUNTS };
  if (expansions.inspector && counts.dog > 0) {
    counts.dog -= 1;
    counts.inspector = (counts.inspector || 0) + 1;
  }
  if (expansions.boy && counts.witness > 0) {
    counts.witness -= 1;
    counts.boy = (counts.boy || 0) + 1;
  }
  return counts;
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

function playCard(room, actor, payload) {
  if (room.phase !== "playing") return "現在不能出牌。";
  if (room.currentPlayerId !== actor.id) return "還沒輪到你。";
  const card = String(payload.card || "");
  const legalError = validatePlayableCard(room, actor, card);
  if (legalError) return legalError;
  const payloadError = validatePlayPayload(room, actor, card, payload);
  if (payloadError) return payloadError;

  removeCard(actor.hand, card);
  actor.tableCards.push(card);
  addLog(room, `${actor.name} 打出 ${cardName(card)}${payload.targetId ? `，指定 ${playerName(room, payload.targetId)}` : ""}。`);
  const phaseKey = actionPhaseKey(room, card);
  if (card !== "rumor") {
    setPublicActionInfo(
      room,
      phaseKey,
      `${playerSeatLabel(room, actor)} 打出 ${cardName(card)}${payload.targetId ? `，指定 ${playerSeatLabelById(room, payload.targetId)}` : ""}。`
    );
  }

  if (card === "first_discoverer" || card === "alibi" || card === "ordinary" || card === "boy") {
    if (card === "first_discoverer") actor.openingConfirmed = true;
    return completeSimpleTurn(room);
  }
  if (card === "accomplice") {
    return completeSimpleTurn(room);
  }
  if (card === "culprit") {
    return endRound(room, { type: "culprit", actorId: actor.id, culpritId: actor.id });
  }
  if (card === "detective") {
    return detective(room, actor, payload.targetId);
  }
  if (card === "witness") {
    return witness(room, actor, payload.targetId);
  }
  if (card === "dog") {
    return dog(room, actor, payload.targetId);
  }
  if (card === "information_exchange") {
    return beginInformationExchange(room, actor);
  }
  if (card === "rumor") {
    return beginRumor(room, actor);
  }
  if (card === "trade") {
    return beginTrade(room, actor, payload.targetId, payload.giveCard);
  }
  if (card === "inspector") {
    return inspector(room, actor, payload.targetId);
  }
  return "未知的牌。";
}

function validatePlayPayload(room, actor, card, payload) {
  if (["detective", "witness", "dog", "inspector"].includes(card) && !otherPlayer(room, actor.id, payload.targetId)) {
    return "請指定其他玩家。";
  }
  if (card === "dog" && !otherPlayer(room, actor.id, payload.targetId)?.hand.length) {
    return `${cardName(card)}不能指定沒有手牌的玩家。`;
  }
  if (card === "trade") {
    const exchangeableCards = tradeExchangeableCards(actor);
    if (!exchangeableCards.length) return null;
    if (!otherPlayer(room, actor.id, payload.targetId)?.hand.length) {
      return "交易不能指定沒有手牌的玩家。";
    }
    if (!exchangeableCards.includes(payload.giveCard)) return "請選擇一張要交換的手牌。";
  }
  return null;
}

function validatePlayableCard(room, actor, card) {
  if (!CARD_DEFS[card]) return "找不到這張牌。";
  if (!actor.hand.includes(card)) return "你沒有這張牌。";
  if (room.turnNumber === 0 && actor.id === room.startingPlayerId && card !== "first_discoverer") {
    return "第一回合必須打出第一發現者。";
  }
  if (card === "culprit" && actor.hand.length !== 1) return "犯人必須是最後一張手牌才能打出。";
  if ((card === "detective" || card === "inspector") && actor.hand.length > 3) {
    return `${cardName(card)}必須在手牌 3 張以下才能打出。`;
  }
  return null;
}

function completeSimpleTurn(room) {
  advanceTurn(room);
  touch(room);
  return null;
}

function detective(room, actor, targetId) {
  const target = otherPlayer(room, actor.id, targetId);
  if (!target) return "請指定其他玩家。";
  const caught = target.hand.includes("culprit") && !target.hand.includes("alibi");
  room.phase = "pendingDetectiveResult";
  room.pendingAction = {
    type: "detectiveResult",
    actorId: actor.id,
    targetId: target.id,
    caught,
    outcome: caught ? { type: "detective", actorId: actor.id, culpritId: target.id } : null
  };
  if (caught) {
    addLog(room, "偵探查到犯人，本局即將結束。");
    setPublicActionInfo(room, actionPhaseKey(room, "detective"), "偵探查到犯人，本局即將結束。");
  } else {
    addLog(room, "偵探沒有查到犯人。");
    setPublicActionInfo(room, actionPhaseKey(room, "detective"), "偵探沒有查到犯人。");
  }
  touch(room);
  return null;
}

function confirmDetectiveResult(room, actor) {
  const pending = room.pendingAction;
  if (room.phase !== "pendingDetectiveResult" || pending?.type !== "detectiveResult") return "現在沒有偵探結果。";
  if (actor.id !== pending.actorId) return "只有偵探可以確認結果。";
  if (pending.caught) return endRound(room, pending.outcome);
  room.phase = "playing";
  room.pendingAction = null;
  advanceTurn(room);
  touch(room);
  return null;
}

function witness(room, actor, targetId) {
  const target = otherPlayer(room, actor.id, targetId);
  if (!target) return "請指定其他玩家。";
  setPrivateActionInfo(
    actor,
    actionPhaseKey(room, "witness"),
    `${playerSeatLabel(room, target)} 的手牌：${target.hand.map(cardName).join("、") || "沒有手牌"}。`
  );
  advanceTurn(room);
  touch(room);
  return null;
}

function dog(room, actor, targetId) {
  const target = otherPlayer(room, actor.id, targetId);
  if (!target) return "請指定其他玩家。";
  if (!target.hand.length) return "神犬不能指定沒有手牌的玩家。";
  room.phase = "pendingDogDiscard";
  room.pendingAction = {
    type: "dogDiscard",
    actorId: actor.id,
    targetId: target.id
  };
  setPublicActionInfo(room, actionPhaseKey(room, "dog"), `${playerSeatLabel(room, target)} 需要因神犬棄一張牌。`);
  touch(room);
  return null;
}

function dogDiscard(room, actor, card) {
  const pending = room.pendingAction;
  if (room.phase !== "pendingDogDiscard" || pending?.type !== "dogDiscard") return "現在沒有神犬棄牌。";
  if (actor.id !== pending.targetId) return "只有被神犬指定的玩家可以棄牌。";
  if (!actor.hand.includes(card)) return "你沒有這張牌。";
  removeCard(actor.hand, card);
  addLog(room, `${actor.name} 因神犬棄掉一張牌。`);
  setPublicActionInfo(room, actionPhaseKey(room, "dog"), `${playerSeatLabel(room, actor)} 因神犬棄掉一張牌。`);
  if (card === "culprit") {
    addLog(room, "神犬抓到犯人。");
    setPublicActionInfo(room, actionPhaseKey(room, "dog"), "神犬抓到犯人。");
    return endRound(room, { type: "dog", actorId: pending.actorId, culpritId: actor.id });
  }
  const dogUser = playerById(room, pending.actorId);
  removeCard(dogUser.tableCards, "dog");
  actor.hand.push("dog");
  setPublicActionInfo(room, actionPhaseKey(room, "dog"), `神犬交給 ${playerSeatLabel(room, actor)}。`);
  room.pendingAction = null;
  room.phase = "playing";
  advanceTurn(room);
  touch(room);
  return null;
}

function beginInformationExchange(room) {
  const snapshot = handSnapshot(room);
  const selections = {};
  room.players.forEach((player) => {
    if (!snapshot[player.id].length) selections[player.id] = null;
  });
  room.phase = "pendingInformationExchange";
  room.pendingAction = {
    type: "informationExchange",
    snapshot,
    selections
  };
  setPublicActionInfo(room, actionPhaseKey(room, "information_exchange"), "情報交換正在發動，所有有手牌的玩家選一張牌。");
  if (Object.keys(selections).length === room.players.length) completeInformationExchange(room);
  touch(room);
  return null;
}

function informationExchangeSelect(room, actor, card) {
  const pending = room.pendingAction;
  if (room.phase !== "pendingInformationExchange" || pending?.type !== "informationExchange") {
    return "現在沒有情報交換。";
  }
  if (!pending.snapshot[actor.id].includes(card)) return "只能選擇效果開始時持有的手牌。";
  pending.selections[actor.id] = card;
  if (Object.keys(pending.selections).length === room.players.length) completeInformationExchange(room);
  touch(room);
  return null;
}

function completeInformationExchange(room) {
  const pending = room.pendingAction;
  const moves = [];
  room.players.forEach((player) => {
    const card = pending.selections[player.id];
    if (!card) return;
    const target = leftPlayer(room, player.id);
    moves.push({ from: player, to: target, card });
  });
  moves.forEach(({ from, card }) => removeCard(from.hand, card));
  moves.forEach(({ to, card }) => to.hand.push(card));
  moves.forEach(({ from, to, card }) => {
    setPrivateActionInfo(from, actionPhaseKey(room, "information_exchange"), `順時針給 ${playerSeatLabel(room, to)}「${cardName(card)}」。`);
    setPrivateActionInfo(to, actionPhaseKey(room, "information_exchange"), `從逆時針 ${playerSeatLabel(room, from)} 收到「${cardName(card)}」。`);
  });
  addLog(room, "所有玩家完成情報交換。");
  setPublicActionInfo(room, actionPhaseKey(room, "information_exchange"), "所有玩家完成情報交換。");
  room.phase = "playing";
  room.pendingAction = null;
  advanceTurn(room);
}

function beginRumor(room, actor) {
  const order = clockwisePlayersFrom(room, actor.id).map((player) => player.id);
  room.phase = "pendingRumor";
  room.pendingAction = {
    type: "rumor",
    actorId: actor.id,
    snapshot: handSnapshot(room),
    order,
    confirmations: {},
    stagedDraws: [],
    removedBySource: Object.fromEntries(room.players.map((player) => [player.id, []]))
  };
  addLog(room, `謠言正在發動，由 ${actor.name} 開始。`);
  touch(room);
  return null;
}

function rumorDraw(room, actor) {
  const pending = room.pendingAction;
  if (room.phase !== "pendingRumor" || pending?.type !== "rumor") return "現在沒有謠言。";
  if (!pending.order.includes(actor.id)) return "你不在謠言流程中。";
  if (pending.confirmations[actor.id]) return "你已經確認謠言抽牌。";
  pending.confirmations[actor.id] = true;
  if (Object.keys(pending.confirmations).length < pending.order.length) {
    touch(room);
    return null;
  }
  resolveRumorDraws(room, pending);
  completeRumor(room, pending);
  return null;
}

function resolveRumorDraws(room, pending) {
  pending.order.forEach((playerId) => {
    const actor = playerById(room, playerId);
    const source = rightPlayer(room, actor.id);
    const sourceCards = availableSnapshotCards(pending.snapshot[source.id] || [], pending.removedBySource[source.id] || []);
    if (sourceCards.length) {
      const card = sourceCards[randomIntInclusive(0, sourceCards.length - 1)];
      pending.stagedDraws.push({ playerId: actor.id, sourceId: source.id, card });
      pending.removedBySource[source.id].push(card);
    } else {
      pending.stagedDraws.push({ playerId: actor.id, sourceId: source.id, card: null });
    }
  });
}

function completeRumor(room, pending) {
  room.players.forEach((player) => {
    const removed = [...(pending.removedBySource[player.id] || [])];
    player.hand = (pending.snapshot[player.id] || []).filter((card) => !removeOneFromList(removed, card));
  });
  pending.stagedDraws.forEach(({ playerId, sourceId, card }) => {
    const player = playerById(room, playerId);
    const source = playerById(room, sourceId);
    if (!card) {
      setPrivateActionInfo(player, actionPhaseKey(room, "rumor"), `逆時針的 ${playerSeatLabel(room, source)} 沒有可抽的牌。`);
      return;
    }
    player.hand.push(card);
    setPrivateActionInfo(player, actionPhaseKey(room, "rumor"), `逆時針從 ${playerSeatLabel(room, source)} 抽到「${cardName(card)}」。`);
    setPrivateActionInfo(source, actionPhaseKey(room, "rumor"), `${playerSeatLabel(room, player)} 從你這裡抽走「${cardName(card)}」。`);
  });
  addLog(room, "所有玩家完成謠言抽牌。");
  room.phase = "playing";
  room.pendingAction = null;
  advanceTurn(room);
  touch(room);
}

function availableSnapshotCards(cards, removedCards) {
  const removed = [...removedCards];
  return cards.filter((card) => !removeOneFromList(removed, card));
}

function clockwisePlayersFrom(room, playerId) {
  const start = room.players.findIndex((player) => player.id === playerId);
  if (start < 0) return [...room.players];
  return room.players.map((_, offset) => room.players[(start + offset) % room.players.length]);
}

function removeOneFromList(list, card) {
  const index = list.indexOf(card);
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}

function beginTrade(room, actor, targetId, giveCard) {
  const exchangeableCards = tradeExchangeableCards(actor);
  if (!exchangeableCards.length) {
    setPublicActionInfo(room, actionPhaseKey(room, "trade"), `${playerSeatLabel(room, actor)} 沒有可交換的手牌，交易無效果。`);
    return completeSimpleTurn(room);
  }
  const target = otherPlayer(room, actor.id, targetId);
  if (!target) return "請指定其他玩家。";
  if (!target.hand.length) return "交易不能指定沒有手牌的玩家。";
  if (!exchangeableCards.includes(giveCard)) return "請選擇一張要交換的手牌。";
  room.phase = "pendingTrade";
  room.pendingAction = {
    type: "trade",
    actorId: actor.id,
    targetId: target.id,
    selections: {
      [actor.id]: giveCard
    }
  };
  setPublicActionInfo(room, actionPhaseKey(room, "trade"), `${playerSeatLabel(room, target)} 需要選一張手牌完成交易。`);
  touch(room);
  return null;
}

function tradeExchangeableCards(player) {
  return player.hand.filter((card) => card !== "trade");
}

function tradeSelect(room, actor, card) {
  const pending = room.pendingAction;
  if (room.phase !== "pendingTrade" || pending?.type !== "trade") return "現在沒有交易。";
  if (actor.id !== pending.targetId) return "只有交易對象需要選牌。";
  if (!actor.hand.includes(card)) return "你沒有這張牌。";
  const initiator = playerById(room, pending.actorId);
  const actorCard = pending.selections[initiator.id];
  if (!initiator.hand.includes(actorCard)) return "交易發起者的牌已不存在。";
  removeCard(initiator.hand, actorCard);
  removeCard(actor.hand, card);
  initiator.hand.push(card);
  actor.hand.push(actorCard);
  addLog(room, `${initiator.name} 和 ${actor.name} 完成交易。`);
  setPublicActionInfo(room, actionPhaseKey(room, "trade"), `${playerSeatLabel(room, initiator)} 和 ${playerSeatLabel(room, actor)} 完成交易。`);
  setPrivateActionInfo(initiator, actionPhaseKey(room, "trade"), `你交給 ${playerSeatLabel(room, actor)}「${cardName(actorCard)}」，收到「${cardName(card)}」。`);
  setPrivateActionInfo(actor, actionPhaseKey(room, "trade"), `你交給 ${playerSeatLabel(room, initiator)}「${cardName(card)}」，收到「${cardName(actorCard)}」。`);
  room.phase = "playing";
  room.pendingAction = null;
  advanceTurn(room);
  touch(room);
  return null;
}

function inspector(room, actor, targetId) {
  const target = otherPlayer(room, actor.id, targetId);
  if (!target) return "請指定其他玩家。";
  actor.publicCards.push({ card: "inspector", targetId: target.id });
  setPublicActionInfo(room, actionPhaseKey(room, "inspector"), `${playerSeatLabel(room, actor)} 對 ${playerSeatLabel(room, target)} 發動警部。`);
  advanceTurn(room);
  touch(room);
  return null;
}

function endRound(room, outcome) {
  const inspectorHit = inspectorHitOutcome(room, outcome);
  const finalOutcome = inspectorHit || outcome;
  const roundScores = scoreRound(room, finalOutcome);
  Object.entries(roundScores).forEach(([playerId, score]) => {
    playerById(room, playerId).score += score;
  });
  const topScore = Math.max(...room.players.map((player) => player.score));
  const finalWinners = topScore >= WINNING_SCORE
    ? room.players.filter((player) => player.score === topScore).map(publicPlayer)
    : [];
  room.roundResult = {
    type: finalOutcome.type,
    actorId: finalOutcome.actorId,
    culpritId: finalOutcome.culpritId,
    roundScores,
    totalScores: Object.fromEntries(room.players.map((player) => [player.id, player.score])),
    reachedMatchEnd: finalWinners.length > 0
  };
  room.matchResult = finalWinners.length ? {
    winners: finalWinners,
    scores: Object.fromEntries(room.players.map((player) => [player.id, player.score]))
  } : null;
  room.pendingAction = null;
  room.phase = finalWinners.length ? "matchResult" : "roundResult";
  addLog(room, roundResultText(room, finalOutcome));
  touch(room);
  return null;
}

function inspectorHitOutcome(room, outcome) {
  const culpritId = outcome.culpritId || currentCulprit(room)?.id;
  if (!culpritId) return null;
  const inspectorPlayer = room.players.find((player) => {
    return player.publicCards.some((item) => item.card === "inspector" && item.targetId === culpritId);
  });
  return inspectorPlayer ? { type: "inspector", actorId: inspectorPlayer.id, culpritId } : null;
}

function scoreRound(room, outcome) {
  const scores = Object.fromEntries(room.players.map((player) => [player.id, 0]));
  const culpritTeam = new Set([
    outcome.culpritId,
    ...room.players.filter((player) => player.tableCards.includes("accomplice")).map((player) => player.id)
  ]);
  if (outcome.type === "culprit") {
    culpritTeam.forEach((playerId) => { scores[playerId] = 2; });
    return scores;
  }
  if (outcome.type === "detective") {
    scores[outcome.actorId] = 2;
  } else if ((outcome.type === "dog" || outcome.type === "inspector") && !culpritTeam.has(outcome.actorId)) {
    scores[outcome.actorId] = 3;
  }
  room.players.forEach((player) => {
    if (player.id === outcome.actorId || culpritTeam.has(player.id)) return;
    scores[player.id] = 1;
  });
  return scores;
}

function nextRound(room, actor) {
  if (room.phase !== "roundResult") return "現在不能開始下一局。";
  if (actor.id !== room.hostId) return "只有房主可以開始下一局。";
  setupRound(room);
  addLog(room, "房主開始下一局。");
  touch(room);
  return null;
}

function resetMatch(room, actor) {
  if (actor.id !== room.hostId) return "只有房主可以重置整場遊戲。";
  if (room.phase !== "matchResult") return "整場結束後才能返回大廳。";
  room.players.forEach((player) => {
    player.score = 0;
    player.hand = [];
    player.tableCards = [];
    player.publicCards = [];
    player.actionInfo = null;
    player.openingConfirmed = false;
    player.ready = false;
    player.roll = null;
    player.rollTie = null;
  });
  room.phase = "lobby";
  room.deckList = [];
  room.initialCulpritId = null;
  room.currentPlayerId = null;
  room.startingPlayerId = null;
  room.turnNumber = 0;
  room.pendingAction = null;
  room.roundResult = null;
  room.matchResult = null;
  room.chat = [];
  room.log = [];
  addSystemMessage(room, "房主重置整場遊戲。");
  touch(room);
  return null;
}

function chat(room, actor, message) {
  const clean = String(message || "").replace(/\s+/g, " ").trim().slice(0, 240);
  if (!clean) return "聊天訊息不能是空的。";
  room.chat.push({ id: room.nextChatId++, playerId: actor.id, name: actor.name, message: clean, at: Date.now() });
  touch(room);
  return null;
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
      settings: { playerCount: room.settings.playerCount, expansions: { ...room.settings.expansions } },
      players: room.players.map((player, index) => ({
        id: player.id,
        name: player.name,
        online: player.online,
        ready: player.ready,
        roll: player.roll,
        score: player.score,
        handCount: player.hand.length,
        tableCards: [...player.tableCards],
        publicCards: player.publicCards.map((item) => ({ ...item })),
        index
      })),
      deckList: [...room.deckList],
      currentPlayerId: room.currentPlayerId,
      startingPlayerId: room.startingPlayerId,
      turnNumber: room.turnNumber,
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
      hand: you.hand.map((card) => ({ id: card, name: cardName(card) })),
      actionInfo: you.actionInfo ? {
        phaseKey: you.actionInfo.phaseKey,
        messages: [...you.actionInfo.messages]
      } : null,
      openingInfo: openingInfo(room, you),
      playableCards: you.hand.map((card) => {
        const reason = validatePlayableCard(room, you, card);
        return {
          id: card,
          name: cardName(card),
          playable: !reason,
          reason
        };
      }),
      pendingAction: privatePendingAction(room, you.id)
    } : null,
    cards: CARD_DEFS
  };
}

function publicPendingAction(pending) {
  if (!pending) return null;
  if (pending.type === "dogDiscard") return { type: pending.type, actorId: pending.actorId, targetId: pending.targetId };
  if (pending.type === "detectiveResult") {
    return { type: pending.type, actorId: pending.actorId, targetId: pending.targetId, caught: pending.caught };
  }
  if (pending.type === "informationExchange") {
    return {
      type: pending.type,
      selectedCount: Object.keys(pending.selections).length
    };
  }
  if (pending.type === "rumor") {
    return {
      type: "rumor",
      actorId: pending.actorId,
      confirmedPlayerIds: Object.keys(pending.confirmations),
      confirmedCount: Object.keys(pending.confirmations).length,
      totalCount: pending.order.length
    };
  }
  if (pending.type === "trade") return { type: pending.type, actorId: pending.actorId, targetId: pending.targetId };
  return { type: pending.type };
}

function privatePendingAction(room, playerId) {
  const pending = room.pendingAction;
  if (!pending) return null;
  if (pending.type === "dogDiscard" && pending.targetId === playerId) return { type: "dogDiscard" };
  if (pending.type === "informationExchange") {
    const cards = pending.snapshot[playerId] || [];
    const target = leftPlayer(room, playerId);
    return pending.selections[playerId] === undefined
      ? { type: "informationExchange", cards, targetId: target.id, targetName: target.name }
      : null;
  }
  if (pending.type === "rumor" && pending.order.includes(playerId) && !pending.confirmations[playerId]) {
    const source = rightPlayer(room, playerId);
    return { type: "rumorDraw", sourceId: source.id, sourceName: source.name };
  }
  if (pending.type === "trade" && pending.targetId === playerId) return { type: "trade" };
  return null;
}

function openingInfo(room, player) {
  if (room.phase !== "playing" || player.openingConfirmed) return null;
  const clues = [];
  if (player.hand.includes("boy")) {
    clues.push({
      type: "boy",
      title: "少年",
      message: `遊戲開始時，犯人牌在 ${playerSeatLabelById(room, room.initialCulpritId)} 手上。`
    });
  }
  if (room.turnNumber === 0 && player.hand.includes("first_discoverer") && player.id === room.startingPlayerId) {
    clues.push({
      type: "first_discoverer",
      title: "第一發現者",
      message: "你是起始玩家。確認後會直接打出第一發現者，開始本局第一回合。"
    });
  }
  return clues.length ? { clues } : null;
}

function advanceTurn(room) {
  const currentIndex = room.players.findIndex((player) => player.id === room.currentPlayerId);
  const startIndex = currentIndex >= 0 ? currentIndex : -1;
  const nextPlayer = nextPlayerWithHand(room, startIndex);
  if (nextPlayer) room.currentPlayerId = nextPlayer.id;
  room.turnNumber += 1;
}

function nextPlayerWithHand(room, startIndex) {
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const player = room.players[(startIndex + offset + room.players.length) % room.players.length];
    if (player.hand.length) return player;
  }
  return null;
}

function currentCulprit(room) {
  return room.players.find((player) => player.hand.includes("culprit"));
}

function handSnapshot(room) {
  return Object.fromEntries(room.players.map((player) => [player.id, [...player.hand]]));
}

function leftPlayer(room, playerId) {
  const index = room.players.findIndex((player) => player.id === playerId);
  return room.players[(index + 1) % room.players.length];
}

function rightPlayer(room, playerId) {
  const index = room.players.findIndex((player) => player.id === playerId);
  return room.players[(index - 1 + room.players.length) % room.players.length];
}

function playersByRoll(room) {
  return [...room.players].sort((left, right) => (
    Number(right.roll || 0) - Number(left.roll || 0)
    || Number(right.rollTie || 0) - Number(left.rollTie || 0)
  ));
}

function publicPlayer(player) {
  return { id: player.id, name: player.name, score: player.score };
}

function playerById(room, playerId) {
  return room.players.find((player) => player.id === playerId);
}

function otherPlayer(room, actorId, targetId) {
  return room.players.find((player) => player.id === targetId && player.id !== actorId);
}

function playerName(room, playerId) {
  return playerById(room, playerId)?.name || "未知玩家";
}

function playerSeatLabel(room, player) {
  if (!player) return "未知玩家";
  const index = room.players.findIndex((item) => item.id === player.id);
  return `#${index + 1} ${player.name}`;
}

function playerSeatLabelById(room, playerId) {
  return playerSeatLabel(room, playerById(room, playerId));
}

function actionPhaseKey(room, name) {
  return `${name}:${room.turnNumber}`;
}

function setPublicActionInfo(room, phaseKey, messages) {
  room.players.forEach((player) => appendActionInfo(player, phaseKey, messages));
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
  player.actionInfo = {
    phaseKey,
    messages: [...nextMessages]
  };
}

function cardName(card) {
  return CARD_DEFS[card]?.name || card;
}

function roundResultText(room, outcome) {
  const actorName = playerName(room, outcome.actorId);
  if (outcome.type === "culprit") return `${actorName} 打出犯人，本局結束。`;
  if (outcome.type === "detective") return `${actorName} 用偵探抓到犯人。`;
  if (outcome.type === "dog") return `${actorName} 用神犬抓到犯人。`;
  if (outcome.type === "inspector") return `${actorName} 用警部抓到犯人。`;
  return "本局結束。";
}

function expandCounts(counts) {
  return Object.entries(counts).flatMap(([card, count]) => Array.from({ length: count }, () => card));
}

function subtractCounts(counts, used) {
  const next = { ...counts };
  Object.entries(used || {}).forEach(([card, count]) => {
    next[card] = Number(next[card] || 0) - Number(count || 0);
    if (next[card] < 0) throw new Error(`required deck exceeds source count: ${card}`);
  });
  return next;
}

function compareCardName(left, right) {
  return cardName(left).localeCompare(cardName(right), "zh-Hant");
}

function removeCard(cards, card) {
  const index = cards.indexOf(card);
  if (index >= 0) cards.splice(index, 1);
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
  return cleanPlayerName(value);
}

function normalizedName(value) {
  return cleanName(value).toLocaleLowerCase();
}

module.exports = {
  CARD_DEFS,
  BASE_DECK_COUNTS,
  REQUIRED_COUNTS,
  WINNING_SCORE,
  makeRoom,
  makePlayer,
  joinRoom,
  applyRoomAction,
  makeView,
  validateLobby,
  buildDeck,
  expansionAdjustedCounts,
  playersByRoll,
  leftPlayer,
  rightPlayer,
  scoreRound
};
