// Same field-mapping pattern as agents/data-controller/normalize.js and
// agents/news-agent/normalize.js — no real economic-data provider's
// field names are assumed or hard-coded.

const { createMacroRecord, MACRO_RECORD_FIELDS } = require("./macroRecord");

function normalizeMacroRecord(raw, fieldMap = {}) {
  if (!raw || typeof raw !== "object") {
    return createMacroRecord({});
  }

  const mapped = {};
  for (const field of MACRO_RECORD_FIELDS) {
    const sourceKey = fieldMap[field] || field;
    if (raw[sourceKey] !== undefined) {
      mapped[field] = raw[sourceKey];
    }
  }

  return createMacroRecord(mapped);
}

module.exports = { normalizeMacroRecord };
