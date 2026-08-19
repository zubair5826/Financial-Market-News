const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeMarketImpact, deriveOverallNewsBias } = require("./impact");

test("summarizeMarketImpact only counts what's already tagged, defaults untagged items to UNKNOWN", () => {
  const items = [{ headline: "A", impact_direction: "POSITIVE" }, { headline: "B" }];
  const summary = summarizeMarketImpact(items);
  assert.equal(summary.counts.POSITIVE, 1);
  assert.equal(summary.counts.UNKNOWN, 1);
});

test("deriveOverallNewsBias returns UNKNOWN when nothing is tagged", () => {
  assert.equal(deriveOverallNewsBias({ POSITIVE: 0, NEGATIVE: 0, MIXED: 0, NEUTRAL: 0, UNKNOWN: 5 }), "UNKNOWN");
});

test("deriveOverallNewsBias returns BULLISH when POSITIVE outweighs NEGATIVE", () => {
  assert.equal(deriveOverallNewsBias({ POSITIVE: 3, NEGATIVE: 1, MIXED: 0, NEUTRAL: 0, UNKNOWN: 0 }), "BULLISH");
});

test("deriveOverallNewsBias returns MIXED when POSITIVE and NEGATIVE both present", () => {
  assert.equal(deriveOverallNewsBias({ POSITIVE: 2, NEGATIVE: 2, MIXED: 0, NEUTRAL: 0, UNKNOWN: 0 }), "MIXED");
});
