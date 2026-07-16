"use strict";

const assert = require("assert");
const Game = require("../game");
const Engine = require("../engine");
const HuntEngine = require("../hunt-engine");
const MapCatalog = require("../map-catalog");
const MapFormat = require("../map-format");
const classic = require("../maps/classic.json");

function huntMap() {
  const map = MapFormat.normalizeMap(classic);
  map.id = "hunt-fixture";
  map.name = "獵殺測試地圖";
  map.hunt.mechanisms = { A: "4,1", B: "5,2" };
  const result = MapFormat.validateHuntMap(map);
  assert.strictEqual(result.valid, true, result.errors.join("; "));
  return result.map;
}

function denseHatchMap() {
  const map = MapFormat.createBlankMap(6, 5);
  map.id = "dense-hatch-fixture";
  map.name = "密道寶藏測試地圖";
  map.author = "Test";
  map.voidCells = ["6,1"];
  map.zones.entrance.anchor = "1,1";
  map.zones.dungeon.anchor = "6,5";
  map.hunt.mechanisms = { A: "3,3", B: "4,3" };
  const mechanismCells = new Set(Object.values(map.hunt.mechanisms));
  const available = Object.keys(MapFormat.buildMovementGraph(map).passages)
    .filter((cell) => !mechanismCells.has(cell));
  map.treasures = MapFormat.TREASURE_IDS.map((id, index) => ({ id, position: available[index] }));
  const result = MapFormat.validateHuntMap(map);
  assert.strictEqual(result.valid, true, result.errors.join("; "));
  return result.map;
}

function setup({ professions = ["knight", "engineer"], mummyType = "trap" } = {}) {
  const { room, player: first } = Game.makeRoom("First", "HT01");
  const second = Game.joinRoom(room, "Second").player;
  const mummy = Game.joinRoom(room, "Mummy").player;
  room.settings = { mode: "hunt", playerCount: 3, mapId: "hunt-fixture", randomMap: false };
  first.role = "adventurer";
  second.role = "adventurer";
  mummy.role = "mummy";
  first.profession = professions[0];
  second.profession = professions[1];
  mummy.mummyType = mummyType;
  first.tokenLabel = "甲";
  second.tokenLabel = "乙";
  const originalGetMap = MapCatalog.getBuiltInMap;
  MapCatalog.getBuiltInMap = () => MapFormat.clone(huntMap());
  try {
    Engine.setupGame(room);
  } finally {
    MapCatalog.getBuiltInMap = originalGetMap;
  }
  return { room, first, second, mummy };
}

function pieceFor(room, player) {
  return Object.values(room.game.pieces).find((piece) => piece.controllerId === player.id);
}

function makeCurrent(room, piece, phase = HuntEngine.PHASES.turnStart) {
  room.game.currentPieceId = piece.id;
  room.game.turnIndex = room.game.adventurerOrder.indexOf(piece.id);
  room.phase = phase;
  room.game.disabledDieId = null;
}

{
  const map = huntMap();
  const originalLoadMaps = MapCatalog.loadBuiltInMaps;
  const originalGetMap = MapCatalog.getBuiltInMap;
  MapCatalog.loadBuiltInMaps = () => [{
    id: map.id,
    name: map.name,
    file: "hunt-fixture.json",
    builtIn: true,
    huntCompatible: true,
    huntErrors: [],
    map: MapFormat.clone(map)
  }];
  MapCatalog.getBuiltInMap = () => MapFormat.clone(map);
  try {
    const { room, player: host } = Game.makeRoom("LobbyHost", "HL01");
    const human = Game.joinRoom(room, "LobbyHuman").player;
    const mummy = Game.joinRoom(room, "LobbyMummy").player;
    assert.strictEqual(Game.applyRoomAction(room, host, "updateSettings", {
      mode: "hunt", playerCount: 3, mapId: map.id, randomMap: false
    }), null);
    assert.strictEqual(Game.applyRoomAction(room, mummy, "chooseRole", { role: "mummy" }), null);
    assert.strictEqual(Game.applyRoomAction(room, host, "chooseProfession", { profession: "doctor" }), null);
    assert.strictEqual(Game.applyRoomAction(room, human, "chooseProfession", { profession: "wizard" }), null);
    assert.strictEqual(Game.applyRoomAction(room, mummy, "chooseMummyType", { mummyType: "knife" }), null);
    for (const [player, token] of [[host, "甲"], [human, "乙"]]) {
      assert.strictEqual(Game.applyRoomAction(room, player, "updateTokenLabel", { tokenLabel: token }), null);
      assert.strictEqual(Game.applyRoomAction(room, player, "roll"), null);
    }
    for (const player of [host, human, mummy]) assert.strictEqual(Game.applyRoomAction(room, player, "toggleReady"), null);
    assert.deepStrictEqual(Game.validateLobby(room).errors, []);
    assert.strictEqual(Game.applyRoomAction(room, host, "startGame"), null);
    assert.strictEqual(room.game.mode, "hunt");
    assert.strictEqual(room.game.mapId, map.id);
    assert.strictEqual(Game.makeView(room, human.id).room.game.mummy.type, "knife");
  } finally {
    MapCatalog.loadBuiltInMaps = originalLoadMaps;
    MapCatalog.getBuiltInMap = originalGetMap;
  }
}

{
  const { room, first, second, mummy } = setup({ professions: ["doctor", "wizard"], mummyType: "knife" });
  assert.strictEqual(room.game.mode, "hunt");
  assert.strictEqual(room.phase, HuntEngine.PHASES.turnStart);
  assert.strictEqual(pieceFor(room, first).life, 4);
  assert.strictEqual(pieceFor(room, second).wizardCharges, 4);
  assert.strictEqual(room.game.hunt.treasureGoal, 5);
  assert.strictEqual(Object.keys(room.game.pieces).length, 2);

  const humanView = HuntEngine.makeGameView(room, first);
  const mummyView = HuntEngine.makeGameView(room, mummy);
  assert(humanView.pieces.every((piece) => Object.hasOwn(piece, "position")));
  assert(mummyView.pieces.every((piece) => !Object.hasOwn(piece, "position")));
  assert.deepStrictEqual(mummyView.progress, []);
  assert.strictEqual(mummyView.dice, null);
  assert(!Object.hasOwn(mummyView.hunt, "countdown"));

  const wizard = pieceFor(room, second);
  makeCurrent(room, wizard);
  room.game.dice[0].locked = true;
  room.game.dice[0].face = "mummy";
  room.game.dice[1].locked = true;
  room.game.dice[1].face = "mummy";
  assert(HuntEngine.makeGameView(room, second).legal.actions.includes("useWizardUnlock"));
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "useWizardUnlock"), null);
  assert.strictEqual(room.game.dice[0].locked, false);
  assert.strictEqual(wizard.wizardCharges, 3);
  assert.strictEqual(wizard.wizardUsedThisTurn, true);
  assert(!HuntEngine.makeGameView(room, second).legal.actions.includes("useWizardUnlock"));
  assert(HuntEngine.applyGameAction(room, second, "useWizardUnlock").includes("每回合只能使用一次"));
  assert.strictEqual(room.game.dice[1].locked, true);
  assert.strictEqual(wizard.wizardCharges, 3);
}

{
  const { room, first } = setup();
  const view = HuntEngine.makeGameView(room, first);
  assert(view.legal.actions.includes("rollAdventurerDice"));
  assert(!view.legal.actions.includes("continueAdventurerTurn"));
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "rollAdventurerDice"), null);
  assert([HuntEngine.PHASES.adventurerRoll, HuntEngine.PHASES.forcedSkip].includes(room.phase));
  assert(room.game.dice.every((die) => die.face !== null));
}

{
  const { room, mummy } = setup({ mummyType: "invisible" });
  room.phase = HuntEngine.PHASES.mummyAbility;
  const view = HuntEngine.makeGameView(room, mummy);
  assert(view.legal.actions.includes("rollMummyDie"));
  assert(view.legal.actions.includes("hideMummy"));
  assert(!view.legal.actions.includes("continueMummyTurn"));
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.mummyMove);
  assert([1, 2, 3].includes(room.game.mummy.roll));
}

{
  const { room, first, second } = setup({ professions: ["knight", "engineer"] });
  const engineer = pieceFor(room, second);
  room.game.revealedTasks = Array.from({ length: room.game.hunt.treasureGoal }, (_, index) => ({ id: `T${index}` }));
  engineer.position = "5,1";
  assert(!HuntEngine.numericPaths(room, engineer, 1).some((path) => path.join("|") === "4,1"));
  makeCurrent(room, engineer);
  let view = HuntEngine.makeGameView(room, second);
  assert(view.legal.mechanisms.includes("A"));
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "activateMechanism", { gateId: "A" }), null);
  assert.strictEqual(room.game.hunt.mechanisms.A, 2);
  engineer.position = "5,1";
  makeCurrent(room, engineer);
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "activateMechanism", { gateId: "A" }), null);
  assert.strictEqual(room.game.hunt.mechanisms.A, 3);
  assert.strictEqual(room.game.hunt.exits.A, "open");
  assert.strictEqual(room.game.hunt.tracking.enabled, true);

  engineer.position = "5,1";
  makeCurrent(room, engineer, HuntEngine.PHASES.numericMove);
  room.game.selectedFace = "1";
  assert(HuntEngine.numericPaths(room, engineer, 1).some((path) => path.join("|") === "4,1"));
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "moveNumeric", { path: ["4,1"] }), null);
  assert.strictEqual(engineer.escaped, true);
  assert.strictEqual(engineer.position, null);
  assert.strictEqual(room.game.hunt.hatch.status, "open");

  const mummyInfo = HuntEngine.makeGameView(room, room.players.find((player) => player.role === "mummy")).actionInfo.join(" ");
  assert(!mummyInfo.includes(second.name + " 操作機關"));
}

{
  const { room, first, second, mummy } = setup({ professions: ["knight", "engineer"], mummyType: "trap" });
  const knight = pieceFor(room, first);
  const target = pieceFor(room, second);
  knight.position = "6,3";
  target.position = "6,4";
  makeCurrent(room, knight);
  assert(HuntEngine.makeGameView(room, first).legal.guardTargets.includes(target.id));
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "useKnightGuard", { pieceId: target.id }), null);
  assert.strictEqual(target.guard, true);
  assert.strictEqual(knight.abilityCooldown, 6);

  room.game.mummy.position = "6,5";
  room.game.mummy.remaining = 1;
  room.game.mummy.moveKind = "normal";
  room.phase = HuntEngine.PHASES.mummyMove;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "moveMummy", { cell: "6,4" }), null);
  assert.strictEqual(target.life, 3);
  assert.strictEqual(target.position, "dungeon");
  assert.strictEqual(target.guard, false);

  knight.position = "6,3";
  room.game.mummy.position = "1,1";
  makeCurrent(room, knight, HuntEngine.PHASES.numericMove);
  room.game.selectedFace = "1";
  room.game.hunt.traps = ["6,4"];
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "moveNumeric", { path: ["6,4"] }), null);
  assert.strictEqual(knight.position, "6,4");
  assert.strictEqual(knight.injuredTurns, 1);
  assert.deepStrictEqual(room.game.hunt.traps, []);
  assert.strictEqual(HuntEngine.makeGameView(room, mummy).pieces.find((piece) => piece.id === knight.id).injured, undefined);
}

{
  const { room, first, mummy } = setup({ professions: ["knight", "engineer"], mummyType: "invisible" });
  const human = pieceFor(room, first);
  human.position = "6,4";
  room.game.mummy.position = "6,5";
  room.phase = HuntEngine.PHASES.mummyAbility;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "hideMummy"), null);
  assert.strictEqual(room.game.mummy.invisible, true);
  assert.strictEqual(HuntEngine.makeGameView(room, first).mummy.position, null);
  HuntEngine.resolveMummyRoll(room, 1);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "moveMummy", { cell: "6,4" }), null);
  assert.strictEqual(room.game.mummy.position, "6,5");
  assert.strictEqual(room.game.mummy.invisible, false);
  assert.strictEqual(human.life, 3);
}

{
  const { room, first, mummy } = setup({ professions: ["knight", "engineer"], mummyType: "knife" });
  const human = pieceFor(room, first);
  human.position = "6,4";
  room.game.mummy.position = "6,5";
  room.phase = HuntEngine.PHASES.mummyAbility;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "throwKnife", { direction: "up" }), null);
  assert.strictEqual(human.injuredTurns, 1);
  assert.strictEqual(room.game.mummy.abilityCooldown, 3);
  assert.strictEqual(HuntEngine.makeGameView(room, first).mummy.abilityCooldown, undefined);
  assert.strictEqual(HuntEngine.makeGameView(room, mummy).mummy.abilityCooldown, 3);
  assert.strictEqual(room.phase, HuntEngine.PHASES.turnStart);
  assert.strictEqual(room.game.currentPieceId, pieceFor(room, first).id);
  assert(!HuntEngine.makeGameView(room, mummy).legal.actions.includes("rollMummyDie"));
  const info = HuntEngine.makeGameView(room, mummy).actionInfo.find((message) => message.includes("(6,4)"));
  assert(info.includes("(6,4)"));
  assert(!info.includes(first.name));
}

{
  const { room, first, mummy } = setup({ professions: ["knight", "engineer"], mummyType: "trap" });
  room.game.mummy.position = "6,3";
  room.phase = HuntEngine.PHASES.mummyAbility;
  let view = HuntEngine.makeGameView(room, mummy);
  assert(view.legal.trapPlacements.includes("6,4"));
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "placeTrap", { cell: "6,4" }), null);
  assert.deepStrictEqual(room.game.hunt.traps, ["6,4"]);
  assert.strictEqual(room.game.mummy.abilityCooldown, 2);
  assert.strictEqual(HuntEngine.makeGameView(room, first).mummy.abilityCooldown, undefined);
  assert.strictEqual(HuntEngine.makeGameView(room, mummy).mummy.abilityCooldown, 2);
  assert.strictEqual(HuntEngine.makeGameView(room, mummy).mummy.cooldownStartedThisTurn, undefined);
  assert(!HuntEngine.makeGameView(room, first).actionInfo.some((message) => message.includes("放置了陷阱")));

  room.phase = HuntEngine.PHASES.mummyAbility;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "recoverTrap", { cell: "6,4" }), null);
  assert.deepStrictEqual(room.game.hunt.traps, []);
  room.game.hunt.traps = ["6,4"];
  room.game.mummy.remaining = 1;
  room.game.mummy.moveKind = "normal";
  room.phase = HuntEngine.PHASES.mummyMove;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "moveMummy", { cell: "6,4" }), null);
  assert.deepStrictEqual(room.game.hunt.traps, []);
  assert.strictEqual(room.game.mummy.position, "6,4");
  assert.strictEqual(room.game.mummy.abilityCooldown, 2);

  for (const expected of [1, 0]) {
    room.game.mummy.moveKind = "normal";
    room.phase = HuntEngine.PHASES.mummyMove;
    assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
    assert.strictEqual(room.game.mummy.abilityCooldown, expected);
  }
}

{
  const { room, first, mummy } = setup({ professions: ["knight", "engineer"], mummyType: "trap" });
  const piece = pieceFor(room, first);
  const task = room.game.hands[first.id][0];
  piece.position = room.game.map.treasures.find((treasure) => treasure.id === task.id).position;
  makeCurrent(room, piece, HuntEngine.PHASES.treasure);
  room.game.pendingTreasureIds = [task.id];
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "revealTreasure"), null);
  const mummyView = HuntEngine.makeGameView(room, mummy);
  assert.strictEqual(mummyView.revealedTasks[0].playerId, undefined);
  assert(!mummyView.actionInfo.join(" ").includes(first.name + " 揭露"));

  room.game.hunt.hatch = { status: "open", position: "6,4" };
  room.game.mummy.position = "6,5";
  room.game.mummy.remaining = 1;
  room.game.mummy.moveKind = "normal";
  room.phase = HuntEngine.PHASES.mummyMove;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "moveMummy", { cell: "6,4" }), null);
  assert.strictEqual(room.game.hunt.hatch.status, "closed");
  assert.deepStrictEqual(room.game.hunt.exits, { A: "open", B: "open" });
  assert.strictEqual(room.game.hunt.tracking.enabled, true);
  room.game.hunt.tracking.revealThisTurn = true;
  assert(HuntEngine.makeGameView(room, mummy).pieces.every((candidate) => Object.hasOwn(candidate, "position")));
  assert(!Object.hasOwn(HuntEngine.makeGameView(room, first).hunt, "countdown"));
}

{
  const { room, first, second, mummy } = setup({ professions: ["knight", "engineer"], mummyType: "trap" });
  const victim = pieceFor(room, first);
  const survivor = pieceFor(room, second);
  const map = denseHatchMap();
  room.game.map = map;
  room.game.graph = MapFormat.buildMovementGraph(map, { hunt: true });
  const treasureCells = new Set(map.treasures.map((treasure) => treasure.position));
  const nonTreasureCells = Object.keys(room.game.graph.passages).filter((cell) => !treasureCells.has(cell));
  assert.strictEqual(nonTreasureCells.length, 2);
  const victimCell = nonTreasureCells.find((cell) => (room.game.graph.passages[cell] || []).some((next) => treasureCells.has(next)));
  const mummyStart = room.game.graph.passages[victimCell].find((cell) => treasureCells.has(cell));
  const survivorCell = nonTreasureCells.find((cell) => cell !== victimCell);
  victim.life = 1;
  victim.position = victimCell;
  survivor.position = survivorCell;
  room.game.mummy.position = mummyStart;
  room.game.mummy.remaining = 1;
  room.game.mummy.moveKind = "normal";
  room.phase = HuntEngine.PHASES.mummyMove;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "moveMummy", { cell: victimCell }), null);
  assert.strictEqual(victim.eliminated, true);
  assert.strictEqual(room.game.hunt.hatch.status, "open");
  const hatch = room.game.hunt.hatch.position;
  assert(treasureCells.has(hatch), "hatch must be allowed to open on a treasure cell");
  const neighbor = (room.game.graph.passages[hatch] || []).find((cell) => cell !== room.game.mummy.position);
  assert(neighbor, "hatch must have a reachable neighbor");
  survivor.position = neighbor;
  makeCurrent(room, survivor, HuntEngine.PHASES.numericMove);
  room.game.selectedFace = "1";
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "moveNumeric", { path: [hatch] }), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.gameOver);
  assert.strictEqual(room.game.winner.role, "adventurer");
  assert.strictEqual(room.game.winner.results.filter((result) => result.outcome === "escaped").length, 1);
}

console.log("Gangsi Hunt engine tests passed");
