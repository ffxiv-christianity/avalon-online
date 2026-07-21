"use strict";

const PLAYER_MIN = 2;
const PLAYER_MAX = 6;
const TARGET_MIN = 1;
const TARGET_MAX = 9;
const DEFAULT_TARGETS = Object.freeze({ 2: 6, 3: 5, 4: 4, 5: 3, 6: 3 });
const CARD_IDS = new Set([
  "spy", "guard", "priest", "baron", "handmaid",
  "prince", "chancellor", "king", "countess", "princess"
]);
const GUARD_GUESSES = new Set([...CARD_IDS].filter((cardId) => cardId !== "guard"));
const ROUND_END_CAUSES = new Set(["one_active_player", "deck_exhausted"]);
const STATIC_ACTIONS = new Set([
  "create_room", "join_room", "roll_d100", "toggle_ready", "start_game",
  "confirm_action", "cancel_action", "confirm_chancellor", "start_next_round",
  "return_lobby", "reset_match"
]);
const OBSERVATION_REF = /^(publicFacts|privateFacts|legalActions|ownMemory)\[(\d+)\]$/;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function playerIds(context) {
  return (context.config?.players || context.players || []).map((player) => String(player.id));
}

function sameMembers(left, right) {
  return JSON.stringify([...left].map(String).sort()) === JSON.stringify([...right].map(String).sort());
}

function parseLegalAction(value) {
  const parts = String(value || "").split(":");
  if (parts[0] === "play_card" && CARD_IDS.has(parts[1])) {
    return { action: `play_card:${parts[1]}`, targets: parts.slice(2), cardId: parts[1] };
  }
  if (parts[0] === "guess_card" && GUARD_GUESSES.has(parts[1])) {
    return { action: `guess_card:${parts[1]}`, targets: parts.slice(2), guessCardId: parts[1] };
  }
  if (["choose_chancellor_keep", "choose_chancellor_bottom"].includes(parts[0]) && parts[1]) {
    return { action: String(value), targets: [], choiceId: parts.slice(1).join(":") };
  }
  return { action: String(value || ""), targets: [] };
}

function canonicalDecision(decision) {
  const action = String(decision.action || "");
  const targets = Array.isArray(decision.targets) ? decision.targets.map(String) : [];
  return targets.length ? `${action}:${targets.join("+")}` : action;
}

function isCanonicalAction(action) {
  if (STATIC_ACTIONS.has(action)) return true;
  if (/^play_card:[a-z_]+$/.test(action)) return CARD_IDS.has(action.slice("play_card:".length));
  if (/^guess_card:[a-z_]+$/.test(action)) return GUARD_GUESSES.has(action.slice("guess_card:".length));
  return /^(choose_chancellor_keep|choose_chancellor_bottom):[a-zA-Z0-9._-]+$/.test(action);
}

function validateSettings(value, context, errors) {
  const settings = isObject(value) ? value : {};
  if (value !== undefined && !isObject(value)) errors.push("gameSettings must be an object.");
  Object.keys(settings).forEach((key) => {
    if (key !== "targetHearts") errors.push(`Unknown Love Letter gameSettings field: ${key}.`);
  });
  const count = Number(context.playerCount);
  if (!Number.isInteger(count) || count < PLAYER_MIN || count > PLAYER_MAX) {
    errors.push(`Love Letter supports ${PLAYER_MIN} to ${PLAYER_MAX} visible players.`);
  }
  const supplied = settings.targetHearts;
  const targetHearts = supplied === undefined ? DEFAULT_TARGETS[count] : Number(supplied);
  if (!Number.isInteger(targetHearts) || targetHearts < TARGET_MIN || targetHearts > TARGET_MAX) {
    errors.push(`gameSettings.targetHearts must be an integer from ${TARGET_MIN} to ${TARGET_MAX} selected in the visible host UI.`);
  }
  return { targetHearts };
}

function resolvePurpose(purpose, context, errors) {
  if (purpose.approach === "exploratory") {
    if (!purpose.journeyIds.includes("discover_user_journeys")) {
      errors.push("Exploratory Love Letter runs must use discover_user_journeys.");
    }
    if (purpose.scenarioIds.length) errors.push("Exploratory Love Letter discovery cannot force scenarios.");
    return purpose;
  }
  if (!purpose.journeyIds.includes("create_join_complete_match")) {
    errors.push("Formal Love Letter runs must exercise create_join_complete_match.");
  }
  return purpose;
}

function validateObservation(observation, context, errors) {
  const ids = new Set(playerIds(context));
  const legalActions = Array.isArray(observation.legalActions) ? observation.legalActions : [];
  if (new Set(legalActions).size !== legalActions.length) {
    errors.push(`${context.playerId || "player"} ${observation.observationId || "Observation"} has duplicate legalActions.`);
  }
  legalActions.forEach((entry, index) => {
    const parsed = parseLegalAction(entry);
    if (!isCanonicalAction(parsed.action)) {
      errors.push(`${context.playerId || "player"} ${observation.observationId || "Observation"} legalActions[${index}] is not a Love Letter canonical action.`);
      return;
    }
    if (parsed.targets.some((target) => !ids.has(target))) {
      errors.push(`${context.playerId || "player"} ${observation.observationId || "Observation"} legalActions[${index}] has an unknown visible target.`);
    }
    if (parsed.cardId) {
      const targeted = ["guard", "priest", "baron", "king"].includes(parsed.cardId);
      if (targeted && parsed.targets.length > 1) errors.push(`${entry} has too many targets.`);
      if (parsed.cardId === "prince" && parsed.targets.length !== 1) errors.push(`${entry} requires one visible target, including self when legal.`);
      if (!["guard", "priest", "baron", "king", "prince"].includes(parsed.cardId) && parsed.targets.length) {
        errors.push(`${entry} must not encode a target.`);
      }
    }
    if (parsed.guessCardId && parsed.targets.length !== 1) errors.push(`${entry} requires exactly one Guard target.`);
  });
}

function validateDecision(decision, observation, context, errors) {
  const action = String(decision.action || "");
  if (!isCanonicalAction(action)) {
    errors.push(`${context.playerId || "player"} Decision ${decision.observationId || "unknown"} has an invalid Love Letter action.`);
  }
  const canonical = canonicalDecision(decision);
  if (!Array.isArray(observation.legalActions) || !observation.legalActions.includes(canonical)) {
    errors.push(`${context.playerId || "player"} Decision ${decision.observationId || "unknown"} action and targets do not exactly match legalActions.`);
  }
  const refs = Array.isArray(decision.evidenceRefs) ? decision.evidenceRefs : [];
  if (!refs.some((ref) => String(ref).startsWith("legalActions["))) {
    errors.push(`${context.playerId || "player"} Decision ${decision.observationId || "unknown"} must cite its same-Observation legal action.`);
  }
  if (!refs.some((ref) => String(ref).startsWith("publicFacts[") || String(ref).startsWith("privateFacts["))) {
    errors.push(`${context.playerId || "player"} Decision ${decision.observationId || "unknown"} must cite a same-Observation visible fact.`);
  }
  refs.forEach((ref) => {
    if (!OBSERVATION_REF.test(String(ref))) errors.push("Love Letter Decision evidenceRefs must use same-Observation array indexes.");
  });
}

function validateEvidence(event, label, errors) {
  if (event.source !== "visible_dom" || event.contentClass !== "public_ui"
    || !String(event.evidenceId || "").trim() || !String(event.evidenceText || "").trim()) {
    errors.push(`${label} requires visible_dom public_ui evidence with evidenceId and evidenceText.`);
  }
}

function exactPlayerNumberMap(value, context, label, errors) {
  const ids = playerIds(context);
  if (!isObject(value) || !sameMembers(Object.keys(value), ids)) {
    errors.push(`${label} must contain every configured player exactly once.`);
    return {};
  }
  Object.entries(value).forEach(([id, item]) => {
    if (!Number.isInteger(Number(item)) || Number(item) < 0) errors.push(`${label}.${id} must be a non-negative integer.`);
  });
  return value;
}

function exactRevealedMap(value, context, label, errors) {
  const ids = playerIds(context);
  if (!isObject(value) || !sameMembers(Object.keys(value), ids)) {
    errors.push(`${label} must contain every configured player exactly once.`);
    return {};
  }
  Object.entries(value).forEach(([id, cards]) => {
    if (!Array.isArray(cards) || cards.some((cardId) => !CARD_IDS.has(String(cardId)))) {
      errors.push(`${label}.${id} must be an array of publicly revealed Love Letter card ids.`);
    }
  });
  return value;
}

function validatePublicEvent(kind, event, context, errors) {
  if (kind !== "timeline" || !String(event.type || "").startsWith("loveletter_")) return;
  validateEvidence(event, event.type, errors);
  const ids = playerIds(context);
  const validPlayer = (id) => ids.includes(String(id));
  if (!Number.isInteger(event.gameIndex) || event.gameIndex < 1) errors.push(`${event.type} requires a positive gameIndex.`);
  if (event.type === "loveletter_settings_verified") {
    const expected = validateSettings(event.settings, {
      playerCount: context.config?.playerCount,
      players: context.config?.players,
      config: context.config
    }, errors);
    if (JSON.stringify(expected) !== JSON.stringify(context.config?.gameSettings)) {
      errors.push("loveletter_settings_verified settings differ from the resolved config.");
    }
    if (event.playerCount !== context.config?.playerCount || event.targetRange?.min !== TARGET_MIN || event.targetRange?.max !== TARGET_MAX) {
      errors.push("loveletter_settings_verified must prove the visible player count and 1-9 target range.");
    }
    if (!["ui_default", "ai_selected_visible_ui"].includes(event.selectionSource)) {
      errors.push("loveletter_settings_verified has an invalid selectionSource.");
    }
    if (event.selectionSource === "ai_selected_visible_ui" && !String(event.rationale || "").trim()) {
      errors.push("AI-selected target hearts require a recorded rationale.");
    }
  }
  if (event.type === "loveletter_round_started") {
    if (!Number.isInteger(event.roundIndex) || event.roundIndex < 1 || !validPlayer(event.firstPlayerId)
      || event.targetHearts !== context.config?.gameSettings?.targetHearts) {
      errors.push("loveletter_round_started requires a sequential round, visible first player, and configured target hearts.");
    }
    exactPlayerNumberMap(event.startingHearts, context, "loveletter_round_started.startingHearts", errors);
  }
  if (event.type === "loveletter_card_played") {
    if (!Number.isInteger(event.roundIndex) || event.roundIndex < 1 || !validPlayer(event.actorId) || !CARD_IDS.has(String(event.cardId))) {
      errors.push("loveletter_card_played has an invalid round, actor, or card.");
      return;
    }
    const target = event.targetId === null ? null : String(event.targetId);
    if (target !== null && !validPlayer(target)) errors.push("loveletter_card_played targetId is not configured.");
    if (["handmaid", "chancellor", "countess", "princess", "spy"].includes(event.cardId) && target !== null) {
      errors.push(`${event.cardId} must not record a target.`);
    }
    if (["priest", "baron", "king"].includes(event.cardId) && !event.noLegalTarget && (!target || target === String(event.actorId))) {
      errors.push(`${event.cardId} requires another visible target unless noLegalTarget is true.`);
    }
    if (event.cardId === "prince" && !target) errors.push("Prince requires one visible target and may target self.");
    if (event.cardId === "guard") {
      if (event.noLegalTarget && (target !== null || event.guessCardId !== null)) errors.push("No-target Guard must not record a target or guess.");
      if (!event.noLegalTarget && (!target || target === String(event.actorId) || !GUARD_GUESSES.has(String(event.guessCardId)))) {
        errors.push("Targeted Guard requires another player and a non-Guard guess.");
      }
    } else if (event.guessCardId !== null) errors.push("Only Guard may record guessCardId.");
  }
  if (event.type === "loveletter_information_isolation_checked") {
    if (event.privateHandOwnerCount !== ids.length || event.nonOwnerExactHandLeakCount !== 0
      || event.privateResultLeakCount !== 0 || event.playerAgentCount !== ids.length) {
      errors.push("loveletter_information_isolation_checked must prove one private hand per player, zero leaks, and one isolated agent per player.");
    }
  }
  if (event.type === "loveletter_round_settled") {
    if (!Number.isInteger(event.roundIndex) || event.roundIndex < 1 || !ROUND_END_CAUSES.has(String(event.endCause))
      || !Array.isArray(event.winnerIds) || !event.winnerIds.length || event.winnerIds.some((id) => !validPlayer(id))) {
      errors.push("loveletter_round_settled has an invalid round, end cause, or winners.");
    }
    if (!Array.isArray(event.eliminatedPlayerIds) || event.eliminatedPlayerIds.some((id) => !validPlayer(id))) {
      errors.push("loveletter_round_settled eliminatedPlayerIds are invalid.");
    }
    exactPlayerNumberMap(event.heartDeltas, context, "loveletter_round_settled.heartDeltas", errors);
    exactPlayerNumberMap(event.totalHearts, context, "loveletter_round_settled.totalHearts", errors);
    exactRevealedMap(event.revealedRemainingCards, context, "loveletter_round_settled.revealedRemainingCards", errors);
  }
  if (event.type === "loveletter_match_settled") {
    if (!Array.isArray(event.winnerIds) || !event.winnerIds.length || event.winnerIds.some((id) => !validPlayer(id))) {
      errors.push("loveletter_match_settled winnerIds are invalid.");
    }
    exactPlayerNumberMap(event.heartTotals, context, "loveletter_match_settled.heartTotals", errors);
    if (event.targetHearts !== context.config?.gameSettings?.targetHearts || !Number.isInteger(event.roundCount) || event.roundCount < 1) {
      errors.push("loveletter_match_settled must use the configured target and a positive round count.");
    }
  }
}

function validateRound(round, index, context, previous, errors) {
  const label = `Game ${context.gameIndex} Love Letter round ${index + 1}`;
  if (!isObject(round) || round.roundIndex !== index + 1 || !ROUND_END_CAUSES.has(String(round.endCause))) {
    errors.push(`${label} has an invalid index or endCause.`);
    return previous;
  }
  const ids = playerIds(context);
  if (!Array.isArray(round.winnerIds) || !round.winnerIds.length || round.winnerIds.some((id) => !ids.includes(String(id)))) {
    errors.push(`${label}.winnerIds are invalid.`);
  }
  if (!Array.isArray(round.eliminatedPlayerIds) || round.eliminatedPlayerIds.some((id) => !ids.includes(String(id)))) {
    errors.push(`${label}.eliminatedPlayerIds are invalid.`);
  }
  const deltas = exactPlayerNumberMap(round.heartDeltas, context, `${label}.heartDeltas`, errors);
  const totals = exactPlayerNumberMap(round.totalHearts, context, `${label}.totalHearts`, errors);
  exactRevealedMap(round.revealedRemainingCards, context, `${label}.revealedRemainingCards`, errors);
  ids.forEach((id) => {
    if (Number(totals[id]) !== Number(previous[id] || 0) + Number(deltas[id] || 0)) errors.push(`${label} heart continuity failed for ${id}.`);
  });
  return totals;
}

function validateResult(result, context, errors) {
  const label = `Game ${context.gameIndex} Love Letter result`;
  if (!isObject(result)) {
    errors.push(`${label} must be an object.`);
    return;
  }
  if (result.outcomeId !== "target_hearts_reached") errors.push(`${label}.outcomeId must be target_hearts_reached.`);
  const target = context.config?.gameSettings?.targetHearts;
  if (result.targetHearts !== target) errors.push(`${label}.targetHearts differs from the configured visible target.`);
  if (!String(result.summary || "").trim()) errors.push(`${label} requires a visible summary.`);
  const ids = playerIds(context);
  const totals = exactPlayerNumberMap(result.heartTotals, context, `${label}.heartTotals`, errors);
  if (!Array.isArray(result.rounds) || !result.rounds.length || result.roundCount !== result.rounds.length) {
    errors.push(`${label} requires roundCount and at least one ordered round.`);
  } else {
    let running = Object.fromEntries(ids.map((id) => [id, 0]));
    result.rounds.forEach((round, index) => { running = validateRound(round, index, context, running, errors); });
    if (JSON.stringify(running) !== JSON.stringify(totals)) errors.push(`${label} heartTotals differ from the final round totals.`);
  }
  const maximum = Math.max(...ids.map((id) => Number(totals[id])));
  const expectedWinners = ids.filter((id) => Number(totals[id]) === maximum);
  if (maximum < target) errors.push(`${label} does not reach the configured target.`);
  if (!Array.isArray(result.winnerIds) || !sameMembers(result.winnerIds, expectedWinners)) {
    errors.push(`${label}.winnerIds must equal every visible top-heart player.`);
  }
}

function auditRun(context, errors, warnings) {
  const { config, timeline } = context;
  if (config.testPurpose?.approach === "exploratory") {
    if (!timeline.some((event) => event.type === "adapter_checkpoint")) warnings.push("Exploratory Love Letter run has no adapter_checkpoint.");
    return;
  }
  for (let gameIndex = 1; gameIndex <= config.gamesToPlay; gameIndex += 1) {
    const events = (type) => timeline.filter((event) => event.type === type && event.gameIndex === gameIndex);
    if (events("loveletter_settings_verified").length !== 1) errors.push(`Game ${gameIndex} requires exactly one loveletter_settings_verified event.`);
    if (events("loveletter_information_isolation_checked").length !== 1) errors.push(`Game ${gameIndex} requires exactly one loveletter_information_isolation_checked event.`);
    const starts = events("loveletter_round_started");
    const rounds = events("loveletter_round_settled");
    if (!starts.length || starts.length !== rounds.length) errors.push(`Game ${gameIndex} requires one visible settlement for every started round.`);
    starts.forEach((start, index) => {
      if (start.roundIndex !== index + 1 || rounds[index]?.roundIndex !== start.roundIndex) errors.push(`Game ${gameIndex} Love Letter round events are not sequential.`);
    });
    const matches = events("loveletter_match_settled");
    if (matches.length !== 1) errors.push(`Game ${gameIndex} requires exactly one loveletter_match_settled event.`);
    const detail = events("result_detail")[0];
    if (!detail?.result) {
      errors.push(`Game ${gameIndex} is missing its normalized Love Letter result.`);
      continue;
    }
    validateResult(detail.result, { gameIndex, config }, errors);
    const expectedRounds = rounds.map((round) => ({
      roundIndex: round.roundIndex,
      endCause: round.endCause,
      winnerIds: round.winnerIds,
      eliminatedPlayerIds: round.eliminatedPlayerIds,
      heartDeltas: round.heartDeltas,
      totalHearts: round.totalHearts,
      revealedRemainingCards: round.revealedRemainingCards
    }));
    if (JSON.stringify(detail.result.rounds || []) !== JSON.stringify(expectedRounds)) {
      errors.push(`Game ${gameIndex} normalized rounds differ from visible settlement events.`);
    }
    const match = matches[0];
    if (match && (!sameMembers(detail.result.winnerIds || [], match.winnerIds || [])
      || JSON.stringify(detail.result.heartTotals) !== JSON.stringify(match.heartTotals)
      || detail.result.targetHearts !== match.targetHearts || detail.result.roundCount !== match.roundCount)) {
      errors.push(`Game ${gameIndex} normalized result differs from the visible match settlement.`);
    }
  }
}

module.exports = {
  id: "loveletter",
  contractVersion: "2.2",
  validateSettings,
  resolvePurpose,
  validateObservation,
  validateDecision,
  validatePublicEvent,
  validateResult,
  auditRun,
  timingIntents: [],
  postTerminalEventTypes: [],
  visibleTerminalMarkerTypes: [],
  resultDisclosureKeys: ["revealedRemainingCards"],
  publicTimelineFields: {
    loveletter_settings_verified: ["gameIndex", "settings", "playerCount", "targetRange", "selectionSource", "rationale", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    loveletter_round_started: ["gameIndex", "roundIndex", "firstPlayerId", "startingHearts", "targetHearts", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    loveletter_card_played: ["gameIndex", "roundIndex", "actorId", "cardId", "targetId", "guessCardId", "noLegalTarget", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    loveletter_information_isolation_checked: ["gameIndex", "privateHandOwnerCount", "nonOwnerExactHandLeakCount", "privateResultLeakCount", "playerAgentCount", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    loveletter_round_settled: ["gameIndex", "roundIndex", "endCause", "winnerIds", "eliminatedPlayerIds", "heartDeltas", "totalHearts", "revealedRemainingCards", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    loveletter_match_settled: ["gameIndex", "winnerIds", "heartTotals", "targetHearts", "roundCount", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"]
  },
  settingsSchema: {
    targetHearts: { type: "integer", minimum: TARGET_MIN, maximum: TARGET_MAX, defaultByPlayerCount: DEFAULT_TARGETS, ui: "host number input labelled 目標分數" }
  },
  identityOracle: {
    create: "Room code and host name are visible on every tab.",
    join: "Roster and public join event agree across tabs.",
    reconnect: "Reloaded player uses its visible named reconnect control while peer tabs remain unaffected.",
    proof: "One shared-chat identity message plus each tab's own visible status region."
  },
  observationMap: {
    public: ["roomCode", "roster", "hostId", "settings", "readyState", "rolls", "phase", "currentPlayerId", "drawPileCount", "removedCards", "handCounts", "discardPiles", "protection", "elimination", "publicActionLog", "heartTotals", "roundResult", "matchResult"],
    private: ["ownHand", "ownDraw", "enabledCards", "legalTargets", "guardGuesses", "priestResult", "baronResult", "kingExchangeResult", "chancellorChoices", "ownActionInfo"],
    excluded: ["otherHandsBeforePublicReveal", "deckOrder", "serverRoomState", "websocketPayloads", "fixtures"]
  },
  decisionMap: {
    canonicalEncoding: "play_card:<cardId>[:targetId], followed by a separate guess_card:<cardId>:targetId when Guard exposes its guess UI",
    submitTargetHearts: "Focus the visible number input, Backspace the old digits, type the target, then click another visible lobby control so the change event synchronizes to every tab.",
    playCard: "Click the enabled accessible card button, choose only rendered legal targets or guesses, and click 確認打出.",
    noLegalTarget: "Use play_card:<cardId> with no targets only when the visible panel explicitly says all other players are protected and the card has no effect.",
    chancellor: "Use the visible keep and bottom-order controls; never infer card instances from server state.",
    transition: "Host uses 下一局 after a round result and 返回大廳 after a match result."
  },
  legalActionOracle: {
    enabledControlsOnly: true,
    forcedCountess: "When Countess is held with King or Prince, only the Countess control may be used.",
    eliminatedOrWaiting: "No strategic action is legal when the own tab has no enabled play control.",
    protectedTargets: "Only target buttons rendered by the active player's own tab are legal."
  },
  timing: {
    scalableWaits: [],
    rule: "No non-decision wait was proven safely scalable; poll visible phase changes at the selected speed profile."
  },
  terminalOracle: {
    round: "Visible round-result heading, winner list, heart deltas, totals, eliminated state, and publicly revealed remaining cards agree across tabs.",
    match: "Visible 整場結束 heading, winner, target, total hearts, and terminal card reveal agree across tabs; only the host may additionally show 返回大廳."
  },
  evidenceContract: {
    appendOrder: ["source_evidence", "observation", "decision", "ui_action", "result_evidence"],
    privateDomSource: "Player console source evidence must contain playerId, sourcePlayerId, contentClass private_ui, source visible_dom, and be written before its Observation.",
    publicChatSource: "Shared chat evidence uses contentClass public_chat and visibleToPlayerIds containing every configured player.",
    factText: "Each fact text exactly equals its earlier source evidenceText.",
    evidenceRefs: "Decision evidenceRefs use same-Observation array indexes only.",
    requiredRunStartEvents: ["product_test", "game_started"]
  },
  semanticMap: {
    phases: ["entry", "lobby", "play", "guard_guess", "chancellor_choice", "round_result", "match_result"],
    actions: ["create_room", "join_room", "reconnect", "set_player_count", "set_target_hearts", "roll_d100", "toggle_ready", "start_game", "select_card", "select_target", "select_guard_guess", "resolve_chancellor", "confirm_action", "start_next_round", "return_lobby"],
    privateRegions: ["own_hand", "own_draw_message", "own_enabled_cards", "own_target_panel", "own_private_action_result", "own_chancellor_panel"],
    publicRegions: ["room_code", "chat", "roster", "host_settings", "phase_header", "table_counts", "removed_cards", "player_matrix", "discard_piles", "public_action_log", "heart_scoreboard", "terminal_result"]
  },
  journeys: {
    discover_user_journeys: ["entry", "create", "join", "reconnect", "configure", "roll", "ready", "play", "round_result", "match_result", "return_lobby"],
    create_join_complete_match: ["create", "join_all_players", "verify_identity", "configure_visible_target", "roll_and_ready", "play_complete_rounds", "normalize_match_terminal"]
  },
  scenarios: {},
  normalizedResultSchema: {
    outcomeId: "target_hearts_reached",
    winnerIds: "all configured players tied for the highest visible heart total at or above targetHearts",
    targetHearts: "visible synchronized host setting",
    heartTotals: "exact configured-player map",
    roundCount: "number of visibly settled rounds",
    rounds: "ordered roundIndex, endCause, winnerIds, eliminatedPlayerIds, heartDeltas, totalHearts, and public terminal card reveal",
    summary: "visible terminal explanation"
  },
  returnFlow: {
    nextRound: "The host clicks the visible 下一局 control after a non-terminal round settlement.",
    returnLobby: "The host clicks the visible 返回大廳 control after match settlement; guests wait for the host."
  },
  mappedButUncertified: [
    "deck-exhaustion settlement and tied high-card/discard-sum resolution",
    "forced Countess with King or Prince in the same hand",
    "three-player, five-player, and six-player full matches",
    "target-heart values 2, 3, 5, 7, 8, and 9",
    "all multi-player combinations of protection, elimination, and no-legal-target states"
  ],
  certificationEvidence: {
    strictCertificationEvidence: [],
    requiredMatrix: ["2-player default target", "4-player custom non-default target"],
    status: "experimental until formal audited runs populate the matrix"
  }
};
