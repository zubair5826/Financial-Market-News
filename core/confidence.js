// Standard confidence levels for the "confidence" field required by both
// the data contract (core/dataRecord.js) and the agent message contract
// (core/agentMessage.js). Exists so confidence is structured data, not
// free-form text that varies agent to agent.

const CONFIDENCE_LEVELS = Object.freeze({
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  UNKNOWN: "UNKNOWN",
});

module.exports = { CONFIDENCE_LEVELS };
