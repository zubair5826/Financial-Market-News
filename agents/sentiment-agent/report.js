// Builds the Sentiment Report — this agent's primary output contract,
// per the Step 8 spec's explicit field list. Sibling contract to
// core/agentMessage.js and the News/Macro/Technical reports — no
// recommendation_type field anywhere in this shape.

const { UNKNOWN } = require("../../core/constants");
const { CONFIDENCE_LEVELS } = require("../../core/confidence");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { INFORMATION_CLASSIFICATIONS } = require("../../core/classification");
const { FRESHNESS_STATES } = require("../../core/freshness");
const { STRENGTH_LEVELS } = require("./sentimentRecord");
const { aggregateSentiment } = require("./aggregation");
const { deriveSentimentBias, buildMarketImpactAssessment } = require("./impact");

function summarizeSourceBreakdown(records) {
  const breakdown = {};
  for (const r of records) {
    const type = r.source_type || "UNKNOWN";
    breakdown[type] = (breakdown[type] || 0) + 1;
  }
  return breakdown;
}

function summarizeStrengthDistribution(records) {
  const distribution = { VERY_STRONG: 0, STRONG: 0, MODERATE: 0, WEAK: 0, UNKNOWN: 0 };
  for (const r of records) {
    const strength = Object.values(STRENGTH_LEVELS).includes(r.sentiment_strength) ? r.sentiment_strength : "UNKNOWN";
    distribution[strength] += 1;
  }
  return distribution;
}

function buildSentimentReport(result, options = {}) {
  // Scoped to the requested asset here, at the point of use — result.
  // validated_records itself stays the full validated set (matching
  // every other agent's field-naming convention), so a report scoped
  // to "BTC" doesn't mix in another asset's sentiment into its
  // distribution/bias/sources.
  const records = options.requestedAsset
    ? result.validated_records.filter((r) => r.asset === options.requestedAsset)
    : result.validated_records;
  const conflicts = options.requestedAsset
    ? result.conflicts.filter((c) => c.asset === options.requestedAsset)
    : result.conflicts;

  const unverifiedSentiment = records.filter(
    (r) =>
      r.verification_status === SOURCE_VERIFICATION_STATES.UNVERIFIED ||
      r.classification === INFORMATION_CLASSIFICATIONS.UNVERIFIED
  );

  const sources = Array.from(new Set(records.map((r) => r.source)));

  const uncertainties = [];
  for (const r of records) {
    if (r.freshness_status === FRESHNESS_STATES.UNKNOWN) {
      uncertainties.push(`${r.asset} sentiment from ${r.source}: freshness UNKNOWN.`);
    }
    if (r.verification_status === SOURCE_VERIFICATION_STATES.UNVERIFIED) {
      uncertainties.push(`${r.asset} sentiment from ${r.source}: UNVERIFIED.`);
    }
    if (r.sentiment_strength === STRENGTH_LEVELS.UNKNOWN) {
      uncertainties.push(`${r.asset} sentiment from ${r.source}: strength UNKNOWN.`);
    }
  }

  let confidence;
  if (records.length === 0) {
    confidence = CONFIDENCE_LEVELS.UNKNOWN;
  } else if (conflicts.length > 0 || result.rejected_records.length > 0) {
    confidence = CONFIDENCE_LEVELS.LOW;
  } else if (result.warnings.length > 0) {
    confidence = CONFIDENCE_LEVELS.MEDIUM;
  } else {
    confidence = CONFIDENCE_LEVELS.HIGH;
  }

  const distribution = aggregateSentiment(records, options);
  // deriveSentimentBias expects the BULLISH/BEARISH/MIXED/NEUTRAL vote
  // shape (same convention as News/Macro agents' impact.js) — map from
  // aggregateSentiment's own *_count field names rather than passing
  // the distribution object through directly.
  const sentimentBias = deriveSentimentBias({
    BULLISH: distribution.bullish_count,
    BEARISH: distribution.bearish_count,
    MIXED: distribution.mixed_count,
    NEUTRAL: distribution.neutral_count,
  });
  const marketImpactAssessment = buildMarketImpactAssessment(sentimentBias);

  return {
    agent_name: "sentiment-agent",
    timestamp: result.timestamp,
    requested_asset: options.requestedAsset || UNKNOWN,
    sentiment_records: records,
    source_breakdown: summarizeSourceBreakdown(records),
    sentiment_distribution: distribution,
    // Evidence-based label only — NOT a trading instruction. BULLISH
    // here never means BUY; see README.md.
    sentiment_bias: sentimentBias,
    sentiment_strength: summarizeStrengthDistribution(records),
    conflicts,
    unverified_sentiment: unverifiedSentiment,
    market_impact_assessment: marketImpactAssessment,
    confidence,
    uncertainties,
    warnings: result.warnings,
    sources,
  };
}

module.exports = { buildSentimentReport };
