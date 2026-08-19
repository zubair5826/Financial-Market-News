// Section 1 — Data Contract. Standard shape for any factual market-data
// record passed between components. Unset fields default to UNKNOWN
// (never a fabricated value) — use NOT_AVAILABLE when a field was
// actively checked and confirmed absent, vs. UNKNOWN when it simply
// wasn't determined.

const { UNKNOWN } = require("./constants");
const { INFORMATION_CLASSIFICATIONS } = require("./classification");
const { SOURCE_VERIFICATION_STATES } = require("./verification");
const { FRESHNESS_STATES } = require("./freshness");
const { CONFIDENCE_LEVELS } = require("./confidence");

const DATA_RECORD_FIELDS = Object.freeze([
  "asset",
  "data_type",
  "value",
  "unit",
  "source",
  "source_type",
  "timestamp",
  "data_age",
  "freshness_status",
  "verification_status",
  "confidence",
  "classification",
  "notes",
]);

function createDataRecord(fields = {}) {
  const record = {};
  for (const key of DATA_RECORD_FIELDS) {
    record[key] = fields[key] !== undefined ? fields[key] : UNKNOWN;
  }
  return record;
}

// Structural + enum validation only — this does not and cannot verify
// that `value` is actually correct; that's a provider/agent concern.
function validateDataRecord(record) {
  const errors = [];

  if (!record || typeof record !== "object") {
    return { valid: false, errors: ["record must be an object"] };
  }

  for (const key of DATA_RECORD_FIELDS) {
    if (!(key in record)) errors.push(`Missing field: ${key}`);
  }

  if (record.freshness_status !== undefined && !Object.values(FRESHNESS_STATES).includes(record.freshness_status)) {
    errors.push(`Invalid freshness_status: ${record.freshness_status}`);
  }
  if (
    record.verification_status !== undefined &&
    !Object.values(SOURCE_VERIFICATION_STATES).includes(record.verification_status)
  ) {
    errors.push(`Invalid verification_status: ${record.verification_status}`);
  }
  if (record.classification !== undefined && !Object.values(INFORMATION_CLASSIFICATIONS).includes(record.classification)) {
    errors.push(`Invalid classification: ${record.classification}`);
  }
  if (record.confidence !== undefined && !Object.values(CONFIDENCE_LEVELS).includes(record.confidence)) {
    errors.push(`Invalid confidence: ${record.confidence}`);
  }

  // Rule from Section 3/5: real-time/FRESH data must carry a real timestamp.
  if (record.freshness_status === FRESHNESS_STATES.FRESH) {
    const hasRealTimestamp = record.timestamp && record.timestamp !== UNKNOWN;
    if (!hasRealTimestamp) {
      errors.push("freshness_status FRESH requires a real timestamp — cannot call data real-time without one.");
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { DATA_RECORD_FIELDS, createDataRecord, validateDataRecord };
