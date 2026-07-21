"use strict";

const ROLE_LIMITS = Object.freeze({
  doppelganger: 1,
  werewolf: 2,
  minion: 1,
  mason: 2,
  seer: 1,
  robber: 1,
  troublemaker: 1,
  drunk: 1,
  insomniac: 1,
  villager: 6,
  tanner: 1,
  hunter: 1
});

function integer(value, label, min, max, errors, fallback) {
  const resolved = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) errors.push(`${label} must be an integer from ${min} to ${max}.`);
  return resolved;
}

function validateSettings(value, context, errors) {
  const settings = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const deckPreset = String(settings.deckPreset || "recommended");
  const discussionSeconds = integer(settings.discussionSeconds, "gameSettings.discussionSeconds", 120, 900, errors, 300);
  if (context.allowLegacyDiscussionRange !== true && ![180, 300, 420, 600].includes(discussionSeconds)) {
    errors.push("gameSettings.discussionSeconds must match a visible UI option: 180, 300, 420, or 600 seconds.");
  }
  if (!["recommended", "custom"].includes(deckPreset)) errors.push("gameSettings.deckPreset must be recommended or custom.");
  const resolved = { deckPreset, discussionSeconds };
  if (deckPreset === "custom") {
    if (!Array.isArray(settings.customDeck)) {
      errors.push("Custom deck requires gameSettings.customDeck.");
      resolved.customDeck = [];
    } else {
      resolved.customDeck = settings.customDeck.map(String);
      if (resolved.customDeck.length !== context.playerCount + 3) errors.push("One Night Werewolf deck size must equal playerCount + 3.");
      const counts = {};
      resolved.customDeck.forEach((role) => {
        counts[role] = (counts[role] || 0) + 1;
        if (!Object.hasOwn(ROLE_LIMITS, role)) errors.push(`Unknown One Night Werewolf role: ${role}.`);
      });
      Object.entries(counts).forEach(([role, count]) => {
        if (ROLE_LIMITS[role] !== undefined && count > ROLE_LIMITS[role]) errors.push(`${role} exceeds Adapter role limit ${ROLE_LIMITS[role]}.`);
      });
      if ((counts.mason || 0) === 1) errors.push("Mason count must be zero or two.");
    }
  }
  return resolved;
}

function resolvePurpose(purpose, context, errors) {
  const parameters = purpose.scenarioParameters || {};
  const playerIds = context.players.map((player) => player.id);
  const voteScenarios = purpose.scenarioIds.filter((id) => id.startsWith("vote_"));
  if (voteScenarios.length > 1) errors.push("Select at most one One Night Werewolf vote-participation scenario per Run.");
  const voteScenario = voteScenarios[0];
  if (voteScenario === "vote_partial_submission") {
    const voterIds = Array.isArray(parameters.voterIds) ? parameters.voterIds.map(String) : [];
    if (voterIds.length < 1 || voterIds.length >= playerIds.length) errors.push("vote_partial_submission requires a non-empty proper subset in scenarioParameters.voterIds.");
    if (new Set(voterIds).size !== voterIds.length || voterIds.some((id) => !playerIds.includes(id))) {
      errors.push("scenarioParameters.voterIds must be unique configured players.");
    }
  }
  if (["vote_no_submission", "vote_partial_submission"].includes(voteScenario)
    && Number(context.speed.serverTimeScale) < 1) {
    errors.push(`${voteScenario} requires production time because discussion deadline is not scalable.`);
  }
  return purpose;
}

function validateResult(result, context, errors) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    errors.push(`Game ${context.gameIndex} One Night Werewolf result must be an object.`);
    return;
  }
  for (const key of ["headline", "reason", "winner"]) {
    if (!String(result[key] || "").trim()) {
      errors.push(`Game ${context.gameIndex} One Night Werewolf result requires ${key}.`);
    }
  }
  for (const key of ["eliminated", "votes", "finalRoles", "centerCards", "nightHistory"]) {
    const value = result[key];
    if (value === undefined || value === null || (typeof value !== "object" && !Array.isArray(value))) {
      errors.push(`Game ${context.gameIndex} One Night Werewolf result requires structured ${key}.`);
    }
  }
  if (Array.isArray(result.centerCards) && result.centerCards.length !== 3) {
    errors.push(`Game ${context.gameIndex} One Night Werewolf result requires exactly three centerCards.`);
  }
}

function validatePublicEvent(kind, event, _context, errors) {
  if (kind !== "timeline" || event.type !== "vote_participation") return;
  if (!Number.isInteger(event.gameIndex) || event.gameIndex < 1) errors.push("vote_participation requires a positive gameIndex.");
  if (!Array.isArray(event.actualVoterIds) || !Array.isArray(event.nonVoterIds)) {
    errors.push("vote_participation requires actualVoterIds and nonVoterIds arrays.");
  }
  if (!["all_submitted", "deadline", "natural"].includes(String(event.actualSettlementTrigger || ""))) {
    errors.push("vote_participation has an invalid actualSettlementTrigger.");
  }
}

function sameMembers(left, right) {
  return JSON.stringify([...left].map(String).sort()) === JSON.stringify([...right].map(String).sort());
}

function auditRun(context, errors) {
  const scenarios = context.config.testPurpose?.scenarioIds || [];
  const selected = scenarios.find((id) => String(id).startsWith("vote_"));
  if (!selected) return;
  const playerIds = context.config.players.map((player) => player.id);
  const expectedVoters = selected === "vote_all_submission"
    ? playerIds
    : selected === "vote_no_submission"
      ? []
      : (context.config.testPurpose.scenarioParameters?.voterIds || []);
  const expectedNonVoters = playerIds.filter((id) => !expectedVoters.includes(id));
  const expectedTrigger = selected === "vote_all_submission" ? "all_submitted" : "deadline";
  for (let gameIndex = 1; gameIndex <= context.config.gamesToPlay; gameIndex += 1) {
    const matches = context.timeline.filter((event) => event.type === "vote_participation" && event.gameIndex === gameIndex);
    if (matches.length !== 1) {
      errors.push(`Game ${gameIndex} scenario ${selected} requires exactly one vote_participation event.`);
      continue;
    }
    const event = matches[0];
    if (!sameMembers(event.actualVoterIds || [], expectedVoters)) errors.push(`Game ${gameIndex} scenario ${selected} has the wrong voter set.`);
    if (!sameMembers(event.nonVoterIds || [], expectedNonVoters)) errors.push(`Game ${gameIndex} scenario ${selected} has the wrong non-voter set.`);
    if (event.actualSettlementTrigger !== expectedTrigger) errors.push(`Game ${gameIndex} scenario ${selected} has the wrong settlement trigger.`);
    if (expectedTrigger === "deadline"
      && !context.timeline.some((item) => item.type === "deadline_reached" && item.gameIndex === gameIndex)) {
      errors.push(`Game ${gameIndex} scenario ${selected} requires visible deadline_reached evidence.`);
    }
  }
}

module.exports = {
  id: "onenightwolf",
  contractVersion: "2.2",
  validateSettings,
  resolvePurpose,
  validateResult,
  validatePublicEvent,
  auditRun,
  timingIntents: ["vote_now", "abstain_until_deadline"],
  postTerminalEventTypes: ["behavior_evaluation"],
  visibleTerminalMarkerTypes: [],
  resultDisclosureKeys: ["role", "roles", "finalroles", "centercards", "nighthistory"],
  publicTimelineFields: {
    vote_participation: ["gameIndex", "actualVoterIds", "nonVoterIds", "actualSettlementTrigger", "source"],
    discussion_started: ["gameIndex", "discussionSeconds", "deadlineAt", "remainingSeconds", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    deadline_reached: ["gameIndex", "remainingSeconds", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    behavior_evaluation: ["gameIndex", "playerId", "configuredBehavior", "observedIntent", "spoke", "claimAssessment", "settlementEvidence", "settlementEvidenceRef", "withheldFactRefs", "disclosedFactRefs"]
  }
};
