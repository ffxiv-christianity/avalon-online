"use strict";

const assert = require("assert");
const {
  randomIntInclusive,
  randomTieBreak,
  shuffle,
  roomCode,
  playerId,
  randomDelay
} = require("../Shared/server/random");
const { transferHost, kickOfflinePlayer } = require("../Shared/server/room-actions");
const {
  connectionStatusText,
  formatCountUnit,
  playerCardClasses,
  captureScroll,
  restoreScroll,
  updateChatUnread,
  readLatestChat,
  mobileStatusSummary
} = require("../Shared/public/room-ui");
const { createActionRequest, SESSION_ERROR_CODES, selectSession } = require("../Shared/public/client-state");
const {
  ERROR_CODES,
  errorMessage,
  claimPlayerControl,
  validateActionRequest,
  rememberAction
} = require("../Shared/server/realtime-contract");

for (let index = 0; index < 100; index += 1) {
  const roll = randomIntInclusive(1, 100);
  assert(roll >= 1 && roll <= 100);
  assert(Number.isInteger(randomTieBreak()));
  assert(randomDelay(5, 9) >= 5 && randomDelay(5, 9) <= 9);
}

const original = ["a", "b", "c", "d"];
assert.deepStrictEqual([...shuffle([...original])].sort(), original);
assert(/^[A-F0-9]{6}$/.test(roomCode(new Set())));
assert(/^[a-f0-9]{16}$/.test(playerId()));

const room = {
  phase: "lobby",
  hostId: "host",
  hostOfflineSince: 123,
  players: [
    { id: "host", name: "Host", online: true, ready: true },
    { id: "next", name: "Next", online: true, ready: true },
    { id: "offline", name: "Offline", online: false, ready: true }
  ]
};
const host = room.players[0];
assert.strictEqual(transferHost({ room, actor: host, playerId: "next" }), null);
assert.strictEqual(room.hostId, "next");
assert.strictEqual(room.hostOfflineSince, null);

const nextHost = room.players[1];
assert.strictEqual(kickOfflinePlayer({
  room,
  actor: nextHost,
  playerId: "offline",
  markEveryoneUnready: () => room.players.forEach((player) => { player.ready = false; })
}), null);
assert(!room.players.some((player) => player.id === "offline"));
assert(room.players.every((player) => !player.ready));

assert.strictEqual(connectionStatusText(0), "已連線");
assert.strictEqual(connectionStatusText(12), "已同步 12 次");
assert.strictEqual(connectionStatusText(1234), "已同步 1.2K 次");
assert.strictEqual(connectionStatusText(12000), "已同步 12K 次");
assert.strictEqual(formatCountUnit(1250000), "1.3M 次");
assert.strictEqual(
  playerCardClasses({ playerId: "P1", viewerId: "P1", online: true }),
  "is-self"
);
assert.strictEqual(
  playerCardClasses({ playerId: "P2", viewerId: "P1", online: false, retired: true }),
  "offline retired"
);
const readingHistory = { scrollHeight: 1000, clientHeight: 300, scrollTop: 200 };
assert.deepStrictEqual(captureScroll(readingHistory), { atBottom: false, scrollTop: 200 });
restoreScroll(readingHistory, { atBottom: false, scrollTop: 200 });
assert.strictEqual(readingHistory.scrollTop, 200);
const followingLatest = { scrollHeight: 1000, clientHeight: 300, scrollTop: 680 };
assert.strictEqual(captureScroll(followingLatest).atBottom, true);
restoreScroll(followingLatest, { atBottom: true, scrollTop: 680 });
assert.strictEqual(followingLatest.scrollTop, 1000);
const chatEntries = [
  { id: 1, playerId: "P2" },
  { id: 2, playerId: "system" },
  { id: 3, playerId: "P1" },
  { id: 4, playerId: "P3" }
];
assert.deepStrictEqual(updateChatUnread({
  entries: chatEntries,
  lastObservedId: 1,
  viewerId: "P1",
  chatActive: true,
  chatAtBottom: false,
  currentCount: 0
}), { count: 1, lastObservedId: 4 });
assert.deepStrictEqual(updateChatUnread({
  entries: chatEntries,
  lastObservedId: 1,
  viewerId: "P1",
  chatActive: true,
  chatAtBottom: true,
  currentCount: 3
}), { count: 0, lastObservedId: 4 });
assert.deepStrictEqual(updateChatUnread({
  entries: chatEntries,
  lastObservedId: 1,
  viewerId: "P1",
  chatActive: false,
  chatAtBottom: true,
  currentCount: 2
}), { count: 3, lastObservedId: 4 });
let markedLatest = false;
const switchedChat = { scrollHeight: 900, clientHeight: 300, scrollTop: 100 };
readLatestChat(switchedChat, () => { markedLatest = true; });
assert.strictEqual(switchedChat.scrollTop, 900);
assert.strictEqual(markedLatest, true);
const compactStatus = mobileStatusSummary([
  { label: "階段", value: "投票" },
  { label: "領袖", value: "<Lou>" }
]);
assert(compactStatus.includes("mobile-status-summary-item"));
assert(compactStatus.includes("<small>階段</small>"));
assert(compactStatus.includes("&lt;Lou&gt;"));

const actionRequest = createActionRequest({
  action: "vote",
  payload: { targetId: "P2" },
  roomVersion: 7,
  clientId: "tab-a",
  sequence: 3
});
assert.deepStrictEqual(actionRequest, {
  type: "action",
  action: "vote",
  payload: { targetId: "P2" },
  roomVersion: 7,
  actionId: "tab-a:3"
});
assert.strictEqual(SESSION_ERROR_CODES.sessionReplaced, ERROR_CODES.sessionReplaced);
const sessionStore = {
  sessions: {
    p1: { roomCode: "ROOM1", playerId: "p1", name: "Alice", lastUsedAt: 10 },
    p2: { roomCode: "ROOM2", playerId: "p2", name: "Bob", lastUsedAt: 20 }
  }
};
assert.strictEqual(selectSession(sessionStore, {}), null);
assert.strictEqual(selectSession(sessionStore, { roomCode: "ROOM1" }).playerId, "p1");
assert.strictEqual(selectSession(sessionStore, { roomCode: "ROOM1", playerId: "p2" }).playerId, "p1");
assert.strictEqual(selectSession(sessionStore, { playerId: "p2" }).roomCode, "ROOM2");
assert.strictEqual(
  errorMessage(ERROR_CODES.roomNotFound),
  "找不到這個房間，可能已經過期。"
);
assert.strictEqual(
  errorMessage(ERROR_CODES.invalidAction, "遊戲專屬錯誤"),
  "遊戲專屬錯誤"
);

const controlMessages = [];
const controlClients = new Set([
  { roomCode: "ROOM1", playerId: "P1", controlActive: true },
  { roomCode: null, playerId: null, controlActive: false }
]);
const [oldControl, newControl] = [...controlClients];
newControl.roomCode = "ROOM1";
newControl.playerId = "P1";
claimPlayerControl({
  clients: controlClients,
  client: newControl,
  roomCode: "ROOM1",
  playerId: "P1",
  send: (client, payload) => controlMessages.push({ client, payload })
});
assert.strictEqual(oldControl.controlActive, false);
assert.strictEqual(newControl.controlActive, true);
assert.strictEqual(controlMessages[0].payload.code, ERROR_CODES.sessionReplaced);

const guardedRoom = { version: 4 };
const guardedClient = { controlActive: true };
assert.strictEqual(validateActionRequest(guardedRoom, guardedClient, {
  actionId: "tab-a:1",
  roomVersion: 4
}), null);
rememberAction(guardedRoom, "tab-a:1");
assert.strictEqual(
  validateActionRequest(guardedRoom, guardedClient, { actionId: "tab-a:1", roomVersion: 4 }).code,
  ERROR_CODES.actionAlreadyConfirmed
);
assert.strictEqual(
  validateActionRequest(guardedRoom, guardedClient, { actionId: "tab-a:2", roomVersion: 3 }).code,
  ERROR_CODES.staleRoomVersion
);

console.log("shared framework tests passed");
