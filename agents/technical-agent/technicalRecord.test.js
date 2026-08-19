const test = require("node:test");
const assert = require("node:assert/strict");
const { createCandle, validateCandleStructure, CANDLE_FIELDS } = require("./technicalRecord");
const { UNKNOWN } = require("../../core/constants");

test("createCandle defaults every field to UNKNOWN — never invents content", () => {
  const candle = createCandle({ asset: "BTC" });
  assert.equal(candle.asset, "BTC");
  assert.equal(candle.open, UNKNOWN);
  for (const field of CANDLE_FIELDS) {
    assert.ok(field in candle, `missing field ${field}`);
  }
});

test("validateCandleStructure accepts a fully-specified valid candle", () => {
  const candle = createCandle({
    asset: "BTC",
    timeframe: "1h",
    open: 100,
    high: 105,
    low: 95,
    close: 102,
    classification: "FACT",
    verification_status: "VERIFIED_PRIMARY",
    freshness_status: "UNKNOWN",
    confidence: "HIGH",
  });
  const result = validateCandleStructure(candle);
  assert.equal(result.valid, true, result.errors.join(", "));
});

test("validateCandleStructure rejects an invalid classification", () => {
  const candle = createCandle({ classification: "NOT_REAL" });
  const result = validateCandleStructure(candle);
  assert.equal(result.valid, false);
});

test("validateCandleStructure rejects FRESH without a real timestamp", () => {
  const candle = createCandle({ freshness_status: "FRESH" });
  const result = validateCandleStructure(candle);
  assert.equal(result.valid, false);
});
