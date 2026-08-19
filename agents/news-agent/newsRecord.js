// News Data Model — the internal contract every news item is normalized
// into. Unset fields default to UNKNOWN (never fabricated), same
// discipline as core/dataRecord.js, but with its own field set: news
// items (headline, source, timestamps, url) don't fit the market Data
// Contract's shape (asset/value/unit), so this is a sibling contract,
// not a reuse of core/dataRecord.js. `impact_confidence` is included
// even though the Step 5 "News Data Model" list didn't name it,
// because the separate "Market Impact" section of the spec explicitly
// calls for a structured impact_confidence field.

const { UNKNOWN } = require("../../core/constants");
const { INFORMATION_CLASSIFICATIONS } = require("../../core/classification");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { FRESHNESS_STATES } = require("../../core/freshness");
const { CONFIDENCE_LEVELS } = require("../../core/confidence");
const { IMPACT_DIRECTIONS } = require("./impact");

const NEWS_RECORD_FIELDS = Object.freeze([
  "headline",
  "summary",
  "source",
  "source_type",
  "publication_timestamp",
  "retrieved_timestamp",
  "url_or_reference",
  "related_assets",
  "related_markets",
  "country_or_region",
  "category",
  "classification",
  "verification_status",
  "freshness_status",
  "confidence",
  "potential_market_impact",
  "impact_direction",
  "impact_confidence",
  "evidence",
  "notes",
]);

function createNewsRecord(fields = {}) {
  const record = {};
  for (const field of NEWS_RECORD_FIELDS) {
    record[field] = fields[field] !== undefined ? fields[field] : UNKNOWN;
  }
  return record;
}

function validateNewsRecordStructure(record) {
  const errors = [];

  if (!record || typeof record !== "object") {
    return { valid: false, errors: ["record must be an object"] };
  }

  for (const field of NEWS_RECORD_FIELDS) {
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
  if (record.impact_confidence !== undefined && !Object.values(CONFIDENCE_LEVELS).includes(record.impact_confidence)) {
    errors.push(`Invalid impact_confidence: ${record.impact_confidence}`);
  }
  if (record.impact_direction !== undefined && !Object.values(IMPACT_DIRECTIONS).includes(record.impact_direction)) {
    errors.push(`Invalid impact_direction: ${record.impact_direction}`);
  }

  // Same real-time discipline as core/dataRecord.js: FRESH requires an
  // actual publication timestamp, never just an unverified claim.
  if (record.freshness_status === FRESHNESS_STATES.FRESH) {
    const hasRealTimestamp = record.publication_timestamp && record.publication_timestamp !== UNKNOWN;
    if (!hasRealTimestamp) {
      errors.push("freshness_status FRESH requires a real publication_timestamp.");
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { NEWS_RECORD_FIELDS, createNewsRecord, validateNewsRecordStructure };
