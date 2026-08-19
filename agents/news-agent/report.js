// Builds the News Summary — the News Agent's primary output contract,
// per the Step 5 spec's explicit field list. This is a sibling contract
// to core/agentMessage.js, not that generic envelope reused verbatim:
// the spec defined its own News Summary shape (requested_asset,
// news_items, overall_news_bias, etc.) rather than pointing at
// core/agentMessage.js the way Step 4's Data Controller spec did. There
// is no recommendation_type field at all here — the News Agent's output
// structurally has nowhere to put a trading recommendation.

const { UNKNOWN } = require("../../core/constants");
const { CONFIDENCE_LEVELS } = require("../../core/confidence");
const { RELEVANCE_LEVELS } = require("./relevance");
const { IMPORTANCE_LEVELS } = require("./importance");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { INFORMATION_CLASSIFICATIONS } = require("../../core/classification");
const { FRESHNESS_STATES } = require("../../core/freshness");
const { summarizeMarketImpact, deriveOverallNewsBias } = require("./impact");

function buildNewsSummary(result, options = {}) {
  const items = result.validated_items;

  const keyEvents = items.filter(
    (i) => i.importance === IMPORTANCE_LEVELS.CRITICAL || i.importance === IMPORTANCE_LEVELS.HIGH
  );
  const relevantEvents = items.filter(
    (i) => i.relevance === RELEVANCE_LEVELS.DIRECT || i.relevance === RELEVANCE_LEVELS.INDIRECT
  );
  const unverifiedReports = items.filter(
    (i) =>
      i.verification_status === SOURCE_VERIFICATION_STATES.UNVERIFIED ||
      i.classification === INFORMATION_CLASSIFICATIONS.UNVERIFIED
  );

  const sources = Array.from(new Set(items.map((i) => i.source)));

  const uncertainties = [];
  for (const i of items) {
    if (i.freshness_status === FRESHNESS_STATES.UNKNOWN) {
      uncertainties.push(`"${i.headline}" from ${i.source}: freshness UNKNOWN.`);
    }
    if (i.verification_status === SOURCE_VERIFICATION_STATES.UNVERIFIED) {
      uncertainties.push(`"${i.headline}" from ${i.source}: UNVERIFIED.`);
    }
    if (i.relevance === RELEVANCE_LEVELS.UNKNOWN) {
      uncertainties.push(`"${i.headline}": relevance to requested asset UNKNOWN.`);
    }
  }

  let confidence;
  if (items.length === 0) {
    confidence = CONFIDENCE_LEVELS.UNKNOWN;
  } else if (result.conflicts.length > 0 || result.rejected_items.length > 0) {
    confidence = CONFIDENCE_LEVELS.LOW;
  } else if (result.warnings.length > 0) {
    confidence = CONFIDENCE_LEVELS.MEDIUM;
  } else {
    confidence = CONFIDENCE_LEVELS.HIGH;
  }

  const marketImpactAssessment = summarizeMarketImpact(items);
  const overallNewsBias = deriveOverallNewsBias(marketImpactAssessment.counts);

  return {
    agent_name: "news-agent",
    timestamp: result.timestamp,
    requested_asset: options.requestedAsset || UNKNOWN,
    news_items: items,
    key_events: keyEvents,
    relevant_events: relevantEvents,
    conflicting_reports: result.conflicts,
    unverified_reports: unverifiedReports,
    market_impact_assessment: marketImpactAssessment,
    // Evidence-based label only — NOT a trading instruction. BULLISH
    // here never means BUY; see README.md.
    overall_news_bias: overallNewsBias,
    confidence,
    uncertainties,
    warnings: result.warnings,
    sources,
  };
}

module.exports = { buildNewsSummary };
