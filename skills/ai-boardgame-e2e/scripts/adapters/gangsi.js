"use strict";

const MODES = new Set(["classic", "hunt"]);
const MAP_SELECTIONS = new Set(["fixed", "random"]);
const MAP_IDS = new Set(["classic", "test-map"]);
const WINNERS = new Set(["adventurer", "mummy"]);
const FEATURE_MAP_SCHEDULE = Object.freeze(["fixed:classic", "fixed:test-map", "random"]);
const FEATURE_JOURNEY_ID = "execute_hunt5_feature_coverage";
const FEATURE_PROFESSIONS = Object.freeze({ P1: "knight", P2: "engineer", P3: "doctor", P4: "wizard" });
const FEATURE_ROUTE_SCHEDULE = Object.freeze([
  Object.freeze({
    gameIndex: 1,
    routeId: "route.hunt5.01_trap_core_escape",
    scenarioId: "hunt5_trap_core_escape",
    setupProfileId: "hunt5.classic",
    mapSelection: "fixed",
    mapId: "classic",
    mummyType: "trap",
    terminal: "adventurer"
  }),
  Object.freeze({
    gameIndex: 2,
    routeId: "route.hunt5.02_invisible_last_survivor",
    scenarioId: "hunt5_invisible_last_survivor",
    setupProfileId: "hunt5.test_map",
    mapSelection: "fixed",
    mapId: "test-map",
    mummyType: "invisible",
    terminal: "mummy"
  }),
  Object.freeze({
    gameIndex: 3,
    routeId: "route.hunt5.03_knife_targeted",
    scenarioId: "hunt5_knife_targeted",
    setupProfileId: "hunt5.random",
    mapSelection: "random",
    mapId: null,
    mummyType: "knife",
    terminal: null
  })
]);
const CHECKPOINTS = Object.freeze([
  Object.freeze({ id: "cp.hunt.5p_lobby_goal", title: "Five-player Hunt lobby and goal", evidenceScope: "public", route: 1, assertions: ["five_players_visible", "hunt_mode_visible", "team_treasure_target_nine"] }),
  Object.freeze({ id: "cp.hunt.team_treasure_tracking_start", title: "Team treasure tracking starts", evidenceScope: "public", route: 1, assertions: ["target_nine_reached", "tracking_started_after_target"] }),
  Object.freeze({ id: "cp.hunt.mechanism_progress", title: "Mechanism progress", evidenceScope: "public", route: 1, assertions: ["faces_x_0_1_1_1_2", "progress_capped_at_three", "contribution_counted_once"] }),
  Object.freeze({ id: "cp.hunt.mechanism_seal_lifecycle", title: "Mechanism seal lifecycle", evidenceScope: "cross_tab", route: 1, assertions: ["x_adds_one_and_seals", "seal_survives_mummy_and_interrupt_turns", "seal_consumes_one_full_adventurer_turn", "completion_by_x_clears_seal"] }),
  Object.freeze({ id: "cp.hunt.tracking_normal_turn_cadence", title: "Tracking normal-turn cadence", evidenceScope: "public", route: 1, assertions: ["cadence_three_normal_mummy_turns", "interrupt_turns_do_not_decrement", "position_reveal_visible"] }),
  Object.freeze({ id: "cp.hunt.interrupt_accounting", title: "Interrupt accounting", evidenceScope: "public", route: 1, assertions: ["interrupt_not_normal_turn", "cooldowns_unchanged", "tracking_unchanged"] }),
  Object.freeze({ id: "cp.hunt.exit_escape", title: "Exit escape", evidenceScope: "public", route: 1, assertions: ["mechanism_becomes_exit_at_three", "adventurer_entry_escapes"] }),
  Object.freeze({ id: "cp.hunt.last_survivor_hatch_open", title: "Last-survivor hatch opens", evidenceScope: "public", route: 2, assertions: ["one_survivor_visible", "hatch_open_visible"] }),
  Object.freeze({ id: "cp.hunt.hatch_close_opens_exits", title: "Hatch close opens exits", evidenceScope: "public", route: 2, assertions: ["mummy_enters_open_hatch", "hatch_closes", "two_mechanisms_become_exits", "seals_cleared"] }),
  Object.freeze({ id: "cp.hunt.core_information_isolation", title: "Core Hunt information isolation", evidenceScope: "cross_tab", route: 1, assertions: ["private_missions_isolated", "hidden_positions_isolated", "trap_positions_isolated", "ability_state_actor_only"] }),
  Object.freeze({ id: "cp.hunt.adventurer_terminal_consistency", title: "Adventurer terminal consistency", evidenceScope: "cross_tab", route: 1, assertions: ["adventurer_terminal_visible_all_tabs", "winner_and_counts_match"] }),
  Object.freeze({ id: "cp.hunt.mummy_terminal_consistency", title: "Mummy terminal consistency", evidenceScope: "cross_tab", route: 2, assertions: ["mummy_terminal_visible_all_tabs", "winner_and_counts_match"] }),
  Object.freeze({ id: "cp.hunt.settlement_rows", title: "Settlement rows", evidenceScope: "cross_tab", route: 2, assertions: ["all_adventurer_rows_visible", "mummy_row_visible", "rows_match_across_tabs"] }),
  Object.freeze({ id: "cp.hunt.profession.knight_guard", title: "Knight guard", evidenceScope: "player", route: 1, assertions: ["target_other_teammate_within_eight_neighbors", "diagonal_and_wall_independent", "consumes_normal_turn", "blocks_one_life_loss_or_injury", "does_not_block_direct_capture", "cooldown_five_own_normal_turns", "activation_and_interrupt_do_not_decrement", "guard_target_hidden_from_mummy"] }),
  Object.freeze({ id: "cp.hunt.profession.engineer_mechanism", title: "Engineer mechanism bonus", evidenceScope: "public", route: 1, assertions: ["normal_roll_then_plus_one", "zero_numeric_x_follow_bonus_and_seal_rules", "progress_capped_at_three", "contribution_counted_once"] }),
  Object.freeze({ id: "cp.hunt.profession.doctor_vitality", title: "Doctor vitality", evidenceScope: "player", route: 1, assertions: ["initial_life_four", "maximum_life_four", "injury_capture_guard_display_correct"] }),
  Object.freeze({ id: "cp.hunt.profession.wizard_unlock", title: "Wizard unlock", evidenceScope: "player", route: 1, assertions: ["available_only_with_two_to_four_locked_dice", "unlocks_one_for_free", "normal_action_remains", "no_interrupt_turn", "once_per_own_normal_turn", "three_uses_global", "unavailable_with_five_locked"] }),
  Object.freeze({ id: "cp.hunt.mummy.trap", title: "Trap mummy", evidenceScope: "cross_tab", route: 1, assertions: ["place_or_recover_before_roll", "roll_remains_available", "maximum_two_traps", "placement_cooldown_two_normal_turns", "recovery_no_cooldown", "protected_cells_rejected", "outer_jail_exit_path_allowed", "trap_positions_hidden_from_adventurers", "adventurer_trigger_injures_stops_removes", "mummy_trigger_stops_ends_turn_removes"] }),
  Object.freeze({ id: "cp.hunt.mummy.invisible", title: "Invisible mummy", evidenceScope: "cross_tab", route: 2, assertions: ["activate_before_roll_and_continue", "state_persists_across_turns", "capture_disabled", "adventurer_paths_ignore_position", "collision_stops_before_contact_and_reveals", "collision_no_capture_or_injury", "active_reveal_ends_turn", "position_and_movement_hidden"] }),
  Object.freeze({ id: "cp.hunt.mummy.knife", title: "Knife mummy", evidenceScope: "cross_tab", route: 3, assertions: ["choose_cardinal_direction_before_roll", "throw_ends_turn_without_roll_or_move", "ray_blockers_respected", "first_adventurer_only", "hit_injures_or_guard_blocks", "coordinate_public_identity_private", "cooldown_two_normal_turns", "miss_not_counted_as_trigger"] })
]);
const CHECKPOINT_BY_ID = new Map(CHECKPOINTS.map((checkpoint) => [checkpoint.id, checkpoint]));
const ROUTE_BY_GAME = new Map(FEATURE_ROUTE_SCHEDULE.map((route) => [route.gameIndex, route]));
const ROUTE_BY_ID = new Map(FEATURE_ROUTE_SCHEDULE.map((route) => [route.routeId, route]));
const ROUTE_CHECKPOINTS = new Map(FEATURE_ROUTE_SCHEDULE.map((route) => [
  route.routeId,
  CHECKPOINTS.filter((checkpoint) => checkpoint.route === route.gameIndex).map((checkpoint) => checkpoint.id).sort()
]));
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

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeMapSchedule(value, errors) {
  if (!Array.isArray(value)) {
    errors.push("Gangsi mapSchedule must be an array.");
    return [];
  }
  const normalized = value.map((item, index) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`Gangsi mapSchedule[${index}] must be a schedule entry.`);
      return "";
    }
    if (item.journey !== index + 1) errors.push(`Gangsi mapSchedule[${index}].journey must be ${index + 1}.`);
    const selection = String(item.mapSelection || "");
    const mapId = item.mapId === undefined || item.mapId === null ? null : String(item.mapId);
    if (selection === "fixed" && MAP_IDS.has(mapId)) return `fixed:${mapId}`;
    if (selection === "random" && mapId === null) return "random";
    errors.push(`Gangsi mapSchedule[${index}] has an invalid mapSelection/mapId pair.`);
    return "";
  });
  if (!sameValue(normalized, FEATURE_MAP_SCHEDULE)) {
    errors.push(`Gangsi feature mapSchedule must be ${FEATURE_MAP_SCHEDULE.join(", ")} in that order.`);
  }
  return normalized;
}

function isFeatureSchedule(configOrSettings) {
  const settings = configOrSettings?.gameSettings || configOrSettings || {};
  return sameValue(settings.mapSchedule, FEATURE_MAP_SCHEDULE);
}

function routeForGame(config, gameIndex) {
  return isFeatureSchedule(config) ? ROUTE_BY_GAME.get(Number(gameIndex)) || null : null;
}

function lobbySettingsForRoute(route) {
  return {
    mode: "hunt",
    mapSelection: route.mapSelection,
    mapId: route.mapSelection === "fixed" ? route.mapId : null
  };
}

function validateSettings(value, context, errors) {
  const settings = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const allowed = new Set(["mode", "mapSelection", "mapId", "mapSchedule"]);
  Object.keys(settings).forEach((key) => {
    if (!allowed.has(key)) errors.push(`Unknown Gangsi gameSettings field: ${key}.`);
  });
  const mode = String(settings.mode || "classic");
  if (Object.hasOwn(settings, "mapSchedule")) {
    const mapSchedule = normalizeMapSchedule(settings.mapSchedule, errors);
    if (mode !== "hunt") errors.push("Gangsi feature mapSchedule requires Hunt mode.");
    if (context.playerCount !== 5) errors.push("Gangsi feature mapSchedule requires exactly 5 players.");
    if (Object.hasOwn(settings, "mapSelection") || Object.hasOwn(settings, "mapId")) {
      errors.push("Gangsi mapSchedule cannot be combined with one single-game mapSelection/mapId.");
    }
    return { mode, mapSchedule };
  }
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
  if (isFeatureSchedule(context.gameSettings)) {
    if (!purpose.journeyIds.includes(FEATURE_JOURNEY_ID)) {
      errors.push(`Gangsi feature schedule must include ${FEATURE_JOURNEY_ID}.`);
    }
    const expectedScenarios = FEATURE_ROUTE_SCHEDULE.map((route) => route.scenarioId).sort();
    if (!sameValue([...purpose.scenarioIds].sort(), expectedScenarios)) {
      errors.push("Gangsi feature schedule must select the three approved route scenarios exactly once.");
    }
    return purpose;
  }
  if (purpose.scenarioIds.length) errors.push("Gangsi natural runs do not declare targeted scenarios.");
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
  if (kind !== "timeline") return;
  const featureRoute = routeForGame(context.config, event.gameIndex);
  if (["coverage_route_started", "coverage_route_completed"].includes(event.type)) {
    if (!featureRoute || event.routeId !== featureRoute.routeId) {
      errors.push(`${event.type} does not match the approved Gangsi route for gameIndex ${event.gameIndex}.`);
      return;
    }
    const expected = ROUTE_CHECKPOINTS.get(featureRoute.routeId);
    if (!sameValue([...(event.checkpointIds || [])].sort(), expected)) {
      errors.push(`${event.type} checkpointIds do not match ${featureRoute.routeId}.`);
    }
    if (event.setupProfileId !== featureRoute.setupProfileId) {
      errors.push(`${event.type} setupProfileId does not match ${featureRoute.setupProfileId}.`);
    }
    return;
  }
  if (event.type === "adapter_checkpoint") {
    const checkpoint = CHECKPOINT_BY_ID.get(String(event.checkpointId || ""));
    if (!checkpoint) return;
    if (!featureRoute || checkpoint.route !== featureRoute.gameIndex) {
      errors.push(`Checkpoint ${checkpoint.id} is assigned to another approved Gangsi route.`);
      return;
    }
    validateEvidence(event, `adapter_checkpoint ${checkpoint.id}`, context, errors);
    const assertionResults = event.data?.assertionResults;
    if (!assertionResults || typeof assertionResults !== "object" || Array.isArray(assertionResults)
      || !sameMembers(Object.keys(assertionResults), checkpoint.assertions)
      || Object.values(assertionResults).some((value) => typeof value !== "boolean")) {
      errors.push(`Checkpoint ${checkpoint.id} must record every declared assertion result exactly once.`);
    }
    return;
  }
  if (event.type === "checkpoint_result") {
    const checkpoint = CHECKPOINT_BY_ID.get(String(event.checkpointId || ""));
    if (!checkpoint) return;
    if (!featureRoute || checkpoint.route !== featureRoute.gameIndex) {
      errors.push(`checkpoint_result ${checkpoint.id} is assigned to another approved Gangsi route.`);
    }
    if (event.source !== "evidence_refs" || !Array.isArray(event.evidenceRefs) || !event.evidenceRefs.length) {
      errors.push(`checkpoint_result ${checkpoint.id} requires logs-only evidence_refs provenance.`);
    }
    return;
  }
  if (!String(event.type || "").startsWith("gangsi_")) return;
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
    const expectedSettings = featureRoute ? lobbySettingsForRoute(featureRoute) : context.config?.gameSettings;
    if (!sameValue(resolved, expectedSettings)) {
      errors.push("gangsi_settings_verified settings differ from the approved settings for this journey.");
    }
    if (featureRoute && event.routeId !== featureRoute.routeId) {
      errors.push("gangsi_settings_verified routeId differs from the approved map schedule.");
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
    if (featureRoute) {
      if (event.routeId !== featureRoute.routeId || event.mapSelection !== featureRoute.mapSelection
        || (featureRoute.mapSelection === "fixed" && event.mapId !== featureRoute.mapId)
        || event.mummyType !== featureRoute.mummyType
        || !sameValue(event.professionByPlayerId, FEATURE_PROFESSIONS)
        || event.mummyPlayerId !== "P5") {
        errors.push("gangsi_game_setup differs from the approved route setup.");
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
  const featureSchedule = isFeatureSchedule(config);
  for (let gameIndex = 1; gameIndex <= config.gamesToPlay; gameIndex += 1) {
    const byType = (type) => timeline.filter((event) => event.type === type && event.gameIndex === gameIndex);
    const settings = byType("gangsi_settings_verified");
    const setups = byType("gangsi_game_setup");
    const turns = byType("gangsi_turn_completed");
    const terminals = byType("gangsi_terminal_settled");
    const returns = byType("gangsi_returned_to_lobby");
    if (settings.length !== 1) errors.push(`Game ${gameIndex} requires exactly one gangsi_settings_verified event.`);
    if (setups.length !== 1) errors.push(`Game ${gameIndex} requires exactly one gangsi_game_setup event.`);
    const featureRoute = routeForGame(config, gameIndex);
    const terminalRequired = !featureSchedule || featureRoute?.terminal !== null;
    if (terminalRequired && terminals.length !== 1) errors.push(`Game ${gameIndex} requires exactly one gangsi_terminal_settled event.`);
    if (!terminalRequired && terminals.length > 1) errors.push(`Game ${gameIndex} permits at most one gangsi_terminal_settled event.`);
    if (!featureSchedule && returns.length !== 1) errors.push(`Game ${gameIndex} requires exactly one gangsi_returned_to_lobby event.`);
    if (featureSchedule && gameIndex < config.gamesToPlay && returns.length !== 1) {
      errors.push(`Game ${gameIndex} requires exactly one gangsi_returned_to_lobby event before the next approved route.`);
    }
    const actorIds = [...new Set(turns.map((event) => String(event.actorId)))];
    if (!sameMembers(actorIds, configuredIds({ config }))) {
      errors.push(`Game ${gameIndex} requires at least one visible completed turn for every configured player.`);
    }
    turns.forEach((event, index) => {
      if (event.turnIndex !== index + 1) errors.push(`Game ${gameIndex} turn evidence must be contiguous from one.`);
    });
    const resultDetail = timeline.find((event) => event.type === "result_detail" && event.gameIndex === gameIndex);
    if (!terminalRequired) continue;
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
    if (featureRoute && terminal.winnerSide !== featureRoute.terminal) {
      errors.push(`Game ${gameIndex} terminal differs from the approved route endpoint.`);
    }
  }
  if (featureSchedule) {
    for (const checkpoint of CHECKPOINTS) {
      const observations = timeline.filter((event) => event.type === "adapter_checkpoint"
        && event.gameIndex === checkpoint.route && event.checkpointId === checkpoint.id);
      const results = timeline.filter((event) => event.type === "checkpoint_result"
        && event.gameIndex === checkpoint.route && event.checkpointId === checkpoint.id);
      if (observations.length !== 1) errors.push(`Feature schedule requires exactly one adapter_checkpoint for ${checkpoint.id}.`);
      if (results.length !== 1) errors.push(`Feature schedule requires exactly one checkpoint_result for ${checkpoint.id}.`);
      const assertionResults = observations[0]?.data?.assertionResults;
      if (results[0]?.passed === true && checkpoint.assertions.some((id) => assertionResults?.[id] !== true)) {
        errors.push(`Passing checkpoint ${checkpoint.id} has an unmet declared sub-assertion.`);
      }
      if (observations[0] && !results[0]?.evidenceRefs?.includes(`public:${observations[0].evidenceId}`)) {
        errors.push(`checkpoint_result ${checkpoint.id} must reference its adapter_checkpoint evidence.`);
      }
    }
  }
}

const coverageModel = Object.freeze({
  schemaVersion: "1.0",
  game: "gangsi",
  checkpoints: CHECKPOINTS.map((checkpoint) => ({
    id: checkpoint.id,
    title: checkpoint.title,
    evidenceScope: checkpoint.evidenceScope,
    prerequisiteCheckpointIds: []
  })),
  setupProfiles: FEATURE_ROUTE_SCHEDULE.map((route) => ({
    id: route.setupProfileId,
    title: `Gangsi ${route.setupProfileId}`,
    initialStateId: "lobby",
    gameSettings: { mode: "hunt", mapSchedule: FEATURE_MAP_SCHEDULE },
    playerCount: { min: 5, max: 5 },
    setupSeconds: 150,
    resetSeconds: 60,
    deterministic: route.setupProfileId !== "hunt5.random"
  })),
  routes: FEATURE_ROUTE_SCHEDULE.map((route) => ({
    id: route.routeId,
    title: route.routeId,
    coversCheckpointIds: ROUTE_CHECKPOINTS.get(route.routeId),
    setupProfileId: route.setupProfileId,
    startStateId: "lobby",
    endStateId: route.terminal ? `terminal_${route.terminal}` : "knife_cp_complete",
    prerequisiteCheckpointIds: [],
    estimatedSeconds: route.gameIndex === 1 ? 3600 : route.gameIndex === 2 ? 2700 : 1200,
    requiresFreshExecution: route.gameIndex > 1,
    deterministic: false
  })),
  transitions: []
});

module.exports = {
  id: "gangsi",
  contractVersion: "2.2",
  validateSettings,
  resolvePurpose,
  validatePublicEvent,
  validateResult,
  auditRun,
  coverageModel,
  timingIntents: [],
  postTerminalEventTypes: [],
  visibleTerminalMarkerTypes: [],
  resultDisclosureKeys: [],
  publicTimelineFields: {
    gangsi_settings_verified: ["gameIndex", "routeId", "settings", "selectionSource", "rationale", "rosterOrder", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    gangsi_game_setup: ["gameIndex", "routeId", "mode", "mapSelection", "mapId", "mapName", "playerCount", "adventurerPlayerIds", "mummyPlayerId", "professionByPlayerId", "mummyType", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    gangsi_turn_completed: ["gameIndex", "turnIndex", "actorId", "actorKind", "phaseId", "publicAction", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    gangsi_objective_checkpoint: ["gameIndex", "mode", "teamTreasures", "teamTreasureTarget", "mechanismA", "mechanismB", "mummyScore", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    gangsi_terminal_settled: ["gameIndex", "outcomeId", "mode", "winnerSide", "winnerPlayerId", "mapId", "summary", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    gangsi_returned_to_lobby: ["gameIndex", "readyReset", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"]
  },
  settingsSchema: {
    mode: { type: "enum", values: ["classic", "hunt"] },
    mapSelection: { type: "enum", values: ["fixed", "random"] },
    mapId: { type: ["enum", "null"], values: ["classic", "test-map", null] },
    mapSchedule: { type: "array", values: FEATURE_MAP_SCHEDULE }
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
    ,
    execute_hunt5_feature_coverage: ["create", "join", "verify_route_lobby_settings", "identity", "ready", "execute_approved_coverage_route", "record_checkpoint_results", "complete_route"]
  },
  scenarios: Object.fromEntries(FEATURE_ROUTE_SCHEDULE.map((route) => [route.scenarioId, {
    routeId: route.routeId,
    setupProfileId: route.setupProfileId,
    controlledSetup: lobbySettingsForRoute(route),
    professionByPlayerId: FEATURE_PROFESSIONS,
    mummyPlayerId: "P5",
    mummyType: route.mummyType,
    checkpointIds: ROUTE_CHECKPOINTS.get(route.routeId),
    terminal: route.terminal
  }])),
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
