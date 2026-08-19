const test = require("node:test");
const assert = require("node:assert/strict");
const { assessTechnicalConflicts, CONFLICT_STATES } = require("./conflicts");

// Fixtures use current_price (snake_case), matching the real field name
// produced by agents/technical-agent/index.js's analyzeTimeframeGroup —
// not currentPrice. A mismatch here previously masked a real bug where
// PRICE_MOMENTUM_CONFLICT could never fire from the actual pipeline.

test("assessTechnicalConflicts returns INSUFFICIENT_DATA with no timeframe analyses", () => {
  const result = assessTechnicalConflicts([]);
  assert.equal(result.status, CONFLICT_STATES.INSUFFICIENT_DATA);
});

test("assessTechnicalConflicts detects a TIMEFRAME_CONFLICT between disagreeing timeframes", () => {
  const analyses = [
    { timeframe: "1h", trend: "UPTREND", momentum: "NEUTRAL", current_price: 100, fastSMA: 95 },
    { timeframe: "4h", trend: "DOWNTREND", momentum: "NEUTRAL", current_price: 100, fastSMA: 105 },
  ];
  const result = assessTechnicalConflicts(analyses);
  assert.equal(result.status, CONFLICT_STATES.CONFLICTING_SIGNALS);
  assert.ok(result.conflicts.some((c) => c.type === "TIMEFRAME_CONFLICT"));
});

test("assessTechnicalConflicts detects a PRICE_MOMENTUM_CONFLICT (price above MA, momentum negative)", () => {
  const analyses = [{ timeframe: "1h", trend: "SIDEWAYS", momentum: "NEGATIVE", current_price: 110, fastSMA: 100 }];
  const result = assessTechnicalConflicts(analyses);
  assert.equal(result.status, CONFLICT_STATES.CONFLICTING_SIGNALS);
  assert.ok(result.conflicts.some((c) => c.type === "PRICE_MOMENTUM_CONFLICT"));
});

test("assessTechnicalConflicts does NOT detect PRICE_MOMENTUM_CONFLICT when current_price is absent (regression guard)", () => {
  // Using the old, incorrect camelCase field name should NOT accidentally
  // satisfy the check — proves the function reads current_price, not
  // currentPrice.
  const analyses = [{ timeframe: "1h", trend: "SIDEWAYS", momentum: "NEGATIVE", currentPrice: 110, fastSMA: 100 }];
  const result = assessTechnicalConflicts(analyses);
  assert.equal(result.conflicts.some((c) => c.type === "PRICE_MOMENTUM_CONFLICT"), false);
});

test("assessTechnicalConflicts preserves both signals, never silently choosing one", () => {
  const analyses = [
    { timeframe: "1h", trend: "UPTREND", momentum: "NEUTRAL", current_price: 100, fastSMA: 95 },
    { timeframe: "4h", trend: "DOWNTREND", momentum: "NEUTRAL", current_price: 100, fastSMA: 105 },
  ];
  const result = assessTechnicalConflicts(analyses);
  const conflict = result.conflicts.find((c) => c.type === "TIMEFRAME_CONFLICT");
  assert.deepEqual(conflict.timeframes, ["1h", "4h"]);
  assert.deepEqual(conflict.trends, ["UPTREND", "DOWNTREND"]);
});

test("assessTechnicalConflicts returns NO_CONFLICT when signals agree", () => {
  const analyses = [
    { timeframe: "1h", trend: "UPTREND", momentum: "POSITIVE", current_price: 110, fastSMA: 100 },
    { timeframe: "4h", trend: "UPTREND", momentum: "POSITIVE", current_price: 110, fastSMA: 100 },
  ];
  const result = assessTechnicalConflicts(analyses);
  assert.equal(result.status, CONFLICT_STATES.NO_CONFLICT);
});
