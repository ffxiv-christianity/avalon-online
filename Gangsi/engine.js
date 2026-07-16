"use strict";

const { randomIntInclusive, shuffle } = require("../Shared/server/random");
const MapCatalog = require("./map-catalog");
const MapFormat = require("./map-format");
const HuntEngine = require("./hunt-engine");

const PHASES = Object.freeze({
  turnStart: "adventurer_turn_start",
  forcedSkip: "adventurer_forced_skip",
  interlude: "mummy_interlude_move",
  adventurerRoll: "adventurer_roll",
  numericMove: "adventurer_numeric_move",
  arrowMove: "adventurer_arrow_move",
  treasure: "treasure_decision",
  mummyRoll: "mummy_normal_roll",
  mummyMove: "mummy_normal_move",
  gameOver: "game_over"
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
    forcedSkipReason: null,
    pendingTreasureIds: [],
    pendingUnlock: null,
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
  switch (action) {
    case "keepLockedDice": return keepLockedDice(room, actor);
    case "unlockDice": return unlockDice(room, actor);
    case "skipAdventurerTurn": return skipAdventurerTurn(room, actor);
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

function keepLockedDice(room, actor) {
  if (room.phase !== PHASES.turnStart) return "現在不能保留鎖定骰。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  room.phase = PHASES.adventurerRoll;
  return null;
}

function unlockDice(room, actor) {
  if (room.phase !== PHASES.turnStart) return "現在不能解鎖骰子。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  const count = lockedDiceCount(room);
  if (!count) return "目前沒有鎖定骰。";
  beginInterlude(room, room.game.currentPieceId, count, false);
  return null;
}

function skipAdventurerTurn(room, actor) {
  if (room.phase !== PHASES.forcedSkip) return "現在不能略過冒險者回合。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  if (!room.game.forcedSkipReason) return "目前沒有必須略過回合的原因。";
  addLog(room, `${currentPieceName(room)} 略過回合。`);
  advanceAfterAdventurer(room);
  return null;
}

function rollAdventurerDice(room, actor) {
  if (room.phase !== PHASES.adventurerRoll) return "現在不能擲冒險者骰。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  const unlocked = room.game.dice.filter((die) => !die.locked);
  if (!unlocked.length) return "目前沒有可擲的骰子。";
  const faces = unlocked.map(() => ADVENTURER_FACES[randomIntInclusive(0, ADVENTURER_FACES.length - 1)]);
  resolveAdventurerFaces(room, faces);
  return null;
}

function resolveAdventurerFaces(room, faces) {
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
    beginForcedAdventurerSkip(room, "all_dice_locked");
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
  addLog(room, `${currentPieceName(room)} 選用了${die.face === "arrow" ? "箭頭" : die.face}骰。`);
  room.phase = die.face === "arrow" ? PHASES.arrowMove : PHASES.numericMove;
  return null;
}

function moveNumeric(room, actor, rawPath) {
  if (room.phase !== PHASES.numericMove) return "現在不能提交數字路徑。";
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
  if (room.phase !== PHASES.arrowMove) return "現在不能使用箭頭移動。";
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
  room.game.selectedDieId = null;
  room.game.selectedFace = null;
  const hand = room.game.hands[piece.controllerId] || [];
  room.game.pendingTreasureIds = hand
    .filter((task) => !task.revealed && treasurePosition(room, task.id) === piece.position)
    .map((task) => task.id);
  if (room.game.pendingTreasureIds.length) {
    room.phase = PHASES.treasure;
    return;
  }
  advanceAfterAdventurer(room);
}

function revealTreasure(room, actor) {
  if (room.phase !== PHASES.treasure) return "現在沒有可揭露的寶藏。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
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
  if (room.phase !== PHASES.treasure) return "現在沒有可略過的寶藏。";
  if (!isCurrentAdventurer(room, actor)) return "現在不是你的回合。";
  room.game.pendingTreasureIds = [];
  advanceAfterAdventurer(room);
  return null;
}

function rollMummyDie(room, actor) {
  if (room.phase !== PHASES.mummyRoll) return "現在不能擲提燈怪骰。";
  if (!isMummy(room, actor)) return "現在不是你的回合。";
  const value = MUMMY_FACES[randomIntInclusive(0, MUMMY_FACES.length - 1)];
  resolveMummyRoll(room, value);
  return null;
}

function resolveMummyRoll(room, value) {
  if (![1, 2, 3].includes(Number(value))) throw new Error("Invalid Gangsi mummy roll");
  room.game.mummy.roll = Number(value);
  room.game.mummy.remaining = Number(value) + lockedDiceCount(room);
  room.game.mummy.moveKind = "normal";
  room.phase = PHASES.mummyMove;
  addLog(room, `提燈怪擲出 ${value}，最多可移動 ${room.game.mummy.remaining} 步。`);
}

function moveMummy(room, actor, rawCell) {
  if (![PHASES.interlude, PHASES.mummyMove].includes(room.phase)) return "現在不能移動提燈怪。";
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
  if (![PHASES.interlude, PHASES.mummyMove].includes(room.phase)) return "現在不能停止提燈怪移動。";
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
    const pieceId = room.game.pendingUnlock?.pieceId;
    clearAllDice(room);
    room.game.pendingUnlock = null;
    const piece = room.game.pieces[pieceId];
    if (!piece || piece.eliminated) {
      advanceAfterAdventurer(room);
      return;
    }
    room.game.turnIndex = room.game.adventurerOrder.indexOf(pieceId);
    room.game.currentPieceId = pieceId;
    if (!hasAnyAdventurerMove(room, piece)) {
      beginForcedAdventurerSkip(room, "no_legal_move");
      return;
    }
    room.phase = PHASES.adventurerRoll;
    return;
  }
  room.game.round += 1;
  beginAdventurerAtIndex(room, 0);
}

function beginInterlude(room, pieceId, count, automatic) {
  room.game.forcedSkipReason = null;
  room.game.pendingUnlock = { pieceId, count };
  room.game.mummy.roll = null;
  room.game.mummy.remaining = count;
  room.game.mummy.moveKind = "interlude";
  room.phase = PHASES.interlude;
  addLog(room, automatic
    ? `${pieceName(room, room.game.pieces[pieceId])} 已無可用骰子，系統自動解鎖 ${count} 顆骰子，並進入提燈怪的插入回合。`
    : `${pieceName(room, room.game.pieces[pieceId])} 解鎖 ${count} 顆骰子，提燈怪取得插入回合。`);
}

function beginForcedAdventurerSkip(room, reason) {
  room.game.forcedSkipReason = reason;
  room.phase = PHASES.forcedSkip;
  addLog(room, reason === "all_dice_locked"
    ? `${currentPieceName(room)} 的五顆骰子全部鎖定，沒有可用骰子，只能略過回合。`
    : `${currentPieceName(room)} 沒有任何合法移動，只能略過回合。`);
}

function advanceAfterAdventurer(room) {
  const currentIndex = room.game.adventurerOrder.indexOf(room.game.currentPieceId);
  clearUnlockedDice(room);
  room.game.selectedDieId = null;
  room.game.selectedFace = null;
  room.game.forcedSkipReason = null;
  room.game.pendingTreasureIds = [];
  beginAdventurerAtIndex(room, currentIndex >= 0 ? currentIndex + 1 : room.game.turnIndex + 1);
}

function beginAdventurerAtIndex(room, startIndex) {
  const order = room.game.adventurerOrder;
  for (let index = startIndex; index < order.length; index += 1) {
    const piece = room.game.pieces[order[index]];
    if (!piece || piece.eliminated) continue;
    room.game.turnIndex = index;
    room.game.currentPieceId = piece.id;
    if (!hasAnyAdventurerMove(room, piece)) {
      beginForcedAdventurerSkip(room, "no_legal_move");
      return;
    }
    const locked = lockedDiceCount(room);
    if (locked === room.game.dice.length) {
      beginInterlude(room, piece.id, locked, true);
      return;
    }
    room.game.forcedSkipReason = null;
    room.phase = locked > 0 ? PHASES.turnStart : PHASES.adventurerRoll;
    addLog(room, `輪到 ${pieceName(room, piece)}。`);
    return;
  }
  room.game.currentPieceId = null;
  room.game.turnIndex = order.length;
  room.game.forcedSkipReason = null;
  room.game.mummy.roll = null;
  room.game.mummy.remaining = 0;
  room.game.mummy.moveKind = null;
  room.phase = PHASES.mummyRoll;
  addLog(room, "輪到提燈怪的正常回合。");
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
    phase: room.phase,
    round: room.game.round,
    currentPieceId: room.game.currentPieceId,
    currentPlayerId: isMummyPhase(room.phase)
      ? room.game.mummy.playerId
      : (currentPiece(room)?.controllerId || null),
    pieces,
    progress,
    lockedDiceCount: lockedDiceCount(room),
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
  if (isCurrent && room.phase === PHASES.forcedSkip) {
    view.legal.actions = ["skipAdventurerTurn"];
  } else if (isCurrent && room.phase === PHASES.turnStart) {
    view.legal.actions = ["keepLockedDice", "unlockDice"];
  } else if (isCurrent && room.phase === PHASES.adventurerRoll) {
    view.legal.dieIds = legalDieIds(room);
    view.legal.actions = [
      "rollAdventurerDice",
      ...(view.legal.dieIds.length ? ["selectDie"] : [])
    ];
  } else if (isCurrent && room.phase === PHASES.numericMove) {
    view.legal.actions = ["moveNumeric"];
    view.legal.paths = numericPaths(room, current, Number(room.game.selectedFace));
    view.legal.selectedFace = room.game.selectedFace;
  } else if (isCurrent && room.phase === PHASES.arrowMove) {
    view.legal.actions = ["moveArrow"];
    view.legal.directions = arrowMoves(room, current);
    view.legal.selectedFace = "arrow";
  } else if (isCurrent && room.phase === PHASES.treasure) {
    view.legal.actions = ["revealTreasure", "declineTreasure"];
    view.legal.treasures = room.game.pendingTreasureIds.map((id) => ({ id, position: treasurePosition(room, id) }));
  } else if (viewer.role === "mummy" && room.phase === PHASES.mummyRoll) {
    view.legal.actions = ["rollMummyDie"];
  } else if (viewer.role === "mummy" && [PHASES.interlude, PHASES.mummyMove].includes(room.phase)) {
    view.legal.actions = ["moveMummy", "stopMummy"];
    view.legal.moves = mummyMoves(room);
  }
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
  return [PHASES.interlude, PHASES.mummyRoll, PHASES.mummyMove].includes(phase);
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
