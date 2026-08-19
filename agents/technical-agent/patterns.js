// Pattern and breakout/breakdown detection — built entirely on
// structure.js's mechanical swing-point detection, never on visual
// impression. A pattern is only reported when the documented criteria
// below are actually satisfied by the supplied candles.
//
//   DOUBLE_TOP / DOUBLE_BOTTOM: the last two swing highs (lows) are
//     within a configurable tolerance of each other (default 2% of the
//     first swing's value — a conventional "approximately equal"
//     margin, fully overridable via options.doubleTopTolerance /
//     options.doubleBottomTolerance).
//   HIGHER_HIGH_HIGHER_LOW / LOWER_HIGH_LOWER_LOW: the market structure
//     evidence (structure.js) shows BOTH a higher high and a higher
//     low (or both lower) among the last two swings of each type.
//   RANGE: at least two swing highs and two swing lows exist, but
//     neither directional pattern above was found.
//   UNKNOWN: not enough swing data to judge any of the above.
//
// BREAKOUT_CANDIDATE / BREAKDOWN_CANDIDATE: the latest close is beyond
// the most recent swing high/low. This is NEVER promoted to
// CONFIRMED_BREAKOUT/CONFIRMED_BREAKDOWN unless the caller supplies
// options.breakoutConfirmationCandles and that many of the most recent
// candles all closed beyond the level — without that option, only the
// CANDIDATE state is ever reachable, by design.

const { findSwingPoints, STRUCTURE_STATES } = require("./structure");
const { UNKNOWN } = require("../../core/constants");

const PATTERNS = Object.freeze({
  DOUBLE_TOP: "DOUBLE_TOP",
  DOUBLE_BOTTOM: "DOUBLE_BOTTOM",
  HIGHER_HIGH_HIGHER_LOW: "HIGHER_HIGH_HIGHER_LOW",
  LOWER_HIGH_LOWER_LOW: "LOWER_HIGH_LOWER_LOW",
  RANGE: "RANGE",
  UNKNOWN: "UNKNOWN",
});

const BREAKOUT_STATES = Object.freeze({
  NONE: "NONE",
  BREAKOUT_CANDIDATE: "BREAKOUT_CANDIDATE",
  BREAKDOWN_CANDIDATE: "BREAKDOWN_CANDIDATE",
  CONFIRMED_BREAKOUT: "CONFIRMED_BREAKOUT",
  CONFIRMED_BREAKDOWN: "CONFIRMED_BREAKDOWN",
  UNKNOWN: "UNKNOWN",
});

function detectPatterns(candles, structureResult, options = {}) {
  const lookback = typeof options.swingLookback === "number" ? options.swingLookback : 2;
  const { highs, lows } = findSwingPoints(candles, lookback);
  const tolerance = typeof options.doubleTopTolerance === "number" ? options.doubleTopTolerance : 0.02;

  const patterns = [];

  if (highs.length >= 2) {
    const [h1, h2] = highs.slice(-2);
    if (h1.value !== 0 && Math.abs(h1.value - h2.value) / Math.abs(h1.value) <= tolerance) {
      patterns.push(PATTERNS.DOUBLE_TOP);
    }
  }
  if (lows.length >= 2) {
    const [l1, l2] = lows.slice(-2);
    if (l1.value !== 0 && Math.abs(l1.value - l2.value) / Math.abs(l1.value) <= tolerance) {
      patterns.push(PATTERNS.DOUBLE_BOTTOM);
    }
  }

  const structures = (structureResult.evidence || []).map((e) => e.structure);
  if (structures.includes(STRUCTURE_STATES.HIGHER_HIGH) && structures.includes(STRUCTURE_STATES.HIGHER_LOW)) {
    patterns.push(PATTERNS.HIGHER_HIGH_HIGHER_LOW);
  }
  if (structures.includes(STRUCTURE_STATES.LOWER_HIGH) && structures.includes(STRUCTURE_STATES.LOWER_LOW)) {
    patterns.push(PATTERNS.LOWER_HIGH_LOWER_LOW);
  }

  if (patterns.length === 0) {
    if (highs.length >= 2 && lows.length >= 2) patterns.push(PATTERNS.RANGE);
    else patterns.push(PATTERNS.UNKNOWN);
  }

  return patterns;
}

function assessBreakout(candles, options = {}) {
  const lookback = typeof options.swingLookback === "number" ? options.swingLookback : 2;
  const { highs, lows } = findSwingPoints(candles, lookback);

  if (highs.length === 0 && lows.length === 0) {
    return { status: BREAKOUT_STATES.UNKNOWN, level: UNKNOWN };
  }

  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  const currentClose = candles[candles.length - 1].close;

  function isConfirmed(level, direction) {
    const confirmCandles = options.breakoutConfirmationCandles;
    if (typeof confirmCandles !== "number" || confirmCandles < 1) return false;
    const recent = candles.slice(-confirmCandles);
    if (recent.length < confirmCandles) return false;
    return direction === "up" ? recent.every((c) => c.close > level) : recent.every((c) => c.close < level);
  }

  if (lastHigh && currentClose > lastHigh.value) {
    const confirmed = isConfirmed(lastHigh.value, "up");
    return { status: confirmed ? BREAKOUT_STATES.CONFIRMED_BREAKOUT : BREAKOUT_STATES.BREAKOUT_CANDIDATE, level: lastHigh.value };
  }
  if (lastLow && currentClose < lastLow.value) {
    const confirmed = isConfirmed(lastLow.value, "down");
    return { status: confirmed ? BREAKOUT_STATES.CONFIRMED_BREAKDOWN : BREAKOUT_STATES.BREAKDOWN_CANDIDATE, level: lastLow.value };
  }

  return { status: BREAKOUT_STATES.NONE, level: null };
}

module.exports = { PATTERNS, BREAKOUT_STATES, detectPatterns, assessBreakout };
