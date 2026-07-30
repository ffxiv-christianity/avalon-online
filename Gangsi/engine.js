"use strict";

const { randomIntInclusive, shuffle } = require("../Shared/server/random");
const MapCatalog = require("./map-catalog");
const MapFormat = require("./map-format");
const HuntEngine = require("./hunt-engine");

const PHASES = HuntEngine.PHASES;

const PHASE_ACTIONS = Object.freeze({
  [PHASES.adventurerPrepare]: Object.freeze(["rollAdventurerDice", "unlockDice"]),
  [PHASES.adventurerRoll]: Object.freeze(["rollAdventurerDice", "selectDie"]),
  [PHASES.adventurerAction]: Object.freeze(["moveNumeric", "moveArrow"]),
  [PHASES.adventurerEnd]: Object.freeze(["revealTreasure", "declineTreasure", "finishAdventurerTurn"]),
  [PHASES.monsterPrepare]: Object.freeze(["rollMummyDie"]),
  [PHASES.monsterRoll]: Object.freeze([]),
  [PHASES.monsterAction]: Object.freeze(["moveMummy", "stopMummy"]),
  [PHASES.monsterEnd]: Object.freeze([]),
  [PHASES.monsterInterruptPrepare]: Object.freeze([]),
  [PHASES.monsterInterruptAction]: Object.freeze(["moveMummy", "stopMummy"]),
  [PHASES.monsterInterruptEnd]: Object.freeze([]),
  [PHASES.gameOver]: Object.freeze([])
});

const ADVENTURER_FACES = Object.freeze(["1", "2", "3", "4", "arrow", "mummy"]);
const MUMMY_FACES = Object.freeze([1, 1, 2, 2, 3, 3]);
const MUMMY_TARGETS = Object.freeze({ 2: 3, 3: 4, 4: 6, 5: 7 });
const DIRECTIONS = Object.freeze({
  up: Object.freeze([0, -1]),
  right: Object.freeze([1, 0]),
  down: Object.freeze([0, 1]),
  left: Object.freeze([-1, 0])
});

function setupGame(room) {
  if (room.settings.mode === "hunt") return HuntEngine.setupGame(room);
  const map = MapCatalog.getBuiltInMap(room.settings.mapId);
  if (!map) throw new Error("Cannot start Gangsi without a valid map");
  const adventurers = room.players.filter((player) => player.role === "adventurer");
  const mummyPlayer = room.players.find((player) => player.role === "mummy");
  if (!mummyPlayer || !adventurers.length) throw new Error("Gangsi roles are incomplete");

  const pieces = {};
  const adventurerOrder = [];
  for (const player of adventurers) {
    const pieceCount = room.settings.playerCount === 2 ? 2 : 1;
    for (let ordinal = 1; ordinal <= pieceCount; ordinal += 1) {
      const id = `${player.id}:adventurer:${ordinal}`;
      pieces[id] = {
        id,
        controllerId: player.id,
        tokenLabel: player.tokenLabel,
        ordinal,
        position: "entrance",
        life: 3,
        eliminated: false
      };
      adventurerOrder.push(id);
    }
  }

  room.game = {
    mapId: map.id,
    map,
    graph: MapFormat.buildMovementGraph(map),
    round: 1,
    turnIndex: 0,
    currentPieceId: null,
    adventurerOrder,
    pieces,
    hands: dealHands(map, adventurers, room.settings.playerCount === 2 ? 2 : 1),
    dice: Array.from({ length: 5 }, (_, index) => ({ id: `die-${index + 1}`, locked: false, face: null })),
    selectedDieId: null,
    selectedFace: null,
    actionState: null,
    forcedSkipReason: null,
    pendingTreasureIds: [],
    endState: null,
    pendingUnlock: null,
    resumeState: null,
    lastPublicDie: null,
    mummy: {
      playerId: mummyPlayer.id,
      position: "dungeon",
      score: 0,
      target: MUMMY_TARGETS[room.settings.playerCount],
      roll: null,
      remaining: 0,
      moveKind: null
    },
    revealedTasks: [],
    captureSerial: 0,
    captureEvent: null,
    winner: null
  };

  beginAdventurerAtIndex(room, 0);
}

function dealHands(map, adventurers, cardsPerGroup) {
  const hands = Object.fromEntries(adventurers.map((player) => [player.id, []]));
  for (const group of Object.keys(MapFormat.GROUPS)) {
    const pool = shuffle(map.treasures
      .filter((treasure) => treasure.id.startsWith(group))
      .map((treasure) => treasure.id));
    for (const player of adventurers) {
      for (let index = 0; index < cardsPerGroup; index += 1) {
        const id = pool.pop();
        if (!id) throw new Error(`Not enough ${group} treasures for Gangsi hands`);
        hands[player.id].push({ id, revealed: false, completedByPieceId: null });
      }
    }
  }
  return hands;
}

function applyGameAction(room, actor, action, payload = {}) {
  if (room.settings.mode === "hunt") return HuntEngine.applyGameAction(room, actor, action, payload);
  if (!room.game || room.phase === "lobby") return "遊戲尚未開始。";
  if (room.phase === PHASES.gameOver) return "遊戲已經結束。";
  if (!PHASE_ACTIONS[room.phase]?.includes(action)) return `操作 ${action} 不能在 ${room.phase} 階段執行。`;
  if (room.phase === PHASES.adventurerPrepare
    && lockedDiceCount(room) === room.game.dice.length
    && action !== "unlockDice") {
    return "所有冒險者骰皆已鎖定，必須先解鎖全部骰子。";
  }
  switch (action) {
    case "unlockDice": return unlockDice(room, actor);
    case "finishAdventurerTurn": return finishAdventurerTurn(room, actor);
    case "rollAdventurerDice": return rollAdventurerDice(room, actor);
    case "selectDie": return selectDie(room, actor, payload.dieId);
    case "moveNumeric": return moveNumeric(room, actor, payload.path);
    case "moveArrow": return moveArrow(room, actor, payload.direction);
    case "revealTreasure": return revealTreasure(room, actor);
    case "declineTreasure": return declineTreasure(room, actor);
    case "rollMummyDie": return rollMummyDie(room, actor);
    case "moveMummy": return moveMummy(room, actor, payload.cell);
    case "stopMummy": return stopMummy(room, actor);
    default: return "未知的遊戲操作。";
  }
}

function unlockDice(room, actor) {
  if (room.phase !== PHASES.adventurerPrepare) return "現在不能解鎖骰子。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  const count = lockedDiceCount(room);
  if (!count) return "目前沒有鎖定骰。";
  beginInterlude(room, room.game.currentPieceId, count, false);
  return null;
}

function finishAdventurerTurn(room, actor) {
  if (room.phase !== PHASES.adventurerEnd || room.game.endState?.kind !== "no_movement") {
    return "現在不能結束冒險者回合。";
  }
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  if (room.game.endState.operatorPlayerId !== actor.id) return "現在不是你的回合。";
  addLog(room, `${currentPieceName(room)} 確認結束無法移動的回合。`);
  advanceAfterAdventurer(room);
  return null;
}

function rollAdventurerDice(room, actor) {
  if (![PHASES.adventurerPrepare, PHASES.adventurerRoll].includes(room.phase)) return "現在不能擲冒險者骰。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  const unlocked = room.game.dice.filter((die) => !die.locked);
  if (!unlocked.length) return "目前沒有可擲的骰子。";
  room.phase = PHASES.adventurerRoll;
  const faces = unlocked.map(() => ADVENTURER_FACES[randomIntInclusive(0, ADVENTURER_FACES.length - 1)]);
  resolveAdventurerFaces(room, faces);
  return null;
}

function resolveAdventurerFaces(room, faces) {
  room.phase = PHASES.adventurerRoll;
  const unlocked = room.game.dice.filter((die) => !die.locked);
  if (!Array.isArray(faces) || faces.length !== unlocked.length) throw new Error("Gangsi dice face count mismatch");
  unlocked.forEach((die, index) => {
    const face = String(faces[index]);
    if (!ADVENTURER_FACES.includes(face)) throw new Error(`Invalid Gangsi die face: ${face}`);
    die.face = face;
    if (face === "mummy") die.locked = true;
  });
  addLog(room, `${currentPieceName(room)} 擲了冒險者骰。`);
  if (lockedDiceCount(room) === room.game.dice.length) {
    beginAdventurerNoMovementEnd(room, "all_dice_locked");
  }
}

function selectDie(room, actor, dieId) {
  if (room.phase !== PHASES.adventurerRoll) return "現在不能選擇骰子。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  const die = room.game.dice.find((candidate) => candidate.id === dieId);
  if (!die || die.locked || !die.face) return "找不到可用的骰子。";
  const legal = legalDieIds(room);
  if (!legal.includes(die.id)) return "這顆骰子目前沒有合法移動。";
  room.game.selectedDieId = die.id;
  room.game.selectedFace = die.face;
  room.game.lastPublicDie = die.face;
  room.game.actionState = { kind: die.face === "arrow" ? "arrow" : "numeric" };
  addLog(room, `${currentPieceName(room)} 選用了${die.face === "arrow" ? "箭頭" : die.face}骰。`);
  room.phase = PHASES.adventurerAction;
  return null;
}

function moveNumeric(room, actor, rawPath) {
  if (room.phase !== PHASES.adventurerAction || room.game.actionState?.kind !== "numeric") return "現在不能提交數字路徑。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  const distance = Number(room.game.selectedFace);
  const path = Array.isArray(rawPath) ? rawPath.map((cell) => MapFormat.cellKey(cell)) : [];
  const legalPaths = numericPaths(room, currentPiece(room), distance);
  if (!legalPaths.some((candidate) => samePath(candidate, path))) return "這條移動路徑不合法。";
  currentPiece(room).position = path.at(-1);
  completeAdventurerMove(room);
  return null;
}

function moveArrow(room, actor, direction) {
  if (room.phase !== PHASES.adventurerAction || room.game.actionState?.kind !== "arrow") return "現在不能使用箭頭移動。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  const move = arrowMoves(room, currentPiece(room))[direction];
  if (!move) return "這個方向沒有合法的箭頭移動。";
  currentPiece(room).position = move.end;
  completeAdventurerMove(room);
  return null;
}

function completeAdventurerMove(room) {
  const piece = currentPiece(room);
  clearUnlockedDice(room);
  clearSelectedMove(room);
  const hand = room.game.hands[piece.controllerId] || [];
  room.game.pendingTreasureIds = hand
    .filter((task) => !task.revealed && treasurePosition(room, task.id) === piece.position)
    .map((task) => task.id);
  room.phase = PHASES.adventurerEnd;
  if (room.game.pendingTreasureIds.length) {
    room.game.endState = { kind: "treasure", operatorPlayerId: piece.controllerId };
    return;
  }
  room.game.endState = { kind: "auto", operatorPlayerId: piece.controllerId };
  advanceAfterAdventurer(room);
}

function revealTreasure(room, actor) {
  if (room.phase !== PHASES.adventurerEnd || room.game.endState?.kind !== "treasure") return "現在沒有可揭露的寶藏。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  if (room.game.endState.operatorPlayerId !== actor.id) return "現在不是你的回合。";
  const piece = currentPiece(room);
  const id = room.game.pendingTreasureIds[0];
  const task = (room.game.hands[piece.controllerId] || []).find((candidate) => candidate.id === id && !candidate.revealed);
  if (!task || treasurePosition(room, id) !== piece.position) return "這張任務目前不能揭露。";
  task.revealed = true;
  task.completedByPieceId = piece.id;
  room.game.revealedTasks.push({
    id,
    playerId: piece.controllerId,
    pieceId: piece.id,
    position: piece.position
  });
  room.game.pendingTreasureIds = [];
  addLog(room, `${currentPieceName(room)} 揭露了寶藏 ${id}。`);
  if ((room.game.hands[piece.controllerId] || []).every((candidate) => candidate.revealed)) {
    finishGame(room, {
      role: "adventurer",
      playerId: piece.controllerId,
      pieceId: piece.id
    });
    return null;
  }
  advanceAfterAdventurer(room);
  return null;
}

function declineTreasure(room, actor) {
  if (room.phase !== PHASES.adventurerEnd || room.game.endState?.kind !== "treasure") return "現在沒有可略過的寶藏。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  if (room.game.endState.operatorPlayerId !== actor.id) return "現在不是你的回合。";
  room.game.pendingTreasureIds = [];
  advanceAfterAdventurer(room);
  return null;
}

function rollMummyDie(room, actor) {
  if (room.phase !== PHASES.monsterPrepare) return "現在不能擲提燈怪骰。";
  if (!isMummy(room, actor)) return "現在不是你的回合。";
  room.phase = PHASES.monsterRoll;
  const value = MUMMY_FACES[randomIntInclusive(0, MUMMY_FACES.length - 1)];
  resolveMummyRoll(room, value);
  return null;
}

function resolveMummyRoll(room, value) {
  if (![1, 2, 3].includes(Number(value))) throw new Error("Invalid Gangsi mummy roll");
  room.phase = PHASES.monsterRoll;
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
  room.game.mummy.position = cell;
  room.game.mummy.remaining -= 1;
  addLog(room, `提燈怪移動到 (${cell})。`);
  const captured = Object.values(room.game.pieces).filter((piece) => !piece.eliminated && piece.position === cell);
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
  room.game.mummy.remaining = 0;
  room.game.captureSerial += 1;
  const captures = pieces.map((piece) => {
    piece.life -= 1;
    room.game.mummy.score += 1;
    piece.eliminated = piece.life <= 0;
    piece.position = piece.eliminated ? null : "dungeon";
    addLog(room, `${pieceName(room, piece)} 被提燈怪抓到，失去 1 點生命${piece.eliminated ? "並出局" : ""}。`);
    return {
      pieceId: piece.id,
      playerId: piece.controllerId,
      life: piece.life,
      eliminated: piece.eliminated
    };
  });
  const first = captures[0];
  room.game.captureEvent = {
    serial: room.game.captureSerial,
    ...first,
    position: room.game.mummy.position,
    captures
  };
  if (room.game.mummy.score >= room.game.mummy.target) {
    finishGame(room, { role: "mummy", playerId: room.game.mummy.playerId });
  }
}

function finishMummyMove(room) {
  const kind = room.game.mummy.moveKind;
  room.game.mummy.remaining = 0;
  room.game.mummy.roll = null;
  room.game.mummy.moveKind = null;
  if (kind === "interlude") {
    room.phase = PHASES.monsterInterruptEnd;
    const pieceId = room.game.resumeState?.pieceId || room.game.pendingUnlock?.pieceId;
    clearAllDice(room);
    room.game.pendingUnlock = null;
    const piece = room.game.pieces[pieceId];
    if (!piece || piece.eliminated) {
      room.game.resumeState = null;
      advanceAfterAdventurer(room);
      return;
    }
    room.game.turnIndex = room.game.adventurerOrder.indexOf(pieceId);
    room.game.currentPieceId = pieceId;
    room.game.resumeState = null;
    prepareAdventurerTurn(room, piece);
    return;
  }
  room.phase = PHASES.monsterEnd;
  finishNormalMummyTurn(room);
}

function finishNormalMummyTurn(room) {
  room.game.round += 1;
  beginAdventurerAtIndex(room, 0);
}

function beginInterlude(room, pieceId, count, automatic) {
  room.game.forcedSkipReason = null;
  room.game.pendingUnlock = { pieceId, count };
  room.game.resumeState = {
    playerId: room.game.pieces[pieceId]?.controllerId || null,
    pieceId,
    phase: PHASES.adventurerPrepare
  };
  room.game.mummy.roll = null;
  room.game.mummy.remaining = count;
  room.game.mummy.moveKind = "interlude";
  room.phase = PHASES.monsterInterruptPrepare;
  addLog(room, automatic
    ? `${pieceName(room, room.game.pieces[pieceId])} 已無可用骰子，系統自動解鎖 ${count} 顆骰子，並進入提燈怪的插入回合。`
    : `${pieceName(room, room.game.pieces[pieceId])} 解鎖 ${count} 顆骰子，提燈怪取得插入回合。`);
  room.phase = PHASES.monsterInterruptAction;
}

function beginAdventurerNoMovementEnd(room, reason) {
  room.game.forcedSkipReason = reason;
  clearSelectedMove(room);
  room.game.endState = {
    kind: "no_movement",
    reason,
    operatorPlayerId: currentPiece(room)?.controllerId || null
  };
  room.phase = PHASES.adventurerEnd;
  addLog(room, reason === "all_dice_locked"
    ? `${currentPieceName(room)} 的五顆骰子全部鎖定，沒有可用骰子，進入結束階段。`
    : `${currentPieceName(room)} 沒有任何合法移動，略過擲骰與行動階段。`);
}

function advanceAfterAdventurer(room) {
  const currentIndex = room.game.adventurerOrder.indexOf(room.game.currentPieceId);
  clearUnlockedDice(room);
  clearSelectedMove(room);
  room.game.forcedSkipReason = null;
  room.game.pendingTreasureIds = [];
  room.game.endState = null;
  beginAdventurerAtIndex(room, currentIndex >= 0 ? currentIndex + 1 : room.game.turnIndex + 1);
}

function beginAdventurerAtIndex(room, startIndex) {
  const order = room.game.adventurerOrder;
  for (let index = startIndex; index < order.length; index += 1) {
    const piece = room.game.pieces[order[index]];
    if (!piece || piece.eliminated) continue;
    room.game.turnIndex = index;
    room.game.currentPieceId = piece.id;
    prepareAdventurerTurn(room, piece);
    return;
  }
  room.game.currentPieceId = null;
  room.game.turnIndex = order.length;
  room.game.forcedSkipReason = null;
  room.game.mummy.roll = null;
  room.game.mummy.remaining = 0;
  room.game.mummy.moveKind = null;
  room.phase = PHASES.monsterPrepare;
  addLog(room, "提燈怪的正常回合。");
}

function prepareAdventurerTurn(room, piece) {
  room.game.forcedSkipReason = null;
  room.game.endState = null;
  room.phase = PHASES.adventurerPrepare;
  addLog(room, `輪到 ${pieceName(room, piece)}。`);
  if (!hasAnyAdventurerMove(room, piece)) {
    beginAdventurerNoMovementEnd(room, "no_legal_move");
    return;
  }
  const locked = lockedDiceCount(room);
  if (locked === room.game.dice.length) {
    addLog(room, `${pieceName(room, piece)} 的所有冒險者骰皆已鎖定，必須先解鎖全部骰子。`);
  }
}

function finishGame(room, winner) {
  room.game.winner = winner;
  room.game.currentPieceId = null;
  room.game.mummy.remaining = 0;
  room.phase = PHASES.gameOver;
  const player = room.players.find((candidate) => candidate.id === winner.playerId);
  addLog(room, winner.role === "mummy"
    ? `提燈怪 ${player?.name || ""} 獲勝。`
    : `冒險者 ${player?.name || ""} 完成全部任務並獲勝。`);
}

function numericPaths(room, piece, distance) {
  if (!piece || piece.eliminated || !Number.isInteger(distance) || distance < 1 || distance > 4) return [];
  const results = [];
  const otherPositions = occupiedAdventurerCells(room, piece.id);
  const visit = (position, path) => {
    if (path.length === distance) {
      if (!otherPositions.has(position)) results.push(path.slice());
      return;
    }
    for (const next of adventurerNeighbors(room, position)) {
      if (next === room.game.mummy.position) continue;
      path.push(next);
      visit(next, path);
      path.pop();
    }
  };
  visit(piece.position, []);
  return results;
}

function arrowMoves(room, piece) {
  if (!piece || piece.eliminated) return {};
  const map = gameMap(room);
  const graph = gameGraph(room);
  const obstacles = occupiedAdventurerCells(room, piece.id);
  if (isFloorPosition(room, room.game.mummy.position)) obstacles.add(room.game.mummy.position);
  const origin = specialAnchor(map, piece.position) || piece.position;
  const originCoordinates = MapFormat.parseCell(origin);
  const moves = {};
  for (const [direction, [dx, dy]] of Object.entries(DIRECTIONS)) {
    const path = [];
    let current = piece.position;
    let [x, y] = originCoordinates;
    while (true) {
      const next = MapFormat.cellKey(x + dx, y + dy);
      if (!next) break;
      const allowed = isSpecialPosition(current)
        ? specialExits(map, current).includes(next)
        : (graph.passages[current] || []).includes(next);
      if (!allowed || obstacles.has(next)) break;
      path.push(next);
      current = next;
      [x, y] = MapFormat.parseCell(next);
    }
    if (path.length) moves[direction] = { direction, path, end: path.at(-1) };
  }
  return moves;
}

function mummyMoves(room) {
  const position = room.game.mummy.position;
  if (position === "dungeon") return gameMap(room).zones.dungeon.exits.slice();
  return (gameGraph(room).passages[position] || []).slice();
}

function adventurerNeighbors(room, position) {
  if (position === "entrance") return gameMap(room).zones.entrance.exits.slice();
  if (position === "dungeon") return gameMap(room).zones.dungeon.exits.slice();
  return (gameGraph(room).passages[position] || []).slice();
}

function hasAnyAdventurerMove(room, piece) {
  return [1, 2, 3, 4].some((distance) => numericPaths(room, piece, distance).length)
    || Object.keys(arrowMoves(room, piece)).length > 0;
}

function legalDieIds(room) {
  const piece = currentPiece(room);
  return room.game.dice
    .filter((die) => !die.locked && die.face)
    .filter((die) => die.face === "arrow"
      ? Object.keys(arrowMoves(room, piece)).length > 0
      : numericPaths(room, piece, Number(die.face)).length > 0)
    .map((die) => die.id);
}

function makeGameView(room, viewer) {
  if (room.game?.mode === "hunt") return HuntEngine.makeGameView(room, viewer);
  if (!room.game) return null;
  const isMummyViewer = viewer?.role === "mummy";
  const pieces = Object.values(room.game.pieces).map((piece) => {
    const result = {
      id: piece.id,
      controllerId: piece.controllerId,
      tokenLabel: piece.tokenLabel,
      ordinal: piece.ordinal,
      life: piece.life,
      eliminated: piece.eliminated
    };
    if (!isMummyViewer) result.position = piece.position;
    return result;
  });
  const progress = room.players
    .filter((player) => player.role === "adventurer")
    .map((player) => taskProgress(room, player.id));
  const view = {
    mode: "classic",
    phase: room.phase,
    turnStage: adventurerTurnStage(room),
    endState: room.game.endState ? { ...room.game.endState } : null,
    round: room.game.round,
    currentPieceId: room.game.currentPieceId,
    currentPlayerId: isMummyPhase(room.phase)
      ? room.game.mummy.playerId
      : (currentPiece(room)?.controllerId || null),
    pieces,
    progress,
    lockedDiceCount: lockedDiceCount(room),
    lockedDice: room.game.dice.filter((die) => die.locked).map((die) => ({ id: die.id, kind: "normal" })),
    dicePoolSize: room.game.dice.length,
    forcedSkipReason: room.game.forcedSkipReason,
    lastPublicDie: room.game.lastPublicDie,
    mummy: { ...room.game.mummy },
    revealedTasks: room.game.revealedTasks.slice(),
    captureEvent: room.game.captureEvent ? { ...room.game.captureEvent } : null,
    winner: room.game.winner ? { ...room.game.winner } : null,
    dice: isMummyViewer ? null : room.game.dice.map((die) => ({ ...die })),
    hand: viewer?.role === "adventurer"
      ? (room.game.hands[viewer.id] || []).map((task) => ({ ...task }))
      : [],
    legal: { actions: [] }
  };
  addLegalView(room, viewer, view);
  return view;
}

function addLegalView(room, viewer, view) {
  if (!viewer || room.phase === PHASES.gameOver) return;
  const current = currentPiece(room);
  const isCurrent = viewer.role === "adventurer" && current?.controllerId === viewer.id;
  if (isCurrent && room.phase === PHASES.adventurerPrepare) {
    const locked = lockedDiceCount(room);
    view.legal.actions = locked === room.game.dice.length
      ? ["unlockDice"]
      : ["rollAdventurerDice", ...(locked > 0 ? ["unlockDice"] : [])];
  } else if (isCurrent && room.phase === PHASES.adventurerRoll) {
    view.legal.dieIds = legalDieIds(room);
    view.legal.actions = [
      "rollAdventurerDice",
      ...(view.legal.dieIds.length ? ["selectDie"] : [])
    ];
  } else if (isCurrent && room.phase === PHASES.adventurerAction && room.game.actionState?.kind === "numeric") {
    view.legal.actions = ["moveNumeric"];
    view.legal.paths = numericPaths(room, current, Number(room.game.selectedFace));
    view.legal.selectedFace = room.game.selectedFace;
  } else if (isCurrent && room.phase === PHASES.adventurerAction && room.game.actionState?.kind === "arrow") {
    view.legal.actions = ["moveArrow"];
    view.legal.directions = arrowMoves(room, current);
    view.legal.selectedFace = "arrow";
  } else if (isCurrent && room.phase === PHASES.adventurerEnd && room.game.endState?.kind === "treasure") {
    view.legal.actions = ["revealTreasure", "declineTreasure"];
    view.legal.treasures = room.game.pendingTreasureIds.map((id) => ({ id, position: treasurePosition(room, id) }));
  } else if (isCurrent && room.phase === PHASES.adventurerEnd && room.game.endState?.kind === "no_movement") {
    view.legal.actions = ["finishAdventurerTurn"];
  } else if (viewer.role === "mummy" && room.phase === PHASES.monsterPrepare) {
    view.legal.actions = ["rollMummyDie"];
  } else if (viewer.role === "mummy" && [PHASES.monsterAction, PHASES.monsterInterruptAction].includes(room.phase)) {
    view.legal.actions = ["moveMummy", "stopMummy"];
    view.legal.moves = mummyMoves(room);
  }
}

function adventurerTurnStage(room) {
  if (room.phase === PHASES.adventurerPrepare) return "prepare";
  if (room.phase === PHASES.adventurerRoll) return "roll";
  if (room.phase === PHASES.adventurerAction) return "action";
  if (room.phase === PHASES.adventurerEnd) return "end";
  return null;
}

function taskProgress(room, playerId) {
  const hand = room.game.hands[playerId] || [];
  const remainingByGroup = {};
  for (const group of Object.keys(MapFormat.GROUPS)) {
    remainingByGroup[group] = hand.filter((task) => task.id.startsWith(group) && !task.revealed).length;
  }
  return {
    playerId,
    total: hand.length,
    completed: hand.filter((task) => task.revealed).length,
    remainingByGroup
  };
}

function resetGame(room) {
  if (room.game?.mode === "hunt") return HuntEngine.resetGame(room);
  room.game = null;
}

function gameMap(room) {
  return room.game.map;
}

function gameGraph(room) {
  return room.game.graph;
}

function treasurePosition(room, id) {
  return gameMap(room).treasures.find((treasure) => treasure.id === id)?.position || null;
}

function currentPiece(room) {
  return room.game?.pieces[room.game.currentPieceId] || null;
}

function currentPieceName(room) {
  return pieceName(room, currentPiece(room));
}

function pieceName(room, piece) {
  if (!piece) return "冒險者";
  const player = room.players.find((candidate) => candidate.id === piece.controllerId);
  const suffix = room.settings.playerCount === 2 ? ` ${piece.ordinal}` : "";
  return `${player?.name || "冒險者"}${suffix}`;
}

function isCurrentAdventurer(room, actor) {
  return Boolean(actor && currentPiece(room)?.controllerId === actor.id);
}

function isMummy(room, actor) {
  return Boolean(actor && room.game.mummy.playerId === actor.id);
}

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

function lockedDiceCount(room) {
  return room.game.dice.filter((die) => die.locked).length;
}

function clearUnlockedDice(room) {
  room.game.dice.forEach((die) => {
    if (!die.locked) die.face = null;
  });
}

function clearAllDice(room) {
  room.game.dice.forEach((die) => {
    die.locked = false;
    die.face = null;
  });
}

function clearSelectedMove(room) {
  room.game.selectedDieId = null;
  room.game.selectedFace = null;
  room.game.actionState = null;
}

function occupiedAdventurerCells(room, excludedPieceId = null) {
  return new Set(Object.values(room.game.pieces)
    .filter((piece) => piece.id !== excludedPieceId && !piece.eliminated && isFloorPosition(room, piece.position))
    .map((piece) => piece.position));
}

function isFloorPosition(room, position) {
  return Boolean(position && !isSpecialPosition(position) && gameGraph(room).passages[position]);
}

function isSpecialPosition(position) {
  return position === "entrance" || position === "dungeon";
}

function specialAnchor(map, position) {
  return isSpecialPosition(position) ? map.zones[position].anchor : null;
}

function specialExits(map, position) {
  return isSpecialPosition(position) ? map.zones[position].exits : [];
}

function samePath(left, right) {
  return left.length === right.length && left.every((cell, index) => cell === right[index]);
}

function addLog(room, message) {
  room.log.push(message);
}

module.exports = {
  PHASES,
  PHASE_ACTIONS,
  ADVENTURER_FACES,
  MUMMY_TARGETS,
  setupGame,
  applyGameAction,
  makeGameView,
  resetGame,
  numericPaths,
  arrowMoves,
  mummyMoves,
  resolveAdventurerFaces,
  resolveMummyRoll
};
