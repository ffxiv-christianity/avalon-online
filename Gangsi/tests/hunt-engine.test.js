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

function setup({ professions = ["knight", "archaeologist"], mummyType = "trap" } = {}) {
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

function treasurePositionForTest(room, id) {
  return room.game.map.treasures.find((treasure) => treasure.id === id)?.position || null;
}

function directionBetween(left, right) {
  const [leftX, leftY] = MapFormat.parseCell(left);
  const [rightX, rightY] = MapFormat.parseCell(right);
  if (rightY < leftY) return "up";
  if (rightX > leftX) return "right";
  if (rightY > leftY) return "down";
  return "left";
}

function makeCurrent(room, piece, phase = HuntEngine.PHASES.adventurerPrepare) {
  room.game.currentPieceId = piece.id;
  room.game.turnIndex = room.game.adventurerOrder.indexOf(piece.id);
  room.phase = phase;
  room.game.disabledDieId = null;
  room.game.endState = null;
  room.game.actionState = null;
}

function makeTreasureEnd(room, piece, treasureId) {
  makeCurrent(room, piece, HuntEngine.PHASES.adventurerEnd);
  room.game.pendingTreasureIds = [treasureId];
  room.game.endState = { kind: "treasure", operatorPlayerId: piece.controllerId };
}

assert(Game.PROFESSIONS.includes("scout") && Game.PROFESSIONS.includes("tombRaider")
  && Game.PROFESSIONS.includes("mason") && Game.PROFESSIONS.includes("archaeologist")
  && Game.PROFESSIONS.includes("cultist") && !Game.PROFESSIONS.includes("engineer"));
assert(Game.MUMMY_TYPES.includes("burrow") && Game.MUMMY_TYPES.includes("phantom")
  && Game.MUMMY_TYPES.includes("gazer") && Game.MUMMY_TYPES.includes("corrupt"));

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
  assert.deepStrictEqual(Object.keys(HuntEngine.PHASE_ACTIONS).sort(), Object.values(HuntEngine.PHASES).sort());
  assert.deepStrictEqual(HuntEngine.PHASE_ACTIONS, {
    adventurer_prepare: [
      "rollAdventurerDice", "unlockDice", "useWizardUnlock", "useKnightGuard", "activateMechanism",
      "useMasonWall", "useArchaeologistTask", "stopBleeding"
    ],
    adventurer_roll: ["rollAdventurerDice", "selectDie"],
    adventurer_action: ["moveNumeric", "moveArrow"],
    adventurer_end: ["revealTreasure", "declineTreasure", "finishAdventurerTurn"],
    monster_prepare: [
      "rollMummyDie", "placeTrap", "recoverTrap", "hideMummy", "revealMummy", "throwKnife",
      "setGrave", "burrowToGrave", "placePhantomWall", "infectTreasure"
    ],
    monster_roll: [],
    monster_action: ["moveMummy", "stopMummy"],
    monster_end: ["chooseGazeDirection"],
    monster_interrupt_prepare: [],
    monster_interrupt_action: ["moveMummy", "stopMummy"],
    monster_interrupt_end: [],
    game_over: []
  });
  assert.deepStrictEqual(Object.values(HuntEngine.PHASES).filter((phase) => phase !== "game_over"), [
    "adventurer_prepare", "adventurer_roll", "adventurer_action", "adventurer_end",
    "monster_prepare", "monster_roll", "monster_action", "monster_end",
    "monster_interrupt_prepare", "monster_interrupt_action", "monster_interrupt_end"
  ]);
  assert.strictEqual(room.game.mode, "hunt");
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerPrepare);
  assert.strictEqual(pieceFor(room, first).life, 4);
  assert.strictEqual(pieceFor(room, second).wizardCharges, 3);
  assert.strictEqual(room.game.hunt.treasureGoal, 5);
  assert.strictEqual(Object.keys(room.game.pieces).length, 2);

  const humanView = HuntEngine.makeGameView(room, first);
  const mummyView = HuntEngine.makeGameView(room, mummy);
  assert(humanView.pieces.every((piece) => Object.hasOwn(piece, "position")));
  assert(mummyView.pieces.every((piece) => !Object.hasOwn(piece, "position")));
  assert(mummyView.pieces.every((piece) => Object.hasOwn(piece, "guard") && Object.hasOwn(piece, "injured")
    && Object.hasOwn(piece, "bleeding") && Object.hasOwn(piece, "gazeStacks")
    && Object.hasOwn(piece, "corrupted")));
  assert.deepStrictEqual(mummyView.progress, []);
  assert.strictEqual(mummyView.dice, null);
  assert.deepStrictEqual(mummyView.hand, []);
  assert(!Object.hasOwn(mummyView.hunt, "countdown"));

  const wizard = pieceFor(room, second);
  makeCurrent(room, wizard);
  room.game.dice[0].locked = true;
  room.game.dice[0].face = "mummy";
  assert(!HuntEngine.makeGameView(room, second).legal.actions.includes("useWizardUnlock"));
  assert(HuntEngine.applyGameAction(room, second, "useWizardUnlock").includes("至少鎖定 2 顆怪物骰"));
  assert.strictEqual(wizard.wizardCharges, 3);
  assert.strictEqual(room.game.dice[0].locked, true);
  room.game.dice[1].locked = true;
  room.game.dice[1].face = "mummy";
  assert(HuntEngine.makeGameView(room, second).legal.actions.includes("useWizardUnlock"));
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "useWizardUnlock"), null);
  assert.strictEqual(room.game.dice.filter((die) => die.locked).length, 1);
  assert.strictEqual(wizard.wizardCharges, 2);
  assert.strictEqual(wizard.wizardUsedThisTurn, true);
  assert(!HuntEngine.makeGameView(room, second).legal.actions.includes("useWizardUnlock"));
  assert(HuntEngine.applyGameAction(room, second, "useWizardUnlock").includes("每回合只能使用一次"));
  assert.strictEqual(room.game.dice.filter((die) => die.locked).length, 1);
  assert.strictEqual(wizard.wizardCharges, 2);
}

{
  const { room, second } = setup({ professions: ["doctor", "wizard"], mummyType: "knife" });
  const wizard = pieceFor(room, second);
  makeCurrent(room, wizard);
  for (const die of room.game.dice.slice(0, 4)) {
    die.locked = true;
    die.face = "mummy";
  }
  assert(HuntEngine.makeGameView(room, second).legal.actions.includes("useWizardUnlock"));
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "useWizardUnlock"), null);
  assert.strictEqual(wizard.wizardCharges, 2);

  wizard.wizardUsedThisTurn = false;
  for (const die of room.game.dice) {
    die.locked = true;
    die.face = "mummy";
  }
  assert(!HuntEngine.makeGameView(room, second).legal.actions.includes("useWizardUnlock"));
  assert(HuntEngine.applyGameAction(room, second, "useWizardUnlock").includes("全部骰子鎖定"));
  assert.strictEqual(wizard.wizardCharges, 2);
}

{
  const { room, first, second, mummy } = setup({ professions: ["wizard", "doctor"], mummyType: "knife" });
  const wizard = pieceFor(room, first);
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerPrepare);
  assert(HuntEngine.PHASE_ACTIONS[room.phase].includes("unlockDice"));
  assert(HuntEngine.applyGameAction(room, first, "moveNumeric", { path: [] }).includes("不能在 adventurer_prepare"));

  for (const die of room.game.dice.slice(0, 2)) {
    die.locked = true;
    die.face = "mummy";
  }
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "useWizardUnlock"), null);
  const chargesAfterAbility = wizard.wizardCharges;
  assert.strictEqual(wizard.wizardUsedThisTurn, true);
  room.game.mummy.abilityCooldown = 2;
  const doctor = pieceFor(room, second);
  doctor.guard = true;
  doctor.guardTurns = 2;
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "unlockDice"), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.monsterInterruptAction);
  assert.deepStrictEqual({
    playerId: room.game.resumeState.playerId,
    phase: room.game.resumeState.phase
  }, { playerId: first.id, phase: HuntEngine.PHASES.adventurerPrepare });
  assert(HuntEngine.applyGameAction(room, mummy, "throwKnife", { direction: "up" }).includes("不能在 monster_interrupt_action"));
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerPrepare);
  assert.strictEqual(room.game.currentPieceId, wizard.id);
  assert.strictEqual(room.game.resumeState, null);
  assert.strictEqual(wizard.wizardUsedThisTurn, true, "interrupt resume must not reset preparation abilities");
  assert.strictEqual(wizard.wizardCharges, chargesAfterAbility, "interrupt resume must not refund spent charges");
  assert.strictEqual(room.game.mummy.abilityCooldown, 2, "interrupt turns must not decrement monster cooldowns");
  assert.strictEqual(doctor.guardTurns, 2, "interrupt turns must not consume guard duration");
  assert(!HuntEngine.makeGameView(room, first).legal.actions.includes("useWizardUnlock"));

  assert.strictEqual(HuntEngine.applyGameAction(room, first, "rollAdventurerDice"), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerRoll);
  for (const die of room.game.dice) { die.locked = false; die.face = null; }
  HuntEngine.resolveAdventurerFaces(room, ["1", "1", "1", "1", "1"]);
  const dieId = HuntEngine.makeGameView(room, first).legal.dieIds[0];
  assert(dieId);
  assert(HuntEngine.applyGameAction(room, first, "useWizardUnlock").includes("不能在 adventurer_roll"));
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "selectDie", { dieId }), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerAction);
  assert(HuntEngine.applyGameAction(room, first, "rollAdventurerDice").includes("不能在 adventurer_action"));
}

{
  const { room, first } = setup();
  const view = HuntEngine.makeGameView(room, first);
  assert.strictEqual(view.turnStage, "prepare");
  assert(view.legal.actions.includes("rollAdventurerDice"));
  assert(!view.legal.actions.includes("continueAdventurerTurn"));
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "rollAdventurerDice"), null);
  assert.notStrictEqual(room.phase, HuntEngine.PHASES.adventurerEnd);
  assert(room.game.dice.every((die) => die.face !== null));
}

{
  const { room, first, second } = setup();
  const firstPiece = pieceFor(room, first);
  makeCurrent(room, firstPiece, HuntEngine.PHASES.adventurerRoll);
  HuntEngine.resolveAdventurerFaces(room, ["mummy", "mummy", "mummy", "mummy", "mummy"]);
  assert.strictEqual(room.game.currentPieceId, firstPiece.id);
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerEnd);
  assert.deepStrictEqual(
    HuntEngine.makeGameView(room, first).legal.actions,
    ["finishAdventurerTurn"],
    "an all-locked turn must wait for the current adventurer to confirm the end phase"
  );
  assert.strictEqual(room.game.endState.kind, "no_movement");
  assert.strictEqual(room.game.endState.reason, "all_dice_locked");
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "finishAdventurerTurn"), null);
  assert.strictEqual(room.game.currentPieceId, pieceFor(room, second).id);
  assert.strictEqual(room.phase, HuntEngine.PHASES.monsterInterruptAction);
}

{
  const { room, first, second, mummy } = setup({ professions: ["archaeologist", "doctor"], mummyType: "phantom" });
  const trapped = pieceFor(room, first);
  const other = pieceFor(room, second);
  trapped.position = "9,2";
  trapped.abilityCooldown = 2;
  trapped.corruptionTurns = 2;
  trapped.knifeTracked = true;
  room.game.hunt.phantomWall = { edge: MapFormat.canonicalEdge("9,2", "10,2") };
  room.game.mummy.abilityCooldown = 2;
  makeCurrent(room, other, HuntEngine.PHASES.adventurerEnd);
  room.game.endState = { kind: "mechanism", operatorPlayerId: second.id };
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "finishAdventurerTurn"), null);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.game.currentPieceId, trapped.id);
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerEnd);
  assert.strictEqual(room.game.endState.kind, "no_movement");
  assert.strictEqual(room.game.endState.reason, "no_legal_move");
  assert.strictEqual(trapped.abilityCooldown, 1, "a blocked turn must still advance the adventurer's cooldown at prepare");
  assert.strictEqual(trapped.corruptionTurns, 2, "end-of-turn states must wait for confirmation");
  assert.strictEqual(trapped.knifeTracked, true, "tracking must remain until the blocked turn is confirmed");
  const trappedView = HuntEngine.makeGameView(room, first);
  assert.deepStrictEqual(trappedView.legal.actions, ["finishAdventurerTurn"]);
  assert.strictEqual(trappedView.endState.operatorPlayerId, first.id);
  const trappedMummyView = HuntEngine.makeGameView(room, mummy);
  assert.strictEqual(trappedMummyView.endState.kind, "no_movement");
  assert(!Object.hasOwn(trappedMummyView.endState, "operatorPlayerId"));
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "finishAdventurerTurn"), "現在不是你的回合。");
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "finishAdventurerTurn"), null);
  assert.strictEqual(trapped.corruptionTurns, 1);
  assert.strictEqual(trapped.knifeTracked, false);
  assert.strictEqual(room.game.currentPieceId, other.id);
}

{
  const { room, first, second, mummy } = setup({ professions: ["scout", "cultist"], mummyType: "phantom" });
  const trappedScout = pieceFor(room, first);
  const other = pieceFor(room, second);
  trappedScout.position = "9,2";
  room.game.hunt.phantomWall = { edge: MapFormat.canonicalEdge("9,2", "10,2") };
  room.game.mummy.abilityCooldown = 2;
  makeCurrent(room, other, HuntEngine.PHASES.adventurerEnd);
  room.game.endState = { kind: "mechanism", operatorPlayerId: second.id };
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "finishAdventurerTurn"), null);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.game.dice.length, 6);
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerEnd);
  assert.strictEqual(room.game.endState.kind, "no_movement",
    "Scout and forbidden 0 faces must not force a trapped adventurer to roll");
}

{
  const { room, first, second, mummy } = setup({ professions: ["tombRaider", "archaeologist"], mummyType: "phantom" });
  const tombRaider = pieceFor(room, first);
  const other = pieceFor(room, second);
  tombRaider.position = "9,2";
  tombRaider.abilityCooldown = 0;
  room.game.hunt.phantomWall = { edge: MapFormat.canonicalEdge("9,2", "10,2") };
  room.game.mummy.abilityCooldown = 2;
  makeCurrent(room, other, HuntEngine.PHASES.adventurerEnd);
  room.game.endState = { kind: "mechanism", operatorPlayerId: second.id };
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "finishAdventurerTurn"), null);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerPrepare);
  assert(HuntEngine.makeGameView(room, first).legal.actions.includes("rollAdventurerDice"),
    "a Tomb Raider who can cross the blocking wall must retain the prepare and roll phases");
  assert(HuntEngine.numericPathOptions(room, tombRaider, 2)
    .some((option) => option.path[0] === "10,2" && option.crossedWallEdge),
  "the blocking Phantom wall must provide a real Tomb Raider escape route");
}

{
  const { room, first, second } = setup();
  const piece = pieceFor(room, first);
  const treasureCells = new Set(room.game.map.treasures.map((treasure) => treasure.position));
  const candidate = [1, 2, 3, 4]
    .flatMap((distance) => HuntEngine.numericPaths(room, piece, distance).map((path) => ({ distance, path })))
    .find(({ path }) => !treasureCells.has(path.at(-1)));
  assert(candidate, "fixture must provide a non-treasure movement path");
  makeCurrent(room, piece, HuntEngine.PHASES.adventurerAction);
  room.game.selectedFace = String(candidate.distance);
  room.game.actionState = { kind: "numeric" };
  assert.strictEqual(HuntEngine.makeGameView(room, first).turnStage, "action");
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "moveNumeric", { path: candidate.path }), null);
  assert.strictEqual(room.game.currentPieceId, pieceFor(room, second).id, "a turn with no end interaction must auto-switch players");
}

{
  const { room, first, mummy } = setup({ mummyType: "invisible" });
  room.phase = HuntEngine.PHASES.monsterPrepare;
  room.game.dice[0].locked = true;
  const view = HuntEngine.makeGameView(room, mummy);
  assert(view.legal.actions.includes("rollMummyDie"));
  assert(view.legal.actions.includes("hideMummy"));
  assert(!view.legal.actions.includes("continueMummyTurn"));
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.monsterAction);
  assert([1, 2, 3].includes(room.game.mummy.roll));
  assert.strictEqual(room.game.mummy.remaining, room.game.mummy.roll + 1);
  const publicView = HuntEngine.makeGameView(room, first);
  assert.strictEqual(publicView.mummy.roll, room.game.mummy.roll, "the mummy roll must be public");
  assert.strictEqual(publicView.lockedDiceCount, 1);
  assert.deepStrictEqual(publicView.legal.actions, [], "adventurers must not select or act on the mummy dice");
}

{
  const { room, first, second } = setup({ professions: ["knight", "archaeologist"] });
  const engineer = pieceFor(room, second);
  room.game.revealedTasks = Array.from({ length: room.game.hunt.treasureGoal }, (_, index) => ({ id: `T${index}` }));
  engineer.position = "5,1";
  assert(!HuntEngine.numericPaths(room, engineer, 1).some((path) => path.join("|") === "4,1"));
  makeCurrent(room, engineer);
  let view = HuntEngine.makeGameView(room, second);
  assert(view.legal.mechanisms.includes("A"));
  let result = HuntEngine.resolveMechanismFace(room, "A", 0);
  assert.deepStrictEqual(result, {
    kind: "mechanism", operatorPlayerId: second.id, mechanismId: "A", diceFace: 0,
    baseProgress: 0, classBonus: 1, calculatedProgress: 1, appliedProgress: 1, finalProgress: 1, sealed: false
  });
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerEnd);
  assert.strictEqual(HuntEngine.makeGameView(room, second).turnStage, "end");
  assert.deepStrictEqual(HuntEngine.makeGameView(room, second).legal.actions, ["finishAdventurerTurn"]);
  assert.deepStrictEqual(HuntEngine.makeGameView(room, second).endState, HuntEngine.makeGameView(room, second).endState, "reconnect views must preserve the same result");
  assert(HuntEngine.applyGameAction(room, second, "activateMechanism", { gateId: "A" }).includes("不能在 adventurer_end"));
  assert.strictEqual(room.game.hunt.mechanisms.A, 1, "a repeated mechanism action must not apply progress twice");
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "finishAdventurerTurn"), null);
  const pieceAfterFinish = room.game.currentPieceId;
  assert(HuntEngine.applyGameAction(room, second, "finishAdventurerTurn").includes("不能在"));
  assert.strictEqual(room.game.currentPieceId, pieceAfterFinish, "duplicate finish must not switch twice");
  engineer.position = "5,1";
  makeCurrent(room, engineer);
  result = HuntEngine.resolveMechanismFace(room, "A", 1);
  assert.strictEqual(result.appliedProgress, 2);
  assert.strictEqual(room.game.hunt.mechanisms.A, 3);
  assert.strictEqual(engineer.mechanismContribution, 3, "contribution must equal the 1 + 2 progress actually applied");
  assert.strictEqual(room.game.hunt.exits.A, "open");
  assert.strictEqual(room.game.hunt.tracking.enabled, false, "opening an exit must not start tracking by itself");

  engineer.position = "5,1";
  makeCurrent(room, engineer);
  room.game.hunt.mechanisms.B = 2;
  const capped = HuntEngine.resolveMechanismFace(room, "B", 2);
  assert.deepStrictEqual({
    baseProgress: capped.baseProgress,
    classBonus: capped.classBonus,
    calculatedProgress: capped.calculatedProgress,
    appliedProgress: capped.appliedProgress,
    finalProgress: capped.finalProgress
  }, { baseProgress: 2, classBonus: 1, calculatedProgress: 3, appliedProgress: 1, finalProgress: 3 });
  assert.strictEqual(engineer.mechanismContribution, 4, "progress beyond the mechanism cap must not add contribution");
  assert.strictEqual(room.game.hunt.mechanismSeals.B, null);

  engineer.position = "5,1";
  makeCurrent(room, engineer, HuntEngine.PHASES.adventurerAction);
  room.game.selectedFace = "1";
  room.game.actionState = { kind: "numeric" };
  assert(HuntEngine.numericPaths(room, engineer, 1).some((path) => path.join("|") === "4,1"));
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "moveNumeric", { path: ["4,1"] }), null);
  assert.strictEqual(engineer.escaped, true);
  assert.strictEqual(engineer.position, null);
  assert.strictEqual(room.game.hunt.hatch.status, "open");

  const mummyInfo = HuntEngine.makeGameView(room, room.players.find((player) => player.role === "mummy")).actionInfo.join(" ");
  assert(!mummyInfo.includes(second.name + " 操作機關"));
}

{
  const { room, first, second, mummy } = setup({ professions: ["doctor", "archaeologist"], mummyType: "trap" });
  const doctor = pieceFor(room, first);
  const engineer = pieceFor(room, second);
  room.game.revealedTasks = Array.from({ length: room.game.hunt.treasureGoal }, (_, index) => ({ id: `T${index}` }));
  doctor.position = "5,1";
  engineer.position = "5,1";
  makeCurrent(room, doctor);
  const result = HuntEngine.resolveMechanismFace(room, "A", "X");
  assert.deepStrictEqual(result, {
    kind: "mechanism", operatorPlayerId: first.id, mechanismId: "A", diceFace: "X",
    baseProgress: 1, classBonus: 0, calculatedProgress: 1, appliedProgress: 1, finalProgress: 1, sealed: true
  });
  assert.strictEqual(room.game.hunt.mechanismSeals.A.remaining, 1);
  const operatorView = HuntEngine.makeGameView(room, first);
  const mummyView = HuntEngine.makeGameView(room, mummy);
  assert.deepStrictEqual(operatorView.endState, result);
  const { operatorPlayerId, ...publicResult } = result;
  assert.strictEqual(operatorPlayerId, first.id);
  assert.deepStrictEqual(mummyView.endState, publicResult);
  assert.strictEqual(mummyView.currentPlayerId, first.id, "the current adventurer remains public during mechanism resolution");
  assert(!Object.hasOwn(mummyView.endState, "operatorPlayerId"));
  assert(!Object.hasOwn(mummyView.endState, "operatorProfession"));
  assert(!Object.hasOwn(mummyView.endState, "operatorName"));
  assert(!JSON.stringify(mummyView.endState).includes(first.name));
  assert(!JSON.stringify(mummyView.endState).includes(doctor.profession));
  assert(!mummyView.actionInfo.find((message) => message.includes("機關 A 擲出")).includes(first.name));
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "finishAdventurerTurn"), "現在不是你的回合。");
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "finishAdventurerTurn"), null);
  assert.strictEqual(room.game.hunt.mechanismSeals.A.remaining, 1, "operator result confirmation must not consume the seal");

  engineer.position = "5,1";
  makeCurrent(room, engineer);
  const legal = HuntEngine.makeGameView(room, second).legal.mechanisms;
  assert(!legal.includes("A"), "sealed mechanism must be unavailable");
  assert(legal.includes("B"), "the other mechanism must remain usable");

  room.game.dice[0].locked = true;
  room.game.dice[0].face = "mummy";
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "unlockDice"), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.monsterInterruptAction);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.game.hunt.mechanismSeals.A.remaining, 1, "mummy interludes must not consume a mechanism seal");

  room.phase = HuntEngine.PHASES.monsterPrepare;
  room.game.mummy.moveKind = "normal";
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.game.hunt.mechanismSeals.A.remaining, 1, "mummy turns must not consume a mechanism seal");

  makeCurrent(room, engineer, HuntEngine.PHASES.adventurerRoll);
  for (const die of room.game.dice) { die.locked = false; die.face = null; }
  HuntEngine.resolveAdventurerFaces(room, ["mummy", "mummy", "mummy", "mummy", "mummy"]);
  assert.strictEqual(room.game.hunt.mechanismSeals.A.remaining, 1,
    "the all-locked end state must not settle the adventurer turn before confirmation");
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "finishAdventurerTurn"), null);
  assert.strictEqual(room.game.hunt.mechanismSeals.A, null, "the next completed adventurer turn must clear the seal");

  doctor.position = "5,1";
  makeCurrent(room, doctor);
  room.game.hunt.mechanisms.A = 2;
  const completingX = HuntEngine.resolveMechanismFace(room, "A", "X");
  assert.strictEqual(completingX.finalProgress, 3);
  assert.strictEqual(completingX.sealed, false);
  assert.strictEqual(room.game.hunt.mechanismSeals.A, null);
  assert.strictEqual(room.game.hunt.exits.A, "open");
}

{
  for (const [profession, bonus] of [["doctor", 0], ["archaeologist", 1]]) {
    const { room, first } = setup({ professions: [profession, profession === "doctor" ? "archaeologist" : "doctor"] });
    const piece = pieceFor(room, first);
    for (const [face, base] of [[0, 0], [1, 1], [2, 2], ["X", 1]]) {
      makeCurrent(room, piece);
      room.game.hunt.mechanisms.A = 0;
      room.game.hunt.exits.A = "closed";
      room.game.hunt.mechanismSeals.A = null;
      piece.mechanismContribution = 0;
      const result = HuntEngine.resolveMechanismFace(room, "A", face);
      assert.strictEqual(result.baseProgress, base);
      assert.strictEqual(result.classBonus, bonus);
      assert.strictEqual(result.calculatedProgress, base + bonus);
      assert.strictEqual(result.finalProgress, Math.min(3, base + bonus));
      assert.strictEqual(result.appliedProgress, Math.min(3, base + bonus));
      assert.strictEqual(piece.mechanismContribution, result.appliedProgress);
      assert.strictEqual(result.sealed, face === "X" && result.finalProgress < 3);
    }
  }
}

{
  const { room, first, second, mummy } = setup({ professions: ["knight", "archaeologist"], mummyType: "trap" });
  const knight = pieceFor(room, first);
  const target = pieceFor(room, second);
  knight.position = "6,3";
  target.position = "7,4";
  makeCurrent(room, knight);
  assert(HuntEngine.makeGameView(room, first).legal.guardTargets.includes(target.id), "diagonal target must be guardable");
  target.position = "8,4";
  assert(!(HuntEngine.makeGameView(room, first).legal.guardTargets || []).includes(target.id), "target outside the surrounding eight cells must be rejected");
  target.position = "6,4";
  const originalWalls = room.game.map.walls.slice();
  room.game.map.walls.push(MapFormat.canonicalEdge(knight.position, target.position));
  room.game.graph = MapFormat.buildMovementGraph(room.game.map, { hunt: true });
  assert(HuntEngine.makeGameView(room, first).legal.guardTargets.includes(target.id));
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "useKnightGuard", { pieceId: target.id }), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerPrepare, "guard must keep the knight in the prepare phase");
  assert.strictEqual(room.game.currentPieceId, knight.id, "guard must not end or pass the knight's turn");
  room.game.map.walls = originalWalls;
  room.game.graph = MapFormat.buildMovementGraph(room.game.map, { hunt: true });
  const afterGuardActions = HuntEngine.makeGameView(room, first).legal.actions;
  assert(afterGuardActions.includes("rollAdventurerDice"), "the knight must still be able to roll after guarding");
  assert(!afterGuardActions.includes("useKnightGuard"), "the knight cannot guard twice during the cooldown");
  assert.strictEqual(target.guard, true);
  assert.strictEqual(target.guardTurns, 2);
  assert.strictEqual(knight.abilityCooldown, 3);
  const guardInfo = HuntEngine.makeGameView(room, mummy).actionInfo.find((message) => message.includes("騎士使用了守護"));
  assert(guardInfo);
  assert(!guardInfo.includes(first.name));
  assert(!guardInfo.includes(second.name));
  const guardedMummyView = HuntEngine.makeGameView(room, mummy).pieces.find((piece) => piece.id === target.id);
  assert.strictEqual(guardedMummyView.guard, true);
  assert.strictEqual(guardedMummyView.guardTurns, 2);

  room.game.mummy.position = "6,5";
  room.game.mummy.remaining = 1;
  room.game.mummy.moveKind = "normal";
  room.phase = HuntEngine.PHASES.monsterAction;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "moveMummy", { cell: "6,4" }), null);
  assert.strictEqual(target.life, 3);
  assert.strictEqual(target.position, "dungeon");
  assert.strictEqual(target.guard, false);
  assert.strictEqual(target.guardTurns, 0);

  knight.position = "6,3";
  room.game.mummy.position = "1,1";
  makeCurrent(room, knight, HuntEngine.PHASES.adventurerAction);
  room.game.selectedFace = "1";
  room.game.actionState = { kind: "numeric" };
  room.game.hunt.traps = ["6,4"];
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "moveNumeric", { path: ["6,4"] }), null);
  assert.strictEqual(knight.position, "6,4");
  assert.strictEqual(knight.injuredTurns, 1);
  assert.strictEqual(room.game.mummy.abilityTriggers, 1);
  assert.deepStrictEqual(room.game.hunt.traps, []);
  assert.strictEqual(HuntEngine.makeGameView(room, mummy).pieces.find((piece) => piece.id === knight.id).injured, true);
}

{
  const { room, second, mummy } = setup({ professions: ["knight", "archaeologist"], mummyType: "trap" });
  const target = pieceFor(room, second);
  target.guard = true;
  target.guardTurns = 2;

  room.game.mummy.moveKind = "normal";
  room.phase = HuntEngine.PHASES.monsterAction;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(target.guard, true);
  assert.strictEqual(target.guardTurns, 1, "one normal monster turn must consume one guard-duration round");

  room.game.mummy.moveKind = "normal";
  room.phase = HuntEngine.PHASES.monsterAction;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(target.guard, false, "guard must expire after the second normal monster turn");
  assert.strictEqual(target.guardTurns, 0);
}

{
  const { room, first, mummy } = setup({ professions: ["knight", "archaeologist"], mummyType: "invisible" });
  const human = pieceFor(room, first);
  human.position = "1,1";
  room.game.mummy.position = "6,5";
  room.phase = HuntEngine.PHASES.monsterPrepare;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "hideMummy"), null);
  HuntEngine.resolveMummyRoll(room, 1);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "moveMummy", { cell: "6,4" }), null);
  const humanView = HuntEngine.makeGameView(room, first);
  const mummyView = HuntEngine.makeGameView(room, mummy);
  assert.strictEqual(humanView.mummy.position, null);
  assert(humanView.actionInfo.includes("隱形提燈怪移動 1 步。"));
  assert(!humanView.actionInfo.join(" ").includes("你移動到 (6,4)"));
  assert(!room.log.join(" ").includes("提燈怪移動到 (6,4)"));
  assert(mummyView.actionInfo.includes("你移動到 (6,4)。"));
}

{
  const { room, first, mummy } = setup({ professions: ["knight", "archaeologist"], mummyType: "invisible" });
  const human = pieceFor(room, first);
  human.position = "6,4";
  room.game.mummy.position = "6,5";
  room.phase = HuntEngine.PHASES.monsterPrepare;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "hideMummy"), null);
  assert.strictEqual(room.game.mummy.invisible, true);
  assert.strictEqual(HuntEngine.makeGameView(room, first).mummy.position, null);
  HuntEngine.resolveMummyRoll(room, 1);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "moveMummy", { cell: "6,4" }), null);
  assert.strictEqual(room.game.mummy.position, "6,5");
  assert.strictEqual(room.game.mummy.invisible, false);
  assert.strictEqual(room.game.mummy.abilityTriggers, 1);
  assert.strictEqual(human.life, 3);

  human.position = "6,3";
  room.game.mummy.position = "6,4";
  room.game.mummy.invisible = true;
  makeCurrent(room, human, HuntEngine.PHASES.adventurerAction);
  room.game.selectedFace = "1";
  room.game.actionState = { kind: "numeric" };
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "moveNumeric", { path: ["6,4"] }), null);
  assert.strictEqual(room.game.mummy.invisible, false);
  assert.strictEqual(room.game.mummy.abilityTriggers, 2);
  room.game.mummy.invisible = true;
  room.phase = HuntEngine.PHASES.monsterPrepare;
  room.game.mummy.abilityUsedThisTurn = false;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "revealMummy"), null);
  assert.strictEqual(room.game.mummy.abilityTriggers, 2, "active reveal must not count as an ability trigger");
}

{
  const { room, first, mummy } = setup({ professions: ["knight", "archaeologist"], mummyType: "knife" });
  const human = pieceFor(room, first);
  human.position = "6,4";
  room.game.mummy.position = "6,5";
  room.phase = HuntEngine.PHASES.monsterPrepare;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "throwKnife", { direction: "up" }), null);
  assert.strictEqual(human.injuredTurns, 0, "knife hits must no longer apply the injury debuff");
  assert.strictEqual(human.bleeding, true);
  assert.strictEqual(human.knifeTracked, true);
  assert.strictEqual(room.game.mummy.abilityTriggers, 1);
  assert.strictEqual(room.game.mummy.abilityCooldown, 2);
  assert.strictEqual(HuntEngine.makeGameView(room, first).mummy.abilityCooldown, undefined);
  assert.strictEqual(HuntEngine.makeGameView(room, mummy).mummy.abilityCooldown, 2);
  assert.strictEqual(HuntEngine.makeGameView(room, mummy).mummy.abilityTriggers, undefined);
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerPrepare);
  assert.strictEqual(room.game.currentPieceId, pieceFor(room, first).id);
  assert(!HuntEngine.makeGameView(room, mummy).legal.actions.includes("rollMummyDie"));
  const trackedHumanView = HuntEngine.makeGameView(room, first);
  const trackedPieceView = trackedHumanView.pieces.find((piece) => piece.id === human.id);
  assert.strictEqual(trackedPieceView.bleeding, true);
  assert.strictEqual(trackedPieceView.trackedByKnife, true);
  const trackedMummyView = HuntEngine.makeGameView(room, mummy);
  assert.deepStrictEqual(trackedMummyView.hunt.knifeTrackedPositions, ["6,4"]);
  assert.strictEqual(trackedMummyView.pieces.find((piece) => piece.id === human.id).bleeding, true);
  assert.strictEqual(trackedMummyView.pieces.find((piece) => piece.id === human.id).trackedByKnife, true);
  assert(trackedMummyView.pieces.every((piece) => !Object.hasOwn(piece, "position")));
  const info = HuntEngine.makeGameView(room, mummy).actionInfo.find((message) => message.includes("(6,4)"));
  assert(info.includes("(6,4)"));
  assert(!info.includes(first.name));

  human.position = "6,3";
  assert.deepStrictEqual(HuntEngine.makeGameView(room, mummy).hunt.knifeTrackedPositions, ["6,3"],
    "tracked coordinates must update as the adventurer moves");
  makeCurrent(room, human, HuntEngine.PHASES.adventurerEnd);
  room.game.endState = { kind: "mechanism", operatorPlayerId: first.id };
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "finishAdventurerTurn"), null);
  assert.strictEqual(human.bleeding, true, "bleeding must persist until the adventurer actively stops it");
  assert.strictEqual(human.knifeTracked, false);
  assert.deepStrictEqual(HuntEngine.makeGameView(room, mummy).hunt.knifeTrackedPositions, []);

  human.position = "6,4";
  human.guard = true;
  const guardedLife = human.life;
  room.game.mummy.position = "6,5";
  room.game.mummy.abilityCooldown = 0;
  room.phase = HuntEngine.PHASES.monsterPrepare;
  room.game.mummy.abilityUsedThisTurn = false;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "throwKnife", { direction: "up" }), null);
  assert.strictEqual(room.game.mummy.abilityTriggers, 2, "a guarded knife hit must still count");
  assert.strictEqual(human.guard, false);
  assert.strictEqual(human.life, guardedLife);
  assert.strictEqual(human.injuredTurns, 0);
  assert.strictEqual(human.bleeding, true, "guard must not remove existing bleeding");
  assert.strictEqual(human.knifeTracked, false);

  human.position = "6,4";
  room.game.mummy.position = "6,5";
  room.game.mummy.abilityCooldown = 0;
  room.phase = HuntEngine.PHASES.monsterPrepare;
  room.game.mummy.abilityUsedThisTurn = false;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "throwKnife", { direction: "up" }), null);
  assert.strictEqual(room.game.mummy.abilityTriggers, 3);
  assert.strictEqual(human.life, guardedLife - 1, "hitting an already bleeding adventurer must cost 1 HP");
  assert.strictEqual(human.bleeding, true);
  assert.strictEqual(human.knifeTracked, true);
  const bleedingView = HuntEngine.makeGameView(room, first);
  assert(bleedingView.legal.actions.includes("stopBleeding"));
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "stopBleeding"), null);
  assert.strictEqual(human.bleeding, false);
  assert.strictEqual(human.knifeTracked, false);

  room.game.mummy.position = "1,1";
  room.game.mummy.abilityCooldown = 0;
  room.phase = HuntEngine.PHASES.monsterPrepare;
  room.game.mummy.abilityUsedThisTurn = false;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "throwKnife", { direction: "up" }), null);
  assert.strictEqual(room.game.mummy.abilityTriggers, 3, "a missed knife must not count");
}

{
  const { room, mummy } = setup({ professions: ["knight", "archaeologist"], mummyType: "trap" });
  room.game.turnSerial += 1;
  room.game.activeMonsterTurnId = room.game.turnSerial;
  room.phase = HuntEngine.PHASES.monsterPrepare;

  room.game.mummy.position = "dungeon";
  let view = HuntEngine.makeGameView(room, mummy);
  assert(view.legal.trapPlacements.length > 0, "the trap ghost may reach the second road layer from the dungeon");
  assert(room.game.map.zones.dungeon.exits.every((cell) => !view.legal.trapPlacements.includes(cell)),
    "traps cannot be placed directly on a dungeon exit");
  assert(view.legal.actions.includes("placeTrap"));

  room.game.mummy.position = "6,5";
  view = HuntEngine.makeGameView(room, mummy);
  assert(!view.legal.trapPlacements.includes("6,6"), "the first road cell outside the dungeon must be protected");
  assert(HuntEngine.applyGameAction(room, mummy, "placeTrap", { cell: "6,6" }).includes("不能放置陷阱"));

  room.game.mummy.position = "7,6";
  view = HuntEngine.makeGameView(room, mummy);
  assert(!view.legal.trapPlacements.includes("7,7"), "every dungeon exit must be protected");

  room.game.mummy.position = "6,4";
  view = HuntEngine.makeGameView(room, mummy);
  assert(view.legal.trapPlacements.includes("6,5"), "the next road layer beyond a dungeon exit must remain available");
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "placeTrap", { cell: "6,5" }), null);
  assert.deepStrictEqual(room.game.hunt.traps, ["6,5"]);
}

{
  const { room, mummy } = setup({ professions: ["knight", "archaeologist"], mummyType: "trap" });
  room.game.turnSerial += 1;
  room.game.activeMonsterTurnId = room.game.turnSerial;
  room.phase = HuntEngine.PHASES.monsterPrepare;
  room.game.mummy.position = "6,3";
  let view = HuntEngine.makeGameView(room, mummy);
  assert(view.legal.trapPlacements.includes("7,4"), "trap placement must include cells two road steps away");
  assert(!view.legal.trapPlacements.includes("5,3"), "permanent walls must block trap range");

  room.game.hunt.traps = ["7,4"];
  view = HuntEngine.makeGameView(room, mummy);
  assert(view.legal.trapRecoveries.includes("7,4"), "trap recovery must include cells two road steps away");

  room.game.hunt.temporaryWall = {
    edge: MapFormat.canonicalEdge("6,3", "6,4"),
    ownerPieceId: Object.values(room.game.pieces)[0].id
  };
  view = HuntEngine.makeGameView(room, mummy);
  assert(!view.legal.trapPlacements.includes("7,4"), "temporary walls must block trap placement range");
  assert(!view.legal.trapRecoveries.includes("7,4"), "temporary walls must block trap recovery range");
}

{
  const { room, first, mummy } = setup({ professions: ["knight", "archaeologist"], mummyType: "trap" });
  room.game.mummy.position = "6,3";
  room.game.turnSerial += 1;
  room.game.activeMonsterTurnId = room.game.turnSerial;
  room.phase = HuntEngine.PHASES.monsterPrepare;
  let view = HuntEngine.makeGameView(room, mummy);
  assert(view.legal.trapPlacements.includes("6,4"));
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "placeTrap", { cell: "6,4" }), null);
  assert.deepStrictEqual(room.game.hunt.traps, ["6,4"]);
  assert.strictEqual(room.game.mummy.abilityCooldown, 2);
  assert.strictEqual(HuntEngine.makeGameView(room, first).mummy.abilityCooldown, undefined);
  assert.strictEqual(HuntEngine.makeGameView(room, mummy).mummy.abilityCooldown, 2);
  assert.strictEqual(HuntEngine.makeGameView(room, mummy).mummy.cooldownCreatedTurnId, undefined);
  assert(!HuntEngine.makeGameView(room, first).actionInfo.some((message) => message.includes("放置了陷阱")));
  assert(HuntEngine.applyGameAction(room, mummy, "recoverTrap", { cell: "6,4" }).includes("本回合已經操作過陷阱"));

  room.phase = HuntEngine.PHASES.monsterPrepare;
  room.game.mummy.abilityUsedThisTurn = false;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "recoverTrap", { cell: "6,4" }), null);
  assert.deepStrictEqual(room.game.hunt.traps, []);
  assert.strictEqual(room.game.mummy.abilityTriggers, 0);
  room.game.hunt.traps = ["6,4"];
  room.game.mummy.remaining = 1;
  room.game.mummy.moveKind = "normal";
  room.phase = HuntEngine.PHASES.monsterAction;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "moveMummy", { cell: "6,4" }), null);
  assert.deepStrictEqual(room.game.hunt.traps, []);
  assert.strictEqual(room.game.mummy.position, "6,4");
  assert.strictEqual(room.game.mummy.abilityTriggers, 1);
  assert.strictEqual(room.game.mummy.abilityCooldown, 2);

  for (const expected of [2, 2]) {
    room.game.turnSerial += 1;
    room.game.activeMonsterTurnId = room.game.turnSerial;
    room.game.mummy.moveKind = "normal";
    room.phase = HuntEngine.PHASES.monsterAction;
    assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
    assert.strictEqual(room.game.mummy.abilityCooldown, expected, "monster cooldown must not decrement at turn end");
  }
}

{
  const { room, first, mummy } = setup({ professions: ["knight", "archaeologist"], mummyType: "trap" });
  const piece = pieceFor(room, first);
  const task = room.game.hands[first.id][0];
  piece.position = room.game.map.treasures.find((treasure) => treasure.id === task.id).position;
  makeTreasureEnd(room, piece, task.id);
  assert.strictEqual(HuntEngine.makeGameView(room, first).turnStage, "end");
  assert.deepStrictEqual(HuntEngine.makeGameView(room, first).endState, { kind: "treasure", operatorPlayerId: first.id });
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "revealTreasure"), null);
  const mummyView = HuntEngine.makeGameView(room, mummy);
  assert.strictEqual(mummyView.revealedTasks[0].playerId, undefined);
  assert(!mummyView.actionInfo.join(" ").includes(first.name + " 揭露"));

  room.game.hunt.hatch = { status: "open", position: "6,4" };
  room.game.hunt.mechanismSeals.A = { remaining: 1, startedThisTurn: false };
  room.game.mummy.position = "6,5";
  room.game.mummy.remaining = 1;
  room.game.mummy.moveKind = "normal";
  room.phase = HuntEngine.PHASES.monsterAction;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "moveMummy", { cell: "6,4" }), null);
  assert.strictEqual(room.game.hunt.hatch.status, "closed");
  assert.deepStrictEqual(room.game.hunt.exits, { A: "open", B: "open" });
  assert.deepStrictEqual(room.game.hunt.mechanismSeals, { A: null, B: null });
  assert.strictEqual(room.game.hunt.tracking.enabled, true);
  assert.strictEqual(room.game.hunt.tracking.countdown, 3);
  room.game.hunt.tracking.revealThisTurn = true;
  assert(HuntEngine.makeGameView(room, mummy).pieces.every((candidate) => Object.hasOwn(candidate, "position")));
  assert.strictEqual(HuntEngine.makeGameView(room, first).hunt.trackingCountdown, null);
}

{
  const { room, first, second, mummy } = setup({ professions: ["knight", "archaeologist"], mummyType: "trap" });
  const piece = pieceFor(room, first);
  const lastTask = room.game.hands[first.id][0];
  room.game.revealedTasks = Array.from({ length: room.game.hunt.treasureGoal - 1 }, (_, index) => ({
    id: `test-${index}`,
    position: "1,1"
  }));
  piece.position = room.game.map.treasures.find((treasure) => treasure.id === lastTask.id).position;
  makeTreasureEnd(room, piece, lastTask.id);
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "revealTreasure"), null);
  assert.strictEqual(room.game.hunt.tracking.enabled, true);
  assert.strictEqual(room.game.hunt.tracking.countdown, 3);
  assert.strictEqual(HuntEngine.makeGameView(room, mummy).hunt.trackingCountdown, 3);

  const lastAdventurer = pieceFor(room, second);
  for (const expected of [
    { countdown: 2, display: 3, reveal: false },
    { countdown: 1, display: 2, reveal: false },
    { countdown: 0, display: null, reveal: true }
  ]) {
    makeCurrent(room, lastAdventurer, HuntEngine.PHASES.adventurerRoll);
    for (const die of room.game.dice) { die.locked = false; die.face = null; }
    HuntEngine.resolveAdventurerFaces(room, ["mummy", "mummy", "mummy", "mummy", "mummy"]);
    assert.strictEqual(HuntEngine.applyGameAction(room, second, "finishAdventurerTurn"), null);
    assert.strictEqual(room.game.hunt.tracking.countdown, expected.countdown);
    assert.strictEqual(room.game.hunt.tracking.revealThisTurn, expected.reveal);
    const mummyView = HuntEngine.makeGameView(room, mummy);
    assert.strictEqual(mummyView.hunt.trackingCountdown, expected.display);
    assert.strictEqual(mummyView.hunt.trackingReveal, expected.reveal);
    assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
    assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  }
  assert.strictEqual(room.game.hunt.tracking.countdown, 3);
  assert.strictEqual(room.game.hunt.tracking.revealThisTurn, false);
  assert.strictEqual(HuntEngine.makeGameView(room, first).hunt.trackingCountdown, 3);
}

{
  const { room, first, second, mummy } = setup({ professions: ["knight", "archaeologist"], mummyType: "trap" });
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
  room.phase = HuntEngine.PHASES.monsterAction;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "moveMummy", { cell: victimCell }), null);
  assert.strictEqual(victim.eliminated, true);
  assert.strictEqual(room.game.hunt.hatch.status, "open");
  const hatch = room.game.hunt.hatch.position;
  assert(treasureCells.has(hatch), "hatch must be allowed to open on a treasure cell");
  const neighbor = (room.game.graph.passages[hatch] || []).find((cell) => cell !== room.game.mummy.position);
  assert(neighbor, "hatch must have a reachable neighbor");
  room.game.revealedTasks = [
    { id: "A1", playerId: second.id, pieceId: survivor.id, position: survivor.position },
    { id: "B1", playerId: second.id, pieceId: survivor.id, position: survivor.position }
  ];
  survivor.mechanismContribution = 4;
  victim.mechanismContribution = 2;
  room.game.mummy.abilityTriggers = 3;
  survivor.position = neighbor;
  makeCurrent(room, survivor, HuntEngine.PHASES.adventurerAction);
  room.game.selectedFace = "1";
  room.game.actionState = { kind: "numeric" };
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "moveNumeric", { path: [hatch] }), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.gameOver);
  assert.strictEqual(room.game.winner.role, "adventurer");
  assert.strictEqual(room.game.winner.results.filter((result) => result.outcome === "escaped").length, 1);
  const survivorResult = room.game.winner.results.find((result) => result.pieceId === survivor.id);
  assert.deepStrictEqual({
    profession: survivorResult.profession,
    completedTasks: survivorResult.completedTasks,
    mechanismContribution: survivorResult.mechanismContribution,
    outcome: survivorResult.outcome
  }, { profession: survivor.profession, completedTasks: 2, mechanismContribution: 4, outcome: "escaped" });
  assert.deepStrictEqual(room.game.winner.mummyResult, {
    playerId: mummy.id,
    type: "trap",
    abilityTriggers: 3
  });
}

{
  const { room, first, second, mummy } = setup({ professions: ["knight", "archaeologist"], mummyType: "knife" });
  const knight = pieceFor(room, first);
  const engineer = pieceFor(room, second);
  knight.position = "6,3";
  engineer.position = "6,4";
  makeCurrent(room, knight, HuntEngine.PHASES.adventurerPrepare);
  const createdTurnId = room.game.activeAdventurerTurnId;
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "useKnightGuard", { pieceId: engineer.id }), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerPrepare);
  assert.strictEqual(knight.abilityCooldown, 3, "the use turn must not decrement knight cooldown");
  assert.strictEqual(knight.cooldownCreatedTurnId, createdTurnId);
  assert.strictEqual(HuntEngine.makeGameView(room, second).pieces
    .find((piece) => piece.id === knight.id).abilityCooldown, 3,
  "adventurers must see one another's profession cooldown");
  assert(!Object.hasOwn(HuntEngine.makeGameView(room, mummy).pieces
    .find((piece) => piece.id === knight.id), "abilityCooldown"),
  "the mummy view must not receive adventurer profession cooldowns");

  makeCurrent(room, engineer, HuntEngine.PHASES.adventurerEnd);
  room.game.endState = { kind: "mechanism", operatorPlayerId: second.id };
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "finishAdventurerTurn"), null);
  assert.strictEqual(knight.abilityCooldown, 3, "other adventurers must not decrement knight cooldown");

  room.game.turnSerial += 1;
  room.game.activeMonsterTurnId = room.game.turnSerial;
  room.phase = HuntEngine.PHASES.monsterPrepare;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(knight.abilityCooldown, 2, "cooldown must decrement when the knight's next normal prepare phase begins");

  for (const expected of [1, 0]) {
    makeCurrent(room, knight, HuntEngine.PHASES.adventurerEnd);
    room.game.endState = { kind: "mechanism", operatorPlayerId: first.id };
    assert.strictEqual(HuntEngine.applyGameAction(room, first, "finishAdventurerTurn"), null);
    assert.strictEqual(knight.abilityCooldown, expected + 1, "cooldown must not decrement at the knight's turn end");
    makeCurrent(room, engineer, HuntEngine.PHASES.adventurerEnd);
    room.game.endState = { kind: "mechanism", operatorPlayerId: second.id };
    assert.strictEqual(HuntEngine.applyGameAction(room, second, "finishAdventurerTurn"), null);
    assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
    assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
    assert.strictEqual(knight.abilityCooldown, expected);
  }
  assert.strictEqual(knight.cooldownCreatedTurnId, null);
}

{
  const { room, first, second, mummy } = setup({ professions: ["scout", "archaeologist"], mummyType: "trap" });
  const scout = pieceFor(room, first);
  makeCurrent(room, scout, HuntEngine.PHASES.adventurerRoll);
  HuntEngine.resolveAdventurerFaces(room, ["0", "compass", "2", "mummy", "3"]);
  const rollView = HuntEngine.makeGameView(room, first);
  assert(rollView.legal.dieIds.includes("die-1"), "the Scout 0 face must be selectable");
  assert(rollView.legal.dieIds.includes("die-2"), "the Scout compass must be selectable when a route exists");
  assert(rollView.legal.compassDistances.length > 0);
  const compassDistance = rollView.legal.compassDistances[0];
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "selectDie", {
    dieId: "die-2",
    distance: compassDistance
  }), null);
  assert.strictEqual(room.game.lastPublicDie, `羅盤 ${compassDistance}`);
  const mummyView = HuntEngine.makeGameView(room, mummy);
  assert.strictEqual(mummyView.lastPublicDie, `羅盤 ${compassDistance}`);
  assert.deepStrictEqual(mummyView.legal, { actions: [] }, "the mummy must not receive the Scout path");

  makeCurrent(room, scout, HuntEngine.PHASES.adventurerRoll);
  room.game.dice.forEach((die) => {
    die.locked = false;
    die.face = null;
  });
  HuntEngine.resolveAdventurerFaces(room, ["0", "2", "3", "4", "compass"]);
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "selectDie", { dieId: "die-1" }), null);
  assert.strictEqual(room.game.currentPieceId, pieceFor(room, second).id, "the Scout 0 face must end the turn in place");
}

{
  const { room, first, second } = setup({ professions: ["tombRaider", "archaeologist"] });
  const tombRaider = pieceFor(room, first);
  const permanentEdge = room.game.map.walls.find((edge) => {
    const [left, right] = edge.split("|");
    return room.game.graph.passages[left] && room.game.graph.passages[right];
  });
  assert(permanentEdge, "fixture must contain a wall between two floor cells");
  const [left, right] = permanentEdge.split("|");
  tombRaider.position = left;
  pieceFor(room, second).position = "entrance";
  makeCurrent(room, tombRaider, HuntEngine.PHASES.adventurerAction);
  room.game.activeAdventurerTurnId = 901;
  room.game.selectedFace = "2";
  room.game.actionState = { kind: "numeric", movementBudget: 2 };
  const option = HuntEngine.numericPathOptions(room, tombRaider, 2)
    .find((candidate) => candidate.path.length === 1 && candidate.path[0] === right);
  assert(option, "the Tomb Raider must receive a two-point route across one wall");
  assert.strictEqual(option.crossedWallEdge, permanentEdge);
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "moveNumeric", { path: option.path }), null);
  assert.strictEqual(tombRaider.abilityCooldown, 2, "wall crossing cooldown must not decrement on the use turn");
}

{
  const { room, first, second, mummy } = setup({ professions: ["mason", "archaeologist"], mummyType: "trap" });
  const mason = pieceFor(room, first);
  pieceFor(room, second).eliminated = true;
  const entranceView = HuntEngine.makeGameView(room, first);
  assert(!entranceView.legal.actions.includes("useMasonWall"), "the entrance is not a legal wall origin");
  assert.strictEqual(entranceView.legal.masonWallEdges, undefined);
  mason.position = "3,6";
  room.game.hunt.phantomWall = { edge: MapFormat.canonicalEdge("2,7", "3,7") };
  makeCurrent(room, mason);
  assert(!(HuntEngine.makeGameView(room, first).legal.masonWallEdges || [])
    .includes(MapFormat.canonicalEdge("3,6", "3,7")),
  "combined dynamic walls must not seal the last entrance route");
  room.game.hunt.phantomWall = null;
  mason.position = "6,3";
  makeCurrent(room, mason);
  const legalEdge = MapFormat.canonicalEdge("6,3", "6,4");
  assert(HuntEngine.makeGameView(room, first).legal.masonWallEdges.includes(legalEdge),
    "the Mason may close an ordinary road's only passage");
  mason.position = "1,1";
  makeCurrent(room, mason);
  const movementEdge = MapFormat.canonicalEdge("1,1", "2,1");
  assert(HuntEngine.makeGameView(room, first).legal.masonWallEdges.includes(movementEdge));
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "useMasonWall", { edge: movementEdge }), null);
  assert.strictEqual(mason.abilityCooldown, 3);
  assert.strictEqual(mason.masonCharges, undefined, "Mason walls no longer use per-game charges");
  assert.deepStrictEqual(HuntEngine.makeGameView(room, mummy).hunt.temporaryWall, {
    edge: movementEdge,
    type: "temporary"
  });
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerPrepare,
    "building must return the Mason to the prepare phase");
  const afterWallView = HuntEngine.makeGameView(room, first);
  assert(afterWallView.legal.actions.includes("rollAdventurerDice"),
    "the Mason may still roll and move after building");
  assert(!afterWallView.legal.actions.includes("useMasonWall"),
    "the new cooldown must prevent a second wall in the same turn");
  makeCurrent(room, mason, HuntEngine.PHASES.adventurerEnd);
  room.game.endState = { kind: "no_movement", reason: "test", operatorPlayerId: first.id };
  assert(HuntEngine.applyGameAction(room, first, "useMasonWall", { edge: movementEdge }).includes("不能在 adventurer_end"),
    "the Mason must not build after moving");
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "finishAdventurerTurn"), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.monsterPrepare);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.game.hunt.temporaryWall, null, "the wall must expire when the Mason's next normal turn starts");
  assert.strictEqual(mason.abilityCooldown, 2);

  for (const expected of [1, 0]) {
    makeCurrent(room, mason, HuntEngine.PHASES.adventurerEnd);
    room.game.endState = { kind: "mechanism", operatorPlayerId: first.id };
    assert.strictEqual(HuntEngine.applyGameAction(room, first, "finishAdventurerTurn"), null);
    assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
    assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
    assert.strictEqual(mason.abilityCooldown, expected);
  }
  assert(HuntEngine.makeGameView(room, first).legal.actions.includes("useMasonWall"),
    "the Mason may build again after the three-turn cooldown");
}

{
  const { room, first, mummy } = setup({ professions: ["archaeologist", "doctor"] });
  const archaeologist = pieceFor(room, first);
  archaeologist.guard = true;
  const task = room.game.hands[first.id][0];
  const beforeProgress = room.game.revealedTasks.length;
  assert(HuntEngine.makeGameView(room, first).legal.actions.includes("useArchaeologistTask"));
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "useArchaeologistTask", { taskId: task.id }), null);
  assert.strictEqual(archaeologist.life, 2);
  assert.strictEqual(archaeologist.guard, true, "forbidden appraisal must bypass rather than consume guard");
  assert.strictEqual(archaeologist.archaeologistCharges, 0);
  assert.strictEqual(room.game.revealedTasks.length, beforeProgress + 1);
  const mummyTask = HuntEngine.makeGameView(room, mummy).revealedTasks.find((candidate) => candidate.id === task.id);
  assert.deepStrictEqual(mummyTask, { id: task.id, position: treasurePositionForTest(room, task.id) });
}

{
  const { room, first, mummy } = setup({ professions: ["knight", "archaeologist"], mummyType: "burrow" });
  const floorCells = Object.keys(room.game.graph.passages);
  room.game.mummy.position = floorCells[0];
  room.game.activeMonsterTurnId = 1001;
  room.phase = HuntEngine.PHASES.monsterPrepare;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "setGrave"), null);
  const grave = room.game.hunt.grave;
  assert.strictEqual(HuntEngine.makeGameView(room, first).hunt.grave, grave);
  room.game.mummy.position = floorCells.find((cell) => cell !== grave);
  room.game.mummy.abilityUsedThisTurn = false;
  room.game.activeMonsterTurnId = 1002;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "burrowToGrave"), null);
  assert.strictEqual(room.game.mummy.position, grave);
  assert.strictEqual(room.game.mummy.abilityCooldown, 2);
  assert.strictEqual(room.game.mummy.abilityTriggers, 1);
}

{
  const { room, first, second, mummy } = setup({ professions: ["knight", "archaeologist"], mummyType: "phantom" });
  const firstPiece = pieceFor(room, first);
  pieceFor(room, second).eliminated = true;
  let edge = null;
  for (const position of Object.keys(room.game.graph.passages)) {
    room.game.mummy.position = position;
    room.phase = HuntEngine.PHASES.monsterPrepare;
    edge = HuntEngine.makeGameView(room, mummy).legal.phantomWallEdges?.[0] || null;
    if (edge) break;
  }
  assert(edge, "fixture must provide a legal Phantom wall");
  room.game.activeMonsterTurnId = 1101;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "placePhantomWall", { edge }), null);
  assert.strictEqual(room.game.mummy.abilityCooldown, 2);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);

  HuntEngine.resolveMechanismFace(room, "A", 0);
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "finishAdventurerTurn"), null);
  assert(room.game.hunt.phantomWall, "the wall must survive the first subsequent mummy turn");
  assert.strictEqual(room.game.mummy.abilityCooldown, 1);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.game.mummy.abilityCooldown, 1);

  firstPiece.position = Object.keys(room.game.graph.passages)[0];
  HuntEngine.resolveMechanismFace(room, "B", 0);
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "finishAdventurerTurn"), null);
  assert.strictEqual(room.game.hunt.phantomWall, null, "the wall must disappear at the start of the second cooldown turn");
  assert.strictEqual(room.game.mummy.abilityCooldown, 0);
  assert(!HuntEngine.makeGameView(room, mummy).legal.actions.includes("placePhantomWall"),
    "the wall's expiration turn must preserve one full adventurer-round gap");
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.game.mummy.abilityCooldown, 0);
  HuntEngine.resolveMechanismFace(room, "A", 0);
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "finishAdventurerTurn"), null);
  assert(HuntEngine.makeGameView(room, mummy).legal.actions.includes("placePhantomWall"));
}

{
  const { room, first, second, mummy } = setup({ professions: ["knight", "archaeologist"], mummyType: "phantom" });
  const survivor = pieceFor(room, first);
  pieceFor(room, second).eliminated = true;
  room.phase = HuntEngine.PHASES.monsterPrepare;
  room.game.mummy.abilityCooldown = 0;
  room.game.mummy.abilityUsedThisTurn = false;
  room.game.mummy.position = "6,3";
  const ordinaryBridge = MapFormat.canonicalEdge("6,3", "6,4");
  assert(HuntEngine.makeGameView(room, mummy).legal.phantomWallEdges.includes(ordinaryBridge),
    "the Phantom may close an ordinary road's only passage");

  room.game.mummy.position = "6,4";
  survivor.position = "6,5";
  room.game.hunt.hatch = { status: "open", position: "6,3" };
  assert(!(HuntEngine.makeGameView(room, mummy).legal.phantomWallEdges || []).includes(ordinaryBridge),
    "a Phantom wall must not seal the survivor's only route to the hatch");
}

for (const [wallField, shouldHit] of [["temporaryWall", false], ["phantomWall", true]]) {
  const { room, first, second, mummy } = setup({ professions: ["doctor", "archaeologist"], mummyType: "knife" });
  const victim = pieceFor(room, first);
  const bystander = pieceFor(room, second);
  const origin = Object.keys(room.game.graph.passages).find((cell) => room.game.graph.passages[cell].length);
  const target = room.game.graph.passages[origin][0];
  const edge = MapFormat.canonicalEdge(origin, target);
  room.game.mummy.position = origin;
  victim.position = target;
  bystander.position = "entrance";
  room.game.hunt[wallField] = { edge, ...(wallField === "temporaryWall" ? { ownerPieceId: bystander.id } : {}) };
  room.game.activeMonsterTurnId = wallField === "temporaryWall" ? 1201 : 1202;
  room.phase = HuntEngine.PHASES.monsterPrepare;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "throwKnife", {
    direction: directionBetween(origin, target)
  }), null);
  assert.strictEqual(victim.bleeding, shouldHit, `${wallField} knife interaction must match the wall table`);
}

{
  const { room, first, second } = setup({ professions: ["doctor", "archaeologist"], mummyType: "phantom" });
  const adventurer = pieceFor(room, first);
  const bystander = pieceFor(room, second);
  const origin = Object.keys(room.game.graph.passages).find((cell) => room.game.graph.passages[cell].length);
  const target = room.game.graph.passages[origin][0];
  const edge = MapFormat.canonicalEdge(origin, target);
  adventurer.position = origin;
  bystander.position = "entrance";
  room.game.mummy.position = origin;
  room.game.hunt.temporaryWall = { edge, ownerPieceId: bystander.id };
  assert(!HuntEngine.numericPaths(room, adventurer, 1).some((path) => path[0] === target));
  assert(!HuntEngine.mummyMoves(room).includes(target), "temporary walls must block the mummy");
  room.game.hunt.temporaryWall = null;
  room.game.hunt.phantomWall = { edge };
  assert(!HuntEngine.numericPaths(room, adventurer, 1).some((path) => path[0] === target));
  assert(HuntEngine.mummyMoves(room).includes(target), "phantom walls must not block the mummy");
}

for (const wallField of ["temporaryWall", "phantomWall"]) {
  const { room, first, second } = setup({ professions: ["tombRaider", "archaeologist"] });
  const tombRaider = pieceFor(room, first);
  const other = pieceFor(room, second);
  const origin = Object.keys(room.game.graph.passages).find((cell) => room.game.graph.passages[cell].length);
  const target = room.game.graph.passages[origin][0];
  const edge = MapFormat.canonicalEdge(origin, target);
  tombRaider.position = origin;
  other.position = "entrance";
  room.game.hunt[wallField] = { edge, ...(wallField === "temporaryWall" ? { ownerPieceId: other.id } : {}) };
  const route = HuntEngine.numericPathOptions(room, tombRaider, 2)
    .find((option) => option.path.length === 1 && option.path[0] === target);
  assert(route, `the Tomb Raider must be able to cross ${wallField}`);
  assert.strictEqual(route.crossedWallEdge, edge);
}

{
  const { room, first, mummy } = setup({ professions: ["mason", "archaeologist"], mummyType: "burrow" });
  assert(HuntEngine.applyGameAction(room, mummy, "setGrave").includes("不能在 adventurer_prepare"));
  room.phase = HuntEngine.PHASES.monsterPrepare;
  assert(HuntEngine.applyGameAction(room, first, "useMasonWall", { edge: "1,1|2,1" }).includes("不能在 monster_prepare"));
  room.phase = HuntEngine.PHASES.monsterInterruptAction;
  assert(HuntEngine.applyGameAction(room, mummy, "burrowToGrave").includes("不能在 monster_interrupt_action"));
  assert(HuntEngine.applyGameAction(room, mummy, "placePhantomWall", { edge: "1,1|2,1" }).includes("不能在 monster_interrupt_action"));
}

{
  const { room, first, second, mummy } = setup({ professions: ["cultist", "scout"], mummyType: "trap" });
  assert.strictEqual(room.game.dice.length, 6);
  assert.deepStrictEqual(room.game.dice.map((die) => die.kind), [
    "normal", "normal", "normal", "normal", "normal", "forbidden"
  ]);
  const cultist = pieceFor(room, first);
  makeCurrent(room, cultist, HuntEngine.PHASES.adventurerRoll);
  HuntEngine.resolveAdventurerFaces(room, ["1", "2", "3", "4", "arrow", "5"]);
  assert.strictEqual(room.game.dice[5].id, "forbidden-die");
  assert.strictEqual(room.game.dice[5].face, "5");
  assert(HuntEngine.numericPathOptions(room, cultist, 5).length > 0, "the forbidden 5 face must support a five-point path");
  assert(HuntEngine.makeGameView(room, first).legal.dieIds.includes("forbidden-die"));

  room.game.dice.forEach((die) => {
    die.locked = false;
    die.face = null;
  });
  HuntEngine.resolveAdventurerFaces(room, ["1", "2", "3", "4", "arrow", "mummy"]);
  const mummyView = HuntEngine.makeGameView(room, mummy);
  assert.deepStrictEqual(mummyView.lockedDice, [{ id: "forbidden-die", kind: "forbidden" }]);
  assert.strictEqual(mummyView.dicePoolSize, 6);
  const reconnectedCultistRoom = JSON.parse(JSON.stringify(room));
  assert.deepStrictEqual(
    HuntEngine.makeGameView(reconnectedCultistRoom, first).dice.find((die) => die.id === "forbidden-die"),
    HuntEngine.makeGameView(room, first).dice.find((die) => die.id === "forbidden-die")
  );

  const scout = pieceFor(room, second);
  makeCurrent(room, scout, HuntEngine.PHASES.adventurerRoll);
  room.game.dice.forEach((die) => {
    die.locked = false;
    die.face = null;
  });
  HuntEngine.resolveAdventurerFaces(room, ["0", "2", "3", "4", "compass", "0"]);
  assert.strictEqual(room.game.dice[0].face, "0");
  assert.strictEqual(room.game.dice[5].face, "0");
  assert(HuntEngine.makeGameView(room, second).legal.dieIds.includes("forbidden-die"));
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "selectDie", { dieId: "forbidden-die" }), null);
}

{
  const { room, first, second, mummy } = setup({ professions: ["doctor", "archaeologist"], mummyType: "gazer" });
  const gazerRoute = Object.keys(room.game.graph.passages)
    .flatMap((origin) => room.game.graph.passages[origin].map((target) => ({
      origin,
      target,
      approach: room.game.graph.passages[target].find((cell) => cell !== origin)
    })))
    .find((entry) => entry.approach);
  assert(gazerRoute, "fixture must provide a gaze line with an approach cell");
  const { origin, target, approach } = gazerRoute;
  room.game.mummy.position = origin;
  room.game.mummy.moveKind = "normal";
  room.game.activeMonsterTurnId = 2001;
  room.phase = HuntEngine.PHASES.monsterAction;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.monsterEnd);
  const direction = directionBetween(origin, target);
  assert(HuntEngine.makeGameView(room, mummy).legal.gazeDirections.includes(direction));
  const reconnectedGazerRoom = JSON.parse(JSON.stringify(room));
  assert.deepStrictEqual(
    HuntEngine.makeGameView(reconnectedGazerRoom, mummy).legal.gazeDirections,
    HuntEngine.makeGameView(room, mummy).legal.gazeDirections
  );
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "chooseGazeDirection", { direction }), null);
  assert.strictEqual(room.game.hunt.gaze.origin, origin);
  assert(HuntEngine.makeGameView(room, first).hunt.gazeLine.cells.includes(target));

  const victim = pieceFor(room, first);
  room.game.resumeState = {
    playerId: first.id,
    pieceId: victim.id,
    phase: HuntEngine.PHASES.adventurerPrepare,
    disabledDieId: null,
    newTurn: false
  };
  room.game.mummy.moveKind = "interrupt";
  room.phase = HuntEngine.PHASES.monsterInterruptAction;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.game.hunt.gaze.origin, origin, "an interrupt turn must not expire the gaze line");
  pieceFor(room, second).position = "entrance";
  const waitingTask = room.game.hands[first.id][0];
  room.game.map.treasures.find((treasure) => treasure.id === waitingTask.id).position = target;
  const crossGaze = () => {
    victim.position = approach;
    room.game.turnSerial += 1;
    room.game.activeAdventurerTurnId = room.game.turnSerial;
    makeCurrent(room, victim, HuntEngine.PHASES.adventurerAction);
    room.game.selectedFace = "1";
    room.game.actionState = { kind: "numeric", movementBudget: 1 };
    assert.strictEqual(HuntEngine.applyGameAction(room, first, "moveNumeric", { path: [target] }), null);
  };
  crossGaze();
  assert.strictEqual(victim.gazeStacks, 1);
  assert.strictEqual(HuntEngine.makeGameView(room, mummy).pieces.find((piece) => piece.id === victim.id).gazeStacks, 1);
  crossGaze();
  assert.strictEqual(victim.gazeStacks, 2);
  assert.strictEqual(victim.gazeTracked, true);
  assert.deepStrictEqual(HuntEngine.makeGameView(room, mummy).hunt.gazeTrackedPositions, [target]);
  assert.deepStrictEqual(HuntEngine.makeGameView(room, first).hunt.gazeTrackedPositions, []);

  victim.guard = true;
  const life = victim.life;
  crossGaze();
  assert.strictEqual(victim.gazeStacks, 0);
  assert.strictEqual(victim.guard, false);
  assert.strictEqual(victim.life, life);
  assert.strictEqual(victim.gazeTracked, true, "the existing gaze tracking deadline must not be shortened or refreshed");

  const gazeEdge = MapFormat.canonicalEdge(origin, target);
  room.game.hunt.temporaryWall = { edge: gazeEdge, ownerPieceId: pieceFor(room, second).id };
  assert(!HuntEngine.makeGameView(room, first).hunt.gazeLine.cells.includes(target));
  room.game.hunt.temporaryWall = null;
  room.game.hunt.phantomWall = { edge: gazeEdge };
  assert(!HuntEngine.makeGameView(room, first).hunt.gazeLine.cells.includes(target));
  room.game.hunt.phantomWall = null;
  room.game.map.walls.push(gazeEdge);
  assert(!HuntEngine.makeGameView(room, first).hunt.gazeLine.cells.includes(target));
  room.game.map.walls.pop();
  assert(HuntEngine.makeGameView(room, first).hunt.gazeLine.cells.includes(target));
  assert(!Object.hasOwn(HuntEngine.makeGameView(room, mummy).pieces.find((piece) => piece.id === victim.id), "gazeTracked"));
  const mechanismCell = room.game.map.hunt.mechanisms.A;
  const mechanismApproach = MapFormat.neighbors(mechanismCell, room.game.map.width, room.game.map.height)
    .find((cell) => room.game.graph.passages[cell]);
  assert(mechanismApproach);
  assert(!HuntEngine.gazeRay(room, directionBetween(mechanismApproach, mechanismCell), mechanismApproach)
    .includes(mechanismCell), "fixed mechanism obstacles must truncate the gaze line");

  makeCurrent(room, victim, HuntEngine.PHASES.adventurerEnd);
  room.game.endState = { kind: "mechanism", operatorPlayerId: first.id };
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "finishAdventurerTurn"), null);
  assert.strictEqual(victim.gazeTracked, false);
  const other = pieceFor(room, second);
  room.game.turnSerial += 1;
  room.game.activeAdventurerTurnId = room.game.turnSerial;
  makeCurrent(room, other, HuntEngine.PHASES.adventurerEnd);
  room.game.endState = { kind: "mechanism", operatorPlayerId: second.id };
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "finishAdventurerTurn"), null);
  assert.strictEqual(room.game.hunt.gaze, null, "the gaze line must expire at the start of the Gazer's next normal turn");
}

{
  const { room, first, mummy } = setup({ professions: ["doctor", "archaeologist"], mummyType: "gazer" });
  room.game.mummy.position = "dungeon";
  room.game.mummy.moveKind = "normal";
  room.game.activeMonsterTurnId = 2501;
  room.phase = HuntEngine.PHASES.monsterAction;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerPrepare);
  assert.strictEqual(room.game.currentPieceId, pieceFor(room, first).id);
  assert.strictEqual(room.game.monsterEndState, null);
}

{
  const { room, first, mummy } = setup({ professions: ["doctor", "archaeologist"], mummyType: "corrupt" });
  assert.strictEqual(room.game.hunt.purification.pools.length, 2);
  assert.strictEqual(room.game.hunt.purification.fallback, false);
  room.game.activeMonsterTurnId = 3001;
  room.phase = HuntEngine.PHASES.monsterPrepare;
  const openingTreasure = room.game.hands[first.id][0];
  const openingView = HuntEngine.makeGameView(room, mummy);
  assert.deepStrictEqual(openingView.legal.actions, ["rollMummyDie"]);
  assert(!openingView.legal.actions.includes("infectTreasure"));
  assert.strictEqual(openingView.legal.infectionTreasures, undefined);
  assert(openingView.actionInfo.some((message) => message.includes("團隊尚未完成第一個寶藏")));
  assert(HuntEngine.makeGameView(room, first).actionInfo.some((message) => message.includes("腐化鬼只能擲骰")));
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "infectTreasure", {
    treasureId: openingTreasure.id
  }), "團隊完成第一個寶藏後才能感染寶藏。");
  assert.deepStrictEqual(room.game.hunt.infections, {});

  room.game.revealedTasks.push({
    id: openingTreasure.id,
    completedByPieceId: pieceFor(room, first).id,
    position: treasurePositionForTest(room, openingTreasure.id)
  });
  const mandatoryInfectionView = HuntEngine.makeGameView(room, mummy);
  assert.deepStrictEqual(mandatoryInfectionView.legal.actions, ["infectTreasure"]);
  assert.strictEqual(mandatoryInfectionView.hunt.infectionRequired, true);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), "必須先感染一個寶藏，才能擲提燈怪骰。");
  const infectionTarget = mandatoryInfectionView.legal.infectionTreasures[0];
  assert(infectionTarget);

  const cappedRoom = JSON.parse(JSON.stringify(room));
  const cappedTargetIds = mandatoryInfectionView.legal.infectionTreasures.map((target) => target.id);
  cappedRoom.game.hunt.infections = Object.fromEntries(
    cappedTargetIds.slice(0, Math.floor(cappedTargetIds.length / 2))
      .map((id) => [id, { remaining: 5, createdTurnId: null }])
  );
  const cappedMummyView = HuntEngine.makeGameView(cappedRoom, mummy);
  assert.deepStrictEqual(cappedMummyView.legal.actions, ["rollMummyDie"]);
  assert.strictEqual(cappedMummyView.hunt.infectionRequired, false);
  assert(cappedMummyView.actionInfo.some((message) => message.includes("感染數已達目前上限")));
  assert(HuntEngine.makeGameView(cappedRoom, first).actionInfo.some((message) => message.includes("感染數已達目前上限")));

  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "infectTreasure", {
    treasureId: infectionTarget.id
  }), null);
  assert.strictEqual(room.game.hunt.infections[infectionTarget.id].remaining, 5);
  assert.strictEqual(room.game.mummy.abilityCooldown, 3);
  const afterInfectionView = HuntEngine.makeGameView(room, mummy);
  assert(afterInfectionView.legal.actions.includes("rollMummyDie"));
  assert(!afterInfectionView.legal.actions.includes("infectTreasure"));
  const reconnectedCorruptRoom = JSON.parse(JSON.stringify(room));
  assert.deepStrictEqual(
    HuntEngine.makeGameView(reconnectedCorruptRoom, mummy).hunt.infectedTreasures,
    HuntEngine.makeGameView(room, mummy).hunt.infectedTreasures
  );
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(room.game.hunt.infections[infectionTarget.id].remaining, 5);
  assert.strictEqual(room.game.mummy.abilityCooldown, 3);

  for (let turn = 1; turn <= 5; turn += 1) {
    room.game.activeMonsterTurnId = 3001 + turn;
    room.game.mummy.abilityUsedThisTurn = false;
    room.phase = HuntEngine.PHASES.monsterPrepare;
    assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
    assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  }
  assert(Object.keys(room.game.hunt.infections).length >= 2, "an expired infection must spread without removing its source");

  const piece = pieceFor(room, first);
  const task = room.game.hands[first.id][1];
  room.game.hunt.infections[task.id] = { remaining: 4, createdTurnId: null };
  piece.position = treasurePositionForTest(room, task.id);
  room.game.turnSerial += 1;
  room.game.activeAdventurerTurnId = room.game.turnSerial;
  makeTreasureEnd(room, piece, task.id);
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "revealTreasure"), null);
  assert.strictEqual(piece.corruptionTurns, 3);
  assert.strictEqual(room.game.hunt.infections[task.id], undefined);
  assert.strictEqual(room.game.mummy.abilityCooldown, 3);
  assert.strictEqual(HuntEngine.makeGameView(room, mummy).pieces.find((candidate) => candidate.id === piece.id).corrupted, true);

  const pool = room.game.hunt.purification.pools[0];
  const next = room.game.graph.passages[pool][0];
  piece.position = pool;
  piece.corruptionTurns = 3;
  piece.corruptionCreatedTurnId = null;
  room.game.mummy.position = "dungeon";
  room.game.turnSerial += 1;
  room.game.activeAdventurerTurnId = room.game.turnSerial;
  makeCurrent(room, piece, HuntEngine.PHASES.adventurerAction);
  room.game.selectedFace = "1";
  room.game.actionState = { kind: "numeric", movementBudget: 1 };
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "moveNumeric", { path: [next] }), null);
  assert.strictEqual(piece.corruptionTurns, 0, "starting a real movement on a pool must purify before the first step");

  const routeThroughPool = room.game.hunt.purification.pools
    .flatMap((candidatePool) => {
      const neighbors = room.game.graph.passages[candidatePool] || [];
      return neighbors.flatMap((before) => neighbors
        .filter((after) => after !== before)
        .map((after) => ({ pool: candidatePool, before, after })));
    })[0];
  assert(routeThroughPool);
  piece.position = routeThroughPool.before;
  piece.corruptionTurns = 3;
  piece.guard = true;
  piece.guardTurns = 2;
  piece.injuredTurns = 1;
  piece.injuryActive = true;
  piece.injuryCreatedTurnId = null;
  piece.bleeding = true;
  piece.knifeTracked = true;
  piece.gazeStacks = 2;
  piece.gazeTracked = true;
  room.game.turnSerial += 1;
  room.game.activeAdventurerTurnId = room.game.turnSerial;
  makeCurrent(room, piece, HuntEngine.PHASES.adventurerAction);
  room.game.selectedFace = "2";
  room.game.actionState = { kind: "numeric", movementBudget: 2 };
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "moveNumeric", {
    path: [routeThroughPool.pool, routeThroughPool.after]
  }), null);
  assert.strictEqual(piece.corruptionTurns, 0);
  assert.strictEqual(piece.guard, false);
  assert.strictEqual(piece.guardTurns, 0);
  assert.strictEqual(piece.injuredTurns, 0);
  assert.strictEqual(piece.injuryActive, false);
  assert.strictEqual(piece.bleeding, false);
  assert.strictEqual(piece.knifeTracked, false);
  assert.strictEqual(piece.gazeStacks, 0);
  assert.strictEqual(piece.gazeTracked, false);
  assert.strictEqual(piece.position, routeThroughPool.after, "purification must not stop the remaining movement");

  piece.position = routeThroughPool.before;
  piece.corruptionTurns = 3;
  room.game.mummy.type = "trap";
  room.game.hunt.traps = [routeThroughPool.pool];
  room.game.turnSerial += 1;
  room.game.activeAdventurerTurnId = room.game.turnSerial;
  makeCurrent(room, piece, HuntEngine.PHASES.adventurerAction);
  room.game.selectedFace = "1";
  room.game.actionState = { kind: "numeric", movementBudget: 1 };
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "moveNumeric", {
    path: [routeThroughPool.pool]
  }), null);
  assert.strictEqual(piece.corruptionTurns, 0, "entering a pool must purify before a trap on that cell stops movement");
  assert.strictEqual(piece.injuredTurns, 1);
  const prePoolStart = room.game.graph.passages[routeThroughPool.before]
    .find((cell) => cell !== routeThroughPool.pool);
  assert(prePoolStart);
  piece.position = prePoolStart;
  piece.corruptionTurns = 3;
  piece.injuredTurns = 0;
  room.game.hunt.traps = [routeThroughPool.before];
  room.game.turnSerial += 1;
  room.game.activeAdventurerTurnId = room.game.turnSerial;
  makeCurrent(room, piece, HuntEngine.PHASES.adventurerAction);
  room.game.selectedFace = "2";
  room.game.actionState = { kind: "numeric", movementBudget: 2 };
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "moveNumeric", {
    path: [routeThroughPool.before, routeThroughPool.pool]
  }), null);
  assert.strictEqual(piece.corruptionTurns, 2, "a trap before the pool must stop movement before purification, then the turn countdown proceeds normally");
  room.game.mummy.type = "corrupt";

  piece.corruptionTurns = 1;
  piece.corruptionCreatedTurnId = null;
  piece.guard = true;
  piece.guardTurns = 2;
  room.game.turnSerial += 1;
  room.game.activeAdventurerTurnId = room.game.turnSerial;
  makeCurrent(room, piece, HuntEngine.PHASES.adventurerEnd);
  room.game.endState = { kind: "mechanism", operatorPlayerId: first.id };
  const life = piece.life;
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "finishAdventurerTurn"), null);
  assert.strictEqual(piece.corruptionTurns, 3, "guard must prevent life loss without ending the corruption cycle");
  assert.strictEqual(piece.guard, false);
  assert.strictEqual(piece.guardTurns, 0);
  assert.strictEqual(piece.life, life);

  piece.corruptionTurns = 1;
  piece.corruptionCreatedTurnId = null;
  room.game.turnSerial += 1;
  room.game.activeAdventurerTurnId = room.game.turnSerial;
  makeCurrent(room, piece, HuntEngine.PHASES.adventurerEnd);
  room.game.endState = { kind: "mechanism", operatorPlayerId: first.id };
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "finishAdventurerTurn"), null);
  assert.strictEqual(piece.life, life - 1);
  assert.strictEqual(piece.corruptionTurns, 3, "surviving an unguarded corruption trigger must restart the countdown");

  piece.life = 1;
  piece.corruptionTurns = 1;
  piece.corruptionCreatedTurnId = null;
  room.game.turnSerial += 1;
  room.game.activeAdventurerTurnId = room.game.turnSerial;
  makeCurrent(room, piece, HuntEngine.PHASES.adventurerEnd);
  room.game.endState = { kind: "mechanism", operatorPlayerId: first.id };
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "finishAdventurerTurn"), null);
  assert.strictEqual(piece.eliminated, true);
  assert.strictEqual(piece.corruptionTurns, 0, "corruption must not restart after the adventurer dies");
}

console.log("Gangsi Hunt engine tests passed");
