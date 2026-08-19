// Market-impact vocabulary and aggregation. This module NEVER infers
// impact_direction from headline wording — doing that would require
// semantic/NLP judgment this system doesn't have and must not
// fabricate. Each item's impact_direction must come from the input
// data itself (e.g. an analyst-tagged field a future provider
// supplies); if a record doesn't carry one, it's UNKNOWN here, never
// guessed from the text.

const IMPACT_DIRECTIONS = Object.freeze({
  POSITIVE: "POSITIVE",
  NEGATIVE: "NEGATIVE",
  MIXED: "MIXED",
  NEUTRAL: "NEUTRAL",
  UNKNOWN: "UNKNOWN",
});

const IMPACT_DIRECTION_DEFINITIONS = Object.freeze({
  POSITIVE: "The reported information may carry a positive market implication based on the evidence. This is NOT a prediction that price will rise.",
  NEGATIVE: "The reported information may carry a negative market implication based on the evidence. This is NOT a prediction that price will fall.",
  MIXED: "The evidence points in both directions at once (e.g. a revenue beat alongside an earnings miss).",
  NEUTRAL: "The evidence indicates no meaningful directional market implication.",
  UNKNOWN: "No impact_direction evidence was supplied for this item.",
});

function summarizeMarketImpact(newsItems) {
  const counts = { POSITIVE: 0, NEGATIVE: 0, MIXED: 0, NEUTRAL: 0, UNKNOWN: 0 };
  const items = [];

  for (const item of newsItems) {
    const direction = Object.values(IMPACT_DIRECTIONS).includes(item.impact_direction)
      ? item.impact_direction
      : IMPACT_DIRECTIONS.UNKNOWN;
    counts[direction] += 1;
    items.push({
      headline: item.headline,
      impact_direction: direction,
      impact_confidence: item.impact_confidence,
      potential_market_impact: item.potential_market_impact,
    });
  }

  return { counts, items };
}

// Aggregates already-tagged impact_direction values into an overall
// news bias. This is evidence aggregation, not a new judgment, and is
// NOT a trading instruction — see README.md.
function deriveOverallNewsBias(counts) {
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

module.exports = { IMPACT_DIRECTIONS, IMPACT_DIRECTION_DEFINITIONS, summarizeMarketImpact, deriveOverallNewsBias };
