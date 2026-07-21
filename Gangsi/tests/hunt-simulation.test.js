"use strict";

const assert = require("assert");
const Game = require("../game");
const Engine = require("../engine");
const Hunt = require("../hunt-engine");
const MapCatalog = require("../map-catalog");
const MapFormat = require("../map-format");
const classic = require("../maps/classic.json");

const RUNS = 10;
const MAX_ACTIONS = 3000;

function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function choose(values, random) {
  assert(values.length);
  return values[Math.floor(random() * values.length)];
}

function fixtureMap() {
  const map = MapFormat.normalizeMap(classic);
  map.id = "hunt-simulation";
  map.hunt.mechanisms = { A: "4,1", B: "5,2" };
  assert.strictEqual(MapFormat.validateHuntMap(map).valid, true);
  return map;
}

function setup(run) {
  const random = randomSource(0xa53c9e11 ^ run);
  const { room, player: first } = Game.makeRoom(`H${run}-1`, `HS${run}`);
  const second = Game.joinRoom(room, `H${run}-2`).player;
  const mummy = Game.joinRoom(room, `H${run}-M`).player;
  const professions = ["knight", "engineer", "doctor", "wizard"];
  first.role = second.role = "adventurer";
  mummy.role = "mummy";
  first.profession = professions.splice(Math.floor(random() * professions.length), 1)[0];
  second.profession = professions.splice(Math.floor(random() * professions.length), 1)[0];
  mummy.mummyType = ["trap", "invisible", "knife"][run % 3];
  first.tokenLabel = "甲";
  second.tokenLabel = "乙";
  room.settings = { mode: "hunt", playerCount: 3, mapId: "hunt-simulation", randomMap: false };
  const originalGetMap = MapCatalog.getBuiltInMap;
  MapCatalog.getBuiltInMap = () => MapFormat.clone(fixtureMap());
  try {
    Engine.setupGame(room);
  } finally {
    MapCatalog.getBuiltInMap = originalGetMap;
  }
  return { room, players: [first, second, mummy], mummy, random };
}

function graphDistance(room, start, targets) {
  if (targets.includes(start)) return 0;
  const visited = new Set([start]);
  const queue = [[start, 0]];
  while (queue.length) {
    const [cell, distance] = queue.shift();
    for (const next of room.game.graph.passages[cell] || []) {
      if (visited.has(next)) continue;
      if (targets.includes(next)) return distance + 1;
      visited.add(next);
      queue.push([next, distance + 1]);
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

function chaseMove(room, legalMoves, random) {
  const targets = Object.values(room.game.pieces)
    .filter((piece) => !piece.eliminated && !piece.escaped)
    .flatMap((piece) => {
      if (piece.position === "entrance") return room.game.map.zones.entrance.exits;
      if (piece.position === "dungeon") return room.game.map.zones.dungeon.exits;
      return [piece.position];
    })
    .filter((cell) => room.game.graph.passages[cell]);
  const ranked = legalMoves.map((cell) => ({ cell, distance: graphDistance(room, cell, targets), tie: random() }));
  ranked.sort((left, right) => left.distance - right.distance || left.tie - right.tie);
  return ranked[0].cell;
}

function assertBoundaries(room, players, mummy) {
  const mummyView = Game.makeView(room, mummy.id).room.game;
  if (!mummyView.hunt.trackingReveal) assert(mummyView.pieces.every((piece) => !Object.hasOwn(piece, "position")));
  assert.strictEqual(mummyView.dice, null);
  assert.deepStrictEqual(mummyView.progress, []);
  for (const player of players.filter((candidate) => candidate.role === "adventurer")) {
    const view = Game.makeView(room, player.id).room.game;
    assert(view.pieces.every((piece) => Object.hasOwn(piece, "position")));
    assert.deepStrictEqual(view.hand.map((task) => task.id).sort(), room.game.hands[player.id].map((task) => task.id).sort());
  }
}

function runSimulation(run) {
  const { room, players, mummy, random } = setup(run);
  for (let count = 0; count < MAX_ACTIONS; count += 1) {
    if (count % 100 === 0) assertBoundaries(room, players, mummy);
    if (room.phase === Hunt.PHASES.gameOver) {
      assertBoundaries(room, players, mummy);
      assert(["mummy", "adventurer"].includes(room.game.winner.role));
      return count;
    }
    const currentPlayerId = Hunt.makeGameView(room, mummy).currentPlayerId;
    const actor = players.find((player) => player.id === currentPlayerId);
    assert(actor, `missing actor in ${room.phase}`);
    const view = Hunt.makeGameView(room, actor);
    const actions = view.legal.actions;
    assert(actions.length, `no legal action in ${room.phase}`);
    assert(actions.every((action) => Hunt.PHASE_ACTIONS[room.phase]?.includes(action)), `phase whitelist mismatch in ${room.phase}`);
    let error = null;
    if (actions.includes("skipAdventurerTurn")) error = Hunt.applyGameAction(room, actor, "skipAdventurerTurn");
    else if (actions.includes("finishAdventurerTurn")) error = Hunt.applyGameAction(room, actor, "finishAdventurerTurn");
    else if (room.phase === Hunt.PHASES.adventurerPrepare) {
      if (actions.includes("activateMechanism") && random() < 0.3) {
        error = Hunt.applyGameAction(room, actor, "activateMechanism", { gateId: choose(view.legal.mechanisms, random) });
      } else {
        const action = actions.includes("rollAdventurerDice") ? "rollAdventurerDice" : "unlockDice";
        error = Hunt.applyGameAction(room, actor, action);
      }
    } else if (room.phase === Hunt.PHASES.adventurerRoll && view.legal.dieIds?.length && random() < 0.8) {
      error = Hunt.applyGameAction(room, actor, "selectDie", { dieId: choose(view.legal.dieIds, random) });
    } else if (actions.includes("rollAdventurerDice")) error = Hunt.applyGameAction(room, actor, "rollAdventurerDice");
    else if (actions.includes("moveNumeric")) error = Hunt.applyGameAction(room, actor, "moveNumeric", { path: choose(view.legal.paths, random) });
    else if (actions.includes("moveArrow")) error = Hunt.applyGameAction(room, actor, "moveArrow", { direction: choose(Object.keys(view.legal.directions), random) });
    else if (actions.includes("revealTreasure")) error = Hunt.applyGameAction(room, actor, random() < 0.75 ? "revealTreasure" : "declineTreasure");
    else if (room.phase === Hunt.PHASES.monsterPrepare) error = Hunt.applyGameAction(room, actor, "rollMummyDie");
    else if (actions.includes("rollMummyDie")) error = Hunt.applyGameAction(room, actor, "rollMummyDie");
    else if (actions.includes("moveMummy")) {
      const moves = view.legal.moves || [];
      error = moves.length
        ? Hunt.applyGameAction(room, actor, "moveMummy", { cell: chaseMove(room, moves, random) })
        : Hunt.applyGameAction(room, actor, "stopMummy");
    } else throw new Error(`unhandled Hunt action set: ${actions.join(",")}`);
    assert.strictEqual(error, null, `action failed in ${room.phase}: ${error}`);
  }
  throw new Error(`Hunt simulation ${run} exceeded ${MAX_ACTIONS} actions`);
}

let totalActions = 0;
for (let run = 1; run <= RUNS; run += 1) totalActions += runSimulation(run);
console.log(`Gangsi Hunt randomized full-game tests passed (${RUNS} runs, ${totalActions} actions)`);
