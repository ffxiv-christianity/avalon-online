"use strict";

const BASELINE_PLAYER_COUNT = 5;
const BASELINE_TEAM_SIZES = Object.freeze([2, 3, 2, 3, 3]);
const BASELINE_ASSIGNMENTS = Object.freeze([
  "merlin",
  "percival",
  "loyal_servant",
  "morgana",
  "assassin"
]);
const WINNERS = new Set(["good", "evil"]);
const OUTCOMES = Object.freeze({
  good_assassination_miss: { winner: "good", reason: "assassin_missed_merlin", assassination: true },
  evil_assassination_hit: { winner: "evil", reason: "assassin_hit_merlin", assassination: true },
  evil_three_failed_quests: { winner: "evil", reason: "three_failed_quests", assassination: false },
  evil_five_rejected_proposals: { winner: "evil", reason: "five_rejected_proposals", assassination: false }
});

function sameMembers(left, right) {
  return JSON.stringify([...left].map(String).sort()) === JSON.stringify([...right].map(String).sort());
}

function exactPlayers(value, context, label, errors) {
  const configured = context.config?.players || context.players || [];
  const configuredIds = configured.map((player) => String(player.id));
  const actual = Array.isArray(value) ? value.map(String) : [];
  if (actual.length !== configuredIds.length
    || new Set(actual).size !== actual.length
    || actual.some((id) => !configuredIds.includes(id))) {
    errors.push(`${label} must contain every configured Avalon player exactly once.`);
  }
  return actual;
}

function validateSettings(value, context, errors) {
  const settings = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const allowed = new Set([
    "deckPreset",
    "leaderMode",
    "publicResultDelaySeconds",
    "excalibur",
    "ladyOfTheLake",
    "questTeamSizes"
  ]);
  Object.keys(settings).forEach((key) => {
    if (!allowed.has(key)) errors.push(`Unknown Avalon gameSettings field: ${key}.`);
  });
  if (context.playerCount !== BASELINE_PLAYER_COUNT) {
    errors.push("The experimental Avalon Adapter currently executes only the visible five-player baseline.");
  }
  const deckPreset = String(settings.deckPreset || "recommended");
  const leaderMode = String(settings.leaderMode || "standard");
  const publicResultDelaySeconds = settings.publicResultDelaySeconds === undefined
    ? 0
    : Number(settings.publicResultDelaySeconds);
  const excalibur = settings.excalibur === true;
  const ladyOfTheLake = settings.ladyOfTheLake === true;
  const questTeamSizes = Array.isArray(settings.questTeamSizes)
    ? settings.questTeamSizes.map(Number)
    : [...BASELINE_TEAM_SIZES];

  if (deckPreset !== "recommended") {
    errors.push("The experimental Avalon Adapter currently supports only the visible 5-player recommended deck.");
  }
  if (leaderMode !== "standard") {
    errors.push("The experimental Avalon Adapter currently supports only the visible standard clockwise leader mode.");
  }
  if (publicResultDelaySeconds !== 0) {
    errors.push("The experimental Avalon baseline requires the visible no-delay public-result option.");
  }
  if (excalibur || ladyOfTheLake) {
    errors.push("Avalon expansion rules are mapped but are not yet executable certification settings.");
  }
  if (questTeamSizes.length !== BASELINE_TEAM_SIZES.length
    || questTeamSizes.some((size, index) => !Number.isInteger(size) || size !== BASELINE_TEAM_SIZES[index])) {
    errors.push("The five-player recommended Avalon quest team sizes must be 2, 3, 2, 3, 3.");
  }
  return {
    deckPreset,
    leaderMode,
    publicResultDelaySeconds,
    excalibur,
    ladyOfTheLake,
    questTeamSizes
  };
}

function resolvePurpose(purpose, _context, errors) {
  if (purpose.approach === "exploratory") {
    errors.push("Avalon now has an experimental executable Adapter; use natural_user, mixed, or a declared targeted scenario.");
  }
  if (purpose.scenarioIds.length) {
    errors.push("The experimental Avalon Adapter does not yet declare targeted scenarios.");
  }
  return purpose;
}

function validateEvidence(event, label, errors) {
  if (event.source !== "visible_dom" || event.contentClass !== "public_ui"
    || !String(event.evidenceId || "") || !String(event.evidenceText || "")) {
    errors.push(`${label} requires visible_dom public_ui evidence with evidenceId and evidenceText.`);
  }
}

function validatePublicEvent(kind, event, context, errors) {
  if (kind !== "timeline" || !String(event.type || "").startsWith("avalon_")) return;
  validateEvidence(event, event.type, errors);
  if (!Number.isInteger(event.gameIndex) || event.gameIndex < 1) {
    errors.push(`${event.type} requires a positive gameIndex.`);
  }
  const playerIds = (context.config?.players || []).map((player) => String(player.id));
  const validPlayer = (id) => playerIds.includes(String(id));
  if (event.type === "avalon_settings_verified") {
    exactPlayers(event.rosterOrder, context, "avalon_settings_verified.rosterOrder", errors);
    if (event.selectionSource !== "ai_recommended" || !String(event.rationale || "").trim()) {
      errors.push("avalon_settings_verified requires the AI selection source and a concrete rationale.");
    }
    const resolvedErrors = [];
    const resolved = validateSettings(event.settings, {
      playerCount: context.config?.playerCount,
      players: context.config?.players,
      config: context.config
    }, resolvedErrors);
    if (resolvedErrors.length) errors.push(...resolvedErrors.map((message) => `avalon_settings_verified: ${message}`));
    if (JSON.stringify(resolved) !== JSON.stringify(context.config?.gameSettings)) {
      errors.push("avalon_settings_verified settings differ from the resolved config.");
    }
  }
  if (event.type === "avalon_proposal_settled") {
    if (!Number.isInteger(event.questIndex) || event.questIndex < 1 || event.questIndex > 5
      || !Number.isInteger(event.proposalIndex) || event.proposalIndex < 1) {
      errors.push("avalon_proposal_settled requires valid questIndex and proposalIndex.");
    }
    if (!validPlayer(event.leaderId)) errors.push("avalon_proposal_settled leaderId is not configured.");
    if (!Array.isArray(event.teamIds) || new Set(event.teamIds.map(String)).size !== event.teamIds.length
      || event.teamIds.some((id) => !validPlayer(id))
      || event.teamIds.length !== event.requiredTeamSize) {
      errors.push("avalon_proposal_settled team must contain the visible required number of unique configured players.");
    }
  }
  if (event.type === "avalon_team_vote_settled") {
    const ballotIds = Object.keys(event.ballots || {});
    if (!exactPlayers(ballotIds, context, "avalon_team_vote_settled.ballots", errors).length) return;
    if (Object.values(event.ballots || {}).some((vote) => !["approve", "reject"].includes(String(vote)))) {
      errors.push("avalon_team_vote_settled ballots must be approve or reject.");
    }
    const approvals = Object.values(event.ballots || {}).filter((vote) => vote === "approve").length;
    const rejections = playerIds.length - approvals;
    if (event.approvals !== approvals || event.rejections !== rejections
      || event.approved !== (approvals > rejections)) {
      errors.push("avalon_team_vote_settled totals do not match the visible ballots.");
    }
    if (!Number.isInteger(event.rejectionStreakAfter) || event.rejectionStreakAfter < 0 || event.rejectionStreakAfter > 5) {
      errors.push("avalon_team_vote_settled requires rejectionStreakAfter from 0 to 5.");
    }
  }
  if (event.type === "avalon_quest_settled") {
    if (!Number.isInteger(event.submissionCount) || event.submissionCount !== event.teamIds?.length
      || !Number.isInteger(event.failCards) || event.failCards < 0
      || !Number.isInteger(event.failsRequired) || event.failsRequired < 1
      || !["success", "failure"].includes(String(event.outcome || ""))
      || event.outcome !== (event.failCards >= event.failsRequired ? "failure" : "success")) {
      errors.push("avalon_quest_settled aggregate quest fields are inconsistent.");
    }
  }
  if (event.type === "avalon_leader_rotated") {
    if (!validPlayer(event.fromLeaderId) || !validPlayer(event.toLeaderId)
      || event.fromLeaderId === event.toLeaderId || event.leaderMode !== "standard") {
      errors.push("avalon_leader_rotated requires distinct configured players in standard mode.");
    }
  }
  if (event.type === "avalon_assassination_settled") {
    if (!validPlayer(event.targetId) || !["good_assassination_miss", "evil_assassination_hit"].includes(event.outcomeId)) {
      errors.push("avalon_assassination_settled requires a configured target and assassination outcome.");
    }
  }
}

function validateResult(result, context, errors) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    errors.push(`Game ${context.gameIndex} Avalon result must be an object.`);
    return;
  }
  const outcome = OUTCOMES[String(result.outcomeId || "")];
  if (!outcome) errors.push(`Game ${context.gameIndex} Avalon result has an unknown outcomeId.`);
  if (!WINNERS.has(String(result.winner || ""))) errors.push(`Game ${context.gameIndex} Avalon result requires winner good or evil.`);
  if (!String(result.summary || "").trim()) errors.push(`Game ${context.gameIndex} Avalon result requires summary.`);
  if (outcome && (result.winner !== outcome.winner || result.reason !== outcome.reason)) {
    errors.push(`Game ${context.gameIndex} Avalon winner/reason do not match outcomeId.`);
  }
  const configuredIds = (context.config?.players || []).map((player) => String(player.id));
  const assignments = result.revealedAssignments;
  if (!assignments || typeof assignments !== "object" || Array.isArray(assignments)
    || !sameMembers(Object.keys(assignments), configuredIds)) {
    errors.push(`Game ${context.gameIndex} Avalon result must reveal one assignment for every configured player.`);
  } else {
    const assignmentValues = Object.values(assignments).map(String);
    if (!sameMembers(assignmentValues, BASELINE_ASSIGNMENTS)) {
      errors.push(`Game ${context.gameIndex} Avalon baseline assignments must match the visible recommended deck.`);
    }
  }
  if (outcome?.assassination) {
    if (!configuredIds.includes(String(result.assassinationTargetId || ""))) {
      errors.push(`Game ${context.gameIndex} assassination result requires a configured assassinationTargetId.`);
    }
  } else if (result.assassinationTargetId !== null) {
    errors.push(`Game ${context.gameIndex} non-assassination result requires assassinationTargetId null.`);
  }
  if (!Array.isArray(result.quests) || !result.quests.length || result.quests.length > 5) {
    errors.push(`Game ${context.gameIndex} Avalon result requires one to five public quest summaries.`);
  } else {
    result.quests.forEach((quest, index) => {
      if (quest.questIndex !== index + 1 || !["success", "failure"].includes(String(quest.outcome || ""))
        || !Array.isArray(quest.teamIds) || !Number.isInteger(quest.failCards)
        || !Number.isInteger(quest.failsRequired)) {
        errors.push(`Game ${context.gameIndex} Avalon quest summary ${index + 1} is invalid.`);
      }
    });
  }
}

function auditRun(context, errors) {
  const { config, timeline } = context;
  for (let gameIndex = 1; gameIndex <= config.gamesToPlay; gameIndex += 1) {
    const byType = (type) => timeline.filter((event) => event.type === type && event.gameIndex === gameIndex);
    const settingsEvents = byType("avalon_settings_verified");
    if (settingsEvents.length !== 1) {
      errors.push(`Game ${gameIndex} requires exactly one avalon_settings_verified event.`);
      continue;
    }
    const roster = settingsEvents[0].rosterOrder || [];
    const proposals = byType("avalon_proposal_settled");
    const votes = byType("avalon_team_vote_settled");
    const quests = byType("avalon_quest_settled");
    const rotations = byType("avalon_leader_rotated");
    const assassinations = byType("avalon_assassination_settled");
    const resultDetail = timeline.find((event) => event.type === "result_detail" && event.gameIndex === gameIndex);
    if (!proposals.length || votes.length !== proposals.length) {
      errors.push(`Game ${gameIndex} requires one settled team vote for every Avalon proposal.`);
    }
    proposals.forEach((proposal, index) => {
      const vote = votes[index];
      const expectedSize = config.gameSettings.questTeamSizes[proposal.questIndex - 1];
      if (proposal.requiredTeamSize !== expectedSize || proposal.teamIds?.length !== expectedSize) {
        errors.push(`Game ${gameIndex} proposal ${index + 1} has the wrong visible quest team size.`);
      }
      if (vote && (vote.questIndex !== proposal.questIndex || vote.proposalIndex !== proposal.proposalIndex
        || vote.leaderId !== proposal.leaderId || !sameMembers(vote.teamIds || [], proposal.teamIds || []))) {
        errors.push(`Game ${gameIndex} proposal ${index + 1} differs from its settled vote.`);
      }
      if (roster.length && proposal.leaderId !== roster[index % roster.length]) {
        errors.push(`Game ${gameIndex} proposal ${index + 1} violates visible clockwise leader order.`);
      }
    });
    if (rotations.length !== Math.max(0, proposals.length - 1)) {
      errors.push(`Game ${gameIndex} requires one visible leader rotation between consecutive proposals.`);
    } else {
      rotations.forEach((rotation, index) => {
        if (rotation.fromLeaderId !== proposals[index]?.leaderId
          || rotation.toLeaderId !== proposals[index + 1]?.leaderId) {
          errors.push(`Game ${gameIndex} leader rotation ${index + 1} differs from consecutive proposals.`);
        }
      });
    }
    const approvedVotes = votes.filter((vote) => vote.approved === true && vote.rejectionStreakAfter < 5);
    if (quests.length !== approvedVotes.length) {
      errors.push(`Game ${gameIndex} requires one public quest settlement for every approved proposal.`);
    }
    quests.forEach((quest, index) => {
      const vote = approvedVotes[index];
      if (!vote || quest.questIndex !== vote.questIndex || !sameMembers(quest.teamIds || [], vote.teamIds || [])) {
        errors.push(`Game ${gameIndex} quest ${quest.questIndex || index + 1} differs from its approved team.`);
      }
    });
    if (!resultDetail?.result) {
      errors.push(`Game ${gameIndex} is missing the normalized Avalon result.`);
      continue;
    }
    const result = resultDetail.result;
    if (JSON.stringify(result.quests || []) !== JSON.stringify(quests.map((quest) => ({
      questIndex: quest.questIndex,
      outcome: quest.outcome,
      teamIds: quest.teamIds,
      failCards: quest.failCards,
      failsRequired: quest.failsRequired
    })))) {
      errors.push(`Game ${gameIndex} normalized quests differ from visible Avalon quest settlements.`);
    }
    if (["assassin_hit_merlin", "assassin_missed_merlin"].includes(result.reason)) {
      if (quests.filter((quest) => quest.outcome === "success").length !== 3 || assassinations.length !== 1
        || assassinations[0]?.targetId !== result.assassinationTargetId
        || assassinations[0]?.outcomeId !== result.outcomeId) {
        errors.push(`Game ${gameIndex} assassination result lacks the matching three-success branch evidence.`);
      }
    } else if (result.reason === "three_failed_quests" && quests.filter((quest) => quest.outcome === "failure").length !== 3) {
      errors.push(`Game ${gameIndex} three-failed-quests result lacks three visible failed quests.`);
    } else if (result.reason === "five_rejected_proposals"
      && !votes.some((vote) => vote.approved === false && vote.rejectionStreakAfter === 5)) {
      errors.push(`Game ${gameIndex} five-rejection result lacks a visible fifth rejection.`);
    }
  }
}

module.exports = {
  id: "avalon",
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
    avalon_settings_verified: ["gameIndex", "settings", "selectionSource", "rationale", "rosterOrder", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    avalon_proposal_settled: ["gameIndex", "questIndex", "proposalIndex", "leaderId", "teamIds", "requiredTeamSize", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    avalon_team_vote_settled: ["gameIndex", "questIndex", "proposalIndex", "leaderId", "teamIds", "ballots", "approvals", "rejections", "approved", "rejectionStreakAfter", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    avalon_quest_settled: ["gameIndex", "questIndex", "teamIds", "submissionCount", "outcome", "failCards", "failsRequired", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    avalon_leader_rotated: ["gameIndex", "questIndex", "fromLeaderId", "toLeaderId", "leaderMode", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"],
    avalon_assassination_settled: ["gameIndex", "targetId", "outcomeId", "source", "evidenceId", "evidenceText", "contentClass", "visibleToPlayerIds"]
  },
  semanticMap: {
    phases: ["identity_confirmation", "team_proposal", "team_vote", "team_vote_result", "quest_submission", "quest_result", "assassination", "terminal"],
    actions: ["acknowledge_identity", "toggle_team_member", "submit_team", "approve_team", "reject_team", "continue_to_quest", "submit_quest_success", "submit_quest_failure", "continue_after_quest", "assassinate_target"],
    privateRegions: ["own_assignment", "own_assignment_information", "own_quest_card_controls", "assassin_target_controls"],
    publicRegions: ["header_state", "room_chat", "roster", "quest_progress", "public_game_log", "terminal_result"]
  }
};
