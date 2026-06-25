"use strict";

function createRealtimeMetrics() {
  const totals = makeBucket();
  const rooms = new Map();

  function bucket(roomCode) {
    const code = String(roomCode || "unassigned");
    if (!rooms.has(code)) rooms.set(code, makeBucket());
    return rooms.get(code);
  }

  function recordOutbound({ roomCode, type, bytes = 0 }) {
    const normalizedType = String(type || "unknown");
    const size = Math.max(0, Number(bytes) || 0);
    for (const target of [totals, bucket(roomCode)]) {
      target.messagesSent += 1;
      target.bytesSent += size;
      target.byType[normalizedType] = (target.byType[normalizedType] || 0) + 1;
      if (normalizedType === "state") {
        target.stateMessagesSent += 1;
        target.stateBytesSent += size;
        target.latestStateBytes = size;
        target.largestStateBytes = Math.max(target.largestStateBytes, size);
      }
    }
  }

  function recordFullSync({ roomCode, sentFullState }) {
    for (const target of [totals, bucket(roomCode)]) {
      target.fullSyncRequests += 1;
      if (sentFullState) target.fullSyncResponses += 1;
      else target.fullSyncSkipped += 1;
    }
  }

  function recordBroadcast(roomCode) {
    for (const target of [totals, bucket(roomCode)]) {
      target.broadcasts += 1;
    }
  }

  function snapshot(roomCode = null) {
    if (roomCode) return serializeBucket(bucket(roomCode));
    return {
      ...serializeBucket(totals),
      rooms: Object.fromEntries([...rooms.entries()].map(([code, value]) => [code, serializeBucket(value)]))
    };
  }

  return {
    recordOutbound,
    recordFullSync,
    recordBroadcast,
    snapshot
  };
}

function makeBucket() {
  return {
    messagesSent: 0,
    bytesSent: 0,
    stateMessagesSent: 0,
    stateBytesSent: 0,
    latestStateBytes: 0,
    largestStateBytes: 0,
    fullSyncRequests: 0,
    fullSyncResponses: 0,
    fullSyncSkipped: 0,
    broadcasts: 0,
    byType: {}
  };
}

function serializeBucket(bucket) {
  const stateMessages = Math.max(0, Number(bucket.stateMessagesSent) || 0);
  return {
    messagesSent: bucket.messagesSent,
    bytesSent: bucket.bytesSent,
    bytesSentMb: bytesToMb(bucket.bytesSent),
    stateMessagesSent: bucket.stateMessagesSent,
    stateBytesSent: bucket.stateBytesSent,
    stateBytesSentMb: bytesToMb(bucket.stateBytesSent),
    averageStateBytes: stateMessages ? Math.round(bucket.stateBytesSent / stateMessages) : 0,
    latestStateBytes: bucket.latestStateBytes,
    largestStateBytes: bucket.largestStateBytes,
    fullSyncRequests: bucket.fullSyncRequests,
    fullSyncResponses: bucket.fullSyncResponses,
    fullSyncSkipped: bucket.fullSyncSkipped,
    broadcasts: bucket.broadcasts,
    byType: { ...bucket.byType }
  };
}

function shouldSendFullState(room, clientVersion) {
  const currentVersion = Number(room?.version || 0);
  const requestedVersion = Number(clientVersion || 0);
  return !Number.isFinite(requestedVersion) || requestedVersion !== currentVersion;
}

function syncOk(room) {
  return { type: "syncOk", version: Number(room?.version || 0) };
}

function bytesToMb(bytes) {
  return Number((Number(bytes || 0) / 1024 / 1024).toFixed(3));
}

module.exports = {
  createRealtimeMetrics,
  shouldSendFullState,
  syncOk,
  bytesToMb
};
