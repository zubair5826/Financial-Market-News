// Same field-mapping pattern as agents/data-controller/normalize.js,
// kept as its own copy here since the News Record and Data Record
// contracts have unrelated field sets — no real news provider's field
// names are assumed or hard-coded.

const { createNewsRecord, NEWS_RECORD_FIELDS } = require("./newsRecord");

// providers/adapters/alphaVantageNewsAdapter.js deliberately preserves
// Alpha Vantage's own time_published value verbatim (compact
// "YYYYMMDD'T'HHMMSS" — no separators, per Alpha Vantage's
// NEWS_SENTIMENT API) as publication_timestamp — that adapter-level
// contract is intentional (raw provider evidence stays unaltered) and
// is covered by its own test. But nothing downstream ever converted
// that compact form into something core/freshness.js's
// computeFreshness() can actually parse: Date.parse("20260824T093000")
// is NaN, so every live news record's freshness silently came back
// UNKNOWN — not because freshnessThresholds was ever missing (it
// wasn't), but because the timestamp itself couldn't be parsed. This
// is the News Agent's own normalization boundary — the correct place
// to turn a provider's raw shape into something the rest of this
// agent can use — so it converts ONLY that one recognized compact
// pattern into a real ISO-8601 timestamp here. Anything else
// (already-ISO caller-supplied timestamps, the UNKNOWN sentinel, a
// missing value) passes through completely untouched.
const ALPHA_VANTAGE_COMPACT_TIMESTAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/;

function normalizePublicationTimestamp(value) {
  if (typeof value !== "string") return value;
  const match = ALPHA_VANTAGE_COMPACT_TIMESTAMP.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}

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

  if (mapped.publication_timestamp !== undefined) {
    mapped.publication_timestamp = normalizePublicationTimestamp(mapped.publication_timestamp);
  }

  return createNewsRecord(mapped);
}

module.exports = { normalizeNewsItem };
