"use strict";

const MODES = new Set(["classic", "hunt"]);
const MAP_SELECTIONS = new Set(["fixed", "random"]);
const MAP_IDS = new Set(["classic", "test-map"]);
const WINNERS = new Set(["adventurer", "mummy"]);
const OUTCOMES = Object.freeze({
  classic_adventurer_completed: { mode: "classic", winner: "adventurer" },
  classic_mummy_life_tokens: { mode: "classic", winner: "mummy" },
  hunt_adventurer_escape: { mode: "hunt", winner: "adventurer" },
  hunt_mummy_elimination: { mode: "hunt", winner: "mummy" }
});

function configuredIds(context) {
  return (context.config?.players || context.players || []).map((player) => String(player.id));
}

function sameMembers(left, right) {
  return JSON.stringify([...(left || [])].map(String).sort())
    === JSON.stringify([...(right || [])].map(String).sort());
}

function validateSettings(value, context, errors) {
  const settings = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const allowed = new Set(["mode", "mapSelection", "mapId"]);
  Object.keys(settings).forEach((key) => {
    if (!allowed.has(key)) errors.push(`Unknown Gangsi gameSettings field: ${key}.`);
  });
  const mode = String(settings.mode || "classic");
  const mapSelection = String(settings.mapSelection || "fixed");
  const mapId = settings.mapId === undefined || settings.mapId === null || settings.mapId === ""
    ? null
    : String(settings.mapId);
  if (!MODES.has(mode)) errors.push("Gangsi mode must be classic or hunt.");
  if (!MAP_SELECTIONS.has(mapSelection)) errors.push("Gangsi mapSelection must be fixed or random.");
  if (mapId !== null && !MAP_IDS.has(mapId)) errors.push("Gangsi mapId must be classic or test-map.");
  if (mode === "classic" && (context.playerCount < 2 || context.playerCount > 5)) {
    errors.push("Gangsi classic mode requires 2-5 players.");
  }
  if (mode === "hunt" && (context.playerCount < 3 || context.playerCount > 5)) {
    errors.push("Gangsi Hunt mode requires 3-5 players.");
  }
  if (mapSelection === "fixed" && mapId === null) {
    errors.push("Gangsi fixed map selection requires a visible mapId.");
  }
  if (mapSelection === "random" && mapId !== null) {
    errors.push("Gangsi random map selection must not declare the resolved mapId before start.");
  }
  return { mode, mapSelection, mapId };
}

function resolvePurpose(purpose, context, errors) {
  if (purpose.scenarioIds.length) errors.push("The Gangsi Adapter does not declare targeted scenarios.");
  const mode = context.gameSettings?.mode || context.config?.gameSettings?.mode;
  const expectedJourney = mode === "hunt"
    ? "create_join_complete_hunt_game"
    : "create_join_complete_classic_game";
  if (purpose.approach !== "exploratory" && !purpose.journeyIds.includes(expectedJourney)) {
    errors.push(`Gangsi ${mode || "classic"} natural runs must include ${expectedJourney}.`);
  }
  return purpose;
}

function validateEvidence(event, label, context, errors) {
  if (event.source !== "visible_dom" || event.contentClass !== "public_ui"
    || !String(event.evidenceId || "").trim() || !String(event.evidenceText || "").trim()) {
    errors.push(`${label} requires visible_dom public_ui evidence with evidenceId and evidenceText.`);
  }
  const expected = configuredIds(context);
  if (!sameMembers(event.visibleToPlayerIds, expected)) {
    errors.push(`${label} must be visible to every configured player.`);
  }
}

function validatePublicEvent(kind, event, context, errors) {
  if (kind !== "timeline" || !String(event.type || "").startsWith("gangsi_")) return;
  validateEvidence(event, event.type, context, errors);
  if (!Number.isInteger(event.gameIndex) || event.gameIndex < 1) {
    errors.push(`${event.type} requires a positive gameIndex.`);
  }
  const playerIds = configuredIds(context);
  const validPlayer = (id) => playerIds.includes(String(id));
  if (event.type === "gangsi_settings_verified") {
    const settingsErrors = [];
    const resolved = validateSettings(event.settings, {
      playerCount: context.config?.playerCount,
      players: context.config?.players,
      config: context.config
    }, settingsErrors);
    errors.push(...settingsErrors.map((message) => `gangsi_settings_verified: ${message}`));
    if (JSON.stringify(resolved) !== JSON.stringify(context.config?.gameSettings)) {
      errors.push("gangsi_settings_verified settings differ from the resolved config.");
    }
    if (!sameMembers(event.rosterOrder, playerIds)) {
      errors.push("gangsi_settings_verified.rosterOrder must contain every configured player exactly once.");
    }
    if (!String(event.selectionSource || "").trim() || !String(event.rationale || "").trim()) {
      errors.push("gangsi_settings_verified requires selectionSource and rationale.");
    }
  }
  if (event.type === "gangsi_game_setup") {
    if (!MODES.has(String(event.mode || "")) || !MAP_SELECTIONS.has(String(event.mapSelection || ""))
      || !MAP_IDS.has(String(event.mapId || "")) || !String(event.mapName || "").trim()) {
      errors.push("gangsi_game_setup requires a visible mode, map selection, map id, and map name.");
    }
    if (event.playerCount !== playerIds.length || !validPlayer(event.mummyPlayerId)
      || !sameMembers(event.adventurerPlayerIds, playerIds.filter((id) => id !== event.mummyPlayerId))) {
      errors.push("gangsi_game_setup player composition is inconsistent with the configured roster.");
    }
    if (event.mode === "hunt") {
      if (!event.professionByPlayerId || !sameMembers(Object.keys(event.professionByPlayerId), event.adventurerPlayerIds)
        || !String(event.mummyType || "").trim()) {
        errors.push("Hunt setup requires one visible profession per adventurer and a visible mummy type.");
      }
    }
  }
  if (event.type === "gangsi_turn_completed") {
    if (!Number.isInteger(event.turnIndex) || event.turnIndex < 1 || !validPlayer(event.actorId)
      || !["adventurer", "mummy"].includes(String(event.actorKind || ""))
      || !String(event.phaseId || "").trim() || !String(event.publicAction || "").trim()) {
      errors.push("gangsi_turn_completed requires a positive turn, configured actor, actorKind, phaseId, and publicAction.");
    }
  }
  if (event.type === "gangsi_objective_checkpoint") {
    if (!MODES.has(String(event.mode || "")) || !Number.isInteger(event.teamTreasures)
      || event.teamTreasures < 0 || !Number.isInteger(event.teamTreasureTarget)
      || event.teamTreasureTarget < 1 || !Number.isInteger(event.mummyScore) || event.mummyScore < 0) {
      errors.push("gangsi_objective_checkpoint has invalid public progress totals.");
    }
  }
  if (event.type === "gangsi_terminal_settled") {
    const outcome = OUTCOMES[String(event.outcomeId || "")];
    if (!outcome || event.mode !== outcome.mode || event.winnerSide !== outcome.winner
      || !validPlayer(event.winnerPlayerId) || !MAP_IDS.has(String(event.mapId || ""))
      || !String(event.summary || "").trim()) {
      errors.push("gangsi_terminal_settled has an inconsistent visible outcome.");
    }
  }
  if (event.type === "gangsi_returned_to_lobby" && event.readyReset !== true) {
    errors.push("gangsi_returned_to_lobby requires visible readyReset true.");
  }
}

function validateResult(result, context, errors) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    errors.push(`Game ${context.gameIndex} Gangsi result must be an object.`);
    return;
  }
  const outcome = OUTCOMES[String(result.outcomeId || "")];
  if (!outcome) errors.push(`Game ${context.gameIndex} Gangsi result has an unknown outcomeId.`);
  if (!MODES.has(String(result.mode || "")) || !WINNERS.has(String(result.winner || ""))) {
    errors.push(`Game ${context.gameIndex} Gangsi result requires a valid mode and winner.`);
  }
  if (outcome && (result.mode !== outcome.mode || result.winner !== outcome.winner)) {
    errors.push(`Game ${context.gameIndex} Gangsi mode/winner do not match outcomeId.`);
  }
  const playerIds = configuredIds(context);
  if (!playerIds.includes(String(result.winnerPlayerId || ""))) {
    errors.push(`Game ${context.gameIndex} Gangsi winnerPlayerId is not configured.`);
  }
  if (!MAP_IDS.has(String(result.mapId || "")) || !String(result.mapName || "").trim()
    || !String(result.summary || "").trim()) {
    errors.push(`Game ${context.gameIndex} Gangsi result requires mapId, mapName, and summary.`);
  }
  if (result.mode === "classic") {
    if (!result.classic || result.hunt !== null || !Number.isInteger(result.classic.mummyScore)
      || !Number.isInteger(result.classic.mummyTarget) || result.classic.mummyTarget < 1) {
      errors.push(`Game ${context.gameIndex} classic result requires classic public totals and hunt null.`);
    } else if (result.winner === "mummy" && result.classic.mummyScore < result.classic.mummyTarget) {
      errors.push(`Game ${context.gameIndex} classic mummy winner lacks the visible life-token target.`);
    } else if (result.winner === "adventurer"
      && (result.classic.winnerCompletedTasks !== result.classic.winnerTotalTasks
        || result.classic.winnerTotalTasks < 1)) {
      errors.push(`Game ${context.gameIndex} classic adventurer winner lacks complete visible tasks.`);
    }
  }
  if (result.mode === "hunt") {
    const hunt = result.hunt;
    if (result.classic !== null || !hunt || !Array.isArray(hunt.adventurerResults)
      || !hunt.mummyResult || !Number.isInteger(hunt.escapedCount) || !Number.isInteger(hunt.deadCount)) {
      errors.push(`Game ${context.gameIndex} Hunt result requires Hunt rows and classic null.`);
      return;
    }
    const adventurerIds = hunt.adventurerResults.map((item) => String(item.playerId));
    const mummyId = String(hunt.mummyResult.playerId || "");
    if (!playerIds.includes(mummyId)
      || !sameMembers(adventurerIds, playerIds.filter((id) => id !== mummyId))
      || hunt.escapedCount + hunt.deadCount !== adventurerIds.length
      || hunt.adventurerResults.some((item) => !["escaped", "dead"].includes(String(item.outcome || "")))) {
      errors.push(`Game ${context.gameIndex} Hunt terminal rows do not match the configured roster.`);
    }
    if ((result.winner === "adventurer" && hunt.escapedCount < 1)
      || (result.winner === "mummy" && hunt.escapedCount !== 0)) {
      errors.push(`Game ${context.gameIndex} Hunt winner does not match visible escape totals.`);
    }
  }
}

function auditRun(context, errors) {
  const { config, timeline } = context;
  for (let gameIndex = 1; gameIndex <= config.gamesToPlay; gameIndex += 1) {
    const byType = (type) => timeline.filter((event) => event.type === type && event.gameIndex === gameIndex);
    const settings = byType("gangsi_settings_verified");
    const setups = byType("gangsi_game_setup");
    const turns = byType("gangsi_turn_completed");
    const terminals = byType("gangsi_terminal_settled");
    const returns = byType("gangsi_returned_to_lobby");
    if (settings.length !== 1) errors.push(`Game ${gameIndex} requires exactly one gangsi_settings_verified event.`);
    if (setups.length !== 1) errors.push(`Game ${gameIndex} requires exactly one gangsi_game_setup event.`);
    if (terminals.length !== 1) errors.push(`Game ${gameIndex} requires exactly one gangsi_terminal_settled event.`);
    if (returns.length !== 1) errors.push(`Game ${gameIndex} requires exactly one gangsi_returned_to_lobby event.`);
    const actorIds = [...new Set(turns.map((event) => String(event.actorId)))];
    if (!sameMembers(actorIds, configuredIds({ config }))) {
      errors.push(`Game ${gameIndex} requires at least one visible completed turn for every configured player.`);
    }
    turns.forEach((event, index) => {
      if (event.turnIndex !== index + 1) errors.push(`Game ${gameIndex} turn evidence must be contiguous from one.`);
    });
    const resultDetail = timeline.find((event) => event.type === "result_detail" && event.gameIndex === gameIndex);
    if (!resultDetail?.result || terminals.length !== 1) {
      errors.push(`Game ${gameIndex} is missing the normalized Gangsi result or terminal settlement.`);
      continue;
    }
    const terminal = terminals[0];
    const result = resultDetail.result;
    if (terminal.outcomeId !== result.outcomeId || terminal.mode !== result.mode
      || terminal.winnerSide !== result.winner || terminal.winnerPlayerId !== result.winnerPlayerId
      || terminal.mapId !== result.mapId || terminal.summary !== result.summary) {
      errors.push(`Game ${gameIndex} normalized result differs from the visible Gangsi terminal settlement.`);
    }
    if (setups.length === 1 && (setups[0].mode !== result.mode || setups[0].mapId !== result.mapId)) {
      errors.push(`Game ${gameIndex} terminal mode/map differ from visible setup.`);
    }
  }
}

module.exports = {
  id: "gangsi",
  contractVersion: "2.2",
  validateSettings,
  resolvePurpose,
  validatePublicEvent,
  validateResult,
  auditRun,
  timingIntents: [],
  postTerminalEventTypes: [],
  visibleTerminalMarkerTypes: [],
  resultDisclosureKeys: [],
  publicTimelineFields: {
    gangsi_settings_verified: ["gameIndex", "settings", "selectionSource", "rationale", "rosterOrder", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    gangsi_game_setup: ["gameIndex", "mode", "mapSelection", "mapId", "mapName", "playerCount", "adventurerPlayerIds", "mummyPlayerId", "professionByPlayerId", "mummyType", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    gangsi_turn_completed: ["gameIndex", "turnIndex", "actorId", "actorKind", "phaseId", "publicAction", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    gangsi_objective_checkpoint: ["gameIndex", "mode", "teamTreasures", "teamTreasureTarget", "mechanismA", "mechanismB", "mummyScore", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    gangsi_terminal_settled: ["gameIndex", "outcomeId", "mode", "winnerSide", "winnerPlayerId", "mapId", "summary", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    gangsi_returned_to_lobby: ["gameIndex", "readyReset", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"]
  },
  settingsSchema: {
    mode: { type: "enum", values: ["classic", "hunt"] },
    mapSelection: { type: "enum", values: ["fixed", "random"] },
    mapId: { type: ["enum", "null"], values: ["classic", "test-map", null] }
  },
  observationMap: {
    public: ["roomCode", "roster", "settings", "readyState", "phase", "currentPlayer", "publicPlayerStatus", "mapName", "boardTreasures", "sharedDiceFaces", "sharedObjectives", "publicActionLog", "terminalResult"],
    private: ["ownMissionCards", "ownAbilityAndCooldown", "ownLegalControls", "ownMapVisibility", "ownPendingChoices", "ownAbilityResults"],
    excluded: ["otherMissionCards", "otherHiddenPositions", "otherAbilityResults", "serverRoomState", "engineFixtures"]
  },
  semanticMap: {
    phases: ["entry", "lobby", "adventurer_prepare", "adventurer_roll", "adventurer_numeric_move", "adventurer_arrow_move", "treasure_reveal", "monster_prepare", "mummy_roll", "mummy_move", "mechanism_result", "terminal", "return_to_lobby"],
    actions: ["create_room", "join_room", "send_chat", "select_mode", "select_player_count", "select_fixed_map", "toggle_random_map", "select_adventurer", "select_mummy", "enter_token_label", "select_profession", "select_mummy_type", "roll_d100", "toggle_ready", "start_game", "continue_turn", "unlock_all_dice", "roll_adventurer_dice", "reroll_unlocked_dice", "select_numeric_die", "select_arrow_die", "select_path_cell", "confirm_path", "select_arrow_direction", "reveal_treasure", "skip_treasure", "use_profession_ability", "activate_mechanism", "use_mummy_ability", "roll_mummy_dice", "move_mummy", "end_mummy_move", "close_terminal", "return_to_lobby"],
    privateRegions: ["own_mission_cards", "own_ability_state", "own_pending_choices", "own_hidden_map_state", "own_ability_result"],
    publicRegions: ["room_code", "room_chat", "roster", "host_settings", "phase_header", "public_player_status", "map_name", "board_treasures", "shared_dice", "shared_objectives", "public_action_log", "terminal_result"]
  },
  journeys: {
    discover_user_journeys: ["create", "join", "settings", "identity", "reconnect", "ready", "play", "isolation", "terminal", "return_to_lobby"],
    create_join_complete_classic_game: ["create", "join", "classic_fixed_setup", "identity", "reconnect", "ready", "complete_classic_game", "normalize_terminal", "return_to_lobby"],
    create_join_complete_hunt_game: ["create", "join", "hunt_random_setup", "identity", "reconnect", "ready", "complete_hunt_game", "normalize_terminal", "return_to_lobby"]
  },
  scenarios: {},
  normalizedResultSchema: {
    outcomeId: Object.keys(OUTCOMES),
    mode: ["classic", "hunt"],
    winner: ["adventurer", "mummy"],
    winnerPlayerId: "configured player id shown by the visible terminal",
    mapId: ["classic", "test-map"],
    mapName: "visible terminal map name",
    summary: "exact visible terminal summary",
    classic: "classic public score/task totals or null",
    hunt: "Hunt adventurer and mummy terminal rows or null"
  },
  mappedButUncertified: [
    "player counts 2, 4, and 5",
    "classic random-map and fixed test-map combinations",
    "Hunt fixed-map combinations",
    "all profession and mummy-type combinations beyond the two natural three-player profiles",
    "every ability target, cooldown, trap trigger/recovery, mechanism-face, seal, secret-passage, capture, death, and escape branch",
    "reconnect during every in-game phase"
  ]
};
