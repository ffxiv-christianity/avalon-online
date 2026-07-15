"use strict";

const {
  randomIntInclusive,
  randomTieBreak,
  roomCode,
  playerId
} = require("../Shared/server/random");
const {
  transferHost: sharedTransferHost,
  kickOfflinePlayer: sharedKickOfflinePlayer
} = require("../Shared/server/room-actions");
const { cleanPlayerName } = require("../Shared/public/player-name");
const MapCatalog = require("./map-catalog");
const Engine = require("./engine");

const PLAYER_COUNTS = Object.freeze([2, 3, 4, 5]);
const PLAYER_ROLES = Object.freeze({ adventurer: "adventurer", mummy: "mummy" });

function mapOptions() {
  return MapCatalog.loadBuiltInMaps().map((entry) => ({
    id: entry.id,
    name: entry.name,
    author: entry.map.author,
    date: entry.map.date,
    width: entry.map.width,
    height: entry.map.height
  }));
}

function makeRoom(hostName, code = roomCode()) {
  const firstMap = mapOptions()[0];
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
      mapId: firstMap?.id || "",
      randomMap: false
    },
    players: [],
    game: null,
    playerJoinSerial: 0,
    playerJoinEvents: [],
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
    tokenLabel: "",
    role: PLAYER_ROLES.adventurer,
    roll: null,
    rollTie: null,
    seat: null
  };
}

function joinRoom(room, name, requestedPlayerId = "") {
  if (requestedPlayerId) {
    const existing = room.players.find((player) => player.id === requestedPlayerId);
    if (!existing) return { error: "找不到你的玩家身分。" };
    existing.online = true;
    return { player: existing };
  }
  if (room.phase !== "lobby") return { error: "遊戲已進入房間，無法加入。" };
  const clean = cleanName(name);
  if (!clean) return { error: "請輸入名字。" };
  if (room.players.some((player) => normalizedName(player.name) === normalizedName(clean))) {
    return { error: "這個名字已經有人使用。" };
  }
  if (room.players.length >= room.settings.playerCount) return { error: "房間人數已滿。" };
  const player = makePlayer(clean);
  room.players.push(player);
  markEveryoneUnready(room);
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
    case "updateTokenLabel": return updateTokenLabel(room, actor, payload.tokenLabel);
    case "chooseRole": return chooseRole(room, actor, payload.role);
    case "roll": return roll(room, actor);
    case "toggleReady": return toggleReady(room, actor);
    case "startGame": return startGame(room, actor);
    case "returnLobby": return returnLobby(room, actor);
    case "chat": return chat(room, actor, payload.message);
    default: {
      const error = Engine.applyGameAction(room, actor, action, payload);
      if (!error) touch(room);
      return error;
    }
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
    markEveryoneUnready: () => markEveryoneUnready(room),
    addLog: (message) => addLog(room, message),
    addSystemMessage: (message) => addSystemMessage(room, message)
  });
  if (!error) touch(room);
  return error;
}

function updateSettings(room, actor, payload) {
  if (room.phase !== "lobby") return "進入遊戲房間後不能更改設定。";
  if (actor.id !== room.hostId) return "只有房主可以更改設定。";
  const playerCount = Number(payload.playerCount);
  if (!PLAYER_COUNTS.includes(playerCount)) return "玩家人數必須是 2 到 5 人。";
  if (room.players.length > playerCount) return "目前玩家數超過新的房間人數。";
  const randomMap = Boolean(payload.randomMap);
  const requestedMap = String(payload.mapId || "");
  const maps = mapOptions();
  if (!maps.length) return "目前沒有可用地圖。";
  if (!randomMap && !maps.some((map) => map.id === requestedMap)) return "找不到指定的地圖。";
  room.settings.playerCount = playerCount;
  room.settings.randomMap = randomMap;
  if (maps.some((map) => map.id === requestedMap)) room.settings.mapId = requestedMap;
  markEveryoneUnready(room);
  touch(room);
  return null;
}

function updateTokenLabel(room, actor, value) {
  if (room.phase !== "lobby") return "進入遊戲房間後不能更改棋子文字。";
  const tokenLabel = String(value || "").trim();
  if (Array.from(tokenLabel).length !== 1) return "棋子文字必須正好是一個字。";
  actor.tokenLabel = tokenLabel;
  actor.ready = false;
  touch(room);
  return null;
}

function chooseRole(room, actor, role) {
  if (room.phase !== "lobby") return "進入遊戲房間後不能更改角色。";
  if (!Object.values(PLAYER_ROLES).includes(role)) return "找不到指定的角色。";
  if (role === PLAYER_ROLES.mummy) {
    const currentMummy = room.players.find((player) => player.role === PLAYER_ROLES.mummy && player.id !== actor.id);
    if (currentMummy) return `${currentMummy.name} 已選擇擔任提燈怪。`;
  }
  if (actor.role === role) return null;
  actor.role = role;
  actor.roll = null;
  actor.rollTie = null;
  markEveryoneUnready(room);
  addSystemMessage(room, role === PLAYER_ROLES.mummy
    ? `${actor.name} 選擇擔任提燈怪。`
    : `${actor.name} 改為冒險者。`);
  touch(room);
  return null;
}

function roll(room, actor) {
  if (room.phase !== "lobby") return "進入遊戲房間後不能擲 d100。";
  if (actor.role !== PLAYER_ROLES.adventurer) return "只有冒險者需要擲 d100。";
  if (actor.roll) return "你已經擲過 d100。";
  actor.roll = randomIntInclusive(1, 100);
  actor.rollTie = randomTieBreak();
  actor.ready = false;
  touch(room);
  return null;
}

function toggleReady(room, actor) {
  if (room.phase !== "lobby") return "已離開準備大廳。";
  if (actor.role === PLAYER_ROLES.adventurer && !actor.tokenLabel) return "請先填寫棋子文字。";
  if (actor.role === PLAYER_ROLES.adventurer && !actor.roll) return "請先擲 d100。";
  actor.ready = !actor.ready;
  touch(room);
  return null;
}

function validateLobby(room) {
  const errors = [];
  if (room.players.length !== room.settings.playerCount) {
    errors.push(`需要 ${room.settings.playerCount} 位玩家，目前 ${room.players.length} 位。`);
  }
  const maps = mapOptions();
  if (!maps.length || (!room.settings.randomMap && !maps.some((map) => map.id === room.settings.mapId))) {
    errors.push("請選擇有效地圖。");
  }
  const mummyCount = room.players.filter((player) => player.role === PLAYER_ROLES.mummy).length;
  if (mummyCount !== 1) errors.push("需要正好一位玩家選擇擔任提燈怪。");
  if (room.players.some((player) => player.role === PLAYER_ROLES.adventurer && !player.tokenLabel)) {
    errors.push("所有冒險者都需要填寫一字棋子文字。");
  }
  if (room.players.some((player) => player.role === PLAYER_ROLES.adventurer && !player.roll)) {
    errors.push("所有冒險者都需要先擲 d100。");
  }
  if (room.players.some((player) => !player.ready)) errors.push("所有玩家都需要準備。");
  return { errors, warnings: [] };
}

function startGame(room, actor) {
  if (room.phase !== "lobby") return "現在不能進入遊戲房間。";
  if (actor.id !== room.hostId) return "只有房主可以開始遊戲。";
  const validation = validateLobby(room);
  if (validation.errors.length) return validation.errors[0];
  if (room.settings.randomMap) {
    const maps = mapOptions();
    room.settings.mapId = maps[randomIntInclusive(0, maps.length - 1)].id;
  }
  room.players = playersByTurnOrder(room);
  room.players.forEach((player, index) => {
    player.seat = index;
    player.ready = false;
  });
  addLog(room, `已載入地圖「${selectedMapOption(room)?.name || room.settings.mapId}」。`);
  Engine.setupGame(room);
  addSystemMessage(room, "遊戲開始。所有玩家已進入古墓。");
  touch(room);
  return null;
}

function returnLobby(room, actor) {
  if (room.phase === "lobby") return "目前已在準備大廳。";
  if (actor.id !== room.hostId) return "只有房主可以返回準備大廳。";
  room.phase = "lobby";
  Engine.resetGame(room);
  room.players.forEach((player) => {
    player.ready = false;
    player.roll = null;
    player.rollTie = null;
    player.seat = null;
  });
  room.chat = [];
  room.log = [];
  addSystemMessage(room, "房主已返回準備大廳。");
  touch(room);
  return null;
}

function chat(room, actor, message) {
  const text = String(message || "").trim().slice(0, 240);
  if (!text) return "訊息不能空白。";
  room.chat.push({
    id: room.nextChatId++,
    playerId: actor.id,
    name: actor.name,
    message: text,
    at: Date.now()
  });
  touch(room);
  return null;
}

function makeView(room, playerIdValue) {
  const you = room.players.find((player) => player.id === playerIdValue);
  const hidesRandomMap = room.phase === "lobby" && room.settings.randomMap;
  const selectedMap = hidesRandomMap
    ? null
    : MapCatalog.getBuiltInMap(room.settings.mapId);
  return {
    type: "state",
    room: {
      code: room.code,
      version: room.version,
      phase: room.phase,
      hostId: room.hostId,
      hostOfflineSince: room.hostOfflineSince,
      settings: { ...room.settings, mapId: hidesRandomMap ? "" : room.settings.mapId },
      maps: mapOptions(),
      selectedMap,
      game: Engine.makeGameView(room, you),
      players: room.players.map((player, index) => ({
        id: player.id,
        name: player.name,
        online: player.online,
        ready: player.ready,
        tokenLabel: player.tokenLabel,
        role: player.role,
        roll: player.roll,
        seat: player.seat,
        index
      })),
      chat: room.chat.slice(),
      log: room.log.slice(-5),
      playerJoinEvents: room.playerJoinEvents.slice(-20)
    },
    you: you ? {
      id: you.id,
      name: you.name,
      role: you.role,
      isHost: you.id === room.hostId
    } : null
  };
}

function selectedMapOption(room) {
  return mapOptions().find((map) => map.id === room.settings.mapId) || null;
}

function playersByTurnOrder(room) {
  const adventurers = room.players
    .filter((player) => player.role === PLAYER_ROLES.adventurer)
    .sort((left, right) => (
      Number(right.roll) - Number(left.roll)
      || Number(right.rollTie) - Number(left.rollTie)
    ));
  const mummy = room.players.filter((player) => player.role === PLAYER_ROLES.mummy);
  return [...adventurers, ...mummy];
}

function markEveryoneUnready(room) {
  room.players.forEach((player) => { player.ready = false; });
}

function recordPlayerJoin(room, player) {
  room.playerJoinSerial += 1;
  room.playerJoinEvents.push({
    serial: room.playerJoinSerial,
    playerId: player.id,
    at: Date.now()
  });
}

function addSystemMessage(room, message) {
  room.chat.push({
    id: room.nextChatId++,
    playerId: "system",
    name: "",
    message,
    at: Date.now()
  });
}

function addLog(room, message) {
  room.log.push(message);
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
  PLAYER_COUNTS,
  PLAYER_ROLES,
  mapOptions,
  makeRoom,
  joinRoom,
  applyRoomAction,
  validateLobby,
  makeView
};
