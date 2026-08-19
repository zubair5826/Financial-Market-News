// core/dataRecord.js's validateDataRecord() only checks structural shape
// (are all contract fields present, are enum-typed fields legal values)
// — it deliberately allows UNKNOWN as a placeholder so the contract
// itself never invents a value. The Data Controller adds a stricter,
// controller-specific rule on top: which fields must be substantively
// supplied by the source for a record to be usable at all. `timestamp`
// is intentionally NOT in this list — a missing timestamp doesn't make
// a record unusable, it just means freshness_status becomes UNKNOWN
// (see core/freshness.js and index.js), per the Step 3 spec.
// `freshness_status`, `verification_status`, and `data_age` are also
// excluded — the controller computes those itself.

const { validateDataRecord } = require("../../core/dataRecord");
const { UNKNOWN } = require("../../core/constants");

const REQUIRED_INPUT_FIELDS = Object.freeze(["asset", "data_type", "value", "source", "classification"]);

function isMissing(value) {
  return value === undefined || value === null || value === UNKNOWN || value === "";
}

function validateControllerInput(record) {
  const structural = validateDataRecord(record);
  const errors = [...structural.errors];

  for (const field of REQUIRED_INPUT_FIELDS) {
    if (isMissing(record[field])) {
      errors.push(`Missing required field: ${field} (DATA UNAVAILABLE).`);
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { REQUIRED_INPUT_FIELDS, validateControllerInput };
