// Structural validation (validateSentimentRecordStructure) plus the
// Sentiment Agent's own required-field rule. Only `asset`, `sentiment`,
// and `classification` reject a record outright — without an asset
// there's nothing to attribute the opinion to, without a sentiment
// value there's no opinion at all, and without a classification
// downstream code can't tell FACT-tier sentiment from FORECAST/
// SCENARIO/UNVERIFIED.
//
// `source` is deliberately NOT required — a missing source degrades
// the record (forced to UNVERIFIED, warned) but is still processed,
// same "handled safely" discipline as the News Agent's missing-source
// case. `timestamp` is not required either — a missing one just means
// freshness_status stays UNKNOWN. `sentiment_score` is explicitly
// optional per the spec and is never required.

const { validateSentimentRecordStructure } = require("./sentimentRecord");
const { UNKNOWN } = require("../../core/constants");

const REQUIRED_INPUT_FIELDS = Object.freeze(["asset", "sentiment", "classification"]);

function isMissing(value) {
  return value === undefined || value === null || value === UNKNOWN || value === "";
}

function validateSentimentInput(record) {
  const structural = validateSentimentRecordStructure(record);
  const missingFields = REQUIRED_INPUT_FIELDS.filter((field) => isMissing(record[field]));

  return {
    valid: structural.valid && missingFields.length === 0,
    structuralErrors: structural.errors,
    missingFields,
  };
}

module.exports = { REQUIRED_INPUT_FIELDS, validateSentimentInput };
