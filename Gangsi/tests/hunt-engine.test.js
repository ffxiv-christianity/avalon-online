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
    adventurer_prepare: ["rollAdventurerDice", "unlockDice", "useWizardUnlock", "useKnightGuard", "activateMechanism"],
    adventurer_roll: ["rollAdventurerDice", "selectDie"],
    adventurer_action: ["moveNumeric", "moveArrow"],
    adventurer_end: ["revealTreasure", "declineTreasure", "finishAdventurerTurn"],
    monster_prepare: ["rollMummyDie", "placeTrap", "recoverTrap", "hideMummy", "revealMummy", "throwKnife"],
    monster_roll: [],
    monster_action: ["moveMummy", "stopMummy"],
    monster_end: [],
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
  assert(mummyView.pieces.every((piece) => !Object.hasOwn(piece, "guard") && !Object.hasOwn(piece, "injured")));
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
  assert.strictEqual(room.game.dice[0].locked, false);
  assert.strictEqual(wizard.wizardCharges, 2);
  assert.strictEqual(wizard.wizardUsedThisTurn, true);
  assert(!HuntEngine.makeGameView(room, second).legal.actions.includes("useWizardUnlock"));
  assert(HuntEngine.applyGameAction(room, second, "useWizardUnlock").includes("每回合只能使用一次"));
  assert.strictEqual(room.game.dice[1].locked, true);
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
  assert(HuntEngine.applyGameAction(room, second, "useWizardUnlock").includes("五顆骰子全部鎖定"));
  assert.strictEqual(wizard.wizardCharges, 2);
}

{
  const { room, first, mummy } = setup({ professions: ["wizard", "doctor"], mummyType: "knife" });
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
  assert.strictEqual(room.game.currentPieceId, pieceFor(room, second).id);
  assert.strictEqual(room.phase, HuntEngine.PHASES.monsterInterruptAction, "an all-locked turn must switch players without a skip confirmation");
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
  const { room, mummy } = setup({ mummyType: "invisible" });
  room.phase = HuntEngine.PHASES.monsterPrepare;
  const view = HuntEngine.makeGameView(room, mummy);
  assert(view.legal.actions.includes("rollMummyDie"));
  assert(view.legal.actions.includes("hideMummy"));
  assert(!view.legal.actions.includes("continueMummyTurn"));
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
  assert.strictEqual(room.phase, HuntEngine.PHASES.monsterAction);
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
  const { room, first, second, mummy } = setup({ professions: ["doctor", "engineer"], mummyType: "trap" });
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
  for (const [profession, bonus] of [["doctor", 0], ["engineer", 1]]) {
    const { room, first } = setup({ professions: [profession, profession === "doctor" ? "engineer" : "doctor"] });
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
  const { room, first, second, mummy } = setup({ professions: ["knight", "engineer"], mummyType: "trap" });
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
  room.game.map.walls = originalWalls;
  room.game.graph = MapFormat.buildMovementGraph(room.game.map, { hunt: true });
  assert.strictEqual(target.guard, true);
  assert.strictEqual(knight.abilityCooldown, 5);
  const guardInfo = HuntEngine.makeGameView(room, mummy).actionInfo.find((message) => message.includes("騎士使用了守護"));
  assert(guardInfo);
  assert(!guardInfo.includes(first.name));
  assert(!guardInfo.includes(second.name));
  assert(!HuntEngine.makeGameView(room, mummy).pieces.some((piece) => piece.guard !== undefined));

  room.game.mummy.position = "6,5";
  room.game.mummy.remaining = 1;
  room.game.mummy.moveKind = "normal";
  room.phase = HuntEngine.PHASES.monsterAction;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "moveMummy", { cell: "6,4" }), null);
  assert.strictEqual(target.life, 3);
  assert.strictEqual(target.position, "dungeon");
  assert.strictEqual(target.guard, false);

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
  assert.strictEqual(HuntEngine.makeGameView(room, mummy).pieces.find((piece) => piece.id === knight.id).injured, undefined);
}

{
  const { room, first, mummy } = setup({ professions: ["knight", "engineer"], mummyType: "invisible" });
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
  const { room, first, mummy } = setup({ professions: ["knight", "engineer"], mummyType: "invisible" });
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
  const { room, first, mummy } = setup({ professions: ["knight", "engineer"], mummyType: "knife" });
  const human = pieceFor(room, first);
  human.position = "6,4";
  room.game.mummy.position = "6,5";
  room.phase = HuntEngine.PHASES.monsterPrepare;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "throwKnife", { direction: "up" }), null);
  assert.strictEqual(human.injuredTurns, 1);
  assert.strictEqual(room.game.mummy.abilityTriggers, 1);
  assert.strictEqual(room.game.mummy.abilityCooldown, 2);
  assert.strictEqual(HuntEngine.makeGameView(room, first).mummy.abilityCooldown, undefined);
  assert.strictEqual(HuntEngine.makeGameView(room, mummy).mummy.abilityCooldown, 2);
  assert.strictEqual(HuntEngine.makeGameView(room, mummy).mummy.abilityTriggers, undefined);
  assert.strictEqual(room.phase, HuntEngine.PHASES.adventurerPrepare);
  assert.strictEqual(room.game.currentPieceId, pieceFor(room, first).id);
  assert(!HuntEngine.makeGameView(room, mummy).legal.actions.includes("rollMummyDie"));
  const info = HuntEngine.makeGameView(room, mummy).actionInfo.find((message) => message.includes("(6,4)"));
  assert(info.includes("(6,4)"));
  assert(!info.includes(first.name));

  human.injuredTurns = 0;
  human.guard = true;
  room.game.mummy.abilityCooldown = 0;
  room.phase = HuntEngine.PHASES.monsterPrepare;
  room.game.mummy.abilityUsedThisTurn = false;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "throwKnife", { direction: "up" }), null);
  assert.strictEqual(room.game.mummy.abilityTriggers, 2, "a guarded knife hit must still count");
  assert.strictEqual(human.guard, false);
  assert.strictEqual(human.injuredTurns, 0);

  room.game.mummy.position = "1,1";
  room.game.mummy.abilityCooldown = 0;
  room.phase = HuntEngine.PHASES.monsterPrepare;
  room.game.mummy.abilityUsedThisTurn = false;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "throwKnife", { direction: "up" }), null);
  assert.strictEqual(room.game.mummy.abilityTriggers, 2, "a missed knife must not count");
}

{
  const { room, mummy } = setup({ professions: ["knight", "engineer"], mummyType: "trap" });
  room.game.turnSerial += 1;
  room.game.activeMonsterTurnId = room.game.turnSerial;
  room.phase = HuntEngine.PHASES.monsterPrepare;

  room.game.mummy.position = "dungeon";
  let view = HuntEngine.makeGameView(room, mummy);
  assert.deepStrictEqual(view.legal.trapPlacements, [], "traps cannot be placed directly from the dungeon onto a dungeon exit");
  assert(!view.legal.actions.includes("placeTrap"));

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
  const { room, first, mummy } = setup({ professions: ["knight", "engineer"], mummyType: "trap" });
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

  for (const expected of [1, 0]) {
    room.game.turnSerial += 1;
    room.game.activeMonsterTurnId = room.game.turnSerial;
    room.game.mummy.moveKind = "normal";
    room.phase = HuntEngine.PHASES.monsterAction;
    assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
    assert.strictEqual(room.game.mummy.abilityCooldown, expected);
  }
}

{
  const { room, first, mummy } = setup({ professions: ["knight", "engineer"], mummyType: "trap" });
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
  const { room, first, second, mummy } = setup({ professions: ["knight", "engineer"], mummyType: "trap" });
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
  const { room, first, second, mummy } = setup({ professions: ["knight", "engineer"], mummyType: "knife" });
  const knight = pieceFor(room, first);
  const engineer = pieceFor(room, second);
  knight.position = "6,3";
  engineer.position = "6,4";
  makeCurrent(room, knight, HuntEngine.PHASES.adventurerPrepare);
  const createdTurnId = room.game.activeAdventurerTurnId;
  assert.strictEqual(HuntEngine.applyGameAction(room, first, "useKnightGuard", { pieceId: engineer.id }), null);
  assert.strictEqual(knight.abilityCooldown, 5, "the use turn must not decrement knight cooldown");
  assert.strictEqual(knight.cooldownCreatedTurnId, createdTurnId);

  makeCurrent(room, engineer, HuntEngine.PHASES.adventurerEnd);
  room.game.endState = { kind: "mechanism", operatorPlayerId: second.id };
  assert.strictEqual(HuntEngine.applyGameAction(room, second, "finishAdventurerTurn"), null);
  assert.strictEqual(knight.abilityCooldown, 5, "other adventurers must not decrement knight cooldown");

  room.game.turnSerial += 1;
  room.game.activeMonsterTurnId = room.game.turnSerial;
  room.phase = HuntEngine.PHASES.monsterPrepare;
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "rollMummyDie"), null);
  assert.strictEqual(HuntEngine.applyGameAction(room, mummy, "stopMummy"), null);
  assert.strictEqual(knight.abilityCooldown, 5, "monster turns must not decrement knight cooldown");

  for (const expected of [4, 3, 2, 1, 0]) {
    room.game.turnSerial += 1;
    room.game.activeAdventurerTurnId = room.game.turnSerial;
    makeCurrent(room, knight, HuntEngine.PHASES.adventurerEnd);
    room.game.endState = { kind: "mechanism", operatorPlayerId: first.id };
    assert.strictEqual(HuntEngine.applyGameAction(room, first, "finishAdventurerTurn"), null);
    assert.strictEqual(knight.abilityCooldown, expected);
  }
  assert.strictEqual(knight.cooldownCreatedTurnId, null);
}

console.log("Gangsi Hunt engine tests passed");
