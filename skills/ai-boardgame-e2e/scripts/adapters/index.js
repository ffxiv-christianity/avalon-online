"use strict";

const path = require("path");

const SKILL_ROOT = path.resolve(__dirname, "..", "..");
const PURPOSE_SOURCES = new Set(["user_questionnaire", "ai_recommended", "provided_config"]);
const PURPOSE_APPROACHES = new Set(["natural_user", "targeted_scenario", "exploratory", "mixed"]);
const COMPLETION_REQUIREMENT_KINDS = new Set([
  "terminal_visible",
  "cross_tab_final_state",
  "checkpoint"
]);
const COMPLETION_REQUIREMENT_SCOPES = new Set(["per_execution", "across_run"]);
const DEFAULT_COMPLETION_REQUIREMENTS = Object.freeze([
  Object.freeze({ id: "visible_terminal", kind: "terminal_visible" }),
  Object.freeze({ id: "cross_tab_result", kind: "cross_tab_final_state" })
]);
const USER_PERSPECTIVES = new Set(["first_time_player", "regular_player", "experienced_player", "mixed_experience"]);
const FOCUS_AREAS = new Set([
  "onboarding",
  "room_flow",
  "settings",
  "core_gameplay",
  "information_isolation",
  "timing",
  "reconnect",
  "usability",
  "accessibility",
  "result_consistency",
  "custom"
]);

function safeIdentifier(value, label, errors) {
  const text = String(value || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(text)) errors.push(`${label} must be a safe lowercase identifier.`);
  return text;
}

function normalizedRequirements(value, label, errors, fallback = []) {
  const source = value === undefined ? fallback : value;
  if (!Array.isArray(source)) {
    errors.push(`${label} must be an array.`);
    return [];
  }
  const requirements = source.map((item, index) => {
    const requirement = item && typeof item === "object" && !Array.isArray(item) ? item : {};
    if (requirement !== item) errors.push(`${label}[${index}] must be an object.`);
    const id = safeIdentifier(requirement.id, `${label}[${index}].id`, errors);
    const kind = String(requirement.kind || "");
    if (!COMPLETION_REQUIREMENT_KINDS.has(kind)) {
      errors.push(`${label}[${index}].kind must be terminal_visible, cross_tab_final_state, or checkpoint.`);
    }
    const allowedKeys = new Set(["id", "kind", "checkpointId", "scope"]);
    const unexpected = Object.keys(requirement).filter((key) => !allowedKeys.has(key));
    if (unexpected.length) errors.push(`${label}[${index}] has unknown fields: ${unexpected.join(", ")}.`);
    const normalized = { id, kind };
    if (requirement.scope !== undefined) {
      const scope = String(requirement.scope || "");
      if (!COMPLETION_REQUIREMENT_SCOPES.has(scope)) {
        errors.push(`${label}[${index}].scope must be per_execution or across_run.`);
      } else if (kind !== "checkpoint") {
        errors.push(`${label}[${index}].scope is only valid for checkpoint requirements.`);
      } else {
        normalized.scope = scope;
      }
    }
    if (kind === "checkpoint") {
      normalized.checkpointId = safeIdentifier(
        requirement.checkpointId || id,
        `${label}[${index}].checkpointId`,
        errors
      );
    } else if (requirement.checkpointId !== undefined) {
      errors.push(`${label}[${index}].checkpointId is only valid for checkpoint requirements.`);
    }
    return normalized;
  });
  if (new Set(requirements.map((item) => item.id)).size !== requirements.length) {
    errors.push(`${label} ids must be unique.`);
  }
  return requirements;
}

function sortedRequirements(requirements) {
  return [...requirements].sort((left, right) => left.id.localeCompare(right.id));
}

function mergeCompletionRequirements(declarations, errors) {
  const merged = new Map();
  for (const { requirements, label } of declarations) {
    for (const requirement of requirements) {
      const existing = merged.get(requirement.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(requirement)) {
        errors.push(`${label} conflicts with another completion requirement named ${requirement.id}.`);
      } else if (!existing) {
        merged.set(requirement.id, requirement);
      }
    }
  }
  return sortedRequirements([...merged.values()]);
}

function loadAdapter(catalogEntry) {
  const relative = String(catalogEntry?.adapterModule || "");
  if (!relative || path.isAbsolute(relative) || relative.includes("..")) {
    throw new Error("Catalog adapterModule must be a safe Skill-relative path.");
  }
  const resolved = path.resolve(SKILL_ROOT, relative);
  if (!resolved.startsWith(`${SKILL_ROOT}${path.sep}`)) throw new Error("Adapter module escapes the Skill directory.");
  return require(resolved);
}

function resolveGenericPurpose(value, context, errors) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (input !== value) errors.push("testPurpose must be an object produced by the questionnaire or an explicit AI recommendation.");
  const selectionSource = String(input.selectionSource || "");
  const approach = String(input.approach || "");
  const userPerspective = String(input.userPerspective || "");
  const objective = String(input.objective || "").trim();
  if (!PURPOSE_SOURCES.has(selectionSource)) errors.push("testPurpose.selectionSource is required and must identify questionnaire, AI recommendation, or provided config.");
  if (!PURPOSE_APPROACHES.has(approach)) errors.push("testPurpose.approach must be natural_user, targeted_scenario, exploratory, or mixed.");
  if (!USER_PERSPECTIVES.has(userPerspective)) errors.push("testPurpose.userPerspective is invalid.");
  if (!objective) errors.push("testPurpose.objective is required; the validator never invents a test objective.");
  if (input.completionMode !== undefined || input.requiredCheckpointIds !== undefined) {
    errors.push("testPurpose completionMode/requiredCheckpointIds were retired; select Adapter journeys/scenarios and use their derived completionRequirements.");
  }
  if (selectionSource === "ai_recommended" && !String(input.recommendationRationale || "").trim()) {
    errors.push("AI-recommended testPurpose requires recommendationRationale.");
  }

  const focusAreas = Array.isArray(input.focusAreas)
    ? [...new Set(input.focusAreas.map((item) => String(item)))]
    : [];
  if (!focusAreas.length) errors.push("testPurpose.focusAreas requires at least one user-visible quality area.");
  focusAreas.forEach((focus) => {
    if (!FOCUS_AREAS.has(focus)) errors.push(`Unknown testPurpose focus area: ${focus}.`);
  });

  const availableJourneys = new Map((context.catalogEntry.capabilities?.journeys || [])
    .map((item) => [String(item.id), item]));
  const journeyIds = Array.isArray(input.journeyIds)
    ? [...new Set(input.journeyIds.map((item) => safeIdentifier(item, "testPurpose.journeyIds[]", errors)))]
    : [];
  if (!journeyIds.length) errors.push("testPurpose.journeyIds requires at least one Adapter-declared user journey.");
  journeyIds.forEach((id) => {
    if (!availableJourneys.has(id)) errors.push(`Adapter does not declare user journey: ${id}.`);
  });

  const availableScenarios = new Map((context.catalogEntry.capabilities?.scenarios || [])
    .map((item) => [String(item.id), item]));
  const scenarioIds = Array.isArray(input.scenarioIds)
    ? [...new Set(input.scenarioIds.map((item) => safeIdentifier(item, "testPurpose.scenarioIds[]", errors)))]
    : [];
  scenarioIds.forEach((id) => {
    if (!availableScenarios.has(id)) errors.push(`Adapter does not declare scenario: ${id}.`);
  });
  if (approach === "targeted_scenario" && !scenarioIds.length) {
    errors.push("targeted_scenario requires at least one Adapter-declared scenarioId.");
  }
  if (approach === "natural_user" && scenarioIds.length) {
    errors.push("natural_user cannot force scenarioIds; use mixed or targeted_scenario.");
  }
  if (approach === "exploratory" && context.catalogEntry.status !== "planned") {
    errors.push("exploratory is reserved for discovering or drafting an unavailable Adapter.");
  }

  const selectedJourneys = journeyIds.map((id) => availableJourneys.get(id)).filter(Boolean);
  const selectedScenarios = scenarioIds.map((id) => availableScenarios.get(id)).filter(Boolean);
  const completionRequirements = mergeCompletionRequirements([
    ...selectedJourneys.map((item) => ({
      label: `Journey ${item.id}`,
      requirements: normalizedRequirements(
        item.completionRequirements,
        `journey ${item.id}.completionRequirements`,
        errors,
        DEFAULT_COMPLETION_REQUIREMENTS
      )
    })),
    ...selectedScenarios.map((item) => ({
      label: `Scenario ${item.id}`,
      requirements: normalizedRequirements(
        item.completionRequirements,
        `scenario ${item.id}.completionRequirements`,
        errors
      )
    }))
  ], errors);
  if (!completionRequirements.length) {
    errors.push("Selected journeys must derive at least one completion requirement.");
  }
  if (input.completionRequirements !== undefined) {
    const supplied = normalizedRequirements(
      input.completionRequirements,
      "testPurpose.completionRequirements",
      errors
    );
    if (JSON.stringify(sortedRequirements(supplied)) !== JSON.stringify(completionRequirements)) {
      errors.push("testPurpose.completionRequirements is Adapter-derived and cannot differ from the selected journey/scenario contract.");
    }
  }

  const successCriteria = Array.isArray(input.successCriteria) ? input.successCriteria.map((criterion, index) => {
    const id = safeIdentifier(criterion?.id, `testPurpose.successCriteria[${index}].id`, errors);
    const description = String(criterion?.description || "").trim();
    const oracle = String(criterion?.oracle || "visible_ui");
    if (!description) errors.push(`testPurpose.successCriteria[${index}].description is required.`);
    if (!context.catalogEntry.capabilities?.oracles?.includes(oracle) && !["visible_ui", "public_log", "cross_tab_consistency"].includes(oracle)) {
      errors.push(`Unsupported success criterion oracle: ${oracle}.`);
    }
    const scope = criterion?.scope === undefined ? null : String(criterion.scope || "");
    if (scope !== null && !COMPLETION_REQUIREMENT_SCOPES.has(scope)) {
      errors.push(`testPurpose.successCriteria[${index}].scope must be per_execution or across_run.`);
    }
    return {
      id,
      description,
      oracle,
      required: criterion?.required !== false,
      ...(scope ? { scope } : {})
    };
  }) : [];
  if (!successCriteria.length) errors.push("testPurpose.successCriteria requires at least one observable criterion.");
  if (new Set(successCriteria.map((item) => item.id)).size !== successCriteria.length) {
    errors.push("testPurpose.successCriteria ids must be unique.");
  }

  const resolved = {
    selectionSource,
    objective,
    approach,
    userPerspective,
    focusAreas,
    journeyIds,
    scenarioIds,
    completionRequirements,
    scenarioParameters: input.scenarioParameters && typeof input.scenarioParameters === "object"
      ? { ...input.scenarioParameters }
      : {},
    successCriteria,
    recommendationRationale: selectionSource === "ai_recommended" ? String(input.recommendationRationale || "").trim() : null
  };
  if (typeof context.adapter.resolvePurpose === "function") {
    return context.adapter.resolvePurpose(resolved, context, errors) || resolved;
  }
  return resolved;
}

module.exports = {
  PURPOSE_SOURCES,
  PURPOSE_APPROACHES,
  COMPLETION_REQUIREMENT_KINDS,
  COMPLETION_REQUIREMENT_SCOPES,
  DEFAULT_COMPLETION_REQUIREMENTS,
  USER_PERSPECTIVES,
  FOCUS_AREAS,
  normalizedRequirements,
  mergeCompletionRequirements,
  loadAdapter,
  resolveGenericPurpose
};
