// Macro Data Model — the internal contract every macroeconomic
// indicator record is normalized into. Sibling contract to
// core/dataRecord.js and agents/news-agent/newsRecord.js, not a reuse
// of either — indicators (actual/expected/forecast/surprise) don't fit
// either of those shapes. Unset fields default to UNKNOWN, never
// fabricated.

const { UNKNOWN } = require("../../core/constants");
const { INFORMATION_CLASSIFICATIONS } = require("../../core/classification");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { FRESHNESS_STATES } = require("../../core/freshness");
const { CONFIDENCE_LEVELS } = require("../../core/confidence");
const { INDICATOR_CATEGORIES } = require("./categories");
const { SURPRISE_STATES } = require("./surprise");
const { RELEVANCE_LEVELS } = require("./relevance");
const { IMPACT_DIRECTIONS } = require("./impact");

const MACRO_RECORD_FIELDS = Object.freeze([
  "indicator",
  "indicator_code",
  "country",
  "region",
  "currency",
  "category",
  "actual_value",
  "previous_value",
  "expected_value",
  "forecast_value",
  "unit",
  "period",
  "release_timestamp",
  "retrieved_timestamp",
  "source",
  "source_type",
  "classification",
  "verification_status",
  "freshness_status",
  "confidence",
  "surprise_value",
  "surprise_direction",
  "market_relevance",
  "potential_market_impact",
  "impact_direction",
  "evidence",
  "notes",
]);

function createMacroRecord(fields = {}) {
  const record = {};
  for (const field of MACRO_RECORD_FIELDS) {
    record[field] = fields[field] !== undefined ? fields[field] : UNKNOWN;
  }
  return record;
}

function validateMacroRecordStructure(record) {
  const errors = [];

  if (!record || typeof record !== "object") {
    return { valid: false, errors: ["record must be an object"] };
  }

  for (const field of MACRO_RECORD_FIELDS) {
    if (!(field in record)) errors.push(`Missing field: ${field}`);
  }

  if (record.classification !== undefined && !Object.values(INFORMATION_CLASSIFICATIONS).includes(record.classification)) {
    errors.push(`Invalid classification: ${record.classification}`);
  }
  if (
    record.verification_status !== undefined &&
    !Object.values(SOURCE_VERIFICATION_STATES).includes(record.verification_status)
  ) {
    errors.push(`Invalid verification_status: ${record.verification_status}`);
  }
  if (record.freshness_status !== undefined && !Object.values(FRESHNESS_STATES).includes(record.freshness_status)) {
    errors.push(`Invalid freshness_status: ${record.freshness_status}`);
  }
  if (record.confidence !== undefined && !Object.values(CONFIDENCE_LEVELS).includes(record.confidence)) {
    errors.push(`Invalid confidence: ${record.confidence}`);
  }
  if (record.category !== undefined && !Object.values(INDICATOR_CATEGORIES).includes(record.category)) {
    errors.push(`Invalid category: ${record.category}`);
  }
  if (record.surprise_direction !== undefined && !Object.values(SURPRISE_STATES).includes(record.surprise_direction)) {
    errors.push(`Invalid surprise_direction: ${record.surprise_direction}`);
  }
  if (record.market_relevance !== undefined && !Object.values(RELEVANCE_LEVELS).includes(record.market_relevance)) {
    errors.push(`Invalid market_relevance: ${record.market_relevance}`);
  }
  if (record.impact_direction !== undefined && !Object.values(IMPACT_DIRECTIONS).includes(record.impact_direction)) {
    errors.push(`Invalid impact_direction: ${record.impact_direction}`);
  }

  // Same real-time discipline as core/dataRecord.js and the News Agent:
  // FRESH requires an actual release timestamp, never just a claim.
  if (record.freshness_status === FRESHNESS_STATES.FRESH) {
    const hasRealTimestamp = record.release_timestamp && record.release_timestamp !== UNKNOWN;
    if (!hasRealTimestamp) {
      errors.push("freshness_status FRESH requires a real release_timestamp.");
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { MACRO_RECORD_FIELDS, createMacroRecord, validateMacroRecordStructure };
