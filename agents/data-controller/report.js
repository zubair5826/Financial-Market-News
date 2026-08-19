// Builds the Data Controller's core/agentMessage.js report from a
// processMarketData() result. The Data Controller never analyzes,
// predicts, or recommends — recommendation_type is set to NOT_AVAILABLE
// (an existing contract sentinel, not an invented category) to make
// that explicit rather than leaving the field ambiguous.

const { createAgentMessage } = require("../../core/agentMessage");
const { FRESHNESS_STATES } = require("../../core/freshness");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { CONFIDENCE_LEVELS } = require("../../core/confidence");
const { NOT_AVAILABLE, UNKNOWN } = require("../../core/constants");

function buildAgentReport(result) {
  const assets = Array.from(new Set(result.validated_data.map((r) => r.asset)));
  const asset = assets.length === 0 ? UNKNOWN : assets.length === 1 ? assets[0] : "MULTIPLE";

  const sources = Array.from(new Set(result.validated_data.map((r) => r.source)));

  const uncertainties = [];
  for (const r of result.validated_data) {
    if (r.freshness_status === FRESHNESS_STATES.UNKNOWN) {
      uncertainties.push(`${r.asset}/${r.data_type} from ${r.source}: freshness UNKNOWN.`);
    }
    if (r.verification_status === SOURCE_VERIFICATION_STATES.UNVERIFIED) {
      uncertainties.push(`${r.asset}/${r.data_type} from ${r.source}: UNVERIFIED.`);
    }
  }

  // Confidence here describes confidence in the Data Controller's own
  // validation process for this batch — never confidence in a market
  // outcome, which this agent does not assess.
  let confidence;
  if (result.validated_data.length === 0) {
    confidence = CONFIDENCE_LEVELS.UNKNOWN;
  } else if (result.conflicts.length > 0 || result.rejected_data.length > 0) {
    confidence = CONFIDENCE_LEVELS.LOW;
  } else if (result.warnings.length > 0) {
    confidence = CONFIDENCE_LEVELS.MEDIUM;
  } else {
    confidence = CONFIDENCE_LEVELS.HIGH;
  }

  const findings =
    `Processed ${result.validated_data.length + result.rejected_data.length} record(s): ` +
    `${result.validated_data.length} validated, ${result.rejected_data.length} rejected, ` +
    `${result.conflicts.length} conflict group(s). controller_status: ${result.controller_status}.`;

  return createAgentMessage({
    agent_name: "data-controller",
    timestamp: result.timestamp,
    asset,
    data_used: result.validated_data,
    sources,
    findings,
    bias: "NOT_APPLICABLE",
    confidence,
    uncertainties,
    conflicts: result.conflicts,
    warnings: result.warnings,
    // Not an omission — the Data Controller does not perform trading
    // analysis and structurally cannot produce a recommendation.
    recommendation_type: NOT_AVAILABLE,
  });
}

module.exports = { buildAgentReport };
