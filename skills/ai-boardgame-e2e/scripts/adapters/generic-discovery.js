"use strict";

function validateSettings(value, _context, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("gameSettings must be an object, even during Adapter discovery.");
    return {};
  }
  return { ...value };
}

function resolvePurpose(purpose, context, errors) {
  if (purpose.approach !== "exploratory") errors.push(`${context.game} has no executable Adapter; only exploratory discovery is allowed.`);
  return purpose;
}

module.exports = {
  id: "generic-discovery",
  contractVersion: "2.2",
  validateSettings,
  resolvePurpose,
  publicTimelineFields: {}
};
