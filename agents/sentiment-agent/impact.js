// Sentiment bias and market impact. Both are derived from the SAME
// aggregated sentiment counts (aggregation.js) — the Sentiment Data
// Model has no separate per-record impact_direction field to aggregate
// (unlike the News/Macro agents' impact.js modules), so
// market_impact_assessment is a direct, documented relabeling of
// sentiment_bias into the cross-agent-consistent
// POSITIVE/NEGATIVE/MIXED/NEUTRAL/UNKNOWN vocabulary, not a new
// inference. Neither is ever a trading instruction — BULLISH does not
// mean BUY, POSITIVE does not mean "price will rise". See README.md.

const BIAS_VALUES = Object.freeze({
  BULLISH: "BULLISH",
  BEARISH: "BEARISH",
  MIXED: "MIXED",
  NEUTRAL: "NEUTRAL",
  UNKNOWN: "UNKNOWN",
});

const IMPACT_DIRECTIONS = Object.freeze({
  POSITIVE: "POSITIVE",
  NEGATIVE: "NEGATIVE",
  MIXED: "MIXED",
  NEUTRAL: "NEUTRAL",
  UNKNOWN: "UNKNOWN",
});

const BIAS_TO_IMPACT = Object.freeze({
  BULLISH: IMPACT_DIRECTIONS.POSITIVE,
  BEARISH: IMPACT_DIRECTIONS.NEGATIVE,
  MIXED: IMPACT_DIRECTIONS.MIXED,
  NEUTRAL: IMPACT_DIRECTIONS.NEUTRAL,
  UNKNOWN: IMPACT_DIRECTIONS.UNKNOWN,
});

function deriveSentimentBias(counts) {
  const { BULLISH, BEARISH, MIXED, NEUTRAL } = counts;
  const tagged = BULLISH + BEARISH + MIXED + NEUTRAL;

  if (tagged === 0) return BIAS_VALUES.UNKNOWN;
  // Majority rules first — a lopsided batch (e.g. 3 BULLISH vs 1
  // BEARISH) is BULLISH, not MIXED. MIXED is reserved for a genuine
  // tie between real BULLISH/BEARISH signals, or explicit MIXED tags
  // with no BULLISH/BEARISH signal at all.
  if (BULLISH > BEARISH) return BIAS_VALUES.BULLISH;
  if (BEARISH > BULLISH) return BIAS_VALUES.BEARISH;
  if (BULLISH > 0) return BIAS_VALUES.MIXED;
  if (MIXED > 0) return BIAS_VALUES.MIXED;
  return BIAS_VALUES.NEUTRAL;
}

function buildMarketImpactAssessment(sentimentBias) {
  const impactDirection = BIAS_TO_IMPACT[sentimentBias] || IMPACT_DIRECTIONS.UNKNOWN;

  const notes =
    impactDirection === IMPACT_DIRECTIONS.UNKNOWN
      ? "Insufficient sentiment evidence to assess market impact."
      : `Sentiment evidence is currently ${impactDirection.toLowerCase()}. This describes the evidence only — it is not a prediction of price movement.`;

  return { impact_direction: impactDirection, based_on: "aggregated sentiment_bias", notes };
}

module.exports = { BIAS_VALUES, IMPACT_DIRECTIONS, deriveSentimentBias, buildMarketImpactAssessment };
