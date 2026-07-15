"use strict";

const assert = require("assert");
const {
  makeRoom,
  joinRoom,
  applyRoomAction,
  makeView
} = require("../game");
const Engine = require("../engine");

function startedThreePlayerRoom() {
  const { room, player: first } = makeRoom("First", "GE01");
  assert.strictEqual(applyRoomAction(room, first, "updateSettings", {
    playerCount: 3,
    mapId: "classic",
    randomMap: false
  }), null);
  const second = joinRoom(room, "Second").player;
  const mummy = joinRoom(room, "Mummy").player;
  assert.strictEqual(applyRoomAction(room, first, "updateTokenLabel", { tokenLabel: "甲" }), null);
  assert.strictEqual(applyRoomAction(room, second, "updateTokenLabel", { tokenLabel: "乙" }), null);
  assert.strictEqual(applyRoomAction(room, mummy, "chooseRole", { role: "mummy" }), null);
  assert.strictEqual(applyRoomAction(room, first, "roll"), null);
  assert.strictEqual(applyRoomAction(room, second, "roll"), null);
  assert.strictEqual(applyRoomAction(room, first, "toggleReady"), null);
  assert.strictEqual(applyRoomAction(room, second, "toggleReady"), null);
  assert.strictEqual(applyRoomAction(room, mummy, "toggleReady"), null);
  assert.strictEqual(applyRoomAction(room, first, "startGame"), null);
  return { room, first, second, mummy };
}

function startedTwoPlayerRoom() {
  const { room, player: adventurer } = makeRoom("Solo", "GE02");
  assert.strictEqual(applyRoomAction(room, adventurer, "updateSettings", {
    playerCount: 2,
    mapId: "classic",
    randomMap: false
  }), null);
  const mummy = joinRoom(room, "Mummy").player;
  assert.strictEqual(applyRoomAction(room, adventurer, "updateTokenLabel", { tokenLabel: "單" }), null);
  assert.strictEqual(applyRoomAction(room, mummy, "chooseRole", { role: "mummy" }), null);
  assert.strictEqual(applyRoomAction(room, adventurer, "roll"), null);
  assert.strictEqual(applyRoomAction(room, adventurer, "toggleReady"), null);
  assert.strictEqual(applyRoomAction(room, mummy, "toggleReady"), null);
  assert.strictEqual(applyRoomAction(room, adventurer, "startGame"), null);
  return { room, adventurer, mummy };
}

{
  const { room, player: host } = makeRoom("Host", "GE05");
  assert.strictEqual(applyRoomAction(room, host, "updateSettings", {
    playerCount: 5,
    mapId: "classic",
    randomMap: false
  }), null);
  const adventurers = [host];
  for (const name of ["Second", "Third", "Fourth"]) adventurers.push(joinRoom(room, name).player);
  const mummy = joinRoom(room, "Mummy").player;
  assert.strictEqual(applyRoomAction(room, mummy, "chooseRole", { role: "mummy" }), null);
  adventurers.forEach((player, index) => {
    assert.strictEqual(applyRoomAction(room, player, "updateTokenLabel", { tokenLabel: String(index + 1) }), null);
    assert.strictEqual(applyRoomAction(room, player, "roll"), null);
  });
  room.players.forEach((player) => assert.strictEqual(applyRoomAction(room, player, "toggleReady"), null));
  assert.strictEqual(applyRoomAction(room, host, "startGame"), null);
  assert.strictEqual(room.game.adventurerOrder.length, 4);
  assert.strictEqual(Object.keys(room.game.pieces).length, 4);
  assert.strictEqual(room.game.mummy.target, 7);
  adventurers.forEach((player) => {
    const hand = room.game.hands[player.id];
    assert.strictEqual(hand.length, 5);
    assert.deepStrictEqual(hand.map((task) => task.id[0]).sort(), ["A", "B", "C", "D", "E"]);
  });
}

{
  const { room, adventurer, mummy } = startedTwoPlayerRoom();
  const pieces = room.game.adventurerOrder.map((id) => room.game.pieces[id]);
  assert.strictEqual(pieces.length, 2);
  assert(pieces.every((piece) => piece.controllerId === adventurer.id));
  assert.deepStrictEqual(pieces.map((piece) => piece.ordinal), [1, 2]);
  assert(pieces.every((piece) => piece.position === "entrance" && piece.life === 3));
  assert.strictEqual(room.game.hands[adventurer.id].length, 10);
  for (const group of ["A", "B", "C", "D", "E"]) {
    assert.strictEqual(room.game.hands[adventurer.id].filter((task) => task.id.startsWith(group)).length, 2);
  }
  assert.strictEqual(room.game.mummy.target, 3);
  assert.strictEqual(makeView(room, adventurer.id).room.game.hand.length, 10);
  assert(makeView(room, mummy.id).room.game.pieces.every((piece) => !Object.hasOwn(piece, "position")));
}

{
  const { room, first, second, mummy } = startedThreePlayerRoom();
  assert.strictEqual(room.phase, Engine.PHASES.adventurerRoll);
  assert.strictEqual(room.game.adventurerOrder.length, 2);
  assert.strictEqual(Object.keys(room.game.pieces).length, 2);
  assert.strictEqual(room.game.hands[first.id].length, 5);
  assert.strictEqual(room.game.hands[second.id].length, 5);
  assert.strictEqual(room.game.mummy.target, 4);

  const firstView = makeView(room, first.id);
  const mummyView = makeView(room, mummy.id);
  assert(firstView.room.game.pieces.every((piece) => Object.hasOwn(piece, "position")));
  assert(mummyView.room.game.pieces.every((piece) => !Object.hasOwn(piece, "position")));
  assert.strictEqual(mummyView.room.game.dice, null);
  assert.deepStrictEqual(mummyView.room.game.hand, []);
  assert.strictEqual(firstView.room.game.hand.length, 5);
  assert(!JSON.stringify(mummyView.room.game).includes('"position":"entrance"'));
  assert.deepStrictEqual(
    makeView(room, second.id).room.game.hand.map((task) => task.id).sort(),
    room.game.hands[second.id].map((task) => task.id).sort()
  );
  const current = room.game.pieces[room.game.currentPieceId];
  const waitingAdventurer = [first, second].find((player) => player.id !== current.controllerId);
  assert.deepStrictEqual(makeView(room, waitingAdventurer.id).room.game.legal.actions, []);
  assert(applyRoomAction(room, waitingAdventurer, "rollAdventurerDice").includes("不是你的回合"));

  assert.deepStrictEqual(Engine.numericPaths(room, current, 1), [["3,7"]]);
  Engine.resolveAdventurerFaces(room, ["1", "mummy", "mummy", "mummy", "mummy"]);
  assert.strictEqual(applyRoomAction(room, room.players.find((player) => player.id === current.controllerId), "selectDie", { dieId: "die-1" }), null);
  assert.strictEqual(room.phase, Engine.PHASES.numericMove);
  const hiddenMovementView = makeView(room, mummy.id);
  assert.strictEqual(hiddenMovementView.room.game.lastPublicDie, "1");
  assert.deepStrictEqual(hiddenMovementView.room.game.legal.actions, []);
  assert(!Object.hasOwn(hiddenMovementView.room.game.legal, "paths"));
  assert(hiddenMovementView.room.log.at(-1).includes("1骰"));
  assert(applyRoomAction(room, room.players.find((player) => player.id === current.controllerId), "moveNumeric", { path: ["4,7"] }).includes("不合法"));
  assert.strictEqual(applyRoomAction(room, room.players.find((player) => player.id === current.controllerId), "moveNumeric", { path: ["3,7"] }), null);
  assert.strictEqual(current.position, "3,7");
  assert.strictEqual(room.phase, Engine.PHASES.turnStart);
  const nextController = room.players.find((player) => player.id === room.game.pieces[room.game.currentPieceId].controllerId);
  assert.strictEqual(applyRoomAction(room, nextController, "unlockDice"), null);
  assert.strictEqual(room.phase, Engine.PHASES.interlude);
  assert.strictEqual(room.game.mummy.remaining, 4);
  assert.strictEqual(makeView(room, mummy.id).room.game.currentPlayerId, mummy.id);
  assert.strictEqual(applyRoomAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.phase, Engine.PHASES.adventurerRoll);
  assert.strictEqual(room.game.dice.filter((die) => die.locked).length, 0);
}

{
  const { room } = startedThreePlayerRoom();
  const piece = room.game.pieces[room.game.currentPieceId];
  const controller = room.players.find((player) => player.id === piece.controllerId);
  piece.position = "1,1";
  room.game.mummy.position = "dungeon";
  const directions = Engine.arrowMoves(room, piece);
  const direction = Object.keys(directions)[0];
  assert(direction);
  room.game.selectedFace = "arrow";
  room.phase = Engine.PHASES.arrowMove;
  assert.strictEqual(applyRoomAction(room, controller, "moveArrow", { direction }), null);
  assert.strictEqual(piece.position, directions[direction].end);
}

{
  const { room } = startedThreePlayerRoom();
  const [firstPiece, secondPiece] = room.game.adventurerOrder.map((id) => room.game.pieces[id]);
  firstPiece.position = "6,3";
  secondPiece.position = "6,4";
  room.game.mummy.position = "1,1";
  assert(!Engine.numericPaths(room, firstPiece, 1).some((path) => path.at(-1) === "6,4"));
  assert(Engine.numericPaths(room, firstPiece, 2).some((path) => path.join("|") === "6,4|6,5"));
  assert(Engine.numericPaths(room, firstPiece, 2).some((path) => path.join("|") === "6,4|6,3"));
  assert(!Engine.arrowMoves(room, firstPiece).right);

  firstPiece.position = "6,3";
  secondPiece.position = "1,1";
  room.game.mummy.position = "6,4";
  assert(!Engine.numericPaths(room, firstPiece, 1).some((path) => path.at(-1) === "6,4"));
  assert(!Engine.numericPaths(room, firstPiece, 2).some((path) => path[0] === "6,4"));
  assert(!Engine.arrowMoves(room, firstPiece).right);
}

{
  const { room, mummy } = startedThreePlayerRoom();
  const [blockedPiece, nextPiece] = room.game.adventurerOrder.map((id) => room.game.pieces[id]);
  blockedPiece.position = "4,1";
  nextPiece.position = "1,1";
  room.game.mummy.position = "5,1";
  room.game.mummy.remaining = 3;
  room.game.mummy.moveKind = "normal";
  room.phase = Engine.PHASES.mummyMove;
  assert.strictEqual(applyRoomAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.game.currentPieceId, nextPiece.id);
  assert.strictEqual(room.phase, Engine.PHASES.adventurerRoll);
  assert(room.log.some((message) => message.includes("完全無法移動")));
  const blockedController = room.players.find((player) => player.id === blockedPiece.controllerId);
  assert(applyRoomAction(room, blockedController, "rollAdventurerDice").includes("不是你的回合"));
}

{
  const { room } = startedThreePlayerRoom();
  const piece = room.game.pieces[room.game.currentPieceId];
  piece.position = "dungeon";
  room.game.mummy.position = "1,1";
  assert.deepStrictEqual(
    Engine.numericPaths(room, piece, 1).map((path) => path[0]).sort(),
    room.game.map.zones.dungeon.exits.slice().sort()
  );
  const arrowFirstSteps = Object.values(Engine.arrowMoves(room, piece)).map((move) => move.path[0]);
  assert(room.game.map.zones.dungeon.exits.every((cell) => arrowFirstSteps.includes(cell)));
}

{
  const { room, mummy } = startedThreePlayerRoom();
  const piece = room.game.pieces[room.game.adventurerOrder[0]];
  const target = Engine.mummyMoves(room)[0];
  piece.position = target;
  room.game.mummy.score = room.game.mummy.target - 1;
  room.game.mummy.remaining = 1;
  room.game.mummy.moveKind = "normal";
  room.phase = Engine.PHASES.mummyMove;
  assert.strictEqual(applyRoomAction(room, mummy, "moveMummy", { cell: target }), null);
  assert.strictEqual(room.phase, Engine.PHASES.gameOver);
  assert.strictEqual(room.game.winner.role, "mummy");
  assert.strictEqual(room.game.winner.playerId, mummy.id);
}

{
  const { room, mummy } = startedThreePlayerRoom();
  room.phase = Engine.PHASES.mummyRoll;
  assert.strictEqual(applyRoomAction(room, mummy, "rollMummyDie"), null);
  const result = room.game.mummy.roll;
  assert([1, 2, 3].includes(result));
  assert.strictEqual(makeView(room, room.game.pieces[room.game.adventurerOrder[0]].controllerId).room.game.mummy.roll, result);
  assert.strictEqual(makeView(room, mummy.id).room.game.mummy.roll, result);
  assert(applyRoomAction(room, mummy, "rollMummyDie").includes("不能"));
  assert.strictEqual(room.game.mummy.roll, result);
}

{
  const { room, mummy } = startedThreePlayerRoom();
  room.game.mummy.position = "dungeon";
  room.game.mummy.remaining = 2;
  room.game.mummy.moveKind = "normal";
  room.phase = Engine.PHASES.mummyMove;
  assert(applyRoomAction(room, mummy, "moveMummy", { cell: "99,99" }).includes("不能移動"));
  assert.strictEqual(room.game.mummy.position, "dungeon");
  assert.strictEqual(room.game.mummy.remaining, 2);
}

{
  const { room, mummy } = startedThreePlayerRoom();
  Engine.resolveAdventurerFaces(room, ["mummy", "mummy", "mummy", "mummy", "mummy"]);
  assert.strictEqual(room.phase, Engine.PHASES.interlude);
  assert.strictEqual(room.game.mummy.remaining, 5);
  assert(room.log.at(-1).includes("已無可用骰子，系統自動解鎖 5 顆骰子"));
  assert.strictEqual(applyRoomAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.phase, Engine.PHASES.adventurerRoll);
}

{
  const { room, mummy } = startedThreePlayerRoom();
  const lockingPiece = room.game.pieces[room.game.currentPieceId];
  const captureCell = Engine.mummyMoves(room)[0];
  lockingPiece.position = captureCell;
  Engine.resolveAdventurerFaces(room, ["mummy", "mummy", "mummy", "mummy", "mummy"]);
  const resumingPieceId = room.game.currentPieceId;
  assert.notStrictEqual(resumingPieceId, lockingPiece.id);
  assert.strictEqual(room.phase, Engine.PHASES.interlude);
  assert.strictEqual(room.game.pendingUnlock.pieceId, resumingPieceId);
  assert.strictEqual(room.game.mummy.remaining, 5);

  assert.strictEqual(applyRoomAction(room, mummy, "moveMummy", { cell: captureCell }), null);
  assert.strictEqual(lockingPiece.position, "dungeon");
  assert.strictEqual(room.phase, Engine.PHASES.adventurerRoll);
  assert.strictEqual(room.game.currentPieceId, resumingPieceId);
  assert.strictEqual(room.game.mummy.remaining, 0);
  assert.strictEqual(room.game.pendingUnlock, null);
  const mummyView = makeView(room, mummy.id).room.game;
  assert.deepStrictEqual(mummyView.legal.actions, []);
  assert.strictEqual(mummyView.legal.moves, undefined);
  assert(applyRoomAction(room, mummy, "moveMummy", { cell: "1,1" }).includes("不能"));
}

{
  const { room, mummy } = startedThreePlayerRoom();
  room.game.turnIndex = room.game.adventurerOrder.length - 1;
  room.game.currentPieceId = room.game.adventurerOrder.at(-1);
  room.phase = Engine.PHASES.adventurerRoll;
  Engine.resolveAdventurerFaces(room, ["mummy", "mummy", "mummy", "mummy", "mummy"]);
  assert.strictEqual(room.phase, Engine.PHASES.mummyRoll);
  Engine.resolveMummyRoll(room, 1);
  assert.strictEqual(room.game.mummy.remaining, 6);
  assert.strictEqual(applyRoomAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.phase, Engine.PHASES.interlude);
  assert.strictEqual(room.game.mummy.remaining, 5);
}

{
  const { room } = startedThreePlayerRoom();
  const firstPieceId = room.game.currentPieceId;
  const firstActor = room.players.find((player) => player.id === room.game.pieces[firstPieceId].controllerId);
  Engine.resolveAdventurerFaces(room, ["1", "1", "1", "1", "1"]);
  assert.strictEqual(applyRoomAction(room, firstActor, "selectDie", { dieId: "die-1" }), null);
  const firstPath = makeView(room, firstActor.id).room.game.legal.paths[0];
  assert.strictEqual(applyRoomAction(room, firstActor, "moveNumeric", { path: firstPath }), null);
  assert.strictEqual(room.game.currentPieceId, room.game.adventurerOrder.at(-1));

  Engine.resolveAdventurerFaces(room, ["mummy", "mummy", "mummy", "mummy", "mummy"]);
  assert.strictEqual(room.phase, Engine.PHASES.mummyRoll);
  assert.strictEqual(room.game.currentPieceId, null);
  assert.strictEqual(room.game.pendingUnlock, null);
  assert(room.log.at(-1).includes("正常回合"));
}

{
  const { room, first, second, mummy } = startedThreePlayerRoom();
  const piece = Object.values(room.game.pieces).find((candidate) => candidate.controllerId === first.id);
  const task = room.game.hands[first.id][0];
  piece.position = room.game.map.treasures.find((treasure) => treasure.id === task.id).position;
  room.game.currentPieceId = piece.id;
  room.game.pendingTreasureIds = [task.id];
  room.phase = Engine.PHASES.treasure;
  assert(applyRoomAction(room, second, "revealTreasure").includes("不是你的回合"));
  assert.strictEqual(task.revealed, false);
  assert.strictEqual(applyRoomAction(room, first, "revealTreasure"), null);
  assert.strictEqual(task.revealed, true);
  assert.strictEqual(room.game.revealedTasks.at(-1).id, task.id);

  const target = Engine.mummyMoves(room)[0];
  piece.position = target;
  piece.life = 3;
  room.game.mummy.score = 0;
  room.game.mummy.remaining = 3;
  room.game.mummy.moveKind = "normal";
  room.phase = Engine.PHASES.mummyMove;
  assert.strictEqual(applyRoomAction(room, mummy, "moveMummy", { cell: target }), null);
  assert.strictEqual(piece.life, 2);
  assert.strictEqual(piece.position, "dungeon");
  assert.strictEqual(room.game.mummy.score, 1);
  assert.strictEqual(room.game.captureEvent.pieceId, piece.id);
  assert.strictEqual(room.game.mummy.remaining, 0);
  assert.notStrictEqual(room.phase, Engine.PHASES.mummyMove);
  assert(applyRoomAction(room, mummy, "moveMummy", { cell: Engine.mummyMoves(room)[0] }).includes("不能"));
}

{
  const { room, first } = startedThreePlayerRoom();
  const piece = Object.values(room.game.pieces).find((candidate) => candidate.controllerId === first.id);
  const task = room.game.hands[first.id][0];
  piece.position = room.game.map.treasures.find((treasure) => treasure.id === task.id).position;
  room.game.currentPieceId = piece.id;
  room.game.turnIndex = room.game.adventurerOrder.indexOf(piece.id);
  room.game.pendingTreasureIds = [task.id];
  room.phase = Engine.PHASES.treasure;
  assert.strictEqual(applyRoomAction(room, first, "declineTreasure"), null);
  assert.strictEqual(task.revealed, false);
  assert.deepStrictEqual(room.game.pendingTreasureIds, []);
  assert(applyRoomAction(room, first, "revealTreasure").includes("沒有可揭露"));

  room.game.currentPieceId = piece.id;
  room.game.turnIndex = room.game.adventurerOrder.indexOf(piece.id);
  room.game.selectedFace = "2";
  room.phase = Engine.PHASES.numericMove;
  const returnPath = Engine.numericPaths(room, piece, 2).find((path) => path.at(-1) === piece.position);
  assert(returnPath, "treasure cell must have a two-step return path");
  assert.strictEqual(applyRoomAction(room, first, "moveNumeric", { path: returnPath }), null);
  assert.strictEqual(room.phase, Engine.PHASES.treasure);
  assert.deepStrictEqual(room.game.pendingTreasureIds, [task.id]);
}

{
  const { room, mummy } = startedThreePlayerRoom();
  const pieces = room.game.adventurerOrder.map((id) => room.game.pieces[id]);
  const target = Engine.mummyMoves(room)[0];
  pieces.forEach((piece) => {
    piece.position = target;
    piece.life = 3;
  });
  room.game.mummy.score = 0;
  room.game.mummy.remaining = 1;
  room.game.mummy.moveKind = "normal";
  room.phase = Engine.PHASES.mummyMove;
  assert.strictEqual(applyRoomAction(room, mummy, "moveMummy", { cell: target }), null);
  assert(pieces.every((piece) => piece.life === 2 && piece.position === "dungeon"));
  assert.strictEqual(room.game.mummy.score, 2);
  assert.strictEqual(room.game.captureEvent.captures.length, 2);
}

{
  const { room, mummy } = startedThreePlayerRoom();
  const [firstPiece, secondPiece] = room.game.adventurerOrder.map((id) => room.game.pieces[id]);
  const target = Engine.mummyMoves(room)[0];
  firstPiece.position = target;
  firstPiece.life = 1;
  room.game.mummy.score = 0;
  room.game.mummy.remaining = 1;
  room.game.mummy.moveKind = "normal";
  room.phase = Engine.PHASES.mummyMove;
  assert.strictEqual(applyRoomAction(room, mummy, "moveMummy", { cell: target }), null);
  assert.strictEqual(firstPiece.eliminated, true);
  assert.strictEqual(firstPiece.position, null);
  assert.strictEqual(room.game.currentPieceId, secondPiece.id);
  assert.strictEqual(room.phase, Engine.PHASES.adventurerRoll);
}

{
  const { room, first, mummy } = startedThreePlayerRoom();
  const piece = Object.values(room.game.pieces).find((candidate) => candidate.controllerId === first.id);
  const target = Engine.mummyMoves(room)[0];
  piece.position = target;
  room.game.pendingUnlock = { pieceId: piece.id, count: 3 };
  room.game.mummy.remaining = 3;
  room.game.mummy.moveKind = "interlude";
  room.phase = Engine.PHASES.interlude;
  assert.strictEqual(applyRoomAction(room, mummy, "moveMummy", { cell: target }), null);
  assert.strictEqual(room.game.mummy.remaining, 0);
  assert.strictEqual(room.game.pendingUnlock, null);
  assert.strictEqual(room.phase, Engine.PHASES.adventurerRoll);
  assert.strictEqual(room.game.currentPieceId, piece.id);
  assert.deepStrictEqual(makeView(room, mummy.id).room.game.legal.actions, []);
  assert.deepStrictEqual(makeView(room, mummy.id).room.game.legal.moves, undefined);
  assert(applyRoomAction(room, mummy, "moveMummy", { cell: Engine.mummyMoves(room)[0] }).includes("不能"));
}

{
  const { room, first } = startedThreePlayerRoom();
  const piece = Object.values(room.game.pieces).find((candidate) => candidate.controllerId === first.id);
  const hand = room.game.hands[first.id];
  hand.slice(0, -1).forEach((task) => { task.revealed = true; });
  const finalTask = hand.at(-1);
  piece.position = room.game.map.treasures.find((treasure) => treasure.id === finalTask.id).position;
  room.game.currentPieceId = piece.id;
  room.game.pendingTreasureIds = [finalTask.id];
  room.phase = Engine.PHASES.treasure;
  assert.strictEqual(applyRoomAction(room, first, "revealTreasure"), null);
  assert.strictEqual(room.phase, Engine.PHASES.gameOver);
  assert.strictEqual(room.game.winner.playerId, first.id);
  assert.strictEqual(room.game.winner.role, "adventurer");
}

console.log("Gangsi engine tests passed");
