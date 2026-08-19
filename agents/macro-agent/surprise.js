// Economic surprise calculation — the core "actual vs expected" logic.
// SURPRISE = ACTUAL - EXPECTED, computed ONLY when both values actually
// exist and are numeric. Never estimates a surprise from a missing
// value, and never confuses surprise_direction (a factual comparison of
// two given numbers) with impact_direction (a market interpretation,
// handled separately in impact.js) — the same indicator's surprise can
// mean different things in different monetary-policy contexts, so this
// module makes no claim about which way markets "should" react.

const { UNKNOWN } = require("../../core/constants");

const SURPRISE_STATES = Object.freeze({
  ABOVE_EXPECTATION: "ABOVE_EXPECTATION",
  BELOW_EXPECTATION: "BELOW_EXPECTATION",
  IN_LINE: "IN_LINE",
  UNKNOWN: "UNKNOWN",
});

const SURPRISE_DEFINITIONS = Object.freeze({
  ABOVE_EXPECTATION: "actual_value is higher than expected_value (beyond any configured tolerance).",
  BELOW_EXPECTATION: "actual_value is lower than expected_value (beyond any configured tolerance).",
  IN_LINE: "actual_value matches expected_value exactly, or falls within a configured tolerance band.",
  UNKNOWN: "actual_value or expected_value is missing/non-numeric — no surprise can be honestly calculated.",
});

function isNumeric(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// options.inLineToleranceRatio (e.g. 0.02 for 2%) is optional — with
// none supplied, only an exact match counts as IN_LINE, and any other
// numeric difference is ABOVE/BELOW. No tolerance is assumed by default.
function calculateSurprise(record, options = {}) {
  const actual = record.actual_value;
  const expected = record.expected_value;

  if (!isNumeric(actual) || !isNumeric(expected)) {
    return { surprise_value: UNKNOWN, surprise_direction: SURPRISE_STATES.UNKNOWN };
  }

  const diff = actual - expected;

  let direction;
  if (typeof options.inLineToleranceRatio === "number" && options.inLineToleranceRatio > 0) {
    const tolerance = Math.abs(expected) * options.inLineToleranceRatio;
    if (Math.abs(diff) <= tolerance) direction = SURPRISE_STATES.IN_LINE;
    else direction = diff > 0 ? SURPRISE_STATES.ABOVE_EXPECTATION : SURPRISE_STATES.BELOW_EXPECTATION;
  } else if (diff === 0) {
    direction = SURPRISE_STATES.IN_LINE;
  } else {
    direction = diff > 0 ? SURPRISE_STATES.ABOVE_EXPECTATION : SURPRISE_STATES.BELOW_EXPECTATION;
  }

  return { surprise_value: diff, surprise_direction: direction };
}

module.exports = { SURPRISE_STATES, SURPRISE_DEFINITIONS, calculateSurprise };
