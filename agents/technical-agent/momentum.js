// Momentum — deterministic, based only on already-calculated indicator
// values (RSI, MACD histogram), never recomputed or guessed from raw
// price action. Rule, documented exactly:
//
//   Each available signal casts one vote: RSI >= 60 -> +1, RSI <= 40 ->
//   -1 (conventional momentum thresholds — distinct from the 70/30
//   overbought/oversold zone in indicators.js); MACD histogram > 0 ->
//   +1, < 0 -> -1. Values in between cast no vote.
//   STRONG_POSITIVE/STRONG_NEGATIVE requires every available signal to
//   agree (and at least 2 signals). Otherwise POSITIVE/NEGATIVE if the
//   vote total is nonzero, NEUTRAL if it's zero, UNKNOWN if no signal
//   was available at all.
//
// This never becomes a trading recommendation on its own.

const MOMENTUM_STATES = Object.freeze({
  STRONG_POSITIVE: "STRONG_POSITIVE",
  POSITIVE: "POSITIVE",
  NEUTRAL: "NEUTRAL",
  NEGATIVE: "NEGATIVE",
  STRONG_NEGATIVE: "STRONG_NEGATIVE",
  UNKNOWN: "UNKNOWN",
});

function isNumeric(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function assessMomentum({ rsiValue, macdHistogram }, options = {}) {
  const rsiPositiveThreshold = typeof options.rsiPositiveThreshold === "number" ? options.rsiPositiveThreshold : 60;
  const rsiNegativeThreshold = typeof options.rsiNegativeThreshold === "number" ? options.rsiNegativeThreshold : 40;

  let score = 0;
  let signals = 0;

  if (isNumeric(rsiValue)) {
    signals += 1;
    if (rsiValue >= rsiPositiveThreshold) score += 1;
    else if (rsiValue <= rsiNegativeThreshold) score -= 1;
  }
  if (isNumeric(macdHistogram)) {
    signals += 1;
    if (macdHistogram > 0) score += 1;
    else if (macdHistogram < 0) score -= 1;
  }

  if (signals === 0) return MOMENTUM_STATES.UNKNOWN;
  if (signals >= 2 && score === signals) return MOMENTUM_STATES.STRONG_POSITIVE;
  if (signals >= 2 && score === -signals) return MOMENTUM_STATES.STRONG_NEGATIVE;
  if (score > 0) return MOMENTUM_STATES.POSITIVE;
  if (score < 0) return MOMENTUM_STATES.NEGATIVE;
  return MOMENTUM_STATES.NEUTRAL;
}

module.exports = { MOMENTUM_STATES, assessMomentum };
