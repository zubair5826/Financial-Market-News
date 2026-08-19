const test = require("node:test");
const assert = require("node:assert/strict");
const { aggregateDirection, DIRECTIONS } = require("./direction");

function evidence(bias) {
  return { bias };
}

test("aggregateDirection returns UNKNOWN with no tagged domains", () => {
  const result = aggregateDirection([null, null, null, null]);
  assert.equal(result.direction, DIRECTIONS.UNKNOWN);
});

test("aggregateDirection returns BULLISH when bullish domains outweigh bearish", () => {
  const result = aggregateDirection([evidence("BULLISH"), evidence("BULLISH"), evidence("NEUTRAL"), null]);
  assert.equal(result.direction, DIRECTIONS.BULLISH);
});

test("aggregateDirection returns MIXED when both BULLISH and BEARISH domains are present", () => {
  const result = aggregateDirection([evidence("BULLISH"), evidence("BEARISH"), null, null]);
  assert.equal(result.direction, DIRECTIONS.MIXED);
});

test("aggregateDirection returns NEUTRAL when tagged domains are all NEUTRAL/MIXED with no directional votes", () => {
  const result = aggregateDirection([evidence("NEUTRAL"), evidence("MIXED"), null, null]);
  assert.equal(result.direction, DIRECTIONS.NEUTRAL);
});

test("aggregateDirection excludes UNKNOWN-bias and missing domains from the vote", () => {
  const result = aggregateDirection([evidence("UNKNOWN"), null, evidence("BULLISH"), null]);
  assert.equal(result.taggedDomains, 1);
  assert.equal(result.direction, DIRECTIONS.BULLISH);
});
