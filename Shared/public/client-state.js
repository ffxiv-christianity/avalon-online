(function exposeClientState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.SharedRoomClient = api;
    root.AvalonClientState = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function createClientState() {
  const SESSION_ERROR_CODES = Object.freeze({
    roomNotFound: "ROOM_NOT_FOUND",
    playerNotFound: "PLAYER_NOT_FOUND",
    roomExpired: "ROOM_EXPIRED",
    roomFull: "ROOM_FULL",
    gameAlreadyStarted: "GAME_ALREADY_STARTED",
    notHost: "NOT_HOST",
    notYourTurn: "NOT_YOUR_TURN",
    sessionReplaced: "SESSION_REPLACED",
    staleRoomVersion: "STALE_ROOM_VERSION",
    actionAlreadyConfirmed: "ACTION_ALREADY_CONFIRMED",
    invalidAction: "INVALID_ACTION"
  });

  function latestJoinSerial(events) {
    return events.reduce((latest, event) => Math.max(latest, Number(event.serial || 0)), 0);
  }

  function unreadPlayerJoins(events, lastSerial, viewerId, rosterIsActive) {
    const unseen = events.filter((event) => Number(event.serial || 0) > Number(lastSerial || 0));
    return {
      count: rosterIsActive ? 0 : unseen.filter((event) => event.playerId !== viewerId).length,
      lastSerial: Math.max(Number(lastSerial || 0), latestJoinSerial(events))
    };
  }

  function normalizeSessionStore(rawValue, legacySession = null) {
    let parsed = rawValue;
    if (typeof rawValue === "string") {
      try {
        parsed = JSON.parse(rawValue);
      } catch {
        parsed = null;
      }
    }
    const sessions = parsed?.sessions && typeof parsed.sessions === "object" ? { ...parsed.sessions } : {};
    if (legacySession?.playerId && legacySession?.roomCode && !sessions[legacySession.playerId]) {
      sessions[legacySession.playerId] = legacySession;
    }
    return { sessions };
  }

  function saveSession(store, session) {
    if (!session?.playerId || !session?.roomCode) return store;
    return {
      sessions: {
        ...store.sessions,
        [session.playerId]: session
      }
    };
  }

  function listSessions(store) {
    return Object.values(store?.sessions || {})
      .filter((item) => item?.playerId && item?.roomCode)
      .sort((a, b) => Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0));
  }

  function removeSession(store, playerId) {
    const sessions = { ...store.sessions };
    delete sessions[playerId];
    return { sessions };
  }

  function removeRoomSessions(store, roomCode) {
    const normalizedRoom = String(roomCode || "").toUpperCase();
    const sessions = Object.fromEntries(
      Object.entries(store.sessions).filter(([, item]) => item.roomCode.toUpperCase() !== normalizedRoom)
    );
    return { sessions };
  }

  function clearInvalidSession(store, { errorCode = "", roomCode = "", playerId = "" } = {}) {
    if (errorCode === SESSION_ERROR_CODES.roomNotFound && roomCode) {
      return removeRoomSessions(store, roomCode);
    }
    if (errorCode === SESSION_ERROR_CODES.playerNotFound && playerId) {
      return removeSession(store, playerId);
    }
    return store;
  }

  function gameLabel(game) {
    if (game === "loveletter") return "情書";
    if (game === "criminaldance") return "犯人在跳舞";
    if (game === "onenightwolf") return "一夜終極狼人";
    if (game === "avalon") return "阿瓦隆";
    return "";
  }

  function createActionRequest({ action, payload = {}, roomVersion, clientId, sequence }) {
    return {
      type: "action",
      action,
      payload,
      roomVersion: Number(roomVersion || 0),
      actionId: `${String(clientId || "client")}:${Number(sequence || 0)}`
    };
  }

  function parseRoomCode(value, baseUrl = "https://avalon.invalid/") {
    const input = String(value || "").trim();
    if (!input) return "";
    try {
      const url = new URL(input, baseUrl);
      const queryRoom = url.searchParams.get("room");
      if (queryRoom) return normalizeRoomCode(queryRoom);
    } catch {
      // Fall through to parsing a raw room code.
    }
    return normalizeRoomCode(input);
  }

  function inviteGame(value, baseUrl = "https://avalon.invalid/") {
    const input = String(value || "").trim();
    if (!input || !/[/?]/.test(input)) return null;
    try {
      const url = new URL(input, baseUrl);
      if (!url.searchParams.get("room")) return null;
      const pathname = url.pathname.toLowerCase();
      if (pathname.startsWith("/loveletter")) return "loveletter";
      if (pathname.startsWith("/criminaldance")) return "criminaldance";
      return pathname.startsWith("/onenightwolf") ? "onenightwolf" : "avalon";
    } catch {
      return null;
    }
  }

  function normalizeRoomCode(value) {
    const compact = String(value || "").trim().toUpperCase();
    return /^[A-Z0-9]{4,8}$/.test(compact) ? compact : "";
  }

  function roomUrlPath(pathname, roomCode) {
    const normalizedRoom = normalizeRoomCode(roomCode);
    return normalizedRoom ? `${pathname}?room=${encodeURIComponent(normalizedRoom)}` : pathname;
  }

  function selectSession(store, { roomCode = "", playerId = "", name = "" } = {}) {
    const sessions = Object.values(store?.sessions || {});
    const normalizedRoom = String(roomCode).toUpperCase();
    const roomSessions = sessions.filter((item) => item.roomCode.toUpperCase() === normalizedRoom);
    if (playerId) {
      const exact = store?.sessions?.[playerId];
      if (exact && (!normalizedRoom || exact.roomCode.toUpperCase() === normalizedRoom)) return exact;
    }
    if (name) {
      const normalizedName = String(name).trim().toLocaleLowerCase();
      const named = roomSessions.find((item) => String(item.name || "").toLocaleLowerCase() === normalizedName);
      if (named) return named;
    }
    return roomSessions.at(-1) || null;
  }

  return {
    latestJoinSerial,
    unreadPlayerJoins,
    normalizeSessionStore,
    saveSession,
    listSessions,
    removeSession,
    removeRoomSessions,
    clearInvalidSession,
    gameLabel,
    createActionRequest,
    SESSION_ERROR_CODES,
    parseRoomCode,
    inviteGame,
    roomUrlPath,
    selectSession
  };
}));
