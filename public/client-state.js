(function exposeClientState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AvalonClientState = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createClientState() {
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

  function selectSession(store, { roomCode = "", playerId = "", name = "" } = {}) {
    const sessions = Object.values(store?.sessions || {});
    const normalizedRoom = String(roomCode).toUpperCase();
    const roomSessions = sessions.filter((item) => item.roomCode.toUpperCase() === normalizedRoom);
    if (name) {
      const normalizedName = String(name).trim().toLocaleLowerCase();
      const named = roomSessions.find((item) => String(item.name || "").toLocaleLowerCase() === normalizedName);
      if (named) return named;
    }
    if (playerId) {
      const exact = store?.sessions?.[playerId];
      if (exact && (!normalizedRoom || exact.roomCode.toUpperCase() === normalizedRoom)) return exact;
    }
    return roomSessions.at(-1) || null;
  }

  return {
    latestJoinSerial,
    unreadPlayerJoins,
    normalizeSessionStore,
    saveSession,
    selectSession
  };
}));
