// Offline tests for the centralized Freshness Policy — Step 100. Tests
// the actual configured per-domain thresholds against
// core/freshness.js's real, unmodified computeFreshness() — never a
// duplicated/reimplemented freshness calculation.

const test = require("node:test");
const assert = require("node:assert/strict");
const { FRESHNESS_POLICY, getFreshnessThresholds } = require("./freshness");
const { computeFreshness, FRESHNESS_STATES } = require("../core/freshness");

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}
function isoDaysAgo(days) {
  return isoMinutesAgo(days * 24 * 60);
}

// --- Policy shape ---

test("FRESHNESS_POLICY defines exactly market, news, and macro, each frozen with numeric thresholds", () => {
  assert.deepEqual(Object.keys(FRESHNESS_POLICY).sort(), ["macro", "market", "news"]);
  for (const domain of Object.keys(FRESHNESS_POLICY)) {
    const cfg = FRESHNESS_POLICY[domain];
    assert.ok(Object.isFrozen(cfg), `${domain} thresholds must be frozen`);
    assert.equal(typeof cfg.freshMaxMs, "number");
    assert.equal(typeof cfg.agingMaxMs, "number");
    assert.ok(cfg.freshMaxMs < cfg.agingMaxMs, `${domain}: freshMaxMs must be strictly less than agingMaxMs`);
  }
});

test("getFreshnessThresholds returns undefined for an unrecognized domain, never a guessed fallback", () => {
  assert.equal(getFreshnessThresholds("sentiment"), undefined);
  assert.equal(getFreshnessThresholds("technical"), undefined);
  assert.equal(getFreshnessThresholds(""), undefined);
});

// --- 1/2. Fresh / stale market data (candle.timestamp granularity: daily) ---

test("fresh market data: a candle timestamped a few hours ago is FRESH under the market policy", () => {
  const status = computeFreshness(isoMinutesAgo(90), getFreshnessThresholds("market"));
  assert.equal(status, FRESHNESS_STATES.FRESH);
});

test("stale market data: a candle timestamped 10 days ago is STALE under the market policy", () => {
  const status = computeFreshness(isoDaysAgo(10), getFreshnessThresholds("market"));
  assert.equal(status, FRESHNESS_STATES.STALE);
});

// --- 3/4. Fresh / stale news (publication_timestamp granularity: near-real-time) ---

test("fresh news: an article published 10 minutes ago is FRESH under the news policy", () => {
  const status = computeFreshness(isoMinutesAgo(10), getFreshnessThresholds("news"));
  assert.equal(status, FRESHNESS_STATES.FRESH);
});

test("stale news: an article published 2 days ago is STALE under the news policy", () => {
  const status = computeFreshness(isoDaysAgo(2), getFreshnessThresholds("news"));
  assert.equal(status, FRESHNESS_STATES.STALE);
});

// --- 5/6. Fresh / stale macro (release_timestamp granularity: slow, non-daily) ---

test("fresh macro: a release timestamped 5 days ago is FRESH under the macro policy", () => {
  const status = computeFreshness(isoDaysAgo(5), getFreshnessThresholds("macro"));
  assert.equal(status, FRESHNESS_STATES.FRESH);
});

test("stale macro: a release timestamped 200 days ago is STALE under the macro policy", () => {
  const status = computeFreshness(isoDaysAgo(200), getFreshnessThresholds("macro"));
  assert.equal(status, FRESHNESS_STATES.STALE);
});

// --- 7/8. Missing / invalid timestamp -> UNKNOWN, regardless of domain ---

test("missing timestamp: undefined/null/empty always resolves to UNKNOWN under any configured policy", () => {
  for (const domain of ["market", "news", "macro"]) {
    const thresholds = getFreshnessThresholds(domain);
    assert.equal(computeFreshness(undefined, thresholds), FRESHNESS_STATES.UNKNOWN);
    assert.equal(computeFreshness(null, thresholds), FRESHNESS_STATES.UNKNOWN);
    assert.equal(computeFreshness("", thresholds), FRESHNESS_STATES.UNKNOWN);
  }
});

test("invalid timestamp: an unparsable string always resolves to UNKNOWN under any configured policy", () => {
  for (const domain of ["market", "news", "macro"]) {
    const thresholds = getFreshnessThresholds(domain);
    assert.equal(computeFreshness("not-a-real-date", thresholds), FRESHNESS_STATES.UNKNOWN);
  }
});

// A frozen, permanent, pre-existing project decision this fix must never
// try to work around: FRED never supplies a real macro release_timestamp
// at all (providers/adapters/fredMacroAdapter.js, Step 16C/18) — no
// threshold value can change that; UNKNOWN there is correct, not a gap.
test("a macro record with no release_timestamp (FRED's real, frozen behavior) stays UNKNOWN even under a real macro threshold", () => {
  const status = computeFreshness("UNKNOWN", getFreshnessThresholds("macro"));
  assert.equal(status, FRESHNESS_STATES.UNKNOWN);
});
