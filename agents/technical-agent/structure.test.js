const test = require("node:test");
const assert = require("node:assert/strict");
const { assessMarketStructure, findSwingPoints } = require("./structure");

// Hand-verified zigzag: prices [100,102,104,101,99,103,107,104,100,105,110],
// high=price+1, low=price-1, lookback=2 (default) produces swing highs at
// index 2 (105) and index 6 (108), and swing lows at index 4 (98) and
// index 8 (99) — see the detailed trace in the technical review notes.
function zigzagCandles() {
  const prices = [100, 102, 104, 101, 99, 103, 107, 104, 100, 105, 110];
  return prices.map((p) => ({ open: p, high: p + 1, low: p - 1, close: p }));
}

test("findSwingPoints identifies the hand-verified swing highs and lows", () => {
  const { highs, lows } = findSwingPoints(zigzagCandles(), 2);
  assert.deepEqual(highs.map((h) => h.index), [2, 6]);
  assert.deepEqual(lows.map((l) => l.index), [4, 8]);
});

test("assessMarketStructure reports the most recently formed swing (HIGHER_LOW at index 8)", () => {
  const result = assessMarketStructure(zigzagCandles());
  assert.equal(result.market_structure, "HIGHER_LOW");
  assert.equal(result.evidence.length, 2);
});

test("assessMarketStructure returns UNKNOWN with too few candles to find swings", () => {
  const candles = [{ high: 10, low: 9 }, { high: 11, low: 10 }];
  const result = assessMarketStructure(candles);
  assert.equal(result.market_structure, "UNKNOWN");
  assert.deepEqual(result.evidence, []);
});

test("assessMarketStructure never claims structure from empty input", () => {
  const result = assessMarketStructure([]);
  assert.equal(result.market_structure, "UNKNOWN");
});
