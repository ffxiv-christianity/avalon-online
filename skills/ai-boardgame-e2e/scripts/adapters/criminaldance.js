"use strict";

const PLAYER_MIN = 3;
const PLAYER_MAX = 8;
const WINNING_SCORE = 10;
const CARD_IDS = new Set([
  "first_finder",
  "culprit",
  "alibi",
  "accomplice",
  "detective",
  "witness",
  "ordinary",
  "dog",
  "information_exchange",
  "rumor",
  "trade",
  "inspector",
  "juvenile"
]);
const ROUND_OUTCOMES = new Set([
  "culprit_escaped",
  "detective_caught_culprit",
  "dog_caught_culprit",
  "inspector_caught_culprit"
]);
const TARGETED_CARD_IDS = new Set(["detective", "witness", "dog", "trade", "inspector"]);
const STATIC_ACTION_IDS = new Set([
  "create_room",
  "join_room",
  "roll_d100",
  "toggle_ready",
  "start_game",
  "confirm_first_finder",
  "rumor_draw",
  "continue_detective_result",
  "start_next_round",
  "reset_match",
  "cancel_action"
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

function splitLegalAction(value) {
  const text = String(value || "");
  const separator = text.indexOf(":");
  return separator < 0
    ? { action: text, targets: [] }
    : { action: text.slice(0, separator), targets: text.slice(separator + 1).split("+").filter(Boolean) };
}

function isCanonicalActionId(action) {
  if (STATIC_ACTION_IDS.has(action)) return true;
  if ([...CARD_IDS].some((cardId) => action === `play_trade_give_${cardId}`)) return true;
  if ([...CARD_IDS].some((cardId) => action === `play_${cardId}`)) return true;
  if ([...CARD_IDS].some((cardId) => action === `dog_discard_${cardId}`)) return true;
  if ([...CARD_IDS].some((cardId) => action === `information_exchange_${cardId}`)) return true;
  return [...CARD_IDS].some((cardId) => action === `trade_reply_${cardId}`);
}

function validateObservation(observation, context, errors) {
  const configuredIds = new Set(playerIds(context));
  const legalActions = Array.isArray(observation.legalActions) ? observation.legalActions : [];
  if (new Set(legalActions).size !== legalActions.length) {
    errors.push(`${context.playerId || "player"} ${observation.observationId || "Observation"} has duplicate legalActions.`);
  }
  legalActions.forEach((entry, index) => {
    const { action, targets } = splitLegalAction(entry);
    if (!isCanonicalActionId(action)) {
      errors.push(`${context.playerId || "player"} ${observation.observationId || "Observation"} legalActions[${index}] is not a Criminal Dance canonical action ID.`);
      return;
    }
    if (targets.some((target) => !configuredIds.has(target))) {
      errors.push(`${context.playerId || "player"} ${observation.observationId || "Observation"} legalActions[${index}] has an unknown target.`);
    }
    const cardId = action.startsWith("play_") ? action.slice("play_".length) : null;
    const tradeGiveCardId = action.startsWith("play_trade_give_")
      ? action.slice("play_trade_give_".length)
      : null;
    if (tradeGiveCardId && targets.length !== 1) {
      errors.push(`${context.playerId || "player"} ${observation.observationId || "Observation"} ${action} requires exactly one visible trade target.`);
      return;
    }
    if (cardId && TARGETED_CARD_IDS.has(cardId) && cardId !== "trade" && targets.length !== 1) {
      errors.push(`${context.playerId || "player"} ${observation.observationId || "Observation"} ${action} requires exactly one visible target.`);
    }
    if (cardId === "trade" && !tradeGiveCardId && targets.length) {
      errors.push(`${context.playerId || "player"} ${observation.observationId || "Observation"} play_trade is only the visible no-effect trade action and must not encode a target.`);
    }
    if (cardId && !tradeGiveCardId && !TARGETED_CARD_IDS.has(cardId) && targets.length) {
      errors.push(`${context.playerId || "player"} ${observation.observationId || "Observation"} ${action} must not encode a target.`);
    }
  });
}

function validateDecision(decision, observation, context, errors) {
  const action = String(decision.action || "");
  const targets = Array.isArray(decision.targets) ? decision.targets.map(String) : [];
  if (!isCanonicalActionId(action) || action.includes(":")) {
    errors.push(`${context.playerId || "player"} Decision ${decision.observationId || "unknown"} must put one canonical action ID in action and targets only in targets.`);
  }
  const canonical = targets.length ? `${action}:${targets.join("+")}` : action;
  if (!Array.isArray(observation.legalActions) || !observation.legalActions.includes(canonical)) {
    errors.push(`${context.playerId || "player"} Decision ${decision.observationId || "unknown"} canonical action/targets do not exactly match legalActions.`);
  }
  const refs = Array.isArray(decision.evidenceRefs) ? decision.evidenceRefs : [];
  if (!refs.some((ref) => String(ref).startsWith("legalActions["))) {
    errors.push(`${context.playerId || "player"} Decision ${decision.observationId || "unknown"} must cite its same-Observation legalActions entry.`);
  }
  if (!refs.some((ref) => String(ref).startsWith("publicFacts[") || String(ref).startsWith("privateFacts["))) {
    errors.push(`${context.playerId || "player"} Decision ${decision.observationId || "unknown"} must cite at least one same-Observation visible fact.`);
  }
  refs.forEach((ref) => {
    if (!OBSERVATION_REF.test(String(ref))) {
      errors.push(`${context.playerId || "player"} Decision ${decision.observationId || "unknown"} evidenceRefs must use same-Observation array indexes, not evidence IDs.`);
    }
  });
}

function exactPlayerMap(value, context, label, errors, options = {}) {
  const ids = playerIds(context);
  if (!isObject(value) || !sameMembers(Object.keys(value), ids)) {
    errors.push(`${label} must contain every configured Criminal Dance player exactly once.`);
    return {};
  }
  Object.entries(value).forEach(([id, item]) => {
    const number = Number(item);
    const minimum = options.minimum ?? 0;
    if (!Number.isInteger(number) || number < minimum) {
      errors.push(`${label}.${id} must be an integer of at least ${minimum}.`);
    }
  });
  return value;
}

function validateSettings(value, context, errors) {
  const settings = isObject(value) ? value : {};
  if (value !== undefined && !isObject(value)) errors.push("gameSettings must be an object.");
  const allowed = new Set(["inspector", "juvenile"]);
  Object.keys(settings).forEach((key) => {
    if (!allowed.has(key)) errors.push(`Unknown Criminal Dance gameSettings field: ${key}.`);
  });
  const inspector = settings.inspector === true;
  const juvenile = settings.juvenile === true;
  for (const key of ["inspector", "juvenile"]) {
    if (settings[key] !== undefined && typeof settings[key] !== "boolean") {
      errors.push(`gameSettings.${key} must be a visible boolean lobby toggle.`);
    }
  }
  if (!Number.isInteger(context.playerCount) || context.playerCount < PLAYER_MIN || context.playerCount > PLAYER_MAX) {
    errors.push(`Criminal Dance supports ${PLAYER_MIN} to ${PLAYER_MAX} visible players.`);
  }
  return { inspector, juvenile };
}

function resolvePurpose(purpose, context, errors) {
  if (purpose.approach === "exploratory") {
    if (!purpose.journeyIds.includes("discover_user_journeys")) {
      errors.push("Exploratory Criminal Dance runs must use discover_user_journeys.");
    }
    if (purpose.scenarioIds.length) errors.push("Exploratory discovery does not force targeted scenarios.");
    return purpose;
  }
  if (!purpose.journeyIds.includes("create_join_complete_match")) {
    errors.push("Formal Criminal Dance runs must exercise create_join_complete_match.");
  }
  const settings = context.gameSettings || {};
  const selected = new Set(purpose.scenarioIds);
  const inspectorScenario = selected.has("inspector_public_marker");
  const juvenileScenario = selected.has("juvenile_opening_clue");
  if (Boolean(settings.inspector) !== inspectorScenario) {
    errors.push("gameSettings.inspector and scenario inspector_public_marker must be enabled or disabled together.");
  }
  if (Boolean(settings.juvenile) !== juvenileScenario) {
    errors.push("gameSettings.juvenile and scenario juvenile_opening_clue must be enabled or disabled together.");
  }
  if ((settings.inspector || settings.juvenile)
    && !["targeted_scenario", "mixed"].includes(purpose.approach)) {
    errors.push("Expansion tests require targeted_scenario or mixed so only declared expansion checkpoints are constrained.");
  }
  return purpose;
}

function validateEvidence(event, label, errors) {
  if (event.source !== "visible_dom" || event.contentClass !== "public_ui"
    || !String(event.evidenceId || "").trim() || !String(event.evidenceText || "").trim()) {
    errors.push(`${label} requires visible_dom public_ui evidence with evidenceId and evidenceText.`);
  }
}

function validatePublicEvent(kind, event, context, errors) {
  if (kind !== "timeline" || !String(event.type || "").startsWith("criminaldance_")) return;
  validateEvidence(event, event.type, errors);
  if (!Number.isInteger(event.gameIndex) || event.gameIndex < 1) {
    errors.push(`${event.type} requires a positive gameIndex.`);
  }
  const ids = playerIds(context);
  const validPlayer = (id) => ids.includes(String(id));
  if (event.type === "criminaldance_settings_verified") {
    const settingErrors = [];
    const resolved = validateSettings(event.settings, {
      playerCount: context.config?.playerCount,
      players: context.config?.players,
      config: context.config
    }, settingErrors);
    if (settingErrors.length) errors.push(...settingErrors.map((message) => `criminaldance_settings_verified: ${message}`));
    if (JSON.stringify(resolved) !== JSON.stringify(context.config?.gameSettings)) {
      errors.push("criminaldance_settings_verified settings differ from the resolved config.");
    }
    if (event.selectionSource !== "ai_recommended" || !String(event.rationale || "").trim()) {
      errors.push("criminaldance_settings_verified requires ai_recommended and a concrete rationale.");
    }
    if (!sameMembers(event.rosterOrder || [], ids)) {
      errors.push("criminaldance_settings_verified.rosterOrder must contain every configured player exactly once.");
    }
  }
  if (event.type === "criminaldance_round_started") {
    if (!Number.isInteger(event.roundIndex) || event.roundIndex < 1
      || !validPlayer(event.firstFinderId) || !sameMembers(event.turnOrder || [], ids)
      || event.startingHandSize !== 4) {
      errors.push("criminaldance_round_started requires a positive round, visible First Finder, exact turn order, and four-card starting hand.");
    }
  }
  if (event.type === "criminaldance_card_played") {
    if (!Number.isInteger(event.roundIndex) || event.roundIndex < 1 || !validPlayer(event.actorId)
      || !CARD_IDS.has(String(event.cardId || ""))) {
      errors.push("criminaldance_card_played has an invalid round, actorId, or cardId.");
    }
    const targetRequired = ["detective", "witness", "dog", "inspector", "trade"].includes(event.cardId)
      && event.noEffectTrade !== true;
    if (targetRequired && (!validPlayer(event.targetId) || event.targetId === event.actorId)) {
      errors.push(`criminaldance_card_played ${event.cardId} requires another configured target.`);
    }
    if (!targetRequired && event.targetId !== null) {
      errors.push(`criminaldance_card_played ${event.cardId} requires targetId null.`);
    }
  }
  if (event.type === "criminaldance_forced_action_settled") {
    if (!Number.isInteger(event.roundIndex) || event.roundIndex < 1
      || !["first_finder", "dog_discard", "information_exchange", "rumor_draw", "trade_reply"].includes(event.actionType)
      || !Array.isArray(event.participantIds) || event.participantIds.some((id) => !validPlayer(id))) {
      errors.push("criminaldance_forced_action_settled has an invalid round, actionType, or participantIds.");
    }
  }
  if (event.type === "criminaldance_inspector_marker_observed") {
    if (!Number.isInteger(event.roundIndex) || event.roundIndex < 1
      || !validPlayer(event.actorId) || !validPlayer(event.targetId) || event.actorId === event.targetId
      || event.markerVisibleToAll !== true
      || ![null, "inspector_caught_culprit"].includes(event.overrideOutcomeId)) {
      errors.push("criminaldance_inspector_marker_observed requires a public marker between two configured players and a valid optional override outcome.");
    }
  }
  if (event.type === "criminaldance_juvenile_clue_isolation_checked") {
    if (!Number.isInteger(event.roundIndex) || event.roundIndex < 1
      || event.participantCount !== ids.length || event.holderPromptCount !== 1
      || event.nonHolderPromptCount !== 0 || !Array.isArray(event.privateEvidenceRefs)
      || event.privateEvidenceRefs.length !== 1
      || event.privateEvidenceRefs.some((ref) => !String(ref || "").trim())) {
      errors.push("criminaldance_juvenile_clue_isolation_checked requires one private holder prompt, zero non-holder prompts, and one opaque private evidence reference.");
    }
  }
  if (event.type === "criminaldance_round_settled") {
    if (!Number.isInteger(event.roundIndex) || event.roundIndex < 1 || !ROUND_OUTCOMES.has(event.outcomeId)
      || !validPlayer(event.actorId) || !validPlayer(event.culpritId)) {
      errors.push("criminaldance_round_settled has an invalid round, outcomeId, actorId, or culpritId.");
    }
    exactPlayerMap(event.scoreDeltas, context, "criminaldance_round_settled.scoreDeltas", errors);
    exactPlayerMap(event.totalScores, context, "criminaldance_round_settled.totalScores", errors);
    for (const field of ["playedCards", "publicCards"]) {
      if (!isObject(event[field]) || !sameMembers(Object.keys(event[field]), ids)
        || Object.values(event[field] || {}).some((cards) => !Array.isArray(cards)
          || cards.some((card) => !CARD_IDS.has(String(card))))) {
        errors.push(`criminaldance_round_settled.${field} must contain valid public card arrays for every configured player.`);
      }
    }
  }
  if (event.type === "criminaldance_match_settled") {
    if (!Array.isArray(event.winnerIds) || !event.winnerIds.length
      || new Set(event.winnerIds.map(String)).size !== event.winnerIds.length
      || event.winnerIds.some((id) => !validPlayer(id))) {
      errors.push("criminaldance_match_settled requires unique configured winnerIds.");
    }
    exactPlayerMap(event.totalScores, context, "criminaldance_match_settled.totalScores", errors);
    if (event.targetScore !== WINNING_SCORE) errors.push(`criminaldance_match_settled.targetScore must be ${WINNING_SCORE}.`);
  }
}

function validateRound(round, index, context, previousScores, errors) {
  const label = `Game ${context.gameIndex} Criminal Dance round ${index + 1}`;
  if (!isObject(round) || round.roundIndex !== index + 1 || !ROUND_OUTCOMES.has(String(round.outcomeId || ""))) {
    errors.push(`${label} has an invalid roundIndex or outcomeId.`);
    return previousScores;
  }
  const ids = playerIds(context);
  if (!ids.includes(String(round.actorId)) || !ids.includes(String(round.culpritId))) {
    errors.push(`${label} requires configured actorId and culpritId.`);
  }
  const deltas = exactPlayerMap(round.scoreDeltas, context, `${label}.scoreDeltas`, errors);
  const totals = exactPlayerMap(round.totalScores, context, `${label}.totalScores`, errors);
  for (const field of ["playedCards", "publicCards"]) {
    if (!isObject(round[field])) {
      errors.push(`${label} requires public ${field}.`);
      continue;
    }
    if (!sameMembers(Object.keys(round[field]), ids)) errors.push(`${label}.${field} must contain every player.`);
    Object.entries(round[field]).forEach(([id, cards]) => {
      if (!Array.isArray(cards) || cards.some((card) => !CARD_IDS.has(String(card)))) {
        errors.push(`${label}.${field}.${id} contains an invalid card.`);
      }
    });
  }
  ids.forEach((id) => {
    if (Number(totals[id]) !== Number(previousScores[id] || 0) + Number(deltas[id] || 0)) {
      errors.push(`${label} score continuity failed for ${id}.`);
    }
  });
  return totals;
}

function validateResult(result, context, errors) {
  const label = `Game ${context.gameIndex} Criminal Dance result`;
  if (!isObject(result)) {
    errors.push(`${label} must be an object.`);
    return;
  }
  if (result.outcomeId !== "match_score_threshold") errors.push(`${label}.outcomeId must be match_score_threshold.`);
  if (result.targetScore !== WINNING_SCORE) errors.push(`${label}.targetScore must be ${WINNING_SCORE}.`);
  if (!String(result.summary || "").trim()) errors.push(`${label} requires summary.`);
  const ids = playerIds(context);
  const totals = exactPlayerMap(result.totalScores, context, `${label}.totalScores`, errors);
  if (!Array.isArray(result.rounds) || !result.rounds.length) {
    errors.push(`${label} requires at least one visible round summary.`);
  } else {
    let running = Object.fromEntries(ids.map((id) => [id, 0]));
    result.rounds.forEach((round, index) => { running = validateRound(round, index, context, running, errors); });
    if (JSON.stringify(running) !== JSON.stringify(totals)) errors.push(`${label} totals differ from the final round.`);
  }
  const maximum = Math.max(...ids.map((id) => Number(totals[id])));
  const expectedWinners = ids.filter((id) => Number(totals[id]) === maximum);
  if (maximum < WINNING_SCORE) errors.push(`${label} has no score at the visible match threshold.`);
  if (!Array.isArray(result.winnerIds) || !result.winnerIds.length
    || !sameMembers(result.winnerIds, expectedWinners)) {
    errors.push(`${label}.winnerIds must equal every visible top-scoring player.`);
  }
}

function auditRun(context, errors, warnings) {
  const { config, timeline } = context;
  if (config.testPurpose?.approach === "exploratory") {
    const checkpoints = timeline.filter((event) => event.type === "adapter_checkpoint");
    if (!checkpoints.length) errors.push("Exploratory Criminal Dance run requires visible adapter_checkpoint evidence.");
    if (!timeline.some((event) => event.type === "identity_check" && event.gameIndex === 1)) {
      warnings.push("Exploratory Criminal Dance run did not record a generic identity_check.");
    }
    return;
  }
  for (let gameIndex = 1; gameIndex <= config.gamesToPlay; gameIndex += 1) {
    const events = (type) => timeline.filter((event) => event.type === type && event.gameIndex === gameIndex);
    if (events("criminaldance_settings_verified").length !== 1) {
      errors.push(`Game ${gameIndex} requires exactly one criminaldance_settings_verified event.`);
    }
    const starts = events("criminaldance_round_started");
    const rounds = events("criminaldance_round_settled");
    const matches = events("criminaldance_match_settled");
    if (!starts.length || starts.length !== rounds.length) {
      errors.push(`Game ${gameIndex} requires one visible round settlement for every started round.`);
    }
    if (matches.length !== 1) errors.push(`Game ${gameIndex} requires exactly one criminaldance_match_settled event.`);
    const selectedScenarios = new Set(config.testPurpose?.scenarioIds || []);
    if (selectedScenarios.has("inspector_public_marker")
      && events("criminaldance_inspector_marker_observed").length < 1) {
      errors.push(`Game ${gameIndex} scenario inspector_public_marker requires visible Inspector marker evidence.`);
    }
    if (selectedScenarios.has("juvenile_opening_clue")
      && events("criminaldance_juvenile_clue_isolation_checked").length < 1) {
      errors.push(`Game ${gameIndex} scenario juvenile_opening_clue requires isolated opening-clue evidence.`);
    }
    rounds.forEach((round, index) => {
      if (round.roundIndex !== index + 1 || starts[index]?.roundIndex !== round.roundIndex) {
        errors.push(`Game ${gameIndex} round events are not sequential.`);
      }
    });
    const detail = events("result_detail")[0];
    if (!detail?.result) {
      errors.push(`Game ${gameIndex} is missing its normalized Criminal Dance result.`);
      continue;
    }
    const expectedRounds = rounds.map((round) => ({
      roundIndex: round.roundIndex,
      outcomeId: round.outcomeId,
      actorId: round.actorId,
      culpritId: round.culpritId,
      scoreDeltas: round.scoreDeltas,
      totalScores: round.totalScores,
      playedCards: round.playedCards,
      publicCards: round.publicCards
    }));
    if (JSON.stringify(detail.result.rounds || []) !== JSON.stringify(expectedRounds)) {
      errors.push(`Game ${gameIndex} normalized rounds differ from visible round settlement events.`);
    }
    const match = matches[0];
    if (match && (!sameMembers(detail.result.winnerIds || [], match.winnerIds || [])
      || JSON.stringify(detail.result.totalScores) !== JSON.stringify(match.totalScores))) {
      errors.push(`Game ${gameIndex} normalized match result differs from the visible match settlement.`);
    }
  }
}

module.exports = {
  id: "criminaldance",
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
  resultDisclosureKeys: [],
  publicTimelineFields: {
    criminaldance_settings_verified: ["gameIndex", "settings", "selectionSource", "rationale", "rosterOrder", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    criminaldance_round_started: ["gameIndex", "roundIndex", "firstFinderId", "turnOrder", "startingHandSize", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    criminaldance_card_played: ["gameIndex", "roundIndex", "actorId", "cardId", "targetId", "noEffectTrade", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    criminaldance_forced_action_settled: ["gameIndex", "roundIndex", "actionType", "actorId", "participantIds", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    criminaldance_inspector_marker_observed: ["gameIndex", "roundIndex", "actorId", "targetId", "markerVisibleToAll", "overrideOutcomeId", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    criminaldance_juvenile_clue_isolation_checked: ["gameIndex", "roundIndex", "participantCount", "holderPromptCount", "nonHolderPromptCount", "privateEvidenceRefs", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    criminaldance_round_settled: ["gameIndex", "roundIndex", "outcomeId", "actorId", "culpritId", "scoreDeltas", "totalScores", "playedCards", "publicCards", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    criminaldance_match_settled: ["gameIndex", "winnerIds", "totalScores", "targetScore", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"]
  },
  settingsSchema: {
    inspector: { type: "boolean", default: false, ui: "警部擴充" },
    juvenile: { type: "boolean", default: false, ui: "少年擴充" },
    crossFieldRules: ["Both toggles may be enabled together", "Every round uses four cards per player"]
  },
  observationMap: {
    public: ["roomCode", "roster", "hostId", "settings", "readyState", "seatOrder", "phase", "currentPlayerId", "handCounts", "playedCards", "publicCards", "publicLog", "scores"],
    private: ["ownHand", "playableCardsAndReasons", "ownOpeningPrompt", "ownPendingChoices", "ownActionInfo"],
    excluded: ["otherHands", "deckOrder", "serverRoomState", "fixtures"]
  },
  evidenceContract: {
    appendOrder: ["source_evidence", "observation", "decision", "ui_action", "result_evidence"],
    factText: "Each publicFacts/privateFacts text must exactly equal its earlier source evidenceText (or public chat message).",
    evidenceRefs: "Decision evidenceRefs use publicFacts[n], privateFacts[n], legalActions[n], or ownMemory[n] from that same Observation; raw evidence IDs are forbidden.",
    uniqueEvidenceIds: true,
    requiredRunStartEvents: ["product_test", "game_started"]
  },
  decisionMap: {
    canonicalEncoding: "legalActions contains action or action:target; Decision.action contains action only and Decision.targets contains the ordered target list",
    play_card: "play_<cardId> or play_<cardId>:<targetId>; select the matching enabled card/visible target and confirm",
    trade_offer: "play_trade_give_<giveCardId>:<targetId>; this encodes both visible strategic choices before confirmation; play_trade without a target is reserved for the visible no-effect trade-only hand",
    forced_first_finder: "confirm_first_finder",
    forced_dog_discard: "dog_discard_<cardId>",
    information_exchange: "information_exchange_<cardId>:<renderedRecipientId>",
    rumor_draw: "every agent uses its own single visible draw control",
    trade_reply: "trade_reply_<cardId>",
    continue_detective_result: "continue_detective_result",
    round_transition: "start_next_round"
  },
  semanticMap: {
    phases: ["entry", "lobby", "opening_info", "play", "information_exchange", "rumor", "trade_reply", "dog_discard", "detective_result", "round_result", "match_result"],
    actions: ["create_room", "join_room", "roll_d100", "toggle_ready", "start_game", "play_card", "select_target", "confirm_action", "cancel_action", "resolve_forced_action", "start_next_round", "reset_match"],
    privateRegions: ["own_hand", "own_playable_reasons", "own_opening_prompt", "own_pending_choices", "own_action_info"],
    publicRegions: ["room_code", "roster", "host_settings", "phase_header", "player_matrix", "played_piles", "public_cards", "public_log", "scoreboard", "terminal_result"]
  },
  journeys: {
    discover_user_journeys: ["create", "join", "settings", "ready", "play", "reconnect", "round_result", "match_result"],
    create_join_complete_match: ["create", "join", "configure", "ready", "complete_rounds_to_10", "normalize_terminal"]
  },
  scenarios: {
    forced_first_finder: { controls: ["opening confirmation"], autonomous: ["all strategic card choices"] },
    detective_resolution: { controls: ["exercise a legal detective target when naturally available"], autonomous: ["target choice"] },
    dog_forced_discard: { controls: ["exercise Dog when naturally available"], autonomous: ["target and discarded card"] },
    witness_visibility: { controls: ["exercise Witness when naturally available"], autonomous: ["target"] },
    information_exchange: { controls: ["exercise Information Exchange when naturally available"], autonomous: ["each passed card"] },
    rumor_simultaneous_draw: { controls: ["exercise Rumor when naturally available"], autonomous: [] },
    trade_exchange: { controls: ["exercise Trade when naturally available"], autonomous: ["target and exchanged cards"] },
    culprit_last_card: { controls: ["continue until Culprit is legally last"], autonomous: ["all strategic choices"] },
    inspector_public_marker: {
      status: "planned",
      requiresSettings: { inspector: true },
      controls: ["enable the visible Inspector expansion toggle", "require a naturally dealt Inspector marker checkpoint"],
      autonomous: ["all card and target decisions"]
    },
    juvenile_opening_clue: {
      status: "planned",
      requiresSettings: { juvenile: true },
      controls: ["enable the visible Juvenile expansion toggle", "require a naturally dealt private opening-clue isolation checkpoint"],
      autonomous: ["all card and target decisions"]
    }
  },
  normalizedResultSchema: {
    outcomeId: "match_score_threshold",
    winnerIds: "configured player ids tied at the highest visible score",
    targetScore: WINNING_SCORE,
    totalScores: "exact configured-player map",
    rounds: "ordered public round settlement summaries with playedCards and publicCards",
    summary: "visible terminal explanation"
  }
};
