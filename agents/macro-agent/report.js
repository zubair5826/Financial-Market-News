// Builds the Macro Report — this agent's primary output contract, per
// the Step 6 spec's explicit field list. Same pattern as the News
// Agent's News Summary: a sibling contract to core/agentMessage.js, not
// that generic envelope reused verbatim. There is no recommendation_type
// field anywhere in this shape — the Macro Agent has nowhere to put a
// trading recommendation.

const { UNKNOWN } = require("../../core/constants");
const { CONFIDENCE_LEVELS } = require("../../core/confidence");
const { RELEVANCE_LEVELS } = require("./relevance");
const { IMPORTANCE_LEVELS } = require("./importance");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { FRESHNESS_STATES } = require("../../core/freshness");
const { SURPRISE_STATES } = require("./surprise");
const { summarizeMarketImpact, deriveMacroBias } = require("./impact");

function buildMacroReport(result, options = {}) {
  const records = result.validated_records;

  const keyIndicators = records.filter(
    (r) => r.importance === IMPORTANCE_LEVELS.CRITICAL || r.importance === IMPORTANCE_LEVELS.HIGH
  );

  const economicSurprises = records
    .filter((r) => r.surprise_direction !== SURPRISE_STATES.UNKNOWN)
    .map((r) => ({
      indicator: r.indicator,
      country: r.country,
      actual_value: r.actual_value,
      expected_value: r.expected_value,
      surprise_value: r.surprise_value,
      surprise_direction: r.surprise_direction,
    }));

  const sources = Array.from(new Set(records.map((r) => r.source)));

  const uncertainties = [];
  for (const r of records) {
    if (r.freshness_status === FRESHNESS_STATES.UNKNOWN) {
      uncertainties.push(`${r.indicator} (${r.country}) from ${r.source}: freshness UNKNOWN.`);
    }
    if (r.verification_status === SOURCE_VERIFICATION_STATES.UNVERIFIED) {
      uncertainties.push(`${r.indicator} (${r.country}) from ${r.source}: UNVERIFIED.`);
    }
    if (r.market_relevance === RELEVANCE_LEVELS.UNKNOWN) {
      uncertainties.push(`${r.indicator}: relevance to requested asset UNKNOWN.`);
    }
  }
  for (const e of result.upcoming_events) {
    if (e.scheduled_time === UNKNOWN) {
      uncertainties.push(`Upcoming event "${e.event}": scheduled_time UNKNOWN.`);
    }
  }

  let confidence;
  if (records.length === 0) {
    confidence = CONFIDENCE_LEVELS.UNKNOWN;
  } else if (result.conflicts.length > 0 || result.rejected_records.length > 0) {
    confidence = CONFIDENCE_LEVELS.LOW;
  } else if (result.warnings.length > 0) {
    confidence = CONFIDENCE_LEVELS.MEDIUM;
  } else {
    confidence = CONFIDENCE_LEVELS.HIGH;
  }

  const marketImpactAssessment = summarizeMarketImpact(records);
  const macroBias = deriveMacroBias(marketImpactAssessment.counts);

  return {
    agent_name: "macro-agent",
    timestamp: result.timestamp,
    requested_asset: options.requestedAsset || UNKNOWN,
    macro_records: records,
    key_indicators: keyIndicators,
    upcoming_events: result.upcoming_events,
    economic_surprises: economicSurprises,
    central_bank_assessment: result.central_bank_assessment,
    macro_risks: result.macro_risks,
    market_impact_assessment: marketImpactAssessment,
    // Evidence-based label only — NOT a trading instruction. BULLISH
    // here never means BUY; see README.md.
    macro_bias: macroBias,
    confidence,
    uncertainties,
    conflicts: result.conflicts,
    warnings: result.warnings,
    sources,
  };
}

module.exports = { buildMacroReport };
