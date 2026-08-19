// Same field-mapping pattern as agents/data-controller/normalize.js,
// kept as its own copy here since the News Record and Data Record
// contracts have unrelated field sets — no real news provider's field
// names are assumed or hard-coded.

const { createNewsRecord, NEWS_RECORD_FIELDS } = require("./newsRecord");

function normalizeNewsItem(raw, fieldMap = {}) {
  if (!raw || typeof raw !== "object") {
    return createNewsRecord({});
  }

  const mapped = {};
  for (const field of NEWS_RECORD_FIELDS) {
    const sourceKey = fieldMap[field] || field;
    if (raw[sourceKey] !== undefined) {
      mapped[field] = raw[sourceKey];
    }
  }

  return createNewsRecord(mapped);
}

module.exports = { normalizeNewsItem };
