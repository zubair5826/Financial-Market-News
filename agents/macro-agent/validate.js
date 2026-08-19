// Structural validation (validateMacroRecordStructure) plus the Macro
// Agent's own required-field rule. Only `indicator` and `classification`
// reject a record outright — without an indicator name there's no
// content to process, and without a classification, downstream code
// can't tell FACT from FORECAST from SCENARIO.
//
// `actual_value` is deliberately NOT required: a SCHEDULED_EVENT record
// (an indicator release that hasn't happened yet) legitimately has no
// actual_value — it's handled safely (surprise calculation simply can't
// run, see surprise.js), not rejected. `release_timestamp` is also not
// required — a missing one just means freshness_status stays UNKNOWN.

const { validateMacroRecordStructure } = require("./macroRecord");
const { UNKNOWN } = require("../../core/constants");

const REQUIRED_INPUT_FIELDS = Object.freeze(["indicator", "classification"]);

function isMissing(value) {
  return value === undefined || value === null || value === UNKNOWN || value === "";
}

function validateMacroInput(record) {
  const structural = validateMacroRecordStructure(record);
  const missingFields = REQUIRED_INPUT_FIELDS.filter((field) => isMissing(record[field]));

  return {
    valid: structural.valid && missingFields.length === 0,
    structuralErrors: structural.errors,
    missingFields,
  };
}

module.exports = { REQUIRED_INPUT_FIELDS, validateMacroInput };
