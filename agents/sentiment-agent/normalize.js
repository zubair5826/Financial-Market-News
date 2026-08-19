// Same field-mapping pattern as the Data Controller/News/Macro/
// Technical agents' normalize.js — no real sentiment provider's field
// names are assumed or hard-coded.

const { createSentimentRecord, SENTIMENT_RECORD_FIELDS } = require("./sentimentRecord");

function normalizeSentimentRecord(raw, fieldMap = {}) {
  if (!raw || typeof raw !== "object") {
    return createSentimentRecord({});
  }

  const mapped = {};
  for (const field of SENTIMENT_RECORD_FIELDS) {
    const sourceKey = fieldMap[field] || field;
    if (raw[sourceKey] !== undefined) {
      mapped[field] = raw[sourceKey];
    }
  }

  return createSentimentRecord(mapped);
}

module.exports = { normalizeSentimentRecord };
