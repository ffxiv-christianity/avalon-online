"use strict";

const assert = require("assert");
const {
  PLAYER_COUNTS,
  mapOptions,
  makeRoom,
  joinRoom,
  applyRoomAction,
  makeView
} = require("../game");
const Engine = require("../engine");

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
  assert(values.length, "random simulation cannot choose from an empty list");
  return values[Math.floor(random() * values.length)];
}

function setupRun(run, playerCount, mapId) {
  const { room, player: host } = makeRoom(`Run${run}-P1`, `SIM${run}`);
  assert.strictEqual(applyRoomAction(room, host, "updateSettings", {
    playerCount,
    mapId,
    randomMap: false
  }), null);
  const players = [host];
  for (let index = 1; index < playerCount; index += 1) {
    const joined = joinRoom(room, `Run${run}-P${index + 1}`);
    assert.ifError(joined.error);
    players.push(joined.player);
  }
  const mummy = players.at(-1);
  assert.strictEqual(applyRoomAction(room, mummy, "chooseRole", { role: "mummy" }), null);
  players.filter((player) => player !== mummy).forEach((player, index) => {
    assert.strictEqual(applyRoomAction(room, player, "updateTokenLabel", {
      tokenLabel: String.fromCodePoint(65 + index)
    }), null);
    assert.strictEqual(applyRoomAction(room, player, "roll"), null);
  });
  players.forEach((player) => assert.strictEqual(applyRoomAction(room, player, "toggleReady"), null));
  assert.strictEqual(applyRoomAction(room, host, "startGame"), null);
  return { room, players, mummy };
}

function assertViewBoundary(room, players, mummy) {
  const mummyView = makeView(room, mummy.id).room.game;
  assert.strictEqual(mummyView.dice, null);
  assert.deepStrictEqual(mummyView.hand, []);
  assert(mummyView.pieces.every((piece) => !Object.hasOwn(piece, "position")));
  assert(!Object.hasOwn(mummyView.legal, "paths"));
  assert(!Object.hasOwn(mummyView.legal, "directions"));

  for (const player of players.filter((candidate) => candidate.role === "adventurer")) {
    const view = makeView(room, player.id).room.game;
    assert(view.pieces.every((piece) => Object.hasOwn(piece, "position")));
    assert.deepStrictEqual(
      view.hand.map((task) => task.id).sort(),
      room.game.hands[player.id].map((task) => task.id).sort()
    );
    if (view.currentPlayerId !== player.id) assert.deepStrictEqual(view.legal.actions, []);
  }

  assert.strictEqual(mummyView.lockedDiceCount, room.game.dice.filter((die) => die.locked).length);
}

function assertStateInvariants(room) {
  if (room.game.currentPieceId) {
    assert.strictEqual(
      room.game.turnIndex,
      room.game.adventurerOrder.indexOf(room.game.currentPieceId),
      "turnIndex must match currentPieceId"
    );
  }
  assert.strictEqual(new Set(room.game.revealedTasks.map((task) => task.id)).size, room.game.revealedTasks.length);
  Object.values(room.game.pieces).forEach((piece) => {
    assert(piece.life >= 0 && piece.life <= 3);
    if (piece.eliminated) assert.strictEqual(piece.position, null);
  });
}

function currentActor(room) {
  if ([Engine.PHASES.interlude, Engine.PHASES.mummyRoll, Engine.PHASES.mummyMove].includes(room.phase)) {
    return room.players.find((player) => player.id === room.game.mummy.playerId);
  }
  const piece = room.game.pieces[room.game.currentPieceId];
  return room.players.find((player) => player.id === piece?.controllerId);
}

function targetCells(view) {
  const positions = new Map(view.selectedMap.treasures.map((treasure) => [treasure.id, treasure.position]));
  return new Set(view.game.hand.filter((task) => !task.revealed).map((task) => positions.get(task.id)).filter(Boolean));
}

function distanceToTargets(cell, targets) {
  if (!cell || !targets.size) return 0;
  const [x, y] = cell.split(",").map(Number);
  return Math.min(...[...targets].map((target) => {
    const [targetX, targetY] = target.split(",").map(Number);
    return Math.abs(x - targetX) + Math.abs(y - targetY);
  }));
}

function bestByDestination(candidates, destination, targets, random) {
  const scored = candidates.map((candidate) => ({
    candidate,
    score: distanceToTargets(destination(candidate), targets),
    tie: random()
  }));
  scored.sort((left, right) => left.score - right.score || left.tie - right.tie);
  return scored[0].candidate;
}

function runGame(run, playerCount, mapId, coverage) {
  const random = randomSource(0x9e3779b9 ^ run);
  const { room, players, mummy } = setupRun(run, playerCount, mapId);
  const rerolls = new Map();

  for (let actionCount = 0; actionCount < MAX_ACTIONS; actionCount += 1) {
    assertStateInvariants(room);
    if (actionCount % 100 === 0) assertViewBoundary(room, players, mummy);
    coverage.phases.add(room.phase);
    if (room.phase === Engine.PHASES.gameOver) {
      assertViewBoundary(room, players, mummy);
      coverage.winners.add(room.game.winner.role);
      return actionCount;
    }

    const actor = currentActor(room);
    assert(actor, `run ${run} has no actor during ${room.phase}`);
    const actorView = makeView(room, actor.id);
    const game = actorView.room.game;
    assert.strictEqual(game.currentPlayerId, actor.id);
    const legal = actorView.room.game.legal;
    let action;
    let payload = {};

    if (room.phase === Engine.PHASES.turnStart) {
      action = !coverage.actions.has("unlockDice")
        ? "unlockDice"
        : !coverage.actions.has("keepLockedDice")
          ? "keepLockedDice"
          : random() < 0.5 ? "unlockDice" : "keepLockedDice";
    } else if (room.phase === Engine.PHASES.adventurerRoll) {
      const key = `${game.round}:${game.currentPieceId}`;
      const attempts = rerolls.get(key) || 0;
      const selectable = legal.dieIds || [];
      if (selectable.length && (attempts >= 2 || random() < 0.7)) {
        const dice = actorView.room.game.dice.filter((die) => selectable.includes(die.id));
        const preferred = !coverage.phases.has(Engine.PHASES.arrowMove)
          ? dice.filter((die) => die.face === "arrow")
          : !coverage.phases.has(Engine.PHASES.numericMove)
            ? dice.filter((die) => die.face !== "arrow")
            : [];
        const die = choose(preferred.length ? preferred : dice, random);
        action = "selectDie";
        payload = { dieId: die.id };
        rerolls.delete(key);
      } else {
        action = "rollAdventurerDice";
        rerolls.set(key, attempts + 1);
      }
    } else if (room.phase === Engine.PHASES.numericMove) {
      const targets = targetCells(actorView.room);
      const path = bestByDestination(legal.paths, (candidate) => candidate.at(-1), targets, random);
      action = "moveNumeric";
      payload = { path };
    } else if (room.phase === Engine.PHASES.arrowMove) {
      const targets = targetCells(actorView.room);
      const moves = Object.values(legal.directions);
      const move = bestByDestination(moves, (candidate) => candidate.end, targets, random);
      action = "moveArrow";
      payload = { direction: move.direction };
    } else if (room.phase === Engine.PHASES.treasure) {
      action = coverage.actions.has("declineTreasure") ? "revealTreasure" : "declineTreasure";
    } else if (room.phase === Engine.PHASES.mummyRoll) {
      action = "rollMummyDie";
    } else if ([Engine.PHASES.interlude, Engine.PHASES.mummyMove].includes(room.phase)) {
      const moves = legal.moves || [];
      if (!moves.length || !coverage.actions.has("stopMummy") || random() < 0.08) {
        action = "stopMummy";
      } else {
        action = "moveMummy";
        payload = { cell: choose(moves, random) };
      }
    } else {
      assert.fail(`run ${run} reached unsupported phase ${room.phase}`);
    }

    assert(legal.actions.includes(action), `run ${run}: ${action} was not legal during ${room.phase}`);
    const previousVersion = room.version;
    const error = applyRoomAction(room, actor, action, payload);
    assert.strictEqual(error, null, `run ${run}: ${action} failed during ${room.phase}: ${error}`);
    assert(room.version > previousVersion, `run ${run}: ${action} did not advance room version`);
    coverage.actions.add(action);
  }

  assert.fail(`run ${run} exceeded ${MAX_ACTIONS} actions without a winner`);
}

const maps = mapOptions();
assert(maps.length, "Gangsi simulation requires at least one map from maps/index.json");
const coverage = { phases: new Set(), actions: new Set(), winners: new Set() };
const completedActions = [];
for (let run = 1; run <= RUNS; run += 1) {
  const playerCount = PLAYER_COUNTS[(run - 1) % PLAYER_COUNTS.length];
  const map = maps[(run - 1) % maps.length];
  completedActions.push(runGame(run, playerCount, map.id, coverage));
}

for (const phase of Object.values(Engine.PHASES)) {
  assert(coverage.phases.has(phase), `random simulations did not cover phase ${phase}`);
}
for (const action of [
  "unlockDice",
  "keepLockedDice",
  "rollAdventurerDice",
  "selectDie",
  "moveNumeric",
  "moveArrow",
  "revealTreasure",
  "declineTreasure",
  "rollMummyDie",
  "moveMummy",
  "stopMummy"
]) {
  assert(coverage.actions.has(action), `random simulations did not cover action ${action}`);
}
assert(completedActions.every((count) => count < MAX_ACTIONS));

const totalActions = completedActions.reduce((sum, count) => sum + count, 0);
console.log(`Gangsi randomized full-game tests passed (${RUNS} runs, ${totalActions} actions)`);
