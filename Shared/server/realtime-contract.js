"use strict";

const ERROR_CODES = Object.freeze({
  roomNotFound: "ROOM_NOT_FOUND",
  roomExpired: "ROOM_EXPIRED",
  playerNotFound: "PLAYER_NOT_FOUND",
  roomFull: "ROOM_FULL",
  gameAlreadyStarted: "GAME_ALREADY_STARTED",
  notHost: "NOT_HOST",
  notYourTurn: "NOT_YOUR_TURN",
  actionAlreadyConfirmed: "ACTION_ALREADY_CONFIRMED",
  staleRoomVersion: "STALE_ROOM_VERSION",
  invalidAction: "INVALID_ACTION",
  sessionReplaced: "SESSION_REPLACED"
});

const ERROR_MESSAGES = Object.freeze({
  [ERROR_CODES.roomNotFound]: "找不到這個房間，可能已經過期。",
  [ERROR_CODES.roomExpired]: "找不到這個房間，可能已經過期。",
  [ERROR_CODES.playerNotFound]: "找不到原本的玩家身分，請重新加入房間。",
  [ERROR_CODES.roomFull]: "房間人數已滿。",
  [ERROR_CODES.gameAlreadyStarted]: "遊戲已經開始，無法以新玩家加入。",
  [ERROR_CODES.notHost]: "只有房主可以進行這項操作。",
  [ERROR_CODES.notYourTurn]: "現在還不能進行這項操作。",
  [ERROR_CODES.actionAlreadyConfirmed]: "這項操作已經確認，已為你同步最新狀態。",
  [ERROR_CODES.staleRoomVersion]: "房間狀態已更新，已為你重新同步。",
  [ERROR_CODES.sessionReplaced]: "此玩家已在另一個分頁接管，這個分頁已切換為唯讀。"
});

function errorMessage(code, fallback = "發生錯誤，請稍後再試。") {
  return ERROR_MESSAGES[code] || fallback;
}

function claimPlayerControl({ clients, client, roomCode, playerId, send }) {
  clients.forEach((other) => {
    if (other === client) return;
    if (other.roomCode !== roomCode || other.playerId !== playerId || !other.controlActive) return;
    other.controlActive = false;
    send(other, {
      type: "error",
      code: ERROR_CODES.sessionReplaced,
      message: errorMessage(ERROR_CODES.sessionReplaced)
    });
  });
  client.controlActive = true;
}

function validateActionRequest(room, client, message, { allowStale = false } = {}) {
  if (!client?.controlActive) {
    return {
      code: ERROR_CODES.sessionReplaced,
      message: "此分頁目前是唯讀，請先在此分頁接管。"
    };
  }
  const actionId = String(message?.actionId || "");
  if (!actionId || actionId.length > 160) {
    return { code: ERROR_CODES.invalidAction, message: "操作識別碼無效，請重新整理後再試。" };
  }
  const processed = processedActionIds(room);
  if (processed.has(actionId)) {
    return {
      code: ERROR_CODES.actionAlreadyConfirmed,
      message: errorMessage(ERROR_CODES.actionAlreadyConfirmed)
    };
  }
  if (!allowStale && Number(message.roomVersion) !== Number(room.version)) {
    return {
      code: ERROR_CODES.staleRoomVersion,
      message: errorMessage(ERROR_CODES.staleRoomVersion)
    };
  }
  return null;
}

function rememberAction(room, actionId, limit = 300) {
  const processed = processedActionIds(room);
  processed.add(String(actionId));
  while (processed.size > limit) processed.delete(processed.values().next().value);
}

function processedActionIds(room) {
  if (!room.processedActionIds) {
    Object.defineProperty(room, "processedActionIds", {
      value: new Set(),
      enumerable: false,
      configurable: false,
      writable: false
    });
  }
  return room.processedActionIds;
}

module.exports = {
  ERROR_CODES,
  ERROR_MESSAGES,
  errorMessage,
  claimPlayerControl,
  validateActionRequest,
  rememberAction
};
