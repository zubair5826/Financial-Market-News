// Exact-duplicate list deduplication. Collapses byte-identical entries
// (plain strings, or plain JSON-serializable objects such as
// failSafe() results) while preserving the order of each entry's
// FIRST occurrence. Deliberately conservative: two entries are only
// ever collapsed when they are exactly identical — this is not a
// fuzzy/semantic "similar enough" merge, which this project has no
// evidence-based way to define safely (the same discipline already
// applied everywhere else: never invent a rule the data doesn't
// support).
//
// Used by specialist-agent report builders (agents/macro-agent/report.js,
// agents/technical-agent/report.js) to prevent one per-record warning
// or uncertainty — e.g. FRED's per-observation freshness warning, a
// per-candle STALE_DATA warning — from appearing once for every
// contributing record when the message itself carries no per-record
// detail. Never changes which conditions are reported, never discards
// a genuinely distinct entry — only how many times an identical report
// of the same condition appears.

function dedupeExact(list) {
  if (!Array.isArray(list)) return list;
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const key = typeof item === "string" ? item : JSON.stringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

module.exports = { dedupeExact };
