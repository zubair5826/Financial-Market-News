// Normalization layer: converts an arbitrary raw record into the
// internal Data Contract shape (core/dataRecord.js) via a caller-
// supplied field map. No real provider's field names are hard-coded
// here — none are known yet. A future provider adapter passes its own
// fieldMap (e.g. { asset: "symbol", value: "price" }) describing how
// its response shape lines up with the contract; this module has no
// opinion on what that shape is.

const { createDataRecord, DATA_RECORD_FIELDS } = require("../../core/dataRecord");

function normalizeRecord(raw, fieldMap = {}) {
  if (!raw || typeof raw !== "object") {
    return createDataRecord({});
  }

  const mapped = {};
  for (const field of DATA_RECORD_FIELDS) {
    const sourceKey = fieldMap[field] || field;
    if (raw[sourceKey] !== undefined) {
      mapped[field] = raw[sourceKey];
    }
  }

  return createDataRecord(mapped);
}

module.exports = { normalizeRecord };
