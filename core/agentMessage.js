// Section 6 — Agent Message Contract. Standard structure every future
// agent uses to report to another agent (or to the Chief Trading
// Manager), so agents depend on structured data rather than free-form
// text alone. `recommendation_type` values are intentionally left
// undefined here — they depend on each agent's own system prompt, none
// of which have been written yet.

const { UNKNOWN } = require("./constants");
const { CONFIDENCE_LEVELS } = require("./confidence");

const AGENT_MESSAGE_FIELDS = Object.freeze([
  "agent_name",
  "timestamp",
  "asset",
  "data_used",
  "sources",
  "findings",
  "bias",
  "confidence",
  "uncertainties",
  "conflicts",
  "warnings",
  "recommendation_type",
]);

function createAgentMessage(fields = {}) {
  const message = {};
  for (const key of AGENT_MESSAGE_FIELDS) {
    message[key] = fields[key] !== undefined ? fields[key] : UNKNOWN;
  }
  return message;
}

function validateAgentMessage(message) {
  const errors = [];

  if (!message || typeof message !== "object") {
    return { valid: false, errors: ["message must be an object"] };
  }

  for (const key of AGENT_MESSAGE_FIELDS) {
    if (!(key in message)) errors.push(`Missing field: ${key}`);
  }

  if (message.data_used !== undefined && message.data_used !== UNKNOWN && !Array.isArray(message.data_used)) {
    errors.push("data_used must be an array of data records/ids, or UNKNOWN.");
  }
  if (message.sources !== undefined && message.sources !== UNKNOWN && !Array.isArray(message.sources)) {
    errors.push("sources must be an array, or UNKNOWN.");
  }
  if (message.uncertainties !== undefined && message.uncertainties !== UNKNOWN && !Array.isArray(message.uncertainties)) {
    errors.push("uncertainties must be an array, or UNKNOWN.");
  }
  if (message.conflicts !== undefined && message.conflicts !== UNKNOWN && !Array.isArray(message.conflicts)) {
    errors.push("conflicts must be an array, or UNKNOWN.");
  }
  if (message.warnings !== undefined && message.warnings !== UNKNOWN && !Array.isArray(message.warnings)) {
    errors.push("warnings must be an array, or UNKNOWN.");
  }
  if (message.confidence !== undefined && !Object.values(CONFIDENCE_LEVELS).includes(message.confidence)) {
    errors.push(`Invalid confidence: ${message.confidence}`);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { AGENT_MESSAGE_FIELDS, createAgentMessage, validateAgentMessage };
