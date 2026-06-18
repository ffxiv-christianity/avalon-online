const assert = require("assert");
const {
  latestJoinSerial,
  unreadPlayerJoins,
  normalizeSessionStore,
  saveSession,
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
  store = saveSession(store, { roomCode: "ABC123", playerId: "L1-ID", name: "L1" });
  store = saveSession(store, { roomCode: "ABC123", playerId: "L2-ID", name: "L2" });

  assert.strictEqual(selectSession(store, { roomCode: "ABC123", playerId: "L1-ID" }).name, "L1");
  assert.strictEqual(selectSession(store, { roomCode: "ABC123", playerId: "L2-ID" }).name, "L2");
  assert.strictEqual(selectSession(store, { roomCode: "ABC123", name: "L1" }).playerId, "L1-ID");
  assert.strictEqual(selectSession(store, { roomCode: "ABC123", name: "L2" }).playerId, "L2-ID");
  assert.strictEqual(
    selectSession(store, { roomCode: "ABC123", playerId: "L2-ID", name: "L1" }).playerId,
    "L1-ID",
    "typing a stored player name should switch the rejoin identity"
  );

  const migrated = normalizeSessionStore(null, { roomCode: "OLD123", playerId: "OLD-ID", name: "Old" });
  assert.strictEqual(selectSession(migrated, { roomCode: "OLD123", playerId: "OLD-ID" }).name, "Old");
}

testPlayerUnreadOnlyTracksJoinEvents();
testMultipleSessionsInOneBrowser();
console.log("client state unit tests passed");
