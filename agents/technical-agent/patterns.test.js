const test = require("node:test");
const assert = require("node:assert/strict");
const { detectPatterns, assessBreakout } = require("./patterns");
const { assessMarketStructure } = require("./structure");

// Same hand-verified zigzag as structure.test.js.
function zigzagCandles() {
  const prices = [100, 102, 104, 101, 99, 103, 107, 104, 100, 105, 110];
  return prices.map((p) => ({ open: p, high: p + 1, low: p - 1, close: p }));
}

test("detectPatterns identifies HIGHER_HIGH_HIGHER_LOW from the hand-verified zigzag", () => {
  const candles = zigzagCandles();
  const structureResult = assessMarketStructure(candles);
  const patterns = detectPatterns(candles, structureResult);
  assert.ok(patterns.includes("HIGHER_HIGH_HIGHER_LOW"));
});

test("detectPatterns identifies DOUBLE_TOP when two swing highs are within tolerance", () => {
  // Two highs at ~105 (index 2 and 6), tolerance defaults to 2%.
  const prices = [100, 102, 105, 101, 99, 103, 105.5, 104, 100, 105, 108];
  const candles = prices.map((p) => ({ open: p, high: p + 1, low: p - 1, close: p }));
  const structureResult = assessMarketStructure(candles);
  const patterns = detectPatterns(candles, structureResult);
  assert.ok(patterns.includes("DOUBLE_TOP"));
});

test("detectPatterns returns UNKNOWN, never a guessed pattern, with insufficient swing data", () => {
  const candles = [{ high: 10, low: 9 }, { high: 11, low: 10 }];
  const structureResult = assessMarketStructure(candles);
  const patterns = detectPatterns(candles, structureResult);
  assert.deepEqual(patterns, ["UNKNOWN"]);
});

test("assessBreakout reports BREAKOUT_CANDIDATE, never CONFIRMED, without a confirmation window configured", () => {
  const candles = zigzagCandles();
  const result = assessBreakout(candles);
  // last close (110) is above the last swing high (108 at index 6)
  assert.equal(result.status, "BREAKOUT_CANDIDATE");
  assert.equal(result.level, 108);
});

test("assessBreakout reports CONFIRMED_BREAKOUT only when the configured confirmation window is satisfied", () => {
  const prices = [100, 102, 104, 101, 99, 103, 106, 104, 100, 105, 110, 111, 112];
  const candles = prices.map((p) => ({ open: p, high: p + 1, low: p - 1, close: p }));
  const result = assessBreakout(candles, { breakoutConfirmationCandles: 3 });
  assert.equal(result.status, "CONFIRMED_BREAKOUT");
});

test("assessBreakout returns UNKNOWN, not NONE, when there is no swing evidence at all", () => {
  const result = assessBreakout([{ high: 10, low: 9, close: 9.5 }]);
  assert.equal(result.status, "UNKNOWN");
});
