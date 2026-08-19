const test = require("node:test");
const assert = require("node:assert/strict");
const { computeFreshness, FRESHNESS_STATES } = require("../core/freshness");

test("computeFreshness returns UNKNOWN with no timestamp", () => {
  assert.equal(computeFreshness(null, { freshMaxMs: 1000, agingMaxMs: 5000 }), FRESHNESS_STATES.UNKNOWN);
});

test("computeFreshness returns UNKNOWN without thresholds (no default thresholds are assumed)", () => {
  assert.equal(computeFreshness(new Date().toISOString()), FRESHNESS_STATES.UNKNOWN);
});

test("computeFreshness returns UNKNOWN for an unparsable timestamp", () => {
  assert.equal(computeFreshness("not-a-date", { freshMaxMs: 1000, agingMaxMs: 5000 }), FRESHNESS_STATES.UNKNOWN);
});

test("computeFreshness classifies FRESH within freshMaxMs", () => {
  const ts = new Date(Date.now() - 1000).toISOString();
  assert.equal(computeFreshness(ts, { freshMaxMs: 5000, agingMaxMs: 60000 }), FRESHNESS_STATES.FRESH);
});

test("computeFreshness classifies AGING between the two thresholds", () => {
  const ts = new Date(Date.now() - 10000).toISOString();
  assert.equal(computeFreshness(ts, { freshMaxMs: 5000, agingMaxMs: 60000 }), FRESHNESS_STATES.AGING);
});

test("computeFreshness classifies STALE beyond agingMaxMs", () => {
  const ts = new Date(Date.now() - 120000).toISOString();
  assert.equal(computeFreshness(ts, { freshMaxMs: 5000, agingMaxMs: 60000 }), FRESHNESS_STATES.STALE);
});
