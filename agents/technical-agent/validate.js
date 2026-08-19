// Two-tier validation, same discipline as the other agents:
// (1) structural — field presence + enum legality (technicalRecord.js)
// (2) required-field — asset/open/high/low/close/classification must
//     be substantively present; timeframe, timestamp, and volume are
//     deliberately NOT required (spec: each is "handled safely" when
//     missing, not rejected — see technicalRecord.js/normalize.js).
// (3) OHLC logical validation — only run once all four price fields
//     are confirmed present and numeric; a candle failing basic OHLC
//     math (e.g. high < low) is rejected outright, values never
//     silently repaired.

const { validateCandleStructure } = require("./technicalRecord");
const { UNKNOWN } = require("../../core/constants");

const REQUIRED_INPUT_FIELDS = Object.freeze(["asset", "open", "high", "low", "close", "classification"]);

function isMissing(value) {
  return value === undefined || value === null || value === UNKNOWN || value === "";
}

function isNumeric(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Every directional check the spec lists explicitly, even where a few
// are mathematically implied by others — kept literal for traceability
// against the spec's own list.
function validateOHLCLogic(candle) {
  const { open, high, low, close } = candle;
  if (![open, high, low, close].every(isNumeric)) {
    return { valid: false, errors: ["open, high, low, and close must all be numeric."] };
  }

  const errors = [];
  if (!(high >= open)) errors.push("high must be >= open.");
  if (!(high >= close)) errors.push("high must be >= close.");
  if (!(high >= low)) errors.push("high must be >= low.");
  if (!(low <= open)) errors.push("low must be <= open.");
  if (!(low <= close)) errors.push("low must be <= close.");
  if (!(open >= low)) errors.push("open must be >= low.");
  if (!(open <= high)) errors.push("open must be <= high.");
  if (!(close >= low)) errors.push("close must be >= low.");
  if (!(close <= high)) errors.push("close must be <= high.");

  return { valid: errors.length === 0, errors };
}

function validateCandleInput(candle) {
  const structural = validateCandleStructure(candle);
  const missingFields = REQUIRED_INPUT_FIELDS.filter((field) => isMissing(candle[field]));

  if (missingFields.length > 0) {
    return { valid: false, structuralErrors: structural.errors, missingFields, ohlcErrors: [] };
  }

  const ohlc = validateOHLCLogic(candle);
  return {
    valid: structural.valid && ohlc.valid,
    structuralErrors: structural.errors,
    missingFields: [],
    ohlcErrors: ohlc.errors,
  };
}

module.exports = { REQUIRED_INPUT_FIELDS, validateOHLCLogic, validateCandleInput };
