"use strict";

const { randomIntInclusive, shuffle } = require("../Shared/server/random");
const MapCatalog = require("./map-catalog");
const MapFormat = require("./map-format");

const PHASES = Object.freeze({
  adventurerPrepare: "adventurer_prepare",
  adventurerRoll: "adventurer_roll",
  adventurerAction: "adventurer_action",
  adventurerEnd: "adventurer_end",
  monsterPrepare: "monster_prepare",
  monsterRoll: "monster_roll",
  monsterAction: "monster_action",
  monsterEnd: "monster_end",
  monsterInterruptPrepare: "monster_interrupt_prepare",
  monsterInterruptAction: "monster_interrupt_action",
  monsterInterruptEnd: "monster_interrupt_end",
  gameOver: "game_over"
});

const PHASE_ACTIONS = Object.freeze({
  [PHASES.adventurerPrepare]: Object.freeze([
    "rollAdventurerDice", "unlockDice", "useWizardUnlock", "useKnightGuard", "activateMechanism"
  ]),
  [PHASES.adventurerRoll]: Object.freeze(["rollAdventurerDice", "selectDie"]),
  [PHASES.adventurerAction]: Object.freeze(["moveNumeric", "moveArrow"]),
  [PHASES.adventurerEnd]: Object.freeze(["revealTreasure", "declineTreasure", "finishAdventurerTurn"]),
  [PHASES.monsterPrepare]: Object.freeze([
    "rollMummyDie", "placeTrap", "recoverTrap", "hideMummy", "revealMummy", "throwKnife"
  ]),
  [PHASES.monsterRoll]: Object.freeze([]),
  [PHASES.monsterAction]: Object.freeze(["moveMummy", "stopMummy"]),
  [PHASES.monsterEnd]: Object.freeze([]),
  [PHASES.monsterInterruptPrepare]: Object.freeze([]),
  [PHASES.monsterInterruptAction]: Object.freeze(["moveMummy", "stopMummy"]),
  [PHASES.monsterInterruptEnd]: Object.freeze([]),
  [PHASES.gameOver]: Object.freeze([])
});

const ADVENTURER_FACES = Object.freeze(["1", "2", "3", "4", "arrow", "mummy"]);
const MECHANISM_FACES = Object.freeze(["X", 0, 1, 1, 1, 2]);
const MUMMY_FACES = Object.freeze([1, 1, 2, 2, 3, 3]);
const DIRECTIONS = Object.freeze({
  up: Object.freeze([0, -1]),
  right: Object.freeze([1, 0]),
  down: Object.freeze([0, 1]),
  left: Object.freeze([-1, 0])
});
const TRACKING_INTERVAL = 3;

function setupGame(room) {
  const map = MapCatalog.getBuiltInMap(room.settings.mapId);
  if (!map || !MapFormat.validateHuntMap(map).valid) throw new Error("Cannot start Hunt mode without a compatible map");
  const adventurers = room.players.filter((player) => player.role === "adventurer");
  const mummyPlayer = room.players.find((player) => player.role === "mummy");
  if (!mummyPlayer || adventurers.length < 2) throw new Error("Hunt mode roles are incomplete");

  const pieces = {};
  const adventurerOrder = [];
  for (const player of adventurers) {
    const id = `${player.id}:adventurer:1`;
    pieces[id] = {
      id,
      controllerId: player.id,
      tokenLabel: player.tokenLabel,
      ordinal: 1,
      profession: player.profession,
      position: "entrance",
      life: player.profession === "doctor" ? 4 : 3,
      maxLife: player.profession === "doctor" ? 4 : 3,
      eliminated: false,
      escaped: false,
      outcome: null,
      guard: false,
      injuredTurns: 0,
      injuryActive: false,
      injuryCreatedTurnId: null,
      abilityCooldown: 0,
      cooldownCreatedTurnId: null,
      wizardCharges: player.profession === "wizard" ? 3 : 0,
      wizardUsedThisTurn: false,
      mechanismContribution: 0
    };
    adventurerOrder.push(id);
  }

  room.game = {
    mode: "hunt",
    mapId: map.id,
    map,
    graph: MapFormat.buildMovementGraph(map, { hunt: true }),
    round: 1,
    turnIndex: 0,
    currentPieceId: null,
    adventurerOrder,
    pieces,
    hands: dealHands(map, adventurers),
    dice: Array.from({ length: 5 }, (_, index) => ({ id: `die-${index + 1}`, locked: false, face: null })),
    disabledDieId: null,
    selectedDieId: null,
    selectedFace: null,
    actionState: null,
    forcedSkipReason: null,
    pendingTreasureIds: [],
    endState: null,
    pendingUnlock: null,
    resumeState: null,
    lastPublicDie: null,
    turnSerial: 0,
    activeAdventurerTurnId: null,
    activeMonsterTurnId: null,
    mummy: {
      playerId: mummyPlayer.id,
      type: mummyPlayer.mummyType,
      position: "dungeon",
      score: 0,
      roll: null,
      remaining: 0,
      moveKind: null,
      abilityCooldown: 0,
      cooldownCreatedTurnId: null,
      abilityUsedThisTurn: false,
      invisible: false,
      abilityTriggers: 0
    },
    hunt: {
      treasureGoal: adventurers.length * 2 + 1,
      mechanisms: { A: 0, B: 0 },
      mechanismSeals: { A: null, B: null },
      exits: { A: "closed", B: "closed" },
      traps: [],
      hatch: { status: "unavailable", position: null },
      tracking: { enabled: false, countdown: null, revealThisTurn: false }
    },
    revealedTasks: [],
    captureSerial: 0,
    captureEvent: null,
    events: [],
    winner: null
  };

  addLog(room, `獵殺模式開始；全隊需要揭露 ${room.game.hunt.treasureGoal} 張寶藏。`);
  beginAdventurerAtIndex(room, 0);
}

function dealHands(map, adventurers) {
  const hands = Object.fromEntries(adventurers.map((player) => [player.id, []]));
  for (const group of Object.keys(MapFormat.GROUPS)) {
    const pool = shuffle(map.treasures.filter((treasure) => treasure.id.startsWith(group)).map((treasure) => treasure.id));
    for (const player of adventurers) {
      const id = pool.pop();
      if (!id) throw new Error(`Not enough ${group} treasures for Hunt mode`);
      hands[player.id].push({ id, revealed: false, completedByPieceId: null });
    }
  }
  return hands;
}

function applyGameAction(room, actor, action, payload = {}) {
  if (!room.game || room.phase === "lobby") return "遊戲尚未開始。";
  if (room.phase === PHASES.gameOver) return "遊戲已經結束。";
  if (!PHASE_ACTIONS[room.phase]?.includes(action)) return `操作 ${action} 不能在 ${room.phase} 階段執行。`;
  switch (action) {
    case "unlockDice": return unlockDice(room, actor);
    case "useWizardUnlock": return useWizardUnlock(room, actor);
    case "useKnightGuard": return useKnightGuard(room, actor, payload.pieceId);
    case "activateMechanism": return activateMechanism(room, actor, payload.gateId);
    case "finishAdventurerTurn": return finishAdventurerTurn(room, actor);
    case "rollAdventurerDice": return rollAdventurerDice(room, actor);
    case "selectDie": return selectDie(room, actor, payload.dieId);
    case "moveNumeric": return moveNumeric(room, actor, payload.path);
    case "moveArrow": return moveArrow(room, actor, payload.direction);
    case "revealTreasure": return revealTreasure(room, actor);
    case "declineTreasure": return declineTreasure(room, actor);
    case "placeTrap": return placeTrap(room, actor, payload.cell);
    case "recoverTrap": return recoverTrap(room, actor, payload.cell);
    case "hideMummy": return hideMummy(room, actor);
    case "revealMummy": return revealMummy(room, actor);
    case "throwKnife": return throwKnife(room, actor, payload.direction);
    case "rollMummyDie": return rollMummyDie(room, actor);
    case "moveMummy": return moveMummy(room, actor, payload.cell);
    case "stopMummy": return stopMummy(room, actor);
    default: return "未知的遊戲操作。";
  }
}

function continueAdventurerTurn(room, actor) {
  if (room.phase !== PHASES.adventurerPrepare) return "現在不能進入擲骰階段。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  if (!usableDice(room).length) return "目前沒有可用的骰子，請先解鎖。";
  room.phase = PHASES.adventurerRoll;
  return null;
}

function unlockDice(room, actor) {
  if (room.phase !== PHASES.adventurerPrepare) return "現在不能解鎖骰子。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  const count = lockedDiceCount(room);
  if (!count) return "目前沒有鎖定骰。";
  beginInterlude(room, room.game.currentPieceId, count, false);
  return null;
}

function useWizardUnlock(room, actor) {
  if (room.phase !== PHASES.adventurerPrepare) return "現在不能使用解鎖術。";
  const piece = currentPiece(room);
  if (!isCurrentAdventurer(room, actor) || piece?.profession !== "wizard") return "你不能使用解鎖術。";
  if (piece.wizardCharges <= 0) return "解鎖術已經用完。";
  if (piece.wizardUsedThisTurn) return "解鎖術每回合只能使用一次。";
  const locked = lockedDiceCount(room);
  if (locked === room.game.dice.length) return "五顆骰子全部鎖定時不能使用解鎖術。";
  if (locked < 2) return "至少鎖定 2 顆怪物骰才能使用解鎖術。";
  const die = room.game.dice.find((candidate) => candidate.locked);
  if (!die) return "目前沒有鎖定骰。";
  die.locked = false;
  die.face = null;
  piece.wizardCharges -= 1;
  piece.wizardUsedThisTurn = true;
  addLog(room, `${pieceName(room, piece)} 使用解鎖術解鎖 1 顆骰子。`);
  return null;
}

function useKnightGuard(room, actor, targetPieceId) {
  if (room.phase !== PHASES.adventurerPrepare) return "現在不能使用守護。";
  const piece = currentPiece(room);
  if (!isCurrentAdventurer(room, actor) || piece?.profession !== "knight") return "你不能使用守護。";
  if (piece.abilityCooldown > 0) return "守護仍在冷卻。";
  const target = room.game.pieces[targetPieceId];
  if (!knightTargets(room, piece).some((candidate) => candidate.id === target?.id)) return "這名冒險者不能成為守護目標。";
  target.guard = true;
  piece.abilityCooldown = 5;
  piece.cooldownCreatedTurnId = room.game.activeAdventurerTurnId;
  addRedactedLog(room, "騎士使用了守護。", {
    adventurer: `${pieceName(room, piece)} 守護了 ${pieceName(room, target)}。`
  });
  finishAdventurerFullTurnAction(room);
  return null;
}

function activateMechanism(room, actor, gateId) {
  if (room.phase !== PHASES.adventurerPrepare) return "現在不能操作機關。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  const piece = currentPiece(room);
  const id = String(gateId || "").toUpperCase();
  if (!mechanismIdsForPiece(room, piece).includes(id)) return "目前不能操作這座機關。";
  const face = MECHANISM_FACES[randomIntInclusive(0, MECHANISM_FACES.length - 1)];
  resolveMechanismFace(room, id, face);
  return null;
}

function resolveMechanismFace(room, gateId, rawFace) {
  const piece = currentPiece(room);
  const id = String(gateId || "").toUpperCase();
  const face = rawFace === "X" ? "X" : Number(rawFace);
  if (!piece || !MapFormat.HUNT_MECHANISM_IDS.includes(id)) throw new Error("Invalid Hunt mechanism");
  if (face !== "X" && ![0, 1, 2].includes(face)) throw new Error(`Invalid mechanism die face: ${rawFace}`);
  const previousProgress = room.game.hunt.mechanisms[id];
  const baseProgress = face === "X" ? 1 : face;
  const classBonus = piece.profession === "engineer" ? 1 : 0;
  const calculatedProgress = baseProgress + classBonus;
  const finalProgress = Math.min(3, previousProgress + calculatedProgress);
  const appliedProgress = finalProgress - previousProgress;
  const sealed = face === "X" && finalProgress < 3;
  room.game.hunt.mechanisms[id] = finalProgress;
  piece.mechanismContribution = (piece.mechanismContribution || 0) + appliedProgress;
  room.game.hunt.mechanismSeals[id] = sealed ? { remaining: 1, startedThisTurn: true } : null;
  const result = {
    kind: "mechanism",
    operatorPlayerId: piece.controllerId,
    mechanismId: id,
    diceFace: face,
    baseProgress,
    classBonus,
    calculatedProgress,
    appliedProgress,
    finalProgress,
    sealed
  };
  room.game.endState = result;
  room.phase = PHASES.adventurerEnd;
  const detail = `擲出 ${face}：骰面進度 +${baseProgress}，工程師加成 +${classBonus}，理論增加 +${calculatedProgress}，實際增加 +${appliedProgress}，最終進度 ${finalProgress} / 3${sealed ? "；機關封印 1 個冒險者回合" : ""}。`;
  addRedactedLog(room, `機關 ${id} ${detail}`, {
    adventurer: `${pieceName(room, piece)} 操作機關 ${id}，${detail}`
  });
  if (finalProgress >= 3 && room.game.hunt.exits[id] !== "open") openExit(room, id);
  return result;
}

function finishAdventurerTurn(room, actor) {
  if (room.phase !== PHASES.adventurerEnd || room.game.endState?.kind !== "mechanism") return "現在不能結束冒險者回合。";
  if (!isCurrentAdventurer(room, actor) || room.game.endState.operatorPlayerId !== actor.id) return "現在不是你的回合。";
  advanceAfterAdventurer(room);
  return null;
}

function rollAdventurerDice(room, actor) {
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  if (room.phase === PHASES.adventurerPrepare) {
    const error = continueAdventurerTurn(room, actor);
    if (error) return error;
  }
  if (room.phase !== PHASES.adventurerRoll) return "現在不能擲冒險者骰。";
  const dice = usableDice(room);
  if (!dice.length) return "目前沒有可擲的骰子。";
  resolveAdventurerFaces(room, dice.map(() => ADVENTURER_FACES[randomIntInclusive(0, ADVENTURER_FACES.length - 1)]));
  return null;
}

function resolveAdventurerFaces(room, faces) {
  const dice = usableDice(room);
  if (!Array.isArray(faces) || faces.length !== dice.length) throw new Error("Hunt dice face count mismatch");
  dice.forEach((die, index) => {
    const face = String(faces[index]);
    if (!ADVENTURER_FACES.includes(face)) throw new Error(`Invalid Hunt die face: ${face}`);
    die.face = face;
    if (face === "mummy") die.locked = true;
  });
  addLog(room, `${currentPieceName(room)} 擲了冒險者骰。`);
  if (lockedDiceCount(room) === room.game.dice.length) beginForcedAdventurerSkip(room, "all_dice_locked");
}

function selectDie(room, actor, dieId) {
  if (room.phase !== PHASES.adventurerRoll) return "現在不能選擇骰子。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  const die = room.game.dice.find((candidate) => candidate.id === dieId);
  if (!die || die.locked || die.id === room.game.disabledDieId || !die.face) return "找不到可用的骰子。";
  if (!legalDieIds(room).includes(die.id)) return "這顆骰子目前沒有合法移動。";
  room.game.selectedDieId = die.id;
  room.game.selectedFace = die.face;
  room.game.actionState = { kind: die.face === "arrow" ? "arrow" : "numeric" };
  room.game.lastPublicDie = die.face;
  addLog(room, `${currentPieceName(room)} 選用了${die.face === "arrow" ? "箭頭" : die.face}骰。`);
  room.phase = PHASES.adventurerAction;
  return null;
}

function moveNumeric(room, actor, rawPath) {
  if (room.phase !== PHASES.adventurerAction || room.game.actionState?.kind !== "numeric") return "現在不能提交數字路徑。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  const path = Array.isArray(rawPath) ? rawPath.map((cell) => MapFormat.cellKey(cell)) : [];
  const legalPaths = numericPaths(room, currentPiece(room), Number(room.game.selectedFace));
  if (!legalPaths.some((candidate) => samePath(candidate, path))) return "這條移動路徑不合法。";
  resolveAdventurerPath(room, path);
  return null;
}

function moveArrow(room, actor, direction) {
  if (room.phase !== PHASES.adventurerAction || room.game.actionState?.kind !== "arrow") return "現在不能使用箭頭移動。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  const move = arrowMoves(room, currentPiece(room))[direction];
  if (!move) return "這個方向沒有合法的箭頭移動。";
  resolveAdventurerPath(room, move.path);
  return null;
}

function resolveAdventurerPath(room, path) {
  const piece = currentPiece(room);
  const hiddenMummyIndex = room.game.mummy.invisible ? path.indexOf(room.game.mummy.position) : -1;
  const trapIndex = room.game.mummy.type === "trap" ? path.findIndex((cell) => room.game.hunt.traps.includes(cell)) : -1;
  const collisionIndexes = [hiddenMummyIndex, trapIndex].filter((index) => index >= 0);
  const interruption = collisionIndexes.length ? Math.min(...collisionIndexes) : -1;
  if (interruption >= 0) {
    const cell = path[interruption];
    if (interruption > 0) piece.position = path[interruption - 1];
    if (hiddenMummyIndex === interruption) {
      room.game.mummy.invisible = false;
      recordMummyAbilityTrigger(room);
      addLog(room, `冒險者與隱形提燈怪在 (${cell}) 發生碰撞；提燈怪現形，冒險者停在前一格。`);
    } else {
      piece.position = cell;
      removeTrap(room, cell);
      recordMummyAbilityTrigger(room);
      applyInjury(room, piece, `冒險者在 (${cell}) 觸發陷阱`);
    }
    clearSelectedMove(room);
    finishAdventurerWithoutInteraction(room);
    return;
  }
  piece.position = path.at(-1);
  completeAdventurerMove(room);
}

function completeAdventurerMove(room) {
  const piece = currentPiece(room);
  clearSelectedMove(room);
  if (isEscapeTarget(room, piece.position)) {
    escapePiece(room, piece, piece.position === room.game.hunt.hatch.position ? "密道" : "逃生出口");
    return;
  }
  const hand = room.game.hands[piece.controllerId] || [];
  room.game.pendingTreasureIds = hand
    .filter((task) => !task.revealed && treasurePosition(room, task.id) === piece.position)
    .map((task) => task.id);
  if (room.game.pendingTreasureIds.length) {
    room.game.endState = { kind: "treasure", operatorPlayerId: piece.controllerId };
    room.phase = PHASES.adventurerEnd;
    return;
  }
  finishAdventurerWithoutInteraction(room);
}

function revealTreasure(room, actor) {
  if (room.phase !== PHASES.adventurerEnd || room.game.endState?.kind !== "treasure") return "現在沒有可揭露的寶藏。";
  if (!isCurrentAdventurer(room, actor) || room.game.endState.operatorPlayerId !== actor.id) return "現在不是你的回合。";
  const piece = currentPiece(room);
  const id = room.game.pendingTreasureIds[0];
  const task = (room.game.hands[piece.controllerId] || []).find((candidate) => candidate.id === id && !candidate.revealed);
  if (!task || treasurePosition(room, id) !== piece.position) return "這張任務目前不能揭露。";
  task.revealed = true;
  task.completedByPieceId = piece.id;
  room.game.revealedTasks.push({ id, playerId: piece.controllerId, pieceId: piece.id, position: piece.position });
  room.game.pendingTreasureIds = [];
  addRedactedLog(room, `寶藏 ${id} 在 (${piece.position}) 被揭露；全隊進度 ${room.game.revealedTasks.length} / ${room.game.hunt.treasureGoal}。`, {
    adventurer: `${pieceName(room, piece)} 揭露寶藏 ${id}；全隊進度 ${room.game.revealedTasks.length} / ${room.game.hunt.treasureGoal}。`
  });
  if (room.game.revealedTasks.length >= room.game.hunt.treasureGoal) enableTracking(room);
  advanceAfterAdventurer(room);
  return null;
}

function declineTreasure(room, actor) {
  if (room.phase !== PHASES.adventurerEnd || room.game.endState?.kind !== "treasure") return "現在沒有可略過的寶藏。";
  if (!isCurrentAdventurer(room, actor) || room.game.endState.operatorPlayerId !== actor.id) return "現在不是你的回合。";
  room.game.pendingTreasureIds = [];
  advanceAfterAdventurer(room);
  return null;
}

function placeTrap(room, actor, rawCell) {
  if (room.phase !== PHASES.monsterPrepare || !isMummy(room, actor) || room.game.mummy.type !== "trap") return "現在不能放置陷阱。";
  if (room.game.mummy.abilityUsedThisTurn) return "本回合已經操作過陷阱。";
  const cell = MapFormat.cellKey(rawCell);
  if (!trapPlacements(room).includes(cell)) return "這一格不能放置陷阱。";
  room.game.hunt.traps.push(cell);
  room.game.mummy.abilityCooldown = 2;
  room.game.mummy.cooldownCreatedTurnId = room.game.activeMonsterTurnId;
  room.game.mummy.abilityUsedThisTurn = true;
  addSecretMummyLog(room, `你在 (${cell}) 放置了陷阱。`);
  return null;
}

function recoverTrap(room, actor, rawCell) {
  if (room.phase !== PHASES.monsterPrepare || !isMummy(room, actor) || room.game.mummy.type !== "trap") return "現在不能回收陷阱。";
  if (room.game.mummy.abilityUsedThisTurn) return "本回合已經操作過陷阱。";
  const cell = MapFormat.cellKey(rawCell);
  if (!trapRecoveries(room).includes(cell)) return "這一格沒有可回收的陷阱。";
  removeTrap(room, cell);
  room.game.mummy.abilityUsedThisTurn = true;
  addSecretMummyLog(room, `你回收了 (${cell}) 的陷阱。`);
  return null;
}

function hideMummy(room, actor) {
  if (room.phase !== PHASES.monsterPrepare || !isMummy(room, actor) || room.game.mummy.type !== "invisible") return "現在不能隱形。";
  if (room.game.mummy.abilityUsedThisTurn) return "本回合已經使用過特殊能力。";
  if (room.game.mummy.invisible) return "提燈怪已經隱形。";
  room.game.mummy.invisible = true;
  room.game.mummy.abilityUsedThisTurn = true;
  addLog(room, "提燈怪隱去身影。隱形期間不能抓捕冒險者。 ");
  return null;
}

function revealMummy(room, actor) {
  if (room.phase !== PHASES.monsterPrepare || !isMummy(room, actor) || room.game.mummy.type !== "invisible") return "現在不能現形。";
  if (room.game.mummy.abilityUsedThisTurn) return "本回合已經使用過特殊能力。";
  if (!room.game.mummy.invisible) return "提燈怪目前沒有隱形。";
  room.game.mummy.invisible = false;
  room.game.mummy.abilityUsedThisTurn = true;
  addLog(room, `提燈怪在 (${room.game.mummy.position}) 現形並結束回合。`);
  enterMonsterEnd(room);
  return null;
}

function throwKnife(room, actor, direction) {
  if (room.phase !== PHASES.monsterPrepare || !isMummy(room, actor) || room.game.mummy.type !== "knife") return "現在不能投擲飛刀。";
  if (room.game.mummy.abilityUsedThisTurn) return "本回合已經使用過特殊能力。";
  if (room.game.mummy.abilityCooldown > 0) return "飛刀仍在冷卻。";
  if (!Object.hasOwn(DIRECTIONS, direction)) return "請選擇有效的飛刀方向。";
  const ray = knifeRay(room, direction);
  const hit = ray.find((cell) => activePieces(room).some((piece) => piece.position === cell));
  room.game.mummy.abilityCooldown = 2;
  room.game.mummy.cooldownCreatedTurnId = room.game.activeMonsterTurnId;
  room.game.mummy.abilityUsedThisTurn = true;
  if (hit) {
    const piece = activePieces(room).find((candidate) => candidate.position === hit);
    recordMummyAbilityTrigger(room);
    applyInjury(room, piece, `飛刀命中 (${hit})`);
  } else {
    addLog(room, `提燈怪向${directionLabel(direction)}投擲飛刀，沒有命中冒險者。`);
  }
  enterMonsterEnd(room);
  return null;
}

function rollMummyDie(room, actor) {
  if (!isMummy(room, actor)) return "現在不是你的回合。";
  if (room.phase !== PHASES.monsterPrepare) return "現在不能擲提燈怪骰。";
  room.phase = PHASES.monsterRoll;
  resolveMummyRoll(room, MUMMY_FACES[randomIntInclusive(0, MUMMY_FACES.length - 1)]);
  return null;
}

function resolveMummyRoll(room, value) {
  if (![1, 2, 3].includes(Number(value))) throw new Error("Invalid Hunt mummy roll");
  room.game.mummy.roll = Number(value);
  room.game.mummy.remaining = Number(value) + lockedDiceCount(room);
  room.game.mummy.moveKind = "normal";
  room.phase = PHASES.monsterAction;
  addLog(room, `提燈怪擲出 ${value}，最多可移動 ${room.game.mummy.remaining} 步。`);
}

function moveMummy(room, actor, rawCell) {
  if (![PHASES.monsterAction, PHASES.monsterInterruptAction].includes(room.phase)) return "現在不能移動提燈怪。";
  if (!isMummy(room, actor)) return "現在不是你的回合。";
  if (room.game.mummy.remaining <= 0) return "提燈怪已沒有剩餘步數。";
  const cell = MapFormat.cellKey(rawCell);
  if (!mummyMoves(room).includes(cell)) return "提燈怪不能移動到這一格。";

  const captured = activePieces(room).filter((piece) => piece.position === cell);
  if (room.game.mummy.invisible && captured.length) {
    room.game.mummy.invisible = false;
    room.game.mummy.remaining = 0;
    recordMummyAbilityTrigger(room);
    addLog(room, `隱形提燈怪與冒險者在 (${cell}) 發生碰撞；提燈怪在原地現形。`);
    finishMummyMove(room);
    return null;
  }

  room.game.mummy.position = cell;
  room.game.mummy.remaining -= 1;
  if (room.game.mummy.invisible) {
    addRedactedLog(room, "隱形提燈怪移動 1 步。", { mummy: `你移動到 (${cell})。` });
  } else {
    addLog(room, `提燈怪移動到 (${cell})。`);
  }

  if (room.game.mummy.type === "trap" && room.game.hunt.traps.includes(cell)) {
    removeTrap(room, cell);
    room.game.mummy.remaining = 0;
    recordMummyAbilityTrigger(room);
    addLog(room, `提燈怪踩中自己在 (${cell}) 的陷阱，陷阱消耗並立即結束回合。`);
    finishMummyMove(room);
    return null;
  }
  if (room.game.hunt.hatch.status === "open" && room.game.hunt.hatch.position === cell) {
    closeHatch(room);
    finishMummyMove(room);
    return null;
  }
  if (captured.length) {
    room.game.mummy.remaining = 0;
    capturePieces(room, captured);
    if (room.phase !== PHASES.gameOver) finishMummyMove(room);
    return null;
  }
  if (room.game.mummy.remaining === 0) finishMummyMove(room);
  return null;
}

function stopMummy(room, actor) {
  if (![PHASES.monsterAction, PHASES.monsterInterruptAction].includes(room.phase)) return "現在不能停止提燈怪移動。";
  if (!isMummy(room, actor)) return "現在不是你的回合。";
  finishMummyMove(room);
  return null;
}

function capturePieces(room, pieces) {
  room.game.captureSerial += 1;
  const captures = pieces.map((piece) => {
    const guarded = piece.guard;
    if (guarded) piece.guard = false;
    else piece.life -= 1;
    room.game.mummy.score += guarded ? 0 : 1;
    piece.eliminated = piece.life <= 0;
    piece.outcome = piece.eliminated ? "dead" : null;
    piece.position = piece.eliminated ? null : "dungeon";
    addLog(room, guarded
      ? `${pieceName(room, piece)} 被提燈怪抓到；守護抵銷生命損失，但仍被送入地牢。`
      : `${pieceName(room, piece)} 被提燈怪抓到，失去 1 點生命${piece.eliminated ? "並死亡" : "並被送入地牢"}。`);
    return { pieceId: piece.id, playerId: piece.controllerId, life: piece.life, eliminated: piece.eliminated, guarded };
  });
  room.game.captureEvent = {
    serial: room.game.captureSerial,
    ...captures[0],
    position: room.game.mummy.position,
    captures
  };
  evaluateHuntResolution(room);
}

function applyInjury(room, piece, source) {
  if (piece.guard) {
    piece.guard = false;
    addRedactedLog(room, `${source}，但守護抵銷了受傷。`, { adventurer: `${source}，${pieceName(room, piece)} 的守護抵銷了受傷。` });
    return;
  }
  piece.injuredTurns = 1;
  piece.injuryCreatedTurnId = room.phase === PHASES.adventurerAction && currentPiece(room)?.id === piece.id
    ? room.game.activeAdventurerTurnId
    : null;
  addRedactedLog(room, `${source}，一名冒險者下次正常回合會少用 1 顆骰子。`, {
    adventurer: `${source}，${pieceName(room, piece)} 下次正常回合會少用 1 顆骰子。`
  });
}

function finishMummyMove(room) {
  const kind = room.game.mummy.moveKind;
  room.game.mummy.remaining = 0;
  room.game.mummy.roll = null;
  room.game.mummy.moveKind = null;
  if (room.phase === PHASES.gameOver) return;
  if (kind === "interrupt") {
    room.phase = PHASES.monsterInterruptEnd;
    const resumeState = room.game.resumeState;
    const pieceId = resumeState?.pieceId || room.game.pendingUnlock?.pieceId;
    clearAllDice(room);
    room.game.pendingUnlock = null;
    const piece = room.game.pieces[pieceId];
    if (!isActivePiece(piece)) {
      room.game.resumeState = null;
      advanceAfterAdventurer(room);
      return;
    }
    room.game.turnIndex = room.game.adventurerOrder.indexOf(pieceId);
    room.game.currentPieceId = pieceId;
    room.game.resumeState = null;
    if (resumeState?.newTurn) {
      prepareAdventurerTurn(room, piece);
      return;
    }
    room.game.disabledDieId = resumeState?.disabledDieId || null;
    piece.injuryActive = Boolean(room.game.disabledDieId);
    resumeAdventurerPrepare(room, piece);
    return;
  }
  enterMonsterEnd(room);
}

function enterMonsterEnd(room) {
  if (room.phase === PHASES.gameOver) return;
  room.phase = PHASES.monsterEnd;
  finishNormalMummyTurn(room);
}

function finishNormalMummyTurn(room) {
  finishMummyCooldown(room);
  const tracking = room.game.hunt.tracking;
  if (tracking.revealThisTurn) {
    tracking.revealThisTurn = false;
    tracking.countdown = TRACKING_INTERVAL;
  }
  room.game.activeMonsterTurnId = null;
  room.game.round += 1;
  beginAdventurerAtIndex(room, 0);
}

function beginInterlude(room, pieceId, count, automatic) {
  room.game.forcedSkipReason = null;
  room.game.pendingUnlock = { pieceId, count };
  const piece = room.game.pieces[pieceId];
  room.game.resumeState = {
    playerId: piece?.controllerId || null,
    pieceId,
    phase: PHASES.adventurerPrepare,
    disabledDieId: room.game.disabledDieId,
    newTurn: Boolean(automatic)
  };
  room.game.mummy.roll = null;
  room.game.mummy.remaining = count;
  room.game.mummy.moveKind = "interrupt";
  room.phase = PHASES.monsterInterruptPrepare;
  addLog(room, automatic
    ? `${pieceName(room, room.game.pieces[pieceId])} 已無可用骰子，系統自動解鎖 ${count} 顆骰子，並進入提燈怪的插入回合。`
    : `${pieceName(room, room.game.pieces[pieceId])} 解鎖 ${count} 顆骰子，提燈怪取得插入回合。`);
  room.phase = PHASES.monsterInterruptAction;
}

function beginForcedAdventurerSkip(room, reason) {
  room.game.forcedSkipReason = reason;
  addLog(room, reason === "all_dice_locked"
    ? `${currentPieceName(room)} 的五顆骰子全部鎖定，沒有可用骰子，系統自動略過回合。`
    : `${currentPieceName(room)} 沒有任何合法移動或可用能力，系統自動略過回合。`);
  finishAdventurerWithoutInteraction(room);
}

function finishAdventurerFullTurnAction(room) {
  clearSelectedMove(room);
  finishAdventurerWithoutInteraction(room);
}

function finishAdventurerWithoutInteraction(room) {
  if (room.phase === PHASES.gameOver) return;
  room.game.endState = { kind: "auto", operatorPlayerId: currentPiece(room)?.controllerId || null };
  room.phase = PHASES.adventurerEnd;
  advanceAfterAdventurer(room);
}

function advanceAfterAdventurer(room) {
  const piece = currentPiece(room);
  const currentIndex = room.game.adventurerOrder.indexOf(room.game.currentPieceId);
  finishPieceTurn(room, piece);
  finishMechanismSeals(room);
  clearSelectedMove(room);
  room.game.forcedSkipReason = null;
  room.game.pendingTreasureIds = [];
  room.game.endState = null;
  room.game.activeAdventurerTurnId = null;
  if (room.phase === PHASES.gameOver) return;
  beginAdventurerAtIndex(room, currentIndex >= 0 ? currentIndex + 1 : room.game.turnIndex + 1);
}

function finishMechanismSeals(room) {
  for (const id of MapFormat.HUNT_MECHANISM_IDS) {
    const seal = room.game.hunt.mechanismSeals[id];
    if (!seal) continue;
    if (seal.startedThisTurn) {
      seal.startedThisTurn = false;
      continue;
    }
    seal.remaining = Math.max(0, seal.remaining - 1);
    if (seal.remaining === 0) room.game.hunt.mechanismSeals[id] = null;
  }
}

function beginAdventurerAtIndex(room, startIndex) {
  const order = room.game.adventurerOrder;
  for (let index = startIndex; index < order.length; index += 1) {
    const piece = room.game.pieces[order[index]];
    if (!isActivePiece(piece)) continue;
    room.game.turnIndex = index;
    room.game.currentPieceId = piece.id;
    if (lockedDiceCount(room) === room.game.dice.length) {
      beginInterlude(room, piece.id, room.game.dice.length, true);
      return;
    }
    prepareAdventurerTurn(room, piece);
    return;
  }
  room.game.currentPieceId = null;
  room.game.turnIndex = order.length;
  beginMummyNormalTurn(room);
}

function prepareAdventurerTurn(room, piece) {
  room.game.turnSerial += 1;
  room.game.activeAdventurerTurnId = room.game.turnSerial;
  piece.wizardUsedThisTurn = false;
  room.game.disabledDieId = piece.injuredTurns > 0
    ? room.game.dice.find((die) => !die.locked)?.id || null
    : null;
  piece.injuryActive = Boolean(room.game.disabledDieId);
  if (!hasAnyAdventurerMove(room, piece) && !hasFullTurnAbility(room, piece)) {
    beginForcedAdventurerSkip(room, "no_legal_move");
    return;
  }
  room.game.forcedSkipReason = null;
  room.phase = PHASES.adventurerPrepare;
  addLog(room, `輪到 ${pieceName(room, piece)}。`);
}

function resumeAdventurerPrepare(room, piece) {
  if (!hasAnyAdventurerMove(room, piece) && !hasFullTurnAbility(room, piece)) {
    beginForcedAdventurerSkip(room, "no_legal_move");
    return;
  }
  room.game.forcedSkipReason = null;
  room.phase = PHASES.adventurerPrepare;
}

function beginMummyNormalTurn(room) {
  room.game.turnSerial += 1;
  room.game.activeMonsterTurnId = room.game.turnSerial;
  room.game.disabledDieId = null;
  room.game.mummy.roll = null;
  room.game.mummy.remaining = 0;
  room.game.mummy.moveKind = null;
  room.game.mummy.abilityUsedThisTurn = false;
  const tracking = room.game.hunt.tracking;
  if (tracking.enabled && Number.isInteger(tracking.countdown)) {
    tracking.countdown -= 1;
    if (tracking.countdown <= 0) {
      tracking.revealThisTurn = true;
      addLog(room, "冒險者的位置已暴露；提燈怪在本次正常回合可看見精確位置。 ");
    }
  }
  room.phase = PHASES.monsterPrepare;
  addLog(room, "輪到提燈怪的正常回合。 ");
}

function numericPaths(room, piece, distance) {
  if (!isActivePiece(piece) || !Number.isInteger(distance) || distance < 1 || distance > 4) return [];
  const results = [];
  const otherPositions = occupiedAdventurerCells(room, piece.id);
  const visit = (position, path) => {
    if (path.length === distance) {
      if (!otherPositions.has(position)) results.push(path.slice());
      return;
    }
    for (const next of adventurerNeighbors(room, position)) {
      if (!room.game.mummy.invisible && next === room.game.mummy.position) continue;
      path.push(next);
      if (isEscapeTarget(room, next)) results.push(path.slice());
      else visit(next, path);
      path.pop();
    }
  };
  visit(piece.position, []);
  return uniquePaths(results);
}

function arrowMoves(room, piece) {
  if (!isActivePiece(piece)) return {};
  const obstacles = occupiedAdventurerCells(room, piece.id);
  if (!room.game.mummy.invisible && isFloorPosition(room, room.game.mummy.position)) obstacles.add(room.game.mummy.position);
  const origin = specialAnchor(gameMap(room), piece.position) || piece.position;
  const originCoordinates = MapFormat.parseCell(origin);
  const moves = {};
  for (const [direction, [dx, dy]] of Object.entries(DIRECTIONS)) {
    const path = [];
    let current = piece.position;
    let [x, y] = originCoordinates;
    while (true) {
      const next = MapFormat.cellKey(x + dx, y + dy);
      if (!next || !adventurerNeighbors(room, current).includes(next) || obstacles.has(next)) break;
      path.push(next);
      if (isEscapeTarget(room, next)) break;
      current = next;
      [x, y] = MapFormat.parseCell(next);
    }
    if (path.length) moves[direction] = { direction, path, end: path.at(-1) };
  }
  return moves;
}

function mummyMoves(room) {
  const position = room.game.mummy.position;
  if (position === "dungeon") return gameMap(room).zones.dungeon.exits.filter((cell) => gameGraph(room).passages[cell]);
  return (gameGraph(room).passages[position] || []).slice();
}

function adventurerNeighbors(room, position) {
  const base = position === "entrance"
    ? gameMap(room).zones.entrance.exits.filter((cell) => gameGraph(room).passages[cell])
    : position === "dungeon"
      ? gameMap(room).zones.dungeon.exits.filter((cell) => gameGraph(room).passages[cell])
      : (gameGraph(room).passages[position] || []).slice();
  if (!isFloorPosition(room, position)) return base;
  for (const cell of escapeTargetCells(room)) {
    if (MapFormat.areAdjacent(position, cell)
      && !gameMap(room).walls.includes(MapFormat.canonicalEdge(position, cell))) base.push(cell);
  }
  return [...new Set(base)];
}

function legalDieIds(room) {
  const piece = currentPiece(room);
  return room.game.dice
    .filter((die) => !die.locked && die.id !== room.game.disabledDieId && die.face)
    .filter((die) => die.face === "arrow"
      ? Object.keys(arrowMoves(room, piece)).length > 0
      : numericPaths(room, piece, Number(die.face)).length > 0)
    .map((die) => die.id);
}

function adventurerTurnStage(room) {
  if (room.phase === PHASES.adventurerPrepare) return "prepare";
  if (room.phase === PHASES.adventurerRoll) return "roll";
  if (room.phase === PHASES.adventurerAction) return "action";
  if (room.phase === PHASES.adventurerEnd) return "end";
  return null;
}

function endStateForView(room, viewer) {
  const state = room.game.endState;
  if (!state || state.kind === "auto") return null;
  const result = { ...state };
  if (viewer?.role === "mummy") delete result.operatorPlayerId;
  return result;
}

function makeGameView(room, viewer) {
  if (!room.game) return null;
  const isMummyViewer = viewer?.role === "mummy";
  const revealsHumans = isMummyViewer && room.game.hunt.tracking.revealThisTurn;
  const pieces = Object.values(room.game.pieces).map((piece) => {
    const result = {
      id: piece.id,
      controllerId: piece.controllerId,
      tokenLabel: piece.tokenLabel,
      ordinal: piece.ordinal,
      profession: piece.profession,
      life: piece.life,
      maxLife: piece.maxLife,
      eliminated: piece.eliminated,
      escaped: piece.escaped,
      outcome: piece.outcome,
      abilityCooldown: piece.abilityCooldown,
      wizardCharges: piece.wizardCharges
    };
    if (!isMummyViewer) {
      result.guard = piece.guard;
      result.injured = piece.injuredTurns > 0;
    }
    if (!isMummyViewer || revealsHumans) result.position = piece.position;
    return result;
  });
  const mummy = { ...room.game.mummy };
  delete mummy.cooldownCreatedTurnId;
  delete mummy.abilityUsedThisTurn;
  delete mummy.abilityTriggers;
  if (!isMummyViewer) delete mummy.abilityCooldown;
  if (!isMummyViewer && mummy.invisible) mummy.position = null;
  const revealedTasks = room.game.revealedTasks.map((task) => {
    if (!isMummyViewer) return { ...task };
    return { id: task.id, position: task.position };
  });
  const view = {
    mode: "hunt",
    phase: room.phase,
    turnStage: adventurerTurnStage(room),
    endState: endStateForView(room, viewer),
    round: room.game.round,
    currentPieceId: room.game.currentPieceId,
    currentPlayerId: isMummyPhase(room.phase) ? mummy.playerId : (currentPiece(room)?.controllerId || null),
    pieces,
    progress: isMummyViewer ? [] : room.players.filter((player) => player.role === "adventurer").map((player) => taskProgress(room, player.id)),
    lockedDiceCount: lockedDiceCount(room),
    disabledDieId: isMummyViewer ? null : room.game.disabledDieId,
    forcedSkipReason: room.game.forcedSkipReason,
    lastPublicDie: room.game.lastPublicDie,
    mummy,
    hunt: {
      treasureGoal: room.game.hunt.treasureGoal,
      mechanisms: { ...room.game.hunt.mechanisms },
      mechanismSeals: Object.fromEntries(MapFormat.HUNT_MECHANISM_IDS.map((id) => [id, room.game.hunt.mechanismSeals[id]?.remaining || 0])),
      exits: { ...room.game.hunt.exits },
      hatch: { ...room.game.hunt.hatch },
      trackingReveal: room.game.hunt.tracking.revealThisTurn,
      trackingCountdown: trackingCountdownForView(room),
      traps: isMummyViewer ? room.game.hunt.traps.slice() : []
    },
    revealedTasks,
    captureEvent: room.game.captureEvent ? { ...room.game.captureEvent } : null,
    winner: room.game.winner ? {
      ...room.game.winner,
      results: room.game.winner.results?.map((result) => ({ ...result })),
      mummyResult: room.game.winner.mummyResult ? { ...room.game.winner.mummyResult } : null
    } : null,
    dice: isMummyViewer ? null : room.game.dice.map((die) => ({ ...die, disabled: die.id === room.game.disabledDieId })),
    hand: viewer?.role === "adventurer" ? (room.game.hands[viewer.id] || []).map((task) => ({ ...task })) : [],
    actionInfo: actionInfoFor(room, viewer),
    legal: { actions: [] }
  };
  addLegalView(room, viewer, view);
  return view;
}

function addLegalView(room, viewer, view) {
  if (!viewer || room.phase === PHASES.gameOver) return;
  const piece = currentPiece(room);
  const isCurrent = viewer.role === "adventurer" && piece?.controllerId === viewer.id;
  if (isCurrent && room.phase === PHASES.adventurerPrepare) {
    const actions = [];
    const locked = lockedDiceCount(room);
    if (usableDice(room).length && hasAnyAdventurerMove(room, piece)) actions.push("rollAdventurerDice");
    if (locked) actions.push("unlockDice");
    const mechanisms = mechanismIdsForPiece(room, piece);
    if (mechanisms.length) {
      actions.push("activateMechanism");
      view.legal.mechanisms = mechanisms;
    }
    const targets = knightTargets(room, piece);
    if (targets.length && piece.profession === "knight" && piece.abilityCooldown === 0) {
      actions.push("useKnightGuard");
      view.legal.guardTargets = targets.map((target) => target.id);
    }
    if (piece.profession === "wizard" && piece.wizardCharges > 0 && !piece.wizardUsedThisTurn && locked >= 2 && locked < room.game.dice.length) {
      actions.push("useWizardUnlock");
    }
    view.legal.actions = actions;
  } else if (isCurrent && room.phase === PHASES.adventurerRoll) {
    view.legal.dieIds = legalDieIds(room);
    view.legal.actions = ["rollAdventurerDice", ...(view.legal.dieIds.length ? ["selectDie"] : [])];
  } else if (isCurrent && room.phase === PHASES.adventurerAction && room.game.actionState?.kind === "numeric") {
    view.legal.actions = ["moveNumeric"];
    view.legal.paths = numericPaths(room, piece, Number(room.game.selectedFace));
    view.legal.selectedFace = room.game.selectedFace;
  } else if (isCurrent && room.phase === PHASES.adventurerAction && room.game.actionState?.kind === "arrow") {
    view.legal.actions = ["moveArrow"];
    view.legal.directions = arrowMoves(room, piece);
    view.legal.selectedFace = "arrow";
  } else if (isCurrent && room.phase === PHASES.adventurerEnd && room.game.endState?.kind === "treasure") {
    view.legal.actions = ["revealTreasure", "declineTreasure"];
    view.legal.treasures = room.game.pendingTreasureIds.map((id) => ({ id, position: treasurePosition(room, id) }));
  } else if (isCurrent && room.phase === PHASES.adventurerEnd && room.game.endState?.kind === "mechanism"
    && room.game.endState.operatorPlayerId === viewer.id) {
    view.legal.actions = ["finishAdventurerTurn"];
  } else if (viewer.role === "mummy" && room.phase === PHASES.monsterPrepare) {
    view.legal.actions = ["rollMummyDie"];
    if (room.game.mummy.type === "trap" && !room.game.mummy.abilityUsedThisTurn) {
      const placements = trapPlacements(room);
      const recoveries = trapRecoveries(room);
      if (placements.length) view.legal.actions.push("placeTrap");
      if (recoveries.length) view.legal.actions.push("recoverTrap");
      view.legal.trapPlacements = placements;
      view.legal.trapRecoveries = recoveries;
    } else if (room.game.mummy.type === "invisible" && !room.game.mummy.abilityUsedThisTurn) {
      view.legal.actions.push(room.game.mummy.invisible ? "revealMummy" : "hideMummy");
    } else if (room.game.mummy.type === "knife" && !room.game.mummy.abilityUsedThisTurn && room.game.mummy.abilityCooldown === 0) {
      view.legal.actions.push("throwKnife");
      view.legal.knifeDirections = Object.keys(DIRECTIONS);
    }
  } else if (viewer.role === "mummy" && [PHASES.monsterAction, PHASES.monsterInterruptAction].includes(room.phase)) {
    view.legal.actions = ["moveMummy", "stopMummy"];
    view.legal.moves = mummyMoves(room);
  }
}

function taskProgress(room, playerId) {
  const hand = room.game.hands[playerId] || [];
  const remainingByGroup = {};
  for (const group of Object.keys(MapFormat.GROUPS)) remainingByGroup[group] = hand.filter((task) => task.id.startsWith(group) && !task.revealed).length;
  return { playerId, total: hand.length, completed: hand.filter((task) => task.revealed).length, remainingByGroup };
}

function mechanismIdsForPiece(room, piece) {
  if (!isActivePiece(piece) || room.game.revealedTasks.length < room.game.hunt.treasureGoal || !isFloorPosition(room, piece.position)) return [];
  return MapFormat.HUNT_MECHANISM_IDS.filter((id) => room.game.hunt.mechanisms[id] < 3)
    .filter((id) => !room.game.hunt.mechanismSeals[id])
    .filter((id) => {
      const mechanism = gameMap(room).hunt.mechanisms[id];
      return MapFormat.areAdjacent(piece.position, mechanism)
        && !gameMap(room).walls.includes(MapFormat.canonicalEdge(piece.position, mechanism));
    });
}

function knightTargets(room, piece) {
  if (piece?.profession !== "knight" || piece.abilityCooldown > 0 || !isFloorPosition(room, piece.position)) return [];
  return activePieces(room).filter((target) => target.id !== piece.id && !target.guard && isFloorPosition(room, target.position)
    && isWithinKnightGuardRange(piece.position, target.position));
}

function isWithinKnightGuardRange(origin, target) {
  const [originX, originY] = MapFormat.parseCell(origin);
  const [targetX, targetY] = MapFormat.parseCell(target);
  return Math.max(Math.abs(originX - targetX), Math.abs(originY - targetY)) === 1;
}

function hasFullTurnAbility(room, piece) {
  return mechanismIdsForPiece(room, piece).length > 0 || knightTargets(room, piece).length > 0;
}

function openExit(room, id) {
  room.game.hunt.exits[id] = "open";
  room.game.hunt.mechanismSeals[id] = null;
  addLog(room, `機關 ${id} 已完成，該格轉為逃生出口 ${id}。`);
}

function enableTracking(room) {
  const tracking = room.game.hunt.tracking;
  if (tracking.enabled) return;
  tracking.enabled = true;
  tracking.countdown = TRACKING_INTERVAL;
}

function trackingCountdownForView(room) {
  const tracking = room.game.hunt.tracking;
  if (!tracking.enabled || tracking.revealThisTurn || !Number.isInteger(tracking.countdown)) return null;
  const normalMummyTurn = [PHASES.monsterPrepare, PHASES.monsterRoll, PHASES.monsterAction, PHASES.monsterEnd].includes(room.phase);
  return Math.max(1, tracking.countdown + (normalMummyTurn ? 1 : 0));
}

function closeHatch(room) {
  room.game.hunt.hatch.status = "closed";
  room.game.mummy.remaining = 0;
  for (const id of MapFormat.HUNT_MECHANISM_IDS) {
    room.game.hunt.exits[id] = "open";
    room.game.hunt.mechanismSeals[id] = null;
  }
  enableTracking(room);
  addLog(room, "提燈怪關閉了密道並結束回合；兩個逃生出口立即開啟。 ");
}

function escapePiece(room, piece, source) {
  piece.escaped = true;
  piece.outcome = "escaped";
  piece.position = null;
  addLog(room, `${pieceName(room, piece)} 已從${source}逃出古墓。`);
  evaluateHuntResolution(room);
  if (room.phase !== PHASES.gameOver) finishAdventurerWithoutInteraction(room);
}

function evaluateHuntResolution(room) {
  const active = activePieces(room);
  if (!active.length) {
    finishGame(room);
    return;
  }
  if (active.length === 1 && room.game.hunt.hatch.status === "unavailable") openHatch(room, active[0]);
}

function openHatch(room, survivor) {
  const reachable = reachableFloorCells(room, survivor.position);
  const occupied = new Set(activePieces(room).map((piece) => piece.position));
  occupied.add(room.game.mummy.position);
  const candidates = [...reachable].filter((cell) => !occupied.has(cell));
  if (!candidates.length) return;
  const position = candidates[randomIntInclusive(0, candidates.length - 1)];
  if (room.game.hunt.traps.includes(position)) removeTrap(room, position);
  room.game.hunt.hatch = { status: "open", position };
  addLog(room, `最後生還者的密道已在 (${position}) 開啟。`);
}

function finishGame(room) {
  const results = Object.values(room.game.pieces).map((piece) => ({
    playerId: piece.controllerId,
    pieceId: piece.id,
    profession: piece.profession,
    completedTasks: room.game.revealedTasks.filter((task) => task.pieceId === piece.id).length,
    mechanismContribution: piece.mechanismContribution || 0,
    outcome: piece.outcome
  }));
  const escaped = results.filter((result) => result.outcome === "escaped").length;
  room.game.winner = {
    role: escaped > 0 ? "adventurer" : "mummy",
    playerId: escaped > 0 ? null : room.game.mummy.playerId,
    teamResult: escaped > 0 ? "escaped" : "all_dead",
    results,
    mummyResult: {
      playerId: room.game.mummy.playerId,
      type: room.game.mummy.type,
      abilityTriggers: room.game.mummy.abilityTriggers || 0
    }
  };
  room.game.currentPieceId = null;
  room.game.mummy.remaining = 0;
  room.phase = PHASES.gameOver;
  addLog(room, escaped > 0 ? `${escaped} 名冒險者成功逃出古墓。` : "所有冒險者都已死亡，提燈怪獲勝。 ");
}

function knifeRay(room, direction) {
  const [dx, dy] = DIRECTIONS[direction];
  const origin = specialAnchor(gameMap(room), room.game.mummy.position) || room.game.mummy.position;
  let [x, y] = MapFormat.parseCell(origin);
  let current = room.game.mummy.position;
  const ray = [];
  while (true) {
    const next = MapFormat.cellKey(x + dx, y + dy);
    if (!next) break;
    const allowed = current === "dungeon"
      ? gameMap(room).zones.dungeon.exits.includes(next) && Boolean(gameGraph(room).passages[next])
      : (gameGraph(room).passages[current] || []).includes(next);
    if (!allowed) break;
    ray.push(next);
    current = next;
    [x, y] = MapFormat.parseCell(next);
  }
  return ray;
}

function trapPlacements(room) {
  if (room.game.mummy.abilityCooldown > 0 || room.game.hunt.traps.length >= 2) return [];
  const occupied = occupiedAdventurerCells(room);
  const map = gameMap(room);
  const forbidden = new Set([
    map.zones.entrance.anchor,
    map.zones.dungeon.anchor,
    ...map.zones.dungeon.exits
  ]);
  return mummyMoves(room).filter((cell) => !occupied.has(cell)
    && !forbidden.has(cell)
    && cell !== room.game.hunt.hatch.position
    && !room.game.hunt.traps.includes(cell));
}

function trapRecoveries(room) {
  const position = room.game.mummy.position;
  const adjacent = position === "dungeon" ? gameMap(room).zones.dungeon.exits : MapFormat.neighbors(position, gameMap(room).width, gameMap(room).height);
  return room.game.hunt.traps.filter((cell) => adjacent.includes(cell));
}

function removeTrap(room, cell) {
  room.game.hunt.traps = room.game.hunt.traps.filter((trap) => trap !== cell);
}

function recordMummyAbilityTrigger(room) {
  room.game.mummy.abilityTriggers = (room.game.mummy.abilityTriggers || 0) + 1;
}

function reachableFloorCells(room, position) {
  const starts = isSpecialPosition(position) ? adventurerNeighbors(room, position).filter((cell) => gameGraph(room).passages[cell]) : [position];
  const visited = new Set(starts);
  const queue = [...starts];
  while (queue.length) {
    const current = queue.shift();
    for (const next of gameGraph(room).passages[current] || []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

function escapeTargetCells(room) {
  const cells = MapFormat.HUNT_MECHANISM_IDS
    .filter((id) => room.game.hunt.exits[id] === "open")
    .map((id) => gameMap(room).hunt.mechanisms[id]);
  if (room.game.hunt.hatch.status === "open") cells.push(room.game.hunt.hatch.position);
  return cells.filter(Boolean);
}

function isEscapeTarget(room, cell) {
  return escapeTargetCells(room).includes(cell);
}

function finishPieceTurn(room, piece) {
  if (!piece) return;
  if (piece.injuryActive) {
    if (piece.injuryCreatedTurnId !== room.game.activeAdventurerTurnId) piece.injuredTurns = Math.max(0, piece.injuredTurns - 1);
    piece.injuryActive = false;
    if (piece.injuredTurns === 0) piece.injuryCreatedTurnId = null;
  }
  if (piece.abilityCooldown > 0) {
    if (piece.cooldownCreatedTurnId !== room.game.activeAdventurerTurnId) piece.abilityCooldown -= 1;
    if (piece.abilityCooldown === 0) piece.cooldownCreatedTurnId = null;
  }
}

function finishMummyCooldown(room) {
  const mummy = room.game.mummy;
  if (mummy.abilityCooldown > 0) {
    if (mummy.cooldownCreatedTurnId !== room.game.activeMonsterTurnId) mummy.abilityCooldown -= 1;
    if (mummy.abilityCooldown === 0) mummy.cooldownCreatedTurnId = null;
  }
}

function hasAnyAdventurerMove(room, piece) {
  return [1, 2, 3, 4].some((distance) => numericPaths(room, piece, distance).length)
    || Object.keys(arrowMoves(room, piece)).length > 0;
}

function usableDice(room) {
  return room.game.dice.filter((die) => !die.locked && die.id !== room.game.disabledDieId);
}

function clearSelectedMove(room) {
  clearUnlockedDice(room);
  room.game.selectedDieId = null;
  room.game.selectedFace = null;
  room.game.actionState = null;
}

function clearUnlockedDice(room) {
  room.game.dice.forEach((die) => { if (!die.locked) die.face = null; });
}

function clearAllDice(room) {
  room.game.dice.forEach((die) => { die.locked = false; die.face = null; });
  room.game.disabledDieId = null;
}

function activePieces(room) {
  return Object.values(room.game.pieces).filter(isActivePiece);
}

function isActivePiece(piece) {
  return Boolean(piece && !piece.eliminated && !piece.escaped);
}

function occupiedAdventurerCells(room, excludedPieceId = null) {
  return new Set(activePieces(room)
    .filter((piece) => piece.id !== excludedPieceId && isFloorPosition(room, piece.position))
    .map((piece) => piece.position));
}

function gameMap(room) { return room.game.map; }
function gameGraph(room) { return room.game.graph; }
function treasurePosition(room, id) { return gameMap(room).treasures.find((treasure) => treasure.id === id)?.position || null; }
function currentPiece(room) { return room.game?.pieces[room.game.currentPieceId] || null; }
function currentPieceName(room) { return pieceName(room, currentPiece(room)); }

function pieceName(room, piece) {
  if (!piece) return "冒險者";
  return room.players.find((candidate) => candidate.id === piece.controllerId)?.name || "冒險者";
}

function isCurrentAdventurer(room, actor) { return Boolean(actor && currentPiece(room)?.controllerId === actor.id); }
function isMummy(room, actor) { return Boolean(actor && room.game.mummy.playerId === actor.id); }
function isMummyPhase(phase) {
  return [
    PHASES.monsterPrepare,
    PHASES.monsterRoll,
    PHASES.monsterAction,
    PHASES.monsterEnd,
    PHASES.monsterInterruptPrepare,
    PHASES.monsterInterruptAction,
    PHASES.monsterInterruptEnd
  ].includes(phase);
}
function lockedDiceCount(room) { return room.game.dice.filter((die) => die.locked).length; }
function isFloorPosition(room, position) { return Boolean(position && !isSpecialPosition(position) && gameGraph(room).passages[position]); }
function isSpecialPosition(position) { return position === "entrance" || position === "dungeon"; }
function specialAnchor(map, position) { return isSpecialPosition(position) ? map.zones[position].anchor : null; }
function samePath(left, right) { return left.length === right.length && left.every((cell, index) => cell === right[index]); }
function uniquePaths(paths) { return [...new Map(paths.map((path) => [path.join("|"), path])).values()]; }
function directionLabel(direction) { return { up: "上方", right: "右方", down: "下方", left: "左方" }[direction] || direction; }

function addLog(room, message) {
  room.log.push(message);
  if (room.game?.mode === "hunt") room.game.events.push({ public: message });
}

function addRedactedLog(room, publicMessage, messages = {}) {
  room.log.push(publicMessage);
  room.game.events.push({ public: publicMessage, adventurer: messages.adventurer || publicMessage, mummy: messages.mummy || publicMessage });
}

function addSecretMummyLog(room, mummyMessage) {
  room.game.events.push({ public: null, mummy: mummyMessage });
}

function actionInfoFor(room, viewer) {
  return room.game.events
    .map((event) => viewer?.role === "mummy" ? (event.mummy ?? event.public) : (event.adventurer ?? event.public))
    .filter(Boolean)
    .slice(-5);
}

function resetGame(room) { room.game = null; }

module.exports = {
  PHASES,
  PHASE_ACTIONS,
  ADVENTURER_FACES,
  MECHANISM_FACES,
  setupGame,
  applyGameAction,
  makeGameView,
  resetGame,
  numericPaths,
  arrowMoves,
  mummyMoves,
  resolveAdventurerFaces,
  resolveMechanismFace,
  resolveMummyRoll
};
