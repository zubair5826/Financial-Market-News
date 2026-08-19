// Sentiment Data Model — sibling contract to core/dataRecord.js and the
// News/Macro/Technical agents' own record shapes. Sentiment opinions
// (BULLISH/BEARISH/NEUTRAL/MIXED, from a NEWS/SOCIAL_MEDIA/ANALYST/...
// source) don't fit any of those existing shapes, so this is its own
// contract. Unset fields default to UNKNOWN, never fabricated.
// sentiment_score is explicitly optional per the Step 8 spec — never
// invented when absent.

const { UNKNOWN } = require("../../core/constants");
const { INFORMATION_CLASSIFICATIONS } = require("../../core/classification");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { FRESHNESS_STATES } = require("../../core/freshness");
const { CONFIDENCE_LEVELS } = require("../../core/confidence");

const SENTIMENT_VALUES = Object.freeze({
  BULLISH: "BULLISH",
  BEARISH: "BEARISH",
  NEUTRAL: "NEUTRAL",
  MIXED: "MIXED",
  UNKNOWN: "UNKNOWN",
});

const SOURCE_TYPES = Object.freeze({
  NEWS: "NEWS",
  SOCIAL_MEDIA: "SOCIAL_MEDIA",
  ANALYST: "ANALYST",
  MARKET_COMMENTARY: "MARKET_COMMENTARY",
  SURVEY: "SURVEY",
  OTHER: "OTHER",
  UNKNOWN: "UNKNOWN",
});

const STRENGTH_LEVELS = Object.freeze({
  VERY_STRONG: "VERY_STRONG",
  STRONG: "STRONG",
  MODERATE: "MODERATE",
  WEAK: "WEAK",
  UNKNOWN: "UNKNOWN",
});

const SENTIMENT_RECORD_FIELDS = Object.freeze([
  "asset",
  "timestamp",
  "source",
  "source_type",
  "content_reference",
  "sentiment",
  "sentiment_score",
  "sentiment_strength",
  "classification",
  "verification_status",
  "freshness_status",
  "confidence",
  "volume",
  "engagement",
  "related_topics",
  "evidence",
  "notes",
]);

function createSentimentRecord(fields = {}) {
  const record = {};
  for (const field of SENTIMENT_RECORD_FIELDS) {
    record[field] = fields[field] !== undefined ? fields[field] : UNKNOWN;
  }
  return record;
}

function validateSentimentRecordStructure(record) {
  const errors = [];

  if (!record || typeof record !== "object") {
    return { valid: false, errors: ["record must be an object"] };
  }

  for (const field of SENTIMENT_RECORD_FIELDS) {
    if (!(field in record)) errors.push(`Missing field: ${field}`);
  }

  if (record.sentiment !== undefined && !Object.values(SENTIMENT_VALUES).includes(record.sentiment)) {
    errors.push(`Invalid sentiment: ${record.sentiment}`);
  }
  if (record.source_type !== undefined && !Object.values(SOURCE_TYPES).includes(record.source_type)) {
    errors.push(`Invalid source_type: ${record.source_type}`);
  }
  if (record.sentiment_strength !== undefined && !Object.values(STRENGTH_LEVELS).includes(record.sentiment_strength)) {
    errors.push(`Invalid sentiment_strength: ${record.sentiment_strength}`);
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
  if (
    record.sentiment_score !== undefined &&
    record.sentiment_score !== UNKNOWN &&
    typeof record.sentiment_score !== "number"
  ) {
    errors.push("sentiment_score must be a number or UNKNOWN.");
  }

  // Same real-time discipline as every other contract in this project:
  // FRESH requires an actual timestamp, never just a claim.
  if (record.freshness_status === FRESHNESS_STATES.FRESH) {
    const hasRealTimestamp = record.timestamp && record.timestamp !== UNKNOWN;
    if (!hasRealTimestamp) {
      errors.push("freshness_status FRESH requires a real timestamp.");
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  SENTIMENT_VALUES,
  SOURCE_TYPES,
  STRENGTH_LEVELS,
  SENTIMENT_RECORD_FIELDS,
  createSentimentRecord,
  validateSentimentRecordStructure,
};
