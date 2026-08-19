const test = require("node:test");
const assert = require("node:assert/strict");
const { INFORMATION_CLASSIFICATIONS, canBePresentedAsFact } = require("../core/classification");

test("SCENARIO, FORECAST, and MARKET_EXPECTATION must never be presentable as FACT", () => {
  assert.equal(canBePresentedAsFact(INFORMATION_CLASSIFICATIONS.SCENARIO), false);
  assert.equal(canBePresentedAsFact(INFORMATION_CLASSIFICATIONS.FORECAST), false);
  assert.equal(canBePresentedAsFact(INFORMATION_CLASSIFICATIONS.MARKET_EXPECTATION), false);
});

test("FACT and HISTORICAL are presentable as fact-tier information", () => {
  assert.equal(canBePresentedAsFact(INFORMATION_CLASSIFICATIONS.FACT), true);
  assert.equal(canBePresentedAsFact(INFORMATION_CLASSIFICATIONS.HISTORICAL), true);
});
