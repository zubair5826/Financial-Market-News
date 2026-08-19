// Market-impact vocabulary and aggregation — same discipline as
// agents/news-agent/impact.js: impact_direction is read from each
// record's own tagged data, never inferred by this agent from the
// indicator name or a surprise result. A hotter-than-expected inflation
// print does NOT automatically mean "NEGATIVE for the currency" — that
// interpretation depends on monetary-policy context this agent has no
// way to reliably infer on its own; it must come from the source data
// itself (e.g. an analyst-tagged field a future provider supplies).

const IMPACT_DIRECTIONS = Object.freeze({
  POSITIVE: "POSITIVE",
  NEGATIVE: "NEGATIVE",
  MIXED: "MIXED",
  NEUTRAL: "NEUTRAL",
  UNKNOWN: "UNKNOWN",
});

const IMPACT_DIRECTION_DEFINITIONS = Object.freeze({
  POSITIVE: "The release may carry a positive market implication based on the evidence. NOT a prediction that any asset's price will rise.",
  NEGATIVE: "The release may carry a negative market implication based on the evidence. NOT a prediction that any asset's price will fall.",
  MIXED: "The evidence points in both directions at once.",
  NEUTRAL: "The evidence indicates no meaningful directional market implication.",
  UNKNOWN: "No impact_direction evidence was supplied for this item.",
});

function summarizeMarketImpact(records) {
  const counts = { POSITIVE: 0, NEGATIVE: 0, MIXED: 0, NEUTRAL: 0, UNKNOWN: 0 };
  const items = [];

  for (const r of records) {
    const direction = Object.values(IMPACT_DIRECTIONS).includes(r.impact_direction) ? r.impact_direction : IMPACT_DIRECTIONS.UNKNOWN;
    counts[direction] += 1;
    items.push({
      indicator: r.indicator,
      impact_direction: direction,
      potential_market_impact: r.potential_market_impact,
    });
  }

  return { counts, items };
}

// Aggregates already-tagged impact_direction values into a macro bias.
// This is evidence aggregation, not a new judgment, and is NOT a
// trading instruction (BULLISH does not mean BUY) — see README.md.
function deriveMacroBias(counts) {
  const { POSITIVE, NEGATIVE, MIXED, NEUTRAL } = counts;
  const tagged = POSITIVE + NEGATIVE + MIXED + NEUTRAL;

  if (tagged === 0) return "UNKNOWN";
  // Majority rules first — a lopsided batch (e.g. 3 POSITIVE vs 1
  // NEGATIVE) is BULLISH, not MIXED. MIXED is reserved for a genuine
  // tie between real POSITIVE/NEGATIVE signals, or explicit MIXED tags
  // with no POSITIVE/NEGATIVE signal at all.
  if (POSITIVE > NEGATIVE) return "BULLISH";
  if (NEGATIVE > POSITIVE) return "BEARISH";
  if (POSITIVE > 0) return "MIXED";
  if (MIXED > 0) return "MIXED";
  return "NEUTRAL";
}

module.exports = { IMPACT_DIRECTIONS, IMPACT_DIRECTION_DEFINITIONS, summarizeMarketImpact, deriveMacroBias };
