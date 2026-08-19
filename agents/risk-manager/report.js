// Builds the Risk Report — this agent's primary output contract, per
// the Step 10 spec's explicit field list. Sibling contract to
// core/agentMessage.js and every other agent's report — no execution
// command, no BUY/SELL/LONG/SHORT field anywhere. risk_decision is
// NEVER an execution decision — see README.md.

const { UNKNOWN } = require("../../core/constants");

// A compact pointer back to the trade setup, not a full duplicate of
// its report — keeps this report from re-embedding everything the
// Trade Setup Agent already produced, while still giving traceability.
function buildSetupReference(tradeSetupReport) {
  if (!tradeSetupReport) return null;
  return {
    setup_status: tradeSetupReport.setup_status,
    direction: tradeSetupReport.direction,
    setup_quality: tradeSetupReport.setup_quality,
    asset: tradeSetupReport.asset,
    timestamp: tradeSetupReport.timestamp,
  };
}

function buildRiskReport(result) {
  return {
    agent_name: "risk-manager",
    timestamp: result.timestamp,
    asset: result.asset || UNKNOWN,
    setup_reference: buildSetupReference(result.tradeSetupReport),
    risk_level: result.risk_level,
    risk_categories: result.risk_categories,
    risk_factors: result.risk_factors,
    data_quality: result.data_quality,
    conflicts: result.conflicts,
    missing_information: result.missing_information,
    position_size_status: result.position_size,
    invalidation_assessment: result.invalidation_assessment,
    risk_decision: result.risk_decision,
    confidence: result.confidence,
    uncertainties: result.uncertainties,
    warnings: result.warnings,
    sources: result.sources,
  };
}

module.exports = { buildRiskReport };
