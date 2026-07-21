"use strict";

const oneNightWolf = require("./onenightwolf");

const TEST_MODES = new Set(["natural_play", "behavior_matrix", "rules_matrix"]);
const VOTE_PARTICIPATION_MODES = new Set(["agent_decides", "all", "none", "partial"]);
const SETTLEMENT_TRIGGERS = new Set(["natural", "all_submitted", "deadline"]);

function resolvePurpose(value, context, errors) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (input !== value) errors.push("testPurpose must be an object with an explicit mode.");
  else if (!Object.hasOwn(value, "mode") || !String(value.mode || "").trim()) errors.push("testPurpose.mode is required.");
  const mode = String(input.mode || "natural_play");
  if (!TEST_MODES.has(mode)) errors.push("testPurpose.mode must be natural_play, behavior_matrix, or rules_matrix.");

  if (mode === "natural_play" || mode === "behavior_matrix") {
    const voteParticipation = String(input.voteParticipation || "agent_decides");
    const settlementTrigger = String(input.settlementTrigger || "natural");
    const decisionPacing = String(input.decisionPacing || "human_like");
    if (voteParticipation !== "agent_decides") errors.push(`${mode} requires testPurpose.voteParticipation: agent_decides.`);
    if (settlementTrigger !== "natural") errors.push(`${mode} requires testPurpose.settlementTrigger: natural.`);
    if (decisionPacing !== "human_like") errors.push(`${mode} requires testPurpose.decisionPacing: human_like.`);
    if (Array.isArray(input.voterIds) && input.voterIds.length) errors.push(`${mode} cannot preselect voterIds.`);
    if (input.allowNonVoting === false) errors.push(`${mode} must allow an agent to decide not to vote; use rules_matrix to force participation.`);
    return {
      mode,
      voteParticipation: "agent_decides",
      settlementTrigger: "natural",
      decisionPacing: "human_like",
      allowNonVoting: true
    };
  }

  const voteParticipation = String(input.voteParticipation || "all");
  if (!VOTE_PARTICIPATION_MODES.has(voteParticipation) || voteParticipation === "agent_decides") {
    errors.push("rules_matrix voteParticipation must be all, none, or partial.");
  }
  const defaultTrigger = voteParticipation === "all" ? "all_submitted" : "deadline";
  const settlementTrigger = String(input.settlementTrigger || defaultTrigger);
  if (!SETTLEMENT_TRIGGERS.has(settlementTrigger) || settlementTrigger === "natural") {
    errors.push("rules_matrix settlementTrigger must be all_submitted or deadline.");
  }
  if (voteParticipation === "all" && settlementTrigger !== "all_submitted") {
    errors.push("rules_matrix all voters must settle through all_submitted.");
  }
  if (["none", "partial"].includes(voteParticipation) && settlementTrigger !== "deadline") {
    errors.push("rules_matrix none/partial participation must settle through deadline.");
  }

  const playerIds = context.players.map((player) => player.id);
  const supplied = Array.isArray(input.voterIds) ? input.voterIds.map(String) : [];
  if (new Set(supplied).size !== supplied.length) errors.push("testPurpose.voterIds must be unique.");
  if (supplied.some((id) => !playerIds.includes(id))) errors.push("testPurpose.voterIds contains an unknown player.");
  let voterIds;
  if (voteParticipation === "all") {
    voterIds = supplied.length ? supplied : [...playerIds];
    if (voterIds.length !== playerIds.length || playerIds.some((id) => !voterIds.includes(id))) {
      errors.push("rules_matrix all participation must include every player in voterIds.");
    }
  } else if (voteParticipation === "none") {
    voterIds = supplied;
    if (voterIds.length) errors.push("rules_matrix none participation requires empty voterIds.");
  } else {
    voterIds = supplied;
    if (voterIds.length < 1 || voterIds.length >= playerIds.length) {
      errors.push("rules_matrix partial participation requires a non-empty proper subset of voterIds.");
    }
  }
  return {
    mode: "rules_matrix",
    voteParticipation,
    settlementTrigger,
    decisionPacing: "scripted",
    voterIds
  };
}

function validateSettings(game, value, context, errors) {
  if (game === "onenightwolf") {
    return oneNightWolf.validateSettings(value, { ...context, allowLegacyDiscussionRange: true }, errors);
  }
  const settings = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
  const integer = context.integer;
  if (game === "loveletter" && settings.targetScore !== undefined) {
    settings.targetScore = integer(settings.targetScore, "gameSettings.targetScore", 1, 9, errors, undefined);
  }
  if (game === "criminaldance" && settings.expansions !== undefined) {
    settings.expansions = {
      inspector: Boolean(settings.expansions?.inspector),
      boy: Boolean(settings.expansions?.boy)
    };
  }
  if (game === "gangsi") {
    const mode = String(settings.mode || "classic");
    if (!["classic", "hunt"].includes(mode)) errors.push("Gangsi mode must be classic or hunt.");
    if (mode === "hunt" && context.playerCount < 3) errors.push("Gangsi hunt mode requires at least three players.");
    settings.mode = mode;
    settings.randomMap = Boolean(settings.randomMap);
    if (!settings.randomMap && !String(settings.mapId || "").trim()) errors.push("Gangsi fixed-map settings require mapId.");
  }
  return settings;
}

function validateResolvedPurpose(purpose, context, errors) {
  if (purpose.mode === "rules_matrix"
    && ["none", "partial"].includes(purpose.voteParticipation)
    && Number(context.speed.serverTimeScale) < 1) {
    errors.push("rules_matrix none/partial deadline scenarios require serverTimeScale: 1.0.");
  }
}

module.exports = {
  id: "onenightwolf-legacy-v1",
  contractVersion: "1.0-compatibility",
  resolvePurpose,
  validateSettings,
  validateResolvedPurpose,
  timingIntents: ["vote_now", "abstain_until_deadline"],
  postTerminalEventTypes: ["settlement_detail", "behavior_evaluation"],
  visibleTerminalMarkerTypes: ["settlement_visible"],
  resultDisclosureKeys: ["role", "roles", "finalroles", "centercards", "nighthistory"],
  publicTimelineFields: {
    discussion_started: ["gameIndex", "discussionSeconds", "deadlineAt", "remainingSeconds", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    deadline_reached: ["gameIndex", "remainingSeconds", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    settlement_visible: ["gameIndex", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    vote_participation: ["gameIndex", "actualVoterIds", "nonVoterIds", "actualSettlementTrigger", "source"],
    settlement_detail: ["gameIndex", "headline", "reason", "winner", "eliminated", "votes", "finalRoles", "centerCards", "nightHistory"],
    behavior_evaluation: ["gameIndex", "playerId", "configuredBehavior", "observedIntent", "spoke", "claimAssessment", "settlementEvidence", "settlementEvidenceRef", "withheldFactRefs", "disclosedFactRefs"]
  }
};
