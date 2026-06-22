const assert = require("assert");
const {
  latestJoinSerial,
  unreadPlayerJoins,
  normalizeSessionStore,
  saveSession,
  listSessions,
  removeSession,
  removeRoomSessions,
  parseRoomCode,
  roomUrlPath,
  selectSession
} = require("../public/client-state");

function testPlayerUnreadOnlyTracksJoinEvents() {
  const initialEvents = [
    { serial: 1, playerId: "L1" },
    { serial: 2, playerId: "L2" }
  ];
  assert.strictEqual(latestJoinSerial(initialEvents), 2);

  const unchanged = unreadPlayerJoins(initialEvents, 2, "L1", false);
  assert.deepStrictEqual(unchanged, { count: 0, lastSerial: 2 }, "votes, rolls, ready, tokens and online state must not create unread players");

  const joined = unreadPlayerJoins([...initialEvents, { serial: 3, playerId: "L3" }], 2, "L1", false);
  assert.deepStrictEqual(joined, { count: 1, lastSerial: 3 });

  const ownJoin = unreadPlayerJoins([...initialEvents, { serial: 3, playerId: "L1" }], 2, "L1", false);
  assert.deepStrictEqual(ownJoin, { count: 0, lastSerial: 3 });

  const rosterOpen = unreadPlayerJoins([...initialEvents, { serial: 3, playerId: "L3" }], 2, "L1", true);
  assert.deepStrictEqual(rosterOpen, { count: 0, lastSerial: 3 });
}

function testMultipleSessionsInOneBrowser() {
  let store = normalizeSessionStore(null);
  store = saveSession(store, { roomCode: "ABC123", playerId: "L1-ID", name: "L1", lastUsedAt: 1 });
  store = saveSession(store, { roomCode: "ABC123", playerId: "L2-ID", name: "L2", lastUsedAt: 2 });

  assert.strictEqual(selectSession(store, { roomCode: "ABC123", playerId: "L1-ID" }).name, "L1");
  assert.strictEqual(selectSession(store, { roomCode: "ABC123", playerId: "L2-ID" }).name, "L2");
  assert.strictEqual(selectSession(store, { roomCode: "ABC123", name: "L1" }).playerId, "L1-ID");
  assert.strictEqual(selectSession(store, { roomCode: "ABC123", name: "L2" }).playerId, "L2-ID");
  assert.strictEqual(
    selectSession(store, { roomCode: "ABC123", playerId: "L2-ID", name: "L1" }).playerId,
    "L2-ID",
    "the current tab player ID must take priority over autofilled or edited names"
  );

  const migrated = normalizeSessionStore(null, { roomCode: "OLD123", playerId: "OLD-ID", name: "Old" });
  assert.strictEqual(selectSession(migrated, { roomCode: "OLD123", playerId: "OLD-ID" }).name, "Old");
  assert.strictEqual(listSessions(store)[0].playerId, "L2-ID");
  store = removeSession(store, "L1-ID");
  assert.strictEqual(store.sessions["L1-ID"], undefined);
  assert.strictEqual(listSessions(store).length, 1);

  store = saveSession(store, { roomCode: "OTHER1", playerId: "O1-ID", name: "Other", lastUsedAt: 3 });
  store = removeRoomSessions(store, "ABC123");
  assert.strictEqual(listSessions(store).length, 1);
  assert.strictEqual(listSessions(store)[0].roomCode, "OTHER1");
}

function testRoomCodeParsing() {
  assert.strictEqual(parseRoomCode("ab12cd"), "AB12CD");
  assert.strictEqual(parseRoomCode("https://example.com/?room=xy98pq"), "XY98PQ");
  assert.strictEqual(parseRoomCode("/?room=ROOM7", "https://example.com/"), "ROOM7");
  assert.strictEqual(parseRoomCode("not a room"), "");
  assert.strictEqual(roomUrlPath("/", "ab12cd"), "/?room=AB12CD");
  assert.strictEqual(roomUrlPath("/avalon/", "ROOM7"), "/avalon/?room=ROOM7");
  assert(!roomUrlPath("/", "ROOM7").includes("player"));
}

testPlayerUnreadOnlyTracksJoinEvents();
testMultipleSessionsInOneBrowser();
testRoomCodeParsing();
console.log("client state unit tests passed");
