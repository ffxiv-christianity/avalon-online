"use strict";

const {
  randomIntInclusive,
  randomTieBreak,
  shuffle,
  roomCode,
  playerId,
  randomDelay
} = require("../Shared/server/random");
const {
  transferHost: sharedTransferHost,
  kickOfflinePlayer: sharedKickOfflinePlayer
} = require("../Shared/server/room-actions");

const ROLE_DEFS = {
  doppelganger: {
    name: "化身幽靈",
    team: "neutral",
    max: 1,
    order: 0,
    description: "最早行動，查看一名玩家的初始角色並複製其能力與陣營；不同角色會立即、同時或延後行動。"
  },
  werewolf: {
    name: "狼人",
    team: "werewolf",
    max: 2,
    order: 10,
    description: "查看其他狼人。若你是唯一的狼人，可以查看一張中央牌。"
  },
  minion: {
    name: "爪牙",
    team: "werewolf",
    max: 1,
    order: 20,
    description: "查看所有狼人。狼人不知道你是誰；必要時可以代替狼人被處決。"
  },
  mason: {
    name: "守夜人",
    team: "village",
    max: 2,
    order: 25,
    description: "查看另一名守夜人。牌庫中必須同時放入兩張守夜人。"
  },
  seer: {
    name: "預言家",
    team: "village",
    max: 1,
    order: 30,
    description: "查看一名其他玩家的牌，或查看兩張中央牌。"
  },
  robber: {
    name: "強盜",
    team: "village",
    max: 1,
    order: 40,
    description: "可以和一名其他玩家交換牌，並查看自己換到的牌。"
  },
  troublemaker: {
    name: "搗蛋鬼",
    team: "village",
    max: 1,
    order: 50,
    description: "可以交換另外兩名玩家的牌，但不能查看牌面。"
  },
  drunk: {
    name: "酒鬼",
    team: "village",
    max: 1,
    order: 60,
    description: "必須將自己的牌與一張中央牌交換，但不能查看新牌。"
  },
  insomniac: {
    name: "失眠者",
    team: "village",
    max: 1,
    order: 70,
    description: "夜晚最後查看自己目前的牌。"
  },
  villager: {
    name: "村民",
    team: "village",
    max: 6,
    order: 99,
    description: "沒有夜間能力，依靠討論找出狼人。"
  },
  tanner: {
    name: "皮匠",
    team: "tanner",
    max: 1,
    order: 99,
    description: "沒有夜間能力。你的目標是讓自己在投票後遭到處決。"
  },
  hunter: {
    name: "獵人",
    team: "village",
    max: 1,
    order: 99,
    description: "沒有夜間能力。若你遭到處決，你可以選擇一名其他玩家開槍，使其一同出局。"
  }
};

const RECOMMENDED_DECKS = {
  3: ["werewolf", "seer", "robber", "troublemaker", "drunk", "villager"],
  4: ["werewolf", "werewolf", "seer", "robber", "troublemaker", "drunk", "villager"],
  5: ["werewolf", "werewolf", "seer", "robber", "troublemaker", "drunk", "insomniac", "villager"],
  6: ["werewolf", "werewolf", "minion", "seer", "robber", "troublemaker", "drunk", "insomniac", "villager"],
  7: ["werewolf", "werewolf", "minion", "mason", "mason", "seer", "robber", "troublemaker", "drunk", "insomniac"],
  8: ["werewolf", "werewolf", "minion", "mason", "mason", "seer", "robber", "troublemaker", "drunk", "insomniac", "villager"],
  9: ["werewolf", "werewolf", "minion", "mason", "mason", "seer", "robber", "troublemaker", "drunk", "insomniac", "villager", "villager"],
  10: ["werewolf", "werewolf", "minion", "mason", "mason", "seer", "robber", "troublemaker", "drunk", "insomniac", "villager", "villager", "villager"]
};

const NIGHT_ROLES = new Set(["doppelganger", "werewolf", "minion", "mason", "seer", "robber", "troublemaker", "drunk", "insomniac"]);
const NIGHT_ORDER = ["doppelganger", "werewolf", "minion", "mason", "seer", "robber", "troublemaker", "drunk", "insomniac", "doppelInsomniac"];
const DISPLAY_NIGHT_ORDER = NIGHT_ORDER.filter((role) => role !== "doppelInsomniac");
const DOPPEL_IMMEDIATE_ROLES = new Set(["minion", "seer", "robber", "troublemaker", "drunk"]);
const CENTER_DELAY_MIN_MS = 5000;
const CENTER_DELAY_MAX_MS = 9000;
const DOPPEL_INSOMNIAC_DELAY_MIN_MS = 5000;
const DOPPEL_INSOMNIAC_DELAY_MAX_MS = 9000;

function makeRoom(hostName, code = makeRoomCode()) {
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
      discussionSeconds: 300,
      deck: [...RECOMMENDED_DECKS[4]]
    },
    players: [],
    playerJoinSerial: 0,
    playerJoinEvents: [],
    initialCards: {},
    cards: {},
    centerInitial: [],
    centerCards: [],
    privateInfo: {},
    effectiveRoles: {},
    doppelCopiedRole: null,
    revealed: {},
    nightRoleIndex: -1,
    nightStage: null,
    doppelPendingRole: null,
    votes: {},
    pendingHunterIds: [],
    hunterShots: {},
    pendingVoteResult: null,
    result: null,
    discussionEndsAt: null,
    chat: [],
    nextChatId: 1,
    log: []
  };
  const player = makePlayer(hostName);
  room.hostId = player.id;
  room.players.push(player);
  recordPlayerJoin(room, player);
  addChat(room, "system", `${player.name} 建立了房間`);
  return { room, player };
}

function makePlayer(name) {
  return {
    id: playerId(),
    name: cleanName(name),
    roll: null,
    rollTie: null,
    ready: false,
    online: true
  };
}

function joinRoom(room, name, requestedPlayerId = "") {
  if (requestedPlayerId) {
    const existing = room.players.find((player) => player.id === requestedPlayerId);
    if (!existing) return { error: "找不到原本的玩家身分" };
    existing.online = true;
    return { player: existing };
  }
  if (room.phase !== "lobby") return { error: "遊戲已開始，只能由原玩家重新連線" };
  if (room.players.length >= room.settings.playerCount) return { error: "房間人數已滿" };
  const clean = cleanName(name);
  if (!clean) return { error: "請輸入名字" };
  if (room.players.some((player) => normalizedName(player.name) === normalizedName(clean))) {
    return { error: "這個名字已經有人使用" };
  }
  const player = makePlayer(clean);
  room.players.push(player);
  room.players.forEach((roomPlayer) => { roomPlayer.ready = false; });
  recordPlayerJoin(room, player);
  addChat(room, "system", `${player.name} 加入了房間`);
  touch(room);
  return { player };
}

function applyRoomAction(room, actor, action, payload = {}) {
  if (!room || !actor) return "找不到房間或玩家";
  switch (action) {
    case "transferHost": return applyHostTransfer(room, actor, payload.playerId);
    case "kickOfflinePlayer": return applyKickOfflinePlayer(room, actor, payload.playerId);
    case "updateSettings": return updateSettings(room, actor, payload);
    case "roll": return roll(room, actor);
    case "toggleReady": return toggleReady(room, actor);
    case "startGame": return startGame(room, actor);
    case "confirmReveal": return confirmReveal(room, actor);
    case "nightAction": return nightAction(room, actor, payload);
    case "vote": return vote(room, actor, payload.targetId);
    case "hunterShot": return hunterShot(room, actor, payload.targetId);
    case "returnLobby": return returnLobby(room, actor);
    case "chat": return chat(room, actor, payload.message);
    default: return "未知操作";
  }
}

function applyHostTransfer(room, actor, playerId) {
  const error = sharedTransferHost({
    room,
    actor,
    playerId,
    addLog: (message) => addLog(room, message),
    addSystemMessage: (message) => addChat(room, "system", message)
  });
  if (!error) touch(room);
  return error;
}

function applyKickOfflinePlayer(room, actor, playerId) {
  const error = sharedKickOfflinePlayer({
    room,
    actor,
    playerId,
    markEveryoneUnready: () => room.players.forEach((player) => { player.ready = false; }),
    addLog: (message) => addLog(room, message),
    addSystemMessage: (message) => addChat(room, "system", message),
    afterKick: (target) => {
      delete room.initialCards[target.id];
      delete room.cards[target.id];
      delete room.privateInfo[target.id];
      delete room.effectiveRoles[target.id];
      delete room.revealed[target.id];
      delete room.votes[target.id];
    }
  });
  if (!error) touch(room);
  return error;
}

function updateSettings(room, actor, payload) {
  if (room.phase !== "lobby") return "只能在準備房調整設定";
  if (actor.id !== room.hostId) return "只有房主可以調整設定";
  const playerCount = Number(payload.playerCount);
  if (!Number.isInteger(playerCount) || playerCount < 3 || playerCount > 10) return "目前支援 3～10 人";
  if (room.players.length > playerCount) return "目前玩家數超過設定人數";
  const discussionSeconds = clamp(Number(payload.discussionSeconds), 120, 900);
  let deck = [...room.settings.deck];
  if (payload.useRecommended) {
    deck = [...RECOMMENDED_DECKS[playerCount]];
  } else if (Array.isArray(payload.deck)) {
    deck = sanitizeDeck(payload.deck);
    if (!deck) return "牌庫包含無效角色或超過角色上限";
  }
  room.settings.playerCount = playerCount;
  room.settings.discussionSeconds = discussionSeconds;
  room.settings.deck = deck;
  room.players.forEach((player) => { player.ready = false; });
  touch(room);
  return null;
}

function roll(room, actor) {
  if (room.phase !== "lobby") return "目前不能擲骰";
  if (actor.roll) return "每局只能擲一次";
  actor.roll = randomIntInclusive(1, 100);
  actor.rollTie = randomTieBreak();
  actor.ready = false;
  touch(room);
  return null;
}

function toggleReady(room, actor) {
  if (room.phase !== "lobby") return "目前不能更改準備狀態";
  if (!actor.roll) return "請先擲 d100";
  actor.ready = !actor.ready;
  touch(room);
  return null;
}

function startGame(room, actor) {
  if (room.phase !== "lobby") return "遊戲已經開始";
  if (actor.id !== room.hostId) return "只有房主可以開始遊戲";
  const validation = validateLobby(room);
  if (validation.errors.length) return validation.errors[0];

  const deck = shuffle([...room.settings.deck]);
  room.initialCards = {};
  room.cards = {};
  room.privateInfo = {};
  room.effectiveRoles = {};
  room.doppelCopiedRole = null;
  const orderedPlayers = playersByRoll(room);
  orderedPlayers.forEach((player, index) => {
    room.initialCards[player.id] = deck[index];
    room.cards[player.id] = deck[index];
    room.effectiveRoles[player.id] = deck[index];
    room.privateInfo[player.id] = [];
    player.ready = false;
  });
  room.centerInitial = deck.slice(room.players.length);
  room.centerCards = [...room.centerInitial];
  room.revealed = {};
  room.nightRoleIndex = -1;
  room.nightStage = null;
  room.doppelPendingRole = null;
  room.votes = {};
  room.pendingHunterIds = [];
  room.hunterShots = {};
  room.pendingVoteResult = null;
  room.result = null;
  room.discussionEndsAt = null;
  room.phase = "reveal";
  addLog(room, "遊戲開始，所有玩家查看初始角色。");
  touch(room);
  return null;
}

function confirmReveal(room, actor) {
  if (room.phase !== "reveal") return "目前不是查看角色階段";
  room.revealed[actor.id] = true;
  if (room.players.every((player) => room.revealed[player.id])) beginNight(room);
  touch(room);
  return null;
}

function nightAction(room, actor, payload) {
  if (room.phase !== "night") return "目前不是夜晚";
  const stage = room.nightStage;
  if (!stage || !stage.actorIds.includes(actor.id)) return "目前不是你的行動";
  if (stage.completedIds.includes(actor.id)) return "你已完成這個角色階段";
  const role = stage.role === "doppelInsomniac" ? "insomniac" : stage.role;
  const actionRole = role === "doppelganger" && room.doppelPendingRole === actor.id
    ? room.doppelCopiedRole
    : role;
  const result = resolveNightRoleAction(room, actor, actionRole, payload);
  const error = result.error;
  const keepActing = result.keepActing;
  if (error) return error;
  if (!keepActing) {
    room.doppelPendingRole = room.doppelPendingRole === actor.id ? null : room.doppelPendingRole;
    stage.completedIds.push(actor.id);
  }
  if (!keepActing && nightStageReadyToAdvance(stage)) advanceNightStage(room);
  touch(room);
  return null;
}

const NIGHT_ROLE_ACTIONS = Object.freeze({
  doppelganger: resolveDoppelganger,
  werewolf: resolveWerewolf,
  minion: resolveMinion,
  mason: resolveMason,
  seer: resolveSeer,
  robber: resolveRobber,
  troublemaker: resolveTroublemaker,
  drunk: resolveDrunk,
  insomniac: resolveInsomniac
});

function resolveNightRoleAction(room, actor, role, payload) {
  const resolver = NIGHT_ROLE_ACTIONS[role];
  if (!resolver) return { error: null, keepActing: false };
  const result = resolver(room, actor, payload);
  if (typeof result === "string") return { error: result, keepActing: false };
  return {
    error: result?.error || null,
    keepActing: Boolean(result?.keepActing)
  };
}

function resolveDoppelganger(room, actor, payload) {
  const target = otherPlayer(room, actor.id, payload.targetId);
  if (!target) return { error: "請選擇一名其他玩家，複製他的初始角色" };
  const copiedRole = room.initialCards[target.id];
  room.doppelCopiedRole = copiedRole;
  room.effectiveRoles[actor.id] = copiedRole;
  remember(room, actor.id, `你複製了 ${target.name} 的「${ROLE_DEFS[copiedRole].name}」，本局視為該角色與陣營。`);

  if (!NIGHT_ROLES.has(copiedRole) || copiedRole === "doppelganger") return { keepActing: false };
  if (DOPPEL_IMMEDIATE_ROLES.has(copiedRole)) {
    if (copiedRole === "minion") {
      return resolveNightRoleAction(room, actor, copiedRole, payload);
    }
    room.doppelPendingRole = actor.id;
    return { keepActing: true };
  }
  return { keepActing: false };
}

function resolveWerewolf(room, actor, payload) {
  const others = room.players.filter((player) => player.id !== actor.id && finalRole(room, player.id) === "werewolf");
  if (others.length) {
    remember(room, actor.id, `其他狼人：${others.map((player) => player.name).join("、")}`);
    return null;
  }
  const centerIndex = Number(payload.centerIndex);
  if (!validCenterIndex(room, centerIndex)) return "你是唯一的狼人，請查看一張中央牌";
  remember(room, actor.id, centerMessage(room, centerIndex));
  return null;
}

function resolveMinion(room, actor) {
  const werewolves = room.players.filter((player) => finalRole(room, player.id) === "werewolf");
  remember(room, actor.id, werewolves.length
    ? `狼人是：${werewolves.map((player) => player.name).join("、")}`
    : "玩家之中沒有狼人。你必須獨自替狼人陣營掩護。");
  return null;
}

function resolveMason(room, actor) {
  const others = room.players.filter((player) => player.id !== actor.id && finalRole(room, player.id) === "mason");
  remember(room, actor.id, others.length
    ? `另一名守夜人是：${others.map((player) => player.name).join("、")}`
    : "玩家之中沒有另一名守夜人。");
  return null;
}

function resolveSeer(room, actor, payload) {
  if (payload.mode === "player") {
    const target = otherPlayer(room, actor.id, payload.targetId);
    if (!target) return "請選擇一名其他玩家";
    remember(room, actor.id, `${target.name} 的牌是「${ROLE_DEFS[room.cards[target.id]].name}」`);
    return null;
  }
  if (payload.mode === "center") {
    const indexes = uniqueCenterIndexes(payload.centerIndexes);
    if (indexes.length !== 2 || indexes.some((index) => !validCenterIndex(room, index))) return "請選擇兩張中央牌";
    remember(room, actor.id, indexes.map((index) => centerMessage(room, index)).join("；"));
    return null;
  }
  return "請選擇查看一名玩家或兩張中央牌";
}

function resolveRobber(room, actor, payload) {
  if (payload.skip) {
    remember(room, actor.id, "你決定不交換卡片。");
    return null;
  }
  const target = otherPlayer(room, actor.id, payload.targetId);
  if (!target) return "請選擇一名其他玩家，或選擇不交換";
  swapCards(room, actor.id, target.id);
  remember(room, actor.id, `你與 ${target.name} 交換後，現在的牌是「${ROLE_DEFS[room.cards[actor.id]].name}」`);
  return null;
}

function resolveTroublemaker(room, actor, payload) {
  if (payload.skip) {
    remember(room, actor.id, "你決定不交換卡片。");
    return null;
  }
  const ids = [...new Set(Array.isArray(payload.targetIds) ? payload.targetIds : [])];
  const targets = ids.map((id) => otherPlayer(room, actor.id, id)).filter(Boolean);
  if (targets.length !== 2) return "請選擇另外兩名不同玩家，或選擇不交換";
  swapCards(room, targets[0].id, targets[1].id);
  remember(room, actor.id, `你交換了 ${targets[0].name} 與 ${targets[1].name} 的牌。`);
  return null;
}

function resolveDrunk(room, actor, payload) {
  const centerIndex = Number(payload.centerIndex);
  if (!validCenterIndex(room, centerIndex)) return "請選擇一張中央牌";
  const held = room.cards[actor.id];
  room.cards[actor.id] = room.centerCards[centerIndex];
  room.centerCards[centerIndex] = held;
  remember(room, actor.id, `你與中央第 ${centerIndex + 1} 張牌交換，但不知道自己換到了什麼。`);
  return null;
}

function resolveInsomniac(room, actor) {
  const role = finalRole(room, actor.id);
  remember(room, actor.id, `夜晚結束時，你的牌是「${ROLE_DEFS[role].name}」`);
  return null;
}

function beginNight(room) {
  room.phase = "night";
  room.nightRoleIndex = -1;
  room.nightStage = null;
  addLog(room, "夜晚開始。");
  advanceNightStage(room);
}

function advanceNightStage(room, now = Date.now()) {
  room.nightRoleIndex += 1;
  while (room.nightRoleIndex < NIGHT_ORDER.length) {
    const role = NIGHT_ORDER[room.nightRoleIndex];
    if (role === "doppelInsomniac") {
      const doppel = room.players.find((player) => room.initialCards[player.id] === "doppelganger");
      const actorIds = room.doppelCopiedRole === "insomniac" && doppel ? [doppel.id] : [];
      room.nightStage = makeNightStage(role, actorIds, now, { forceDelay: true });
      return;
    }

    const existsInDeck = room.settings.deck.includes(role);
    if (!existsInDeck) {
      room.nightRoleIndex += 1;
      continue;
    }
    const actorIds = nightActors(room, role);
    room.nightStage = makeNightStage(role, actorIds, now);
    addLog(room, `${ROLE_DEFS[role].name}階段。`);
    return;
  }
  beginDiscussion(room);
}

function makeNightStage(role, actorIds, now, options = {}) {
  const minDelay = role === "doppelInsomniac" ? DOPPEL_INSOMNIAC_DELAY_MIN_MS : CENTER_DELAY_MIN_MS;
  const maxDelay = role === "doppelInsomniac" ? DOPPEL_INSOMNIAC_DELAY_MAX_MS : CENTER_DELAY_MAX_MS;
  return {
    role,
    actorIds,
    completedIds: [],
    delayUntil: actorIds.length && !options.forceDelay ? null : now + randomDelay(minDelay, maxDelay)
  };
}

function nightStageReadyToAdvance(stage, now = Date.now()) {
  if (!stage) return false;
  const actorsDone = stage.completedIds.length >= stage.actorIds.length;
  const delayDone = !stage.delayUntil || now >= stage.delayUntil;
  return actorsDone && delayDone;
}

function nightActors(room, role) {
  if (role === "doppelganger") {
    return room.players.filter((player) => room.initialCards[player.id] === "doppelganger").map((player) => player.id);
  }
  return room.players
    .filter((player) => finalRole(room, player.id) === role)
    .filter((player) => !shouldSkipDoppelCopiedRegularAction(room, player.id, role))
    .map((player) => player.id);
}

function shouldSkipDoppelCopiedRegularAction(room, playerId, role) {
  if (room.cards[playerId] !== "doppelganger" || room.doppelCopiedRole !== role) return false;
  return role === "insomniac" || DOPPEL_IMMEDIATE_ROLES.has(role);
}

function advanceTimedNight(room, now = Date.now()) {
  if (room.phase !== "night" || !room.nightStage?.delayUntil || !nightStageReadyToAdvance(room.nightStage, now)) return false;
  advanceNightStage(room, now);
  touch(room);
  return true;
}

function advanceTimedDiscussion(room, now = Date.now()) {
  if (room.phase !== "discussion" || !room.discussionEndsAt || now < room.discussionEndsAt) return false;
  addLog(room, "討論時間結束，未投票者視為廢票。");
  finishVote(room);
  touch(room);
  return true;
}

function beginDiscussion(room) {
  room.phase = "discussion";
  room.discussionEndsAt = Date.now() + room.settings.discussionSeconds * 1000;
  room.nightStage = null;
  addLog(room, "天亮了，開始討論與投票。");
}

function vote(room, actor, targetId) {
  if (room.phase !== "discussion") return "目前不能投票";
  if (advanceTimedDiscussion(room)) return "討論時間已結束，這張票視為廢票";
  if (room.votes[actor.id]) return "你已完成投票，不能更改票選";
  const target = room.players.find((player) => player.id === targetId && player.id !== actor.id);
  if (!target) return "找不到投票目標";
  room.votes[actor.id] = target.id;
  if (Object.keys(room.votes).length === room.players.length) finishVote(room);
  touch(room);
  return null;
}

function finishVote(room) {
  room.discussionEndsAt = null;
  const counts = {};
  Object.values(room.votes).forEach((targetId) => {
    counts[targetId] = (counts[targetId] || 0) + 1;
  });
  const highest = Math.max(0, ...Object.values(counts));
  const votedOutIds = highest >= 2
    ? Object.entries(counts).filter(([, count]) => count === highest).map(([playerId]) => playerId)
    : [];
  const hunterIds = votedOutIds
    .filter((playerId) => finalRole(room, playerId) === "hunter")
    .sort((leftId, rightId) => compareByRoll(playerById(room, leftId), playerById(room, rightId)));

  if (hunterIds.length) {
    room.pendingVoteResult = { counts, votedOutIds, eliminatedIds: [...votedOutIds] };
    room.pendingHunterIds = hunterIds;
    room.hunterShots = {};
    room.phase = "hunter";
    addLog(room, "遭到處決的獵人正在選擇反擊目標。");
    return;
  }
  completeVoteResolution(room, counts, votedOutIds, [...votedOutIds]);
}

function hunterShot(room, actor, targetId) {
  if (room.phase !== "hunter") return "目前不是獵人反擊階段";
  if (room.pendingHunterIds[0] !== actor.id) return "目前不是你選擇反擊目標";
  if (finalRole(room, actor.id) !== "hunter") return "只有出局的獵人可以反擊";
  const target = room.players.find((player) => player.id === targetId && player.id !== actor.id);
  if (!target) return "請選擇另一名玩家";

  room.hunterShots[actor.id] = target.id;
  if (!room.pendingVoteResult.eliminatedIds.includes(target.id)) {
    room.pendingVoteResult.eliminatedIds.push(target.id);
  }
  room.pendingHunterIds.shift();
  if (finalRole(room, target.id) === "hunter"
    && !room.hunterShots[target.id]
    && !room.pendingHunterIds.includes(target.id)) {
    room.pendingHunterIds.push(target.id);
    room.pendingHunterIds.sort((leftId, rightId) => compareByRoll(playerById(room, leftId), playerById(room, rightId)));
  }

  if (!room.pendingHunterIds.length) {
    const pending = room.pendingVoteResult;
    completeVoteResolution(room, pending.counts, pending.votedOutIds, pending.eliminatedIds);
  }
  touch(room);
  return null;
}

function completeVoteResolution(room, counts, votedOutIds, eliminatedIds) {

  const rolesByPlayer = Object.fromEntries(room.players.map((player) => [player.id, finalRole(room, player.id)]));
  const werewolfIds = playerIdsWithRole(rolesByPlayer, "werewolf");
  const minionIds = playerIdsWithRole(rolesByPlayer, "minion");
  const tannerIds = playerIdsWithRole(rolesByPlayer, "tanner");
  const killedWerewolf = eliminatedIds.some((playerId) => werewolfIds.includes(playerId));
  const killedMinion = eliminatedIds.some((playerId) => minionIds.includes(playerId));
  const killedTannerIds = eliminatedIds.filter((playerId) => tannerIds.includes(playerId));
  const winnerTeams = [];
  let winningPlayerIds = [];
  let reason;

  if (killedTannerIds.length) {
    winnerTeams.push("tanner");
    winningPlayerIds.push(...killedTannerIds);
    if (werewolfIds.length && killedWerewolf) {
      winnerTeams.push("village");
      winningPlayerIds.push(...playerIdsOnTeam(room, rolesByPlayer, "village"));
      reason = "皮匠成功遭到處決；同時至少一名狼人死亡，因此皮匠與好人陣營共同獲勝。";
    } else if (werewolfIds.length) {
      reason = "皮匠成功遭到處決，且沒有狼人死亡；本局由皮匠單獨獲勝。";
    } else {
      reason = "場上沒有狼人，皮匠成功遭到處決；本局由皮匠單獨獲勝。";
    }
  } else if (werewolfIds.length) {
    const winningTeam = killedWerewolf ? "village" : "werewolf";
    winnerTeams.push(winningTeam);
    winningPlayerIds = playerIdsOnTeam(room, rolesByPlayer, winningTeam);
    reason = killedWerewolf ? "好人陣營成功處決了至少一名狼人。" : "所有狼人都躲過了處決。";
  } else if (minionIds.length) {
    const nonMinionDied = eliminatedIds.some((playerId) => !minionIds.includes(playerId));
    const winningTeam = killedMinion ? "village" : (nonMinionDied ? "werewolf" : "village");
    winnerTeams.push(winningTeam);
    winningPlayerIds = playerIdsOnTeam(room, rolesByPlayer, winningTeam);
    reason = killedMinion
      ? "場上沒有狼人，爪牙遭到處決；好人陣營獲勝。"
      : nonMinionDied
        ? "場上沒有狼人，但爪牙成功讓其他玩家出局；狼人陣營獲勝。"
        : "場上沒有狼人，且沒有人遭到處決；好人陣營獲勝。";
  } else {
    if (eliminatedIds.length) {
      winnerTeams.push("none");
      reason = "場上沒有狼人或爪牙，但仍有玩家遭到處決；本局沒有人獲勝。";
    } else {
      winnerTeams.push("everyone");
      winningPlayerIds = room.players.map((player) => player.id);
      reason = "場上沒有狼人或爪牙，且無人遭到處決；所有玩家獲勝。";
    }
  }

  winningPlayerIds = [...new Set(winningPlayerIds)];
  room.result = {
    winner: winnerTeams[0],
    winnerTeams,
    winningPlayerIds,
    reason,
    counts,
    votedOutIds,
    eliminatedIds,
    rolesByPlayer,
    votes: room.players.map((player) => ({
      voterId: player.id,
      targetId: room.votes[player.id] || null
    }))
  };
  room.pendingVoteResult = null;
  room.pendingHunterIds = [];
  room.phase = "result";
  addLog(room, `${resultTitle(winnerTeams)}。`);
}

function finalRole(room, playerId) {
  const card = room.cards[playerId];
  if (card === "doppelganger" && room.doppelCopiedRole) return room.doppelCopiedRole;
  return card;
}

function playerIdsWithRole(rolesByPlayer, role) {
  return Object.entries(rolesByPlayer).filter(([, playerRole]) => playerRole === role).map(([playerId]) => playerId);
}

function playerIdsOnTeam(room, rolesByPlayer, team) {
  return room.players
    .filter((player) => ROLE_DEFS[rolesByPlayer[player.id]]?.team === team)
    .map((player) => player.id);
}

function resultTitle(winnerTeams) {
  return winnerTeams.map((team) => ({
    village: "好人陣營",
    werewolf: "狼人陣營",
    tanner: "皮匠",
    everyone: "所有玩家",
    none: "無人"
  })[team]).join("與") + "獲勝";
}

function returnLobby(room, actor) {
  if (room.phase !== "result") return "目前不能返回準備房";
  if (actor.id !== room.hostId) return "只有房主可以開啟下一局";
  room.phase = "lobby";
  room.initialCards = {};
  room.cards = {};
  room.centerInitial = [];
  room.centerCards = [];
  room.privateInfo = {};
  room.effectiveRoles = {};
  room.doppelCopiedRole = null;
  room.revealed = {};
  room.nightRoleIndex = -1;
  room.nightStage = null;
  room.doppelPendingRole = null;
  room.votes = {};
  room.pendingHunterIds = [];
  room.hunterShots = {};
  room.pendingVoteResult = null;
  room.result = null;
  room.discussionEndsAt = null;
  room.chat = [];
  room.log = [];
  room.players.forEach((player) => {
    player.ready = false;
    player.roll = null;
    player.rollTie = null;
  });
  touch(room);
  return null;
}

function chat(room, actor, message) {
  const clean = String(message || "").replace(/\s+/g, " ").trim().slice(0, 240);
  if (!clean) return "訊息不能為空";
  addChat(room, actor.id, clean, actor.name);
  touch(room);
  return null;
}

function makeView(room, playerId) {
  const you = room.players.find((player) => player.id === playerId);
  const initialRole = you ? room.initialCards[you.id] : null;
  const validation = validateLobby(room);
  const visibleNightRole = nightRoleForViewer(room, playerId);
  const actionRole = nightActionRoleForViewer(room, playerId);
  const nightProgress = nightProgressForViewer(room, visibleNightRole);
  const publicPlayers = playersByRoll(room).map((player) => ({
    id: player.id,
    name: player.name,
    roll: player.roll,
    ready: player.ready,
    online: player.online,
    hasVoted: Boolean(room.votes[player.id])
  }));
  return {
    type: "state",
    room: {
      code: room.code,
      version: room.version,
      phase: room.phase,
      hostId: room.hostId,
      revealedCount: Object.keys(room.revealed).length,
      settings: { ...room.settings, deck: [...room.settings.deck] },
      validation,
      canStart: validation.errors.length === 0,
      players: publicPlayers,
      night: {
        role: visibleNightRole,
        roleName: nightRoleName(visibleNightRole),
        order: makeNightOrderView(room, playerId),
        actionRole,
        actorCount: nightProgress.actorCount,
        completedCount: nightProgress.completedCount,
        yourTurn: Boolean(room.nightStage?.actorIds.includes(playerId) && !room.nightStage?.completedIds.includes(playerId)),
        waitingDelay: Boolean(room.nightStage?.delayUntil),
        delayRemainingMs: Math.max(0, Number(room.nightStage?.delayUntil || 0) - Date.now())
      },
      votesCast: Object.keys(room.votes).length,
      hunter: {
        yourTurn: room.phase === "hunter" && room.pendingHunterIds[0] === playerId,
        pending: room.pendingHunterIds.length,
        shots: { ...room.hunterShots }
      },
      discussionEndsAt: room.discussionEndsAt,
      chat: room.chat.slice(),
      log: room.log.slice(),
      playerJoinEvents: room.playerJoinEvents.slice(-20),
      result: room.phase === "result" ? {
        ...room.result,
        finalCards: room.players.map((player) => ({ playerId: player.id, role: finalRole(room, player.id) })),
        centerCards: [...room.centerCards]
      } : null
    },
    you: you ? {
      id: you.id,
      name: you.name,
      isHost: you.id === room.hostId,
      initialRole,
      role: initialRole ? ROLE_DEFS[initialRole] : null,
      hasRevealed: Boolean(room.revealed[you.id]),
      nightContext: makeNightContext(room, you.id),
      privateInfo: [...(room.privateInfo[you.id] || [])],
      voteTargetId: room.votes[you.id] || null
    } : null,
    roles: ROLE_DEFS,
    recommendedDecks: RECOMMENDED_DECKS
  };
}

function nightRoleForViewer(room, playerId) {
  const role = room.nightStage?.role || null;
  if (role !== "doppelInsomniac") return role;
  return room.nightStage?.actorIds.includes(playerId) ? "insomniac" : "privateNightAction";
}

function nightActionRoleForViewer(room, playerId) {
  const stage = room.nightStage;
  if (!stage) return null;
  if (stage.role === "doppelganger" && room.doppelPendingRole === playerId) return room.doppelCopiedRole;
  if (stage.role === "doppelInsomniac") {
    return stage.actorIds.includes(playerId) && !stage.completedIds.includes(playerId) ? "insomniac" : null;
  }
  return stage.role;
}

function nightProgressForViewer(room, visibleNightRole) {
  if (visibleNightRole === "privateNightAction") return { actorCount: 0, completedCount: 0 };
  return {
    actorCount: room.nightStage?.actorIds.length || 0,
    completedCount: room.nightStage?.completedIds.length || 0
  };
}

function makeNightContext(room, playerId) {
  const stage = room.nightStage;
  if (room.phase !== "night" || !stage?.actorIds.includes(playerId) || stage.completedIds.includes(playerId)) return null;
  const actionRole = stage.role === "doppelganger" && room.doppelPendingRole === playerId
    ? room.doppelCopiedRole
    : (stage.role === "doppelInsomniac" ? "insomniac" : stage.role);
  if (actionRole === "werewolf") {
    const teammates = room.players
      .filter((player) => player.id !== playerId && finalRole(room, player.id) === "werewolf")
      .map(publicPlayerReference);
    return { role: actionRole, teammates, loneWerewolf: teammates.length === 0 };
  }
  if (actionRole === "minion") {
    return {
      role: actionRole,
      werewolves: room.players
        .filter((player) => finalRole(room, player.id) === "werewolf")
        .map(publicPlayerReference)
    };
  }
  if (actionRole === "mason") {
    return {
      role: actionRole,
      masons: room.players
        .filter((player) => player.id !== playerId && finalRole(room, player.id) === "mason")
        .map(publicPlayerReference)
    };
  }
  return { role: actionRole };
}

function publicPlayerReference(player) {
  return { id: player.id, name: player.name };
}

function nightRoleName(role) {
  if (role === "privateNightAction") return "夜間行動";
  return ROLE_DEFS[role]?.name || "";
}

function makeNightOrderView(room, playerId) {
  const hiddenDoppelInsomniac = room.nightStage?.role === "doppelInsomniac"
    && !room.nightStage.actorIds.includes(playerId);
  const stageRole = room.nightStage?.role === "doppelInsomniac"
    ? (hiddenDoppelInsomniac ? null : "insomniac")
    : room.nightStage?.role;
  const enabledOrder = DISPLAY_NIGHT_ORDER.filter((role) => room.settings.deck.includes(role));
  const activeIndex = enabledOrder.indexOf(stageRole);
  return enabledOrder.map((role, index) => {
    let state = "upcoming";
    if (hiddenDoppelInsomniac) state = "done";
    if (activeIndex >= 0 && index < activeIndex) state = "done";
    if (role === stageRole) state = "active";
    return {
      role,
      name: ROLE_DEFS[role].name,
      enabled: true,
      state
    };
  });
}

function validateLobby(room) {
  const errors = [];
  const warnings = [];
  if (room.players.length !== room.settings.playerCount) {
    errors.push(`需要 ${room.settings.playerCount} 名玩家，目前有 ${room.players.length} 名。`);
  }
  const requiredCards = room.settings.playerCount + 3;
  if (room.settings.deck.length !== requiredCards) {
    errors.push(`牌庫需要 ${requiredCards} 張角色牌，目前有 ${room.settings.deck.length} 張。`);
  }
  if (room.players.some((player) => !player.ready)) {
    errors.push("所有玩家都準備後才能開始遊戲。");
  }
  if (room.players.some((player) => !player.roll)) {
    errors.push("所有玩家都擲過 d100 後才能開始遊戲。");
  }
  if (!room.settings.deck.includes("werewolf")) {
    warnings.push("牌庫中沒有狼人；此配置適合特殊玩法。");
  }
  const masonCount = room.settings.deck.filter((role) => role === "mason").length;
  if (masonCount === 1) errors.push("守夜人必須同時放入兩張。");
  if (room.settings.deck.some((role) => ["doppelganger", "tanner", "hunter"].includes(role))) {
    warnings.push("化身幽靈、皮匠與獵人屬於進階角色，建議熟悉基本規則後再使用。");
  }
  return { errors, warnings };
}

function sanitizeDeck(deck) {
  const counts = {};
  for (const role of deck) {
    if (!ROLE_DEFS[role]) return null;
    counts[role] = (counts[role] || 0) + 1;
    if (counts[role] > ROLE_DEFS[role].max) return null;
  }
  return [...deck];
}

function playersByRoll(room) {
  return [...room.players].sort(compareByRoll);
}

function compareByRoll(left, right) {
  const rollDifference = Number(right?.roll || 0) - Number(left?.roll || 0);
  if (rollDifference) return rollDifference;
  const tieDifference = Number(right?.rollTie || 0) - Number(left?.rollTie || 0);
  if (tieDifference) return tieDifference;
  return 0;
}

function playerById(room, playerId) {
  return room.players.find((player) => player.id === playerId);
}

function addChat(room, playerId, message, name = "") {
  room.chat.push({ id: room.nextChatId++, playerId, name, message, at: Date.now() });
}

function addLog(room, message) {
  room.log.push(message);
}

function recordPlayerJoin(room, player) {
  room.playerJoinSerial += 1;
  room.playerJoinEvents.push({ serial: room.playerJoinSerial, playerId: player.id });
  if (room.playerJoinEvents.length > 20) room.playerJoinEvents.shift();
}

function remember(room, playerId, message) {
  room.privateInfo[playerId].push(message);
}

function centerMessage(room, index) {
  return `中央第 ${index + 1} 張是「${ROLE_DEFS[room.centerCards[index]].name}」`;
}

function otherPlayer(room, actorId, targetId) {
  return room.players.find((player) => player.id === targetId && player.id !== actorId);
}

function swapCards(room, leftId, rightId) {
  [room.cards[leftId], room.cards[rightId]] = [room.cards[rightId], room.cards[leftId]];
}

function uniqueCenterIndexes(values) {
  return [...new Set(Array.isArray(values) ? values.map(Number) : [])].filter((index) => [0, 1, 2].includes(index));
}

function validCenterIndex(room, index) {
  return [0, 1, 2].includes(index) && Boolean(ROLE_DEFS[room.centerCards[index]]);
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 16);
}

function normalizedName(value) {
  return cleanName(value).toLocaleLowerCase();
}

function touch(room) {
  room.version += 1;
  room.updatedAt = Date.now();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function makeRoomCode() {
  return roomCode();
}

module.exports = {
  ROLE_DEFS,
  RECOMMENDED_DECKS,
  makeRoom,
  joinRoom,
  applyRoomAction,
  makeView,
  validateLobby,
  advanceTimedNight,
  advanceTimedDiscussion,
  finishVote,
  shuffle,
  NIGHT_ORDER
};
