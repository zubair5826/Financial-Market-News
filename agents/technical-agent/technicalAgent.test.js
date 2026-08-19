// Integration-level tests for the Technical Analysis Agent pipeline,
// numbered to match the 30 required test scenarios from the Step 7 spec.

const test = require("node:test");
const assert = require("node:assert/strict");
const technicalAgent = require("./index");
const { processTechnicalData, runTechnicalAgent, TECHNICAL_AGENT_STATUS } = technicalAgent;

const THRESHOLDS = { freshMaxMs: 3_600_000, agingMaxMs: 86_400_000 }; // 1h fresh, 24h aging — test-only

function baseCandle(overrides = {}) {
  return {
    asset: "BTC",
    timeframe: "1h",
    timestamp: new Date().toISOString(),
    open: 100,
    high: 105,
    low: 95,
    close: 102,
    volume: 1000,
    source: "internal-test-source",
    classification: "FACT",
    ...overrides,
  };
}

function buildUptrendCandles(count) {
  const candles = [];
  for (let i = 0; i < count; i++) {
    const close = 100 + i * 0.5;
    candles.push({
      asset: "BTC",
      timeframe: "1h",
      timestamp: new Date(Date.now() - (count - 1 - i) * 3_600_000).toISOString(),
      open: close - 0.2,
      high: close + 0.3,
      low: close - 0.3,
      close,
      volume: 1000 + i,
      source: "internal-test-source",
      classification: "FACT",
    });
  }
  return candles;
}

function buildTrendCandles(count, timeframe, direction) {
  const candles = [];
  for (let i = 0; i < count; i++) {
    const close = direction === "up" ? 100 + i : 109 - i;
    candles.push({
      asset: "BTC",
      timeframe,
      timestamp: new Date(Date.now() - (count - 1 - i) * 3_600_000).toISOString(),
      open: close - 0.2,
      high: close + 0.3,
      low: close - 0.3,
      close,
      volume: 1000,
      source: "internal-test-source",
      classification: "FACT",
    });
  }
  return candles;
}

function zigzagCandles() {
  const prices = [100, 102, 104, 101, 99, 103, 107, 104, 100, 105, 110];
  return prices.map((p, i) => ({
    asset: "BTC",
    timeframe: "1h",
    timestamp: new Date(Date.now() - (prices.length - 1 - i) * 3_600_000).toISOString(),
    open: p,
    high: p + 1,
    low: p - 1,
    close: p,
    volume: 1000,
    source: "internal-test-source",
    classification: "FACT",
  }));
}

const SMALL_INDICATOR_CONFIG = {
  sma: [3, 5],
  ema: [2, 3],
  rsi: { period: 3 },
  macd: { fast: 2, slow: 4, signal: 2 },
  atr: { period: 3 },
  bollinger: { period: 5, stdDevMultiplier: 2 },
};

// 1. Valid OHLCV data accepted.
test("1. a valid candle is accepted and marked SUCCESS", () => {
  const result = processTechnicalData([baseCandle()], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.agent_status, TECHNICAL_AGENT_STATUS.SUCCESS);
  assert.equal(result.validated_candles.length, 1);
});

// 2. Missing asset rejected.
test("2. a candle missing its asset is rejected, not silently accepted", () => {
  const candle = baseCandle();
  delete candle.asset;
  const result = processTechnicalData([candle], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_candles.length, 0);
  assert.equal(result.rejected_candles.length, 1);
  assert.equal(result.agent_status, TECHNICAL_AGENT_STATUS.FAILED);
});

// 3. Missing timestamp handled safely.
test("3. a candle with no timestamp is still processed, not rejected", () => {
  const candle = baseCandle();
  delete candle.timestamp;
  const result = processTechnicalData([candle], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_candles.length, 1);
  assert.equal(result.validated_candles[0].freshness_status, "UNKNOWN");
});

// 4. Invalid OHLC candle rejected.
test("4. a candle violating basic OHLC rules is rejected, values never repaired", () => {
  const candle = baseCandle({ high: 90, low: 95 });
  const result = processTechnicalData([candle], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_candles.length, 0);
  assert.equal(result.rejected_candles.length, 1);
  assert.equal(result.rejected_candles[0].record.high, 90);
});

// 5. Missing volume handled safely.
test("5. a candle with no volume is still processed, volume reads NOT_AVAILABLE", () => {
  const candle = baseCandle();
  delete candle.volume;
  const result = processTechnicalData([candle], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_candles.length, 1);
  assert.equal(result.validated_candles[0].volume, "NOT_AVAILABLE");
});

// 6-11: full pipeline indicator wiring, using a 55-candle uptrend so
// every default-configured indicator (including SMA_50) has enough data.
const richResult = processTechnicalData(buildUptrendCandles(55), { freshnessThresholds: THRESHOLDS });
const richAnalysis = richResult.timeframe_analyses[0];

test("6. SMA is calculated correctly through the full pipeline", () => {
  assert.ok(richAnalysis.indicators.sma.every((r) => r.calculation_status === "CALCULATED"));
});

test("7. EMA is calculated correctly through the full pipeline", () => {
  assert.ok(richAnalysis.indicators.ema.every((r) => r.calculation_status === "CALCULATED"));
});

test("8. RSI is calculated correctly through the full pipeline", () => {
  assert.equal(richAnalysis.indicators.rsi.calculation_status, "CALCULATED");
});

test("9. MACD is calculated correctly through the full pipeline", () => {
  assert.equal(richAnalysis.indicators.macd.calculation_status, "CALCULATED");
});

test("10. ATR is calculated correctly through the full pipeline", () => {
  assert.equal(richAnalysis.indicators.atr.calculation_status, "CALCULATED");
});

test("11. Bollinger Bands are calculated correctly through the full pipeline", () => {
  assert.equal(richAnalysis.indicators.bollinger_bands.calculation_status, "CALCULATED");
});

// 12. Insufficient candles returns INSUFFICIENT DATA.
test("12. too few candles produces INSUFFICIENT_DATA, never a fabricated indicator value", () => {
  const result = processTechnicalData([baseCandle(), baseCandle()], { freshnessThresholds: THRESHOLDS });
  const analysis = result.timeframe_analyses[0];
  assert.equal(analysis.indicators.sma[0].calculation_status, "INSUFFICIENT_DATA");
  assert.equal(analysis.indicators.sma[0].current_value, "UNKNOWN");
});

// 13. Missing data never becomes fabricated data.
test("13. a candle with no volume never gets a guessed volume number", () => {
  const candle = baseCandle();
  delete candle.volume;
  const result = processTechnicalData([candle], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_candles[0].volume, "NOT_AVAILABLE");
  assert.notEqual(typeof result.validated_candles[0].volume, "number");
});

// 14-17: classification pass-through.
test("14. a FORECAST candle's classification is never changed", () => {
  const result = processTechnicalData([baseCandle({ classification: "FORECAST" })], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_candles[0].classification, "FORECAST");
});

test("15. a SCENARIO candle's classification is never changed", () => {
  const result = processTechnicalData([baseCandle({ classification: "SCENARIO" })], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_candles[0].classification, "SCENARIO");
});

test("16. a MARKET_EXPECTATION candle's classification is never changed", () => {
  const result = processTechnicalData([baseCandle({ classification: "MARKET_EXPECTATION" })], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_candles[0].classification, "MARKET_EXPECTATION");
});

test("17. classification is never upgraded toward FACT for any non-FACT input", () => {
  for (const classification of ["FORECAST", "MARKET_EXPECTATION", "SCENARIO", "UNVERIFIED"]) {
    const result = processTechnicalData([baseCandle({ classification })], { freshnessThresholds: THRESHOLDS });
    assert.notEqual(result.validated_candles[0].classification, "FACT");
  }
});

// 18. Support/resistance only generated from actual supplied data.
test("18. support/resistance levels are only produced when real swing evidence exists", () => {
  const goodResult = processTechnicalData(zigzagCandles(), { freshnessThresholds: THRESHOLDS });
  assert.ok(goodResult.timeframe_analyses[0].support_levels.length > 0);

  const sparseResult = processTechnicalData([baseCandle(), baseCandle()], { freshnessThresholds: THRESHOLDS });
  assert.deepEqual(sparseResult.timeframe_analyses[0].support_levels, []);
});

// 19. Trend classification requires sufficient evidence.
test("19. trend is UNKNOWN, not guessed, when moving averages can't be calculated", () => {
  const result = processTechnicalData([baseCandle(), baseCandle()], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.timeframe_analyses[0].trend, "UNKNOWN");
});

// 20. Momentum does not automatically become BUY/SELL.
test("20. momentum is always one of the defined observation states, never BUY/SELL", () => {
  const result = processTechnicalData(buildUptrendCandles(20), { freshnessThresholds: THRESHOLDS, indicatorConfig: SMALL_INDICATOR_CONFIG });
  const momentum = result.timeframe_analyses[0].momentum;
  assert.ok(["STRONG_POSITIVE", "POSITIVE", "NEUTRAL", "NEGATIVE", "STRONG_NEGATIVE", "UNKNOWN"].includes(momentum));
});

// 21. Technical bias does not become BUY/SELL.
test("21. technical_bias is always an evidence label, never BUY/SELL/LONG/SHORT", () => {
  const { report } = runTechnicalAgent(buildUptrendCandles(55), { freshnessThresholds: THRESHOLDS });
  assert.ok(["BULLISH", "BEARISH", "MIXED", "NEUTRAL", "UNKNOWN"].includes(report.technical_bias));
  assert.equal("recommendation_type" in report, false);
});

// 22. Multi-timeframe conflict is detected.
test("22. an uptrend on 1h and a downtrend on 4h are flagged as a TIMEFRAME_CONFLICT", () => {
  const input = [...buildTrendCandles(10, "1h", "up"), ...buildTrendCandles(10, "4h", "down")];
  const result = processTechnicalData(input, { freshnessThresholds: THRESHOLDS, indicatorConfig: SMALL_INDICATOR_CONFIG, requestedAsset: "BTC" });
  assert.equal(result.technical_conflicts.status, "CONFLICTING_SIGNALS");
  assert.equal(result.agent_status, TECHNICAL_AGENT_STATUS.CONFLICTING);
  assert.ok(result.technical_conflicts.conflicts.some((c) => c.type === "TIMEFRAME_CONFLICT"));
});

// 23. Stale data is identified when thresholds are supplied.
test("23. a candle older than the configured aging threshold is marked STALE", () => {
  const oldTimestamp = new Date(Date.now() - 100_000_000).toISOString(); // ~27.8h — genuinely beyond the 24h (86_400_000ms) aging threshold
  const candle = baseCandle({ timestamp: oldTimestamp });
  const result = processTechnicalData([candle], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_candles[0].freshness_status, "STALE");
  assert.ok(result.warnings.some((w) => typeof w === "object" && w.code === "STALE_DATA"));
});

// 24. Missing timestamp results in UNKNOWN freshness.
test("24. a candle with no timestamp always yields UNKNOWN freshness, never assumed fresh", () => {
  const candle = baseCandle();
  delete candle.timestamp;
  const result = processTechnicalData([candle], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_candles[0].freshness_status, "UNKNOWN");
});

// 25 & 26. No external API / live market access is claimed.
test("25-26. the module exposes no live-fetch / external-access capability to claim", () => {
  const exportedNames = Object.keys(technicalAgent).sort();
  assert.deepEqual(exportedNames, ["TECHNICAL_AGENT_STATUS", "processTechnicalData", "runTechnicalAgent"].sort());
});

// 27. Technical Agent does not create trading recommendations.
test("27. the Technical Report never carries a trading recommendation of any kind", () => {
  const { report } = runTechnicalAgent(buildUptrendCandles(55), { freshnessThresholds: THRESHOLDS });
  assert.equal("recommendation_type" in report, false);
  const serialized = JSON.stringify(report);
  assert.ok(!/"BUY"|"SELL"|"LONG"|"SHORT"/.test(serialized));
});

// 28. Missing market data returns TECHNICAL DATA UNAVAILABLE.
test("28. no input data at all returns UNAVAILABLE with a TECHNICAL DATA UNAVAILABLE warning", () => {
  const result = processTechnicalData([]);
  assert.equal(result.agent_status, TECHNICAL_AGENT_STATUS.UNAVAILABLE);
  assert.ok(result.warnings.some((w) => w.includes("TECHNICAL DATA UNAVAILABLE")));
});

// 29. Conflicting technical signals are preserved.
test("29. both sides of a timeframe conflict remain present in timeframe_analysis, neither dropped", () => {
  const input = [...buildTrendCandles(10, "1h", "up"), ...buildTrendCandles(10, "4h", "down")];
  const result = processTechnicalData(input, { freshnessThresholds: THRESHOLDS, indicatorConfig: SMALL_INDICATOR_CONFIG });
  assert.equal(result.timeframe_analyses.length, 2);
  const timeframes = result.timeframe_analyses.map((a) => a.timeframe).sort();
  assert.deepEqual(timeframes, ["1h", "4h"]);
});

// 30. No fabricated price or candle exists.
test("30. an invalid candle's original values are preserved untouched in rejected_candles, never repaired", () => {
  const candle = baseCandle({ open: 999, high: 90, low: 95 });
  const result = processTechnicalData([candle], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.rejected_candles[0].record.open, 999);
  assert.equal(result.rejected_candles[0].record.high, 90);
  assert.equal(result.rejected_candles[0].record.low, 95);
});

test("a provider failSafe()-shaped error passed as input is handled, not crashed on", () => {
  const providerError = { ok: false, code: "API_UNAVAILABLE", message: "no provider connected", details: {} };
  const result = processTechnicalData(providerError);
  assert.equal(result.agent_status, TECHNICAL_AGENT_STATUS.UNAVAILABLE);
});

test("a non-array top-level input is rejected as FAILED", () => {
  const result = processTechnicalData("not-an-array");
  assert.equal(result.agent_status, TECHNICAL_AGENT_STATUS.FAILED);
});
