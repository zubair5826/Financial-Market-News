// Trend classification — deterministic evidence, documented exactly:
//
//   STRONG_UPTREND: price > fastSMA > slowSMA AND market structure is
//                   HIGHER_HIGH or HIGHER_LOW.
//   UPTREND:        price > fastSMA > slowSMA (without the structure
//                   confirmation above).
//   STRONG_DOWNTREND / DOWNTREND: the mirror conditions.
//   SIDEWAYS:       none of the above — price and moving averages are
//                   not in a consistent order.
//   UNKNOWN:        price or either moving average could not be
//                   calculated (insufficient candles).
//
// This is the ENTIRE trend rule — nothing else influences it. No
// direction is ever invented from a hunch.

const { STRUCTURE_STATES } = require("./structure");

const TREND_STATES = Object.freeze({
  STRONG_UPTREND: "STRONG_UPTREND",
  UPTREND: "UPTREND",
  SIDEWAYS: "SIDEWAYS",
  DOWNTREND: "DOWNTREND",
  STRONG_DOWNTREND: "STRONG_DOWNTREND",
  UNKNOWN: "UNKNOWN",
});

function isNumeric(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function assessTrend({ currentPrice, fastSMA, slowSMA, marketStructure }) {
  if (!isNumeric(currentPrice) || !isNumeric(fastSMA) || !isNumeric(slowSMA)) {
    return TREND_STATES.UNKNOWN;
  }

  const structureBullish = marketStructure === STRUCTURE_STATES.HIGHER_HIGH || marketStructure === STRUCTURE_STATES.HIGHER_LOW;
  const structureBearish = marketStructure === STRUCTURE_STATES.LOWER_HIGH || marketStructure === STRUCTURE_STATES.LOWER_LOW;

  if (currentPrice > fastSMA && fastSMA > slowSMA) {
    return structureBullish ? TREND_STATES.STRONG_UPTREND : TREND_STATES.UPTREND;
  }
  if (currentPrice < fastSMA && fastSMA < slowSMA) {
    return structureBearish ? TREND_STATES.STRONG_DOWNTREND : TREND_STATES.DOWNTREND;
  }
  return TREND_STATES.SIDEWAYS;
}

module.exports = { TREND_STATES, assessTrend };
