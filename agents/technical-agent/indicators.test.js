const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateBollingerBands,
  calculateVolumeStats,
  classifyVolatilityZone,
} = require("./indicators");

function candle(close, overrides = {}) {
  return { open: close, high: close, low: close, close, ...overrides };
}

// ---- SMA ----
test("SMA is calculated correctly on an exact window", () => {
  const candles = [10, 20, 30, 40, 50].map((c) => candle(c));
  const result = calculateSMA(candles, 5, "1h");
  assert.equal(result.calculation_status, "CALCULATED");
  assert.equal(result.current_value, 30);
});

test("SMA returns INSUFFICIENT_DATA when fewer candles than the period exist", () => {
  const candles = [10, 20].map((c) => candle(c));
  const result = calculateSMA(candles, 5, "1h");
  assert.equal(result.calculation_status, "INSUFFICIENT_DATA");
  assert.equal(result.current_value, "UNKNOWN");
});

// ---- EMA ----
test("EMA is calculated correctly (hand-verified: seed=20, multiplier=0.5 -> 50)", () => {
  const candles = [10, 20, 30, 40, 50, 60].map((c) => candle(c));
  const result = calculateEMA(candles, 3, "1h");
  assert.equal(result.calculation_status, "CALCULATED");
  assert.equal(result.current_value, 50);
});

// ---- RSI ----
test("RSI is calculated correctly: strictly increasing closes -> RSI 100 (Wilder's, avgLoss=0)", () => {
  const closes = Array.from({ length: 16 }, (_, i) => 10 + i);
  const candles = closes.map((c) => candle(c));
  const result = calculateRSI(candles, 14, "1h");
  assert.equal(result.calculation_status, "CALCULATED");
  assert.equal(result.current_value, 100);
  assert.equal(result.technical_state, "OVERBOUGHT_ZONE");
});

test("RSI is calculated correctly: flat closes -> RSI 50 (no gain, no loss)", () => {
  const candles = Array.from({ length: 16 }, () => candle(100));
  const result = calculateRSI(candles, 14, "1h");
  assert.equal(result.current_value, 50);
  assert.equal(result.technical_state, "NEUTRAL");
});

test("RSI never treats OVERBOUGHT/OVERSOLD as a BUY/SELL instruction — only zone labels exist", () => {
  const closes = Array.from({ length: 16 }, (_, i) => 10 + i);
  const result = calculateRSI(closes.map((c) => candle(c)), 14, "1h");
  assert.ok(["OVERBOUGHT_ZONE", "OVERSOLD_ZONE", "NEUTRAL", "UNKNOWN"].includes(result.technical_state));
});

test("RSI returns INSUFFICIENT_DATA with too few candles", () => {
  const result = calculateRSI([candle(10), candle(11)], 14, "1h");
  assert.equal(result.calculation_status, "INSUFFICIENT_DATA");
});

// ---- MACD ----
test("MACD is calculated correctly and returns a structured line/signal/histogram", () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);
  const candles = closes.map((c) => candle(c));
  const result = calculateMACD(candles, { fast: 12, slow: 26, signal: 9 }, "1h");
  assert.equal(result.calculation_status, "CALCULATED");
  assert.equal(typeof result.current_value.macd_line, "number");
  assert.equal(typeof result.current_value.signal_line, "number");
  assert.equal(typeof result.current_value.histogram, "number");
  assert.ok(["BULLISH_CROSS", "BEARISH_CROSS", "ABOVE_ZERO", "BELOW_ZERO", "NEUTRAL"].includes(result.technical_state));
});

test("MACD returns INSUFFICIENT_DATA with too few candles", () => {
  const result = calculateMACD([candle(10), candle(11)], { fast: 12, slow: 26, signal: 9 }, "1h");
  assert.equal(result.calculation_status, "INSUFFICIENT_DATA");
});

// ---- ATR ----
test("ATR is calculated correctly (hand-verified: constant 10-wide range, no gaps -> ATR 10)", () => {
  const candles = Array.from({ length: 15 }, () => candle(105, { high: 110, low: 100, close: 105 }));
  const result = calculateATR(candles, 14, "1h");
  assert.equal(result.calculation_status, "CALCULATED");
  assert.equal(result.current_value, 10);
});

test("ATR volatility zone is UNKNOWN without configured thresholds, never guessed", () => {
  const candles = Array.from({ length: 15 }, () => candle(105, { high: 110, low: 100, close: 105 }));
  const result = calculateATR(candles, 14, "1h");
  assert.equal(result.technical_state, "UNKNOWN");
});

test("ATR volatility zone respects configured thresholds", () => {
  const candles = Array.from({ length: 15 }, () => candle(105, { high: 110, low: 100, close: 105 }));
  const result = calculateATR(candles, 14, "1h", { volatilityThresholds: { lowMax: 5, normalMax: 15, highMax: 30 } });
  // ATR=10, referencePrice=105 -> atrPercent ~9.52% -> within normalMax(15)
  assert.equal(result.technical_state, "NORMAL");
});

// ---- Bollinger Bands ----
test("Bollinger Bands are calculated correctly (hand-verified: flat closes -> zero-width bands, WITHIN_BANDS)", () => {
  const candles = Array.from({ length: 20 }, () => candle(100, { high: 101, low: 99, close: 100 }));
  const result = calculateBollingerBands(candles, { period: 20, stdDevMultiplier: 2 }, "1h");
  assert.equal(result.calculation_status, "CALCULATED");
  assert.equal(result.current_value.middle, 100);
  assert.equal(result.current_value.upper, 100);
  assert.equal(result.current_value.lower, 100);
  assert.equal(result.technical_state, "WITHIN_BANDS");
});

test("Bollinger Bands returns INSUFFICIENT_DATA with too few candles", () => {
  const result = calculateBollingerBands([candle(10)], { period: 20 }, "1h");
  assert.equal(result.calculation_status, "INSUFFICIENT_DATA");
});

// ---- Volume ----
test("Volume statistics report NOT_AVAILABLE when no candle has volume, never invented", () => {
  const candles = [candle(10), candle(11)];
  const result = calculateVolumeStats(candles);
  assert.equal(result.average_volume, "NOT_AVAILABLE");
  assert.equal(result.volume_status, "NOT_AVAILABLE");
});

test("Volume statistics compute average/current/ratio when volume is present", () => {
  const candles = [candle(10, { volume: 100 }), candle(11, { volume: 200 })];
  const result = calculateVolumeStats(candles);
  assert.equal(result.average_volume, 150);
  assert.equal(result.current_volume, 200);
});

test("classifyVolatilityZone returns UNKNOWN without configured thresholds", () => {
  assert.equal(classifyVolatilityZone(10, 100), "UNKNOWN");
});
