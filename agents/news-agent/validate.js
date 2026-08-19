// core/-style structural validation (validateNewsRecordStructure) plus
// the News Agent's own required-field rule. `headline` and
// `classification` are the only fields whose absence rejects an item
// outright — without a headline there is no content to process; without
// a classification, downstream code can't tell FACT from FORECAST from
// SCENARIO, which is the entire anti-hallucination point of this system.
//
// `source` is deliberately NOT required for rejection — a missing
// source degrades the item (forced to UNVERIFIED, flagged with a
// warning, see index.js) but is still processed, per the Step 5 spec's
// "missing source handled safely" (distinct from "missing headline
// rejected"). `publication_timestamp` is also not required — a missing
// timestamp just means freshness_status stays UNKNOWN.

const { validateNewsRecordStructure } = require("./newsRecord");
const { UNKNOWN } = require("../../core/constants");

const REQUIRED_INPUT_FIELDS = Object.freeze(["headline", "classification"]);

function isMissing(value) {
  return value === undefined || value === null || value === UNKNOWN || value === "";
}

function validateNewsInput(record) {
  const structural = validateNewsRecordStructure(record);
  const missingFields = REQUIRED_INPUT_FIELDS.filter((field) => isMissing(record[field]));

  return {
    valid: structural.valid && missingFields.length === 0,
    structuralErrors: structural.errors,
    missingFields,
  };
}

module.exports = { REQUIRED_INPUT_FIELDS, validateNewsInput };
