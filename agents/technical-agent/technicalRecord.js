// OHLCV Candle Data Model — sibling contract to core/dataRecord.js,
// agents/news-agent/newsRecord.js, and agents/macro-agent/macroRecord.js.
//
// The Step 7 spec's candle field bullet list omits `timeframe`, but
// later sections ("OHLCV Validation" explicitly lists timeframe among
// verified fields; "Primary Input" says "If timeframe is missing:
// UNKNOWN") clearly require it to exist as a real field. It's included
// here as a deliberate reconciliation of the spec's own sections, not
// an invented addition — documented in README.md.
//
// Unset fields default to UNKNOWN, never fabricated — EXCEPT `volume`,
// which the spec explicitly calls out to read NOT_AVAILABLE when
// missing (a confirmed absence, not merely "not determined") — handled
// in normalize.js, not here, so this factory stays consistent with
// every other contract in this project.

const { UNKNOWN } = require("../../core/constants");
const { INFORMATION_CLASSIFICATIONS } = require("../../core/classification");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { FRESHNESS_STATES } = require("../../core/freshness");
const { CONFIDENCE_LEVELS } = require("../../core/confidence");

const CANDLE_FIELDS = Object.freeze([
  "asset",
  "timeframe",
  "timestamp",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "unit",
  "source",
  "source_type",
  "verification_status",
  "freshness_status",
  "classification",
  "confidence",
  "notes",
]);

function createCandle(fields = {}) {
  const candle = {};
  for (const field of CANDLE_FIELDS) {
    candle[field] = fields[field] !== undefined ? fields[field] : UNKNOWN;
  }
  return candle;
}

function validateCandleStructure(candle) {
  const errors = [];

  if (!candle || typeof candle !== "object") {
    return { valid: false, errors: ["candle must be an object"] };
  }

  for (const field of CANDLE_FIELDS) {
    if (!(field in candle)) errors.push(`Missing field: ${field}`);
  }

  if (candle.classification !== undefined && !Object.values(INFORMATION_CLASSIFICATIONS).includes(candle.classification)) {
    errors.push(`Invalid classification: ${candle.classification}`);
  }
  if (
    candle.verification_status !== undefined &&
    !Object.values(SOURCE_VERIFICATION_STATES).includes(candle.verification_status)
  ) {
    errors.push(`Invalid verification_status: ${candle.verification_status}`);
  }
  if (candle.freshness_status !== undefined && !Object.values(FRESHNESS_STATES).includes(candle.freshness_status)) {
    errors.push(`Invalid freshness_status: ${candle.freshness_status}`);
  }
  if (candle.confidence !== undefined && !Object.values(CONFIDENCE_LEVELS).includes(candle.confidence)) {
    errors.push(`Invalid confidence: ${candle.confidence}`);
  }

  // Same real-time discipline as every other contract in this project:
  // FRESH requires an actual timestamp, never just a claim.
  if (candle.freshness_status === FRESHNESS_STATES.FRESH) {
    const hasRealTimestamp = candle.timestamp && candle.timestamp !== UNKNOWN;
    if (!hasRealTimestamp) {
      errors.push("freshness_status FRESH requires a real timestamp.");
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { CANDLE_FIELDS, createCandle, validateCandleStructure };
