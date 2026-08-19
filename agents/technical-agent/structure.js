// Market structure — deterministic swing-high/swing-low detection from
// the actual supplied candles only. A candle at index i is a swing high
// if its high is the maximum within a symmetric window of `lookback`
// candles on each side (swing low: the minimum low in that window).
// This is a well-known, purely mechanical definition — no invented
// pattern-matching. Never claims a structure when there isn't enough
// data to find at least two swings of the relevant type.

const { UNKNOWN } = require("../../core/constants");

const STRUCTURE_STATES = Object.freeze({
  HIGHER_HIGH: "HIGHER_HIGH",
  HIGHER_LOW: "HIGHER_LOW",
  LOWER_HIGH: "LOWER_HIGH",
  LOWER_LOW: "LOWER_LOW",
  RANGE: "RANGE",
  UNKNOWN: "UNKNOWN",
});

function findSwingPoints(candles, lookback = 2) {
  const highs = [];
  const lows = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const windowHighs = window.map((c) => c.high);
    const windowLows = window.map((c) => c.low);

    if (candles[i].high === Math.max(...windowHighs)) {
      highs.push({ index: i, value: candles[i].high });
    }
    if (candles[i].low === Math.min(...windowLows)) {
      lows.push({ index: i, value: candles[i].low });
    }
  }

  return { highs, lows };
}

// Reports on whichever swing point (a new swing high or a new swing
// low) formed most recently, compared against the prior swing of the
// same type. This is deliberately a single-value classification of the
// LATEST swing event, not a composite "uptrend structure" judgment —
// see patterns.js for the combined HIGHER_HIGH_HIGHER_LOW /
// LOWER_HIGH_LOWER_LOW pattern, which does combine both swing types.
function assessMarketStructure(candles, options = {}) {
  const lookback = typeof options.swingLookback === "number" ? options.swingLookback : 2;
  const minCandles = lookback * 2 + 3;

  if (!Array.isArray(candles) || candles.length < minCandles) {
    return { market_structure: STRUCTURE_STATES.UNKNOWN, evidence: [] };
  }

  const { highs, lows } = findSwingPoints(candles, lookback);
  const candidates = [];

  if (highs.length >= 2) {
    const [prev, last] = highs.slice(-2);
    candidates.push({
      index: last.index,
      structure:
        last.value > prev.value
          ? STRUCTURE_STATES.HIGHER_HIGH
          : last.value < prev.value
            ? STRUCTURE_STATES.LOWER_HIGH
            : STRUCTURE_STATES.RANGE,
    });
  }
  if (lows.length >= 2) {
    const [prev, last] = lows.slice(-2);
    candidates.push({
      index: last.index,
      structure:
        last.value > prev.value
          ? STRUCTURE_STATES.HIGHER_LOW
          : last.value < prev.value
            ? STRUCTURE_STATES.LOWER_LOW
            : STRUCTURE_STATES.RANGE,
    });
  }

  if (candidates.length === 0) {
    return { market_structure: STRUCTURE_STATES.UNKNOWN, evidence: [] };
  }

  candidates.sort((a, b) => b.index - a.index);
  return { market_structure: candidates[0].structure, evidence: candidates };
}

module.exports = { STRUCTURE_STATES, findSwingPoints, assessMarketStructure };
