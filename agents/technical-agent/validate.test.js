const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCandleInput, validateOHLCLogic } = require("./validate");
const { createCandle } = require("./technicalRecord");

function validRaw(overrides = {}) {
  return { asset: "BTC", open: 100, high: 105, low: 95, close: 102, classification: "FACT", ...overrides };
}

test("validateCandleInput accepts a structurally valid, logically consistent candle", () => {
  const candle = createCandle(validRaw());
  const result = validateCandleInput(candle);
  assert.equal(result.valid, true, [...result.structuralErrors, ...result.ohlcErrors].join(", "));
});

test("validateCandleInput rejects a candle missing the asset field", () => {
  const candle = createCandle(validRaw({ asset: undefined }));
  const result = validateCandleInput(candle);
  assert.equal(result.valid, false);
  assert.ok(result.missingFields.includes("asset"));
});

test("validateCandleInput does not require timeframe, timestamp, or volume", () => {
  const candle = createCandle(validRaw());
  const result = validateCandleInput(candle);
  assert.equal(result.valid, true);
});

test("validateOHLCLogic rejects high < low", () => {
  const candle = createCandle(validRaw({ high: 90, low: 95 }));
  const result = validateOHLCLogic(candle);
  assert.equal(result.valid, false);
});

test("validateOHLCLogic rejects open above high", () => {
  const candle = createCandle(validRaw({ open: 110, high: 105 }));
  const result = validateOHLCLogic(candle);
  assert.equal(result.valid, false);
});

test("validateOHLCLogic never repairs values — invalid input is returned unchanged", () => {
  const candle = createCandle(validRaw({ high: 90, low: 95 }));
  validateOHLCLogic(candle);
  assert.equal(candle.high, 90);
  assert.equal(candle.low, 95);
});
