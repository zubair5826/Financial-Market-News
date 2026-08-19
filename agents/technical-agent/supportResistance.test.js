const test = require("node:test");
const assert = require("node:assert/strict");
const { identifySupportResistance } = require("./supportResistance");

// Same hand-verified zigzag: swing highs at ~105 and ~108 (2.86% apart,
// beyond the default 1.5% cluster tolerance -> stay separate); swing
// lows at ~98 and ~99 (1.02% apart, within tolerance -> cluster into one).
function zigzagCandles() {
  const prices = [100, 102, 104, 101, 99, 103, 107, 104, 100, 105, 110];
  return prices.map((p) => ({ open: p, high: p + 1, low: p - 1, close: p }));
}

test("identifySupportResistance clusters nearby swing lows into one support level", () => {
  const { support_levels } = identifySupportResistance(zigzagCandles());
  assert.equal(support_levels.length, 1);
  assert.equal(support_levels[0].evidence.length, 2);
  assert.equal(support_levels[0].strength, "MODERATE");
});

test("identifySupportResistance keeps distant swing highs as separate resistance levels", () => {
  const { resistance_levels } = identifySupportResistance(zigzagCandles());
  assert.equal(resistance_levels.length, 2);
  assert.ok(resistance_levels.every((r) => r.strength === "WEAK"));
});

test("identifySupportResistance never claims a level from insufficient data", () => {
  const { support_levels, resistance_levels } = identifySupportResistance([{ high: 10, low: 9 }]);
  assert.deepEqual(support_levels, []);
  assert.deepEqual(resistance_levels, []);
});

test("identifySupportResistance levels use observational language via type, never a reversal guarantee", () => {
  const { support_levels } = identifySupportResistance(zigzagCandles());
  assert.equal(support_levels[0].type, "SUPPORT");
  assert.ok("confidence" in support_levels[0]);
});
