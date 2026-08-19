// Builds the Trade Setup Report — this agent's primary output
// contract, per the Step 9 spec's explicit field list. Sibling
// contract to core/agentMessage.js and the News/Macro/Technical/
// Sentiment reports — no execution command, no BUY/SELL/LONG/SHORT
// field anywhere in this shape. `direction` is setup direction, never
// an execution order — see README.md.

const { UNKNOWN } = require("../../core/constants");

function buildTradeSetupReport(result) {
  return {
    agent_name: "trade-setup-agent",
    timestamp: result.timestamp,
    asset: result.asset || UNKNOWN,
    setup_status: result.setup_status,
    direction: result.direction,
    supporting_evidence: result.supporting_evidence,
    conflicting_evidence: result.conflicting_evidence,
    technical_evidence: result.technical_evidence,
    news_evidence: result.news_evidence,
    macro_evidence: result.macro_evidence,
    sentiment_evidence: result.sentiment_evidence,
    confluence: result.confluence,
    setup_quality: result.setup_quality,
    potential_levels: result.potential_levels,
    invalidation_conditions: result.invalidation_conditions,
    setup_risks: result.setup_risks,
    confidence: result.confidence,
    uncertainties: result.uncertainties,
    warnings: result.warnings,
    sources: result.sources,
  };
}

module.exports = { buildTradeSetupReport };
