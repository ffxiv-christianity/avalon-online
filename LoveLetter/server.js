"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { roomCode } = require("../Shared/server/random");
const { serveSharedStatic } = require("../Shared/server/static");
const {
  createRealtimeMetrics,
  shouldSendFullState,
  syncOk
} = require("../Shared/server/realtime-metrics");
const {
  ERROR_CODES,
  errorMessage,
  claimPlayerControl,
  validateActionRequest,
  rememberAction
} = require("../Shared/server/realtime-contract");
const {
  makeRoom,
  joinRoom,
  applyRoomAction,
  makeView
} = require("./game");

const PUBLIC_DIR = path.join(__dirname, "public");
const ROOM_EMPTY_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 8000;
const CLIENT_STALE_MS = 20000;
const HOST_AUTO_TRANSFER_MS = 2 * 60 * 1000;
const rooms = new Map();
const clients = new Set();
const realtimeMetrics = createRealtimeMetrics();
const pendingBroadcastTimers = new Map();
const COALESCED_BROADCAST_DELAY_MS = 50;
const STALE_SAFE_ACTIONS = new Set(["chat", "roll", "toggleReady"]);
const COALESCED_ACTIONS = new Set(["roll", "toggleReady"]);

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  if (serveSharedStatic(req, res, requestUrl)) return;
  const relativePath = requestUrl.pathname.replace(/^\/LoveLetter\/?/, "");
  const safePath = relativePath ? path.normalize(relativePath).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "") : "index.html";
  const publicRoot = path.resolve(PUBLIC_DIR);
  const filePath = path.resolve(PUBLIC_DIR, safePath);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  });
}

function handleUpgrade(req, socket) {
  if (req.url !== "/ws/loveletter") {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    ""
  ].join("\r\n"));
  const client = { socket, buffer: Buffer.alloc(0), roomCode: null, playerId: null };
  clients.add(client);
  socket.on("data", (chunk) => readFrames(client, chunk));
  socket.on("close", () => removeClient(client));
  socket.on("error", () => removeClient(client));
}

function readFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const frame = decodeFrame(client.buffer);
    if (!frame) return;
    client.buffer = client.buffer.slice(frame.bytes);
    if (frame.opcode === 8) {
      client.socket.end();
      return;
    }
    if (frame.opcode !== 1) continue;
    try {
      onMessage(client, JSON.parse(frame.payload));
    } catch {
      send(client, { type: "error", message: "訊息格式錯誤。" });
    }
  }
}

function onMessage(client, message) {
  markClientSeen(client);
  if (message.type === "joinRoom") {
    client.pendingJoin = {
      roomCode: normalizeCode(message.roomCode),
      playerId: message.playerId || ""
    };
  }
  if (message.type === "createRoom") {
    const created = makeRoom(message.name, uniqueRoomCode());
    rooms.set(created.room.code, created.room);
    attach(client, created.room.code, created.player.id);
    send(client, { type: "joined", roomCode: created.room.code, playerId: created.player.id });
    broadcast(created.room);
    return;
  }
  if (message.type === "takeControl") {
    const room = rooms.get(normalizeCode(message.roomCode));
    if (!room) {
      return send(client, {
        type: "error",
        code: ERROR_CODES.roomNotFound,
        message: errorMessage(ERROR_CODES.roomNotFound)
      });
    }
    const player = room.players.find((item) => item.id === message.playerId);
    if (!player) {
      return send(client, {
        type: "error",
        code: ERROR_CODES.playerNotFound,
        message: errorMessage(ERROR_CODES.playerNotFound)
      });
    }
    attach(client, room.code, player.id);
    send(client, { type: "controlGranted", roomCode: room.code, playerId: player.id });
    broadcast(room);
    return;
  }
  if (message.type === "pong" || message.type === "heartbeat") return;
  if (message.type === "joinRoom") {
    const room = rooms.get(normalizeCode(message.roomCode));
    if (!room) return send(client, { type: "error", code: ERROR_CODES.roomNotFound, message: "找不到這個房間。" });
    const joined = joinRoom(room, message.name, message.playerId);
    if (joined.error) return send(client, { type: "error", message: joined.error });
    attach(client, room.code, joined.player.id);
    send(client, { type: "joined", roomCode: room.code, playerId: joined.player.id });
    broadcast(room);
    return;
  }
  if (message.type === "sync") {
    const room = rooms.get(client.roomCode);
    if (room) {
      const sentFullState = shouldSendFullState(room, message.version);
      realtimeMetrics.recordFullSync({ roomCode: room.code, sentFullState });
      send(client, sentFullState ? makeView(room, client.playerId) : syncOk(room));
    }
    return;
  }
  if (message.type === "action") {
    const room = rooms.get(client.roomCode);
    const actor = room?.players.find((player) => player.id === client.playerId);
    if (!room || !actor) {
      return send(client, {
        type: "error",
        code: room ? ERROR_CODES.playerNotFound : ERROR_CODES.roomNotFound,
        message: "房間狀態已失效。"
      });
    }
    const guardError = validateActionRequest(room, client, message, {
      allowStale: STALE_SAFE_ACTIONS.has(message.action)
    });
    if (guardError) {
      send(client, { type: "error", ...guardError });
      send(client, makeView(room, client.playerId));
      return;
    }
    const error = applyRoomAction(room, actor, message.action, message.payload || {});
    if (error) return send(client, { type: "error", code: ERROR_CODES.invalidAction, message: error });
    rememberAction(room, message.actionId);
    if (message.action === "kickOfflinePlayer") {
      detachPlayerClients(room.code, message.payload?.playerId, "你已被房主移出房間。");
    }
    broadcastAfterAction(room, message.action);
  }
}

function attach(client, targetRoomCode, targetPlayerId) {
  client.roomCode = targetRoomCode;
  client.playerId = targetPlayerId;
  claimPlayerControl({ clients, client, roomCode: targetRoomCode, playerId: targetPlayerId, send });
  markClientSeen(client);
}

function markClientSeen(client) {
  client.lastSeen = Date.now();
  const room = rooms.get(client.roomCode);
  const player = room?.players.find((item) => item.id === client.playerId);
  if (player) player.online = true;
  if (room?.hostId === client.playerId) room.hostOfflineSince = null;
}

function removeClient(client) {
  clients.delete(client);
  if (!client.roomCode) return;
  const room = rooms.get(client.roomCode);
  if (!room) return;
  const player = room.players.find((item) => item.id === client.playerId);
  if (player) player.online = hasLiveClient(room.code, player.id);
  refreshEmptyState(room);
  broadcast(room);
}

function hasLiveClient(targetRoomCode, targetPlayerId) {
  const now = Date.now();
  return [...clients].some((client) => (
    client.roomCode === targetRoomCode
    && client.playerId === targetPlayerId
    && !client.socket.destroyed
    && client.lastSeen
    && now - client.lastSeen <= CLIENT_STALE_MS
  ));
}

function detachPlayerClients(targetRoomCode, targetPlayerId, message) {
  clients.forEach((client) => {
    if (client.roomCode !== targetRoomCode || client.playerId !== targetPlayerId) return;
    send(client, { type: "error", message });
    client.socket.end();
    clients.delete(client);
  });
}

function broadcast(room) {
  const timer = pendingBroadcastTimers.get(room.code);
  if (timer) {
    clearTimeout(timer);
    pendingBroadcastTimers.delete(room.code);
  }
  refreshEmptyState(room);
  realtimeMetrics.recordBroadcast(room.code);
  clients.forEach((client) => {
    if (client.roomCode === room.code) send(client, makeView(room, client.playerId));
  });
}

function broadcastAfterAction(room, action) {
  if (!COALESCED_ACTIONS.has(action)) {
    broadcast(room);
    return;
  }
  scheduleBroadcast(room);
}

function scheduleBroadcast(room) {
  if (pendingBroadcastTimers.has(room.code)) return;
  const timer = setTimeout(() => {
    pendingBroadcastTimers.delete(room.code);
    if (rooms.get(room.code) === room) broadcast(room);
  }, COALESCED_BROADCAST_DELAY_MS);
  timer.unref?.();
  pendingBroadcastTimers.set(room.code, timer);
}

function refreshEmptyState(room) {
  const connected = [...clients].some((client) => client.roomCode === room.code && !client.socket.destroyed);
  room.emptySince = connected ? null : (room.emptySince || Date.now());
}

function heartbeatClients() {
  clients.forEach((client) => {
    if (client.socket.destroyed) {
      removeClient(client);
      return;
    }
    if (Date.now() - (client.lastSeen || 0) > CLIENT_STALE_MS) {
      client.socket.end();
      removeClient(client);
      return;
    }
    send(client, { type: "ping", at: Date.now() });
  });
}

function cleanupRooms(now = Date.now()) {
  rooms.forEach((room, targetRoomCode) => {
    refreshEmptyState(room);
    if (room.emptySince && now - room.emptySince >= ROOM_EMPTY_TTL_MS) rooms.delete(targetRoomCode);
  });
}

function statsSnapshot() {
  const roomList = [...rooms.values()].map((room) => {
    const onlinePlayers = room.players.filter((player) => player.online).length;
    const connections = [...clients].filter((client) => client.roomCode === room.code && !client.socket.destroyed).length;
    return {
      code: room.code,
      phase: room.phase,
      players: room.players.length,
      onlinePlayers,
      connections,
      version: room.version,
      emptyForMs: room.emptySince ? Math.max(0, Date.now() - room.emptySince) : 0
    };
  });
  return {
    rooms: roomList.length,
    activeRooms: roomList.filter((room) => room.onlinePlayers > 0).length,
    connections: [...clients].filter((client) => !client.socket.destroyed).length,
    players: roomList.reduce((sum, room) => sum + room.players, 0),
    onlinePlayers: roomList.reduce((sum, room) => sum + room.onlinePlayers, 0),
    roomList
  };
}

function updateHostTransfer(room, now = Date.now()) {
  const host = room.players.find((player) => player.id === room.hostId);
  if (!host || host.online) {
    const changed = Boolean(room.hostOfflineSince);
    room.hostOfflineSince = null;
    return changed;
  }
  const nextHost = room.players.find((player) => player.online && player.id !== host.id);
  if (!nextHost) return false;
  if (!room.hostOfflineSince) {
    room.hostOfflineSince = now;
    return true;
  }
  if (now - room.hostOfflineSince < HOST_AUTO_TRANSFER_MS) return false;
  room.hostId = nextHost.id;
  room.hostOfflineSince = null;
  room.log.push(`${host.name} 離線超過 2 分鐘，房主自動轉移給 ${nextHost.name}。`);
  room.chat.push({
    id: room.nextChatId++,
    playerId: "system",
    name: "",
    message: `${nextHost.name} 現在是房主。`,
    at: now
  });
  room.version += 1;
  room.updatedAt = now;
  return true;
}

function attachMaintenance(server) {
  const cleanupTimer = setInterval(cleanupRooms, CLEANUP_INTERVAL_MS);
  const heartbeatTimer = setInterval(heartbeatClients, HEARTBEAT_INTERVAL_MS);
  const hostTransferTimer = setInterval(() => {
    rooms.forEach((room) => {
      if (updateHostTransfer(room)) broadcast(room);
    });
  }, 1000);
  cleanupTimer.unref?.();
  heartbeatTimer.unref?.();
  hostTransferTimer.unref?.();
  server.on("close", () => {
    clearInterval(cleanupTimer);
    clearInterval(heartbeatTimer);
    clearInterval(hostTransferTimer);
  });
}

function uniqueRoomCode() {
  return roomCode(rooms);
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function send(client, payload) {
  if (!client?.socket || client.socket.destroyed) return;
  if (payload.type === "error" && !payload.code && client.pendingJoin) {
    const pendingRoom = rooms.get(client.pendingJoin.roomCode);
    payload.code = !pendingRoom
      ? ERROR_CODES.roomNotFound
      : client.pendingJoin.playerId
        ? ERROR_CODES.playerNotFound
        : pendingRoom.phase !== "lobby"
          ? ERROR_CODES.gameAlreadyStarted
          : pendingRoom.players.length >= pendingRoom.settings.playerCount
            ? ERROR_CODES.roomFull
            : ERROR_CODES.invalidAction;
    client.pendingJoin = null;
  }
  if (payload.type === "error" && !payload.code) payload.code = ERROR_CODES.invalidAction;
  if (payload.type === "error") payload.message = errorMessage(payload.code, payload.message);
  if (payload.type === "joined") client.pendingJoin = null;
  const text = JSON.stringify(payload);
  const frame = encodeFrame(text);
  realtimeMetrics.recordOutbound({
    roomCode: client.roomCode,
    type: payload.type,
    bytes: frame.length
  });
  client.socket.write(frame);
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function decodeFrame(buffer) {
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = Boolean(second & 0x80);
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  const maskOffset = offset;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.slice(offset, offset + length));
  if (masked) {
    const mask = buffer.slice(maskOffset, maskOffset + 4);
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  }
  return { opcode, payload: payload.toString("utf8"), bytes: offset + length };
}

function encodeFrame(text) {
  const payload = Buffer.from(text);
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

module.exports = {
  rooms,
  clients,
  realtimeMetrics,
  serveStatic,
  handleUpgrade,
  cleanupRooms,
  attachMaintenance,
  statsSnapshot,
  updateHostTransfer
};
