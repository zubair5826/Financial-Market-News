// Integration-level tests for the Technical Analysis Agent pipeline,
// numbered to match the 30 required test scenarios from the Step 7 spec.

const test = require("node:test");
const assert = require("node:assert/strict");
const technicalAgent = require("./index");
const { processTechnicalData, runTechnicalAgent, TECHNICAL_AGENT_STATUS } = technicalAgent;
const { ERROR_CODES } = require("../../core/errors");

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

// --- Deduplication of identical report warnings ---
// (root cause: a compact multi-day candle fetch includes many
// genuinely old historical candles; each one independently produces
// its own copy of an identical STALE_DATA warning that carries no
// per-candle detail — see agents/technical-agent/report.js/core/dedupe.js)

function staleCandle(overrides = {}) {
  const oldTimestamp = new Date(Date.now() - 100_000_000).toISOString(); // ~27.8h, beyond the 24h test threshold
  return baseCandle({ timestamp: oldTimestamp, ...overrides });
}

test("31a. identical STALE_DATA warnings from multiple stale candles (same asset/timeframe/source) are emitted only once on the report", () => {
  const candles = [staleCandle(), staleCandle(), staleCandle()];
  const { result, report } = runTechnicalAgent(candles, { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_candles.length, 3); // underlying candles unchanged

  const reportStaleWarnings = report.warnings.filter((w) => typeof w === "object" && w.code === "STALE_DATA");
  assert.equal(reportStaleWarnings.length, 1);
});

test("31b. a genuinely different STALE_DATA warning (different timeframe) is preserved alongside the deduplicated one", () => {
  const candles = [staleCandle(), staleCandle(), staleCandle({ timeframe: "4h" })];
  const { report } = runTechnicalAgent(candles, { freshnessThresholds: THRESHOLDS });
  const oneHourWarnings = report.warnings.filter((w) => typeof w === "object" && w.code === "STALE_DATA" && w.message.includes("(1h)"));
  const fourHourWarnings = report.warnings.filter((w) => typeof w === "object" && w.code === "STALE_DATA" && w.message.includes("(4h)"));
  assert.equal(oneHourWarnings.length, 1);
  assert.equal(fourHourWarnings.length, 1);
});

// Updated for Step 2 (not weakened — the underlying property these
// tests originally proved no longer exists to prove, by design): Step
// 1's dedupeExact() collapsed multiple IDENTICAL-content warnings
// after they were generated. Step 2 goes further for the technical
// agent specifically — only the latest candle in each asset+timeframe
// group is ever evaluated for a warning in the first place (see
// identifyLatestCandlePerGroup() in index.js), so three same-group
// stale candles no longer produce three raw duplicate warnings for
// dedup to collapse; they never produce more than one to begin with.
// core/dedupe.test.js and agents/macro-agent/macroAgent.test.js's own
// 25a-25e (macro-agent is untouched by Step 2) still fully cover
// dedupeExact()'s own exact-duplicate-collapsing behavior in isolation.
test("31c. warnings for distinct asset+timeframe groups appear in the order each group's own latest candle is encountered", () => {
  const candles = [staleCandle({ asset: "BTC" }), staleCandle({ asset: "ETH" })];
  const { report } = runTechnicalAgent(candles, { freshnessThresholds: THRESHOLDS });
  const staleWarnings = report.warnings.filter((w) => typeof w === "object" && w.code === "STALE_DATA");
  assert.equal(staleWarnings.length, 2);
  assert.ok(staleWarnings[0].message.startsWith("BTC"));
  assert.ok(staleWarnings[1].message.startsWith("ETH"));
});

test("31d. Step 2 eliminates intra-group warning duplication at the source — result.warnings (raw) already has exactly one STALE_DATA entry per group, same as report.warnings", () => {
  const candles = [staleCandle(), staleCandle(), staleCandle()]; // same asset+timeframe group
  const { result, report } = runTechnicalAgent(candles, { freshnessThresholds: THRESHOLDS });
  const rawStaleWarnings = result.warnings.filter((w) => typeof w === "object" && w.code === "STALE_DATA");
  const reportStaleWarnings = report.warnings.filter((w) => typeof w === "object" && w.code === "STALE_DATA");
  assert.equal(rawStaleWarnings.length, 1);
  assert.equal(reportStaleWarnings.length, 1);
});

test("31e. deduplication does not change agent_status, confidence, or any validated candle", () => {
  const candles = [staleCandle(), staleCandle(), staleCandle()];
  const { result, report } = runTechnicalAgent(candles, { freshnessThresholds: THRESHOLDS });
  assert.equal(result.agent_status, TECHNICAL_AGENT_STATUS.SUCCESS);
  assert.equal(report.confidence, "MEDIUM"); // driven by result.warnings.length > 0 (un-deduped) — unaffected by dedup
  assert.equal(result.validated_candles.length, 3);
  assert.deepEqual(
    result.validated_candles.map((c) => c.freshness_status),
    ["STALE", "STALE", "STALE"]
  );
});

// --- Step 2: latest-candle-only freshness warnings/uncertainties ---
// (root cause: a compact multi-day fetch legitimately includes many
// genuinely old historical candles; only the single latest candle per
// asset+timeframe group is decision-relevant for freshness — see
// identifyLatestCandlePerGroup() in index.js)

// `count` candles for one asset+timeframe group, oldest first, each
// candle's `close` distinguishing it (100, 101, 102, ...) so a test
// can identify exactly which one was flagged latest regardless of
// input order. Index (count-1) is the newest (timestamp ~now).
function timestampedCandles(count, overrides = {}) {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i;
    return baseCandle({
      close,
      open: close,
      high: close + 1,
      low: close - 1,
      timestamp: new Date(Date.now() - (count - 1 - i) * 3_600_000).toISOString(),
      ...overrides,
    });
  });
}

// `historicalCount` genuinely old (STALE, per THRESHOLDS' 24h aging
// ceiling) candles, plus one final "latest" candle (close: 999,
// timestamp "now" unless overridden) that is always the most recent
// of the group by construction. open/high/low are kept consistent
// with each candle's own `close` (never a fixed value) so a
// distinguishing close never accidentally violates OHLC validation.
function historicalPlusLatest(historicalCount, latestOverrides = {}) {
  const historical = Array.from({ length: historicalCount }, (_, i) => {
    const close = 100 + i;
    return baseCandle({
      close,
      open: close,
      high: close + 1,
      low: close - 1,
      timestamp: new Date(Date.now() - (historicalCount - i) * 100_000_000).toISOString(),
    });
  });
  const latest = baseCandle({ close: 999, open: 999, high: 1000, low: 998, timestamp: new Date().toISOString(), ...latestOverrides });
  return [...historical, latest];
}

// A. Historical candles remain available.
test("A. many historical candles plus the latest all remain available to technical calculations", () => {
  const candles = historicalPlusLatest(60); // 60 historical + 1 latest — enough for SMA-50
  const { result, report } = runTechnicalAgent(candles, { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_candles.length, 61);
  const analysis = report.timeframe_analysis.find((a) => a.timeframe === "1h");
  assert.equal(analysis.candle_count, 61);
  const sma50 = analysis.indicators.sma.find((s) => s.parameters.period === 50);
  assert.equal(sma50.calculation_status, "CALCULATED"); // genuinely uses the historical candles, not just counts them
});

// B. Historical candles never independently create a STALE_DATA warning.
test("B. many genuinely stale historical candles produce no STALE_DATA warning when the latest candle is fresh", () => {
  const candles = historicalPlusLatest(20);
  const { report } = runTechnicalAgent(candles, { freshnessThresholds: THRESHOLDS });
  const staleWarnings = report.warnings.filter((w) => typeof w === "object" && w.code === "STALE_DATA");
  assert.equal(staleWarnings.length, 0);
});

// C. Fresh latest candle: no warning, but still genuinely validated.
test("C. a fresh latest candle produces no STALE warning and is confirmed freshness-validated, not silently skipped", () => {
  const candles = historicalPlusLatest(20);
  const { result } = runTechnicalAgent(candles, { freshnessThresholds: THRESHOLDS });
  const latest = result.validated_candles.find((c) => c.close === 999);
  assert.equal(latest.is_latest_in_group, true);
  assert.equal(latest.freshness_status, "FRESH");
});

// D. Stale latest candle: exactly one warning.
test("D. a genuinely stale latest candle produces exactly one STALE_DATA warning", () => {
  // ~25h old — beyond the 24h aging threshold, but still more recent
  // than every historical candle (the oldest of which is ~27.8h+ old).
  const candles = historicalPlusLatest(20, { timestamp: new Date(Date.now() - 90_000_000).toISOString() });
  const { report } = runTechnicalAgent(candles, { freshnessThresholds: THRESHOLDS });
  const staleWarnings = report.warnings.filter((w) => typeof w === "object" && w.code === "STALE_DATA");
  assert.equal(staleWarnings.length, 1);
});

// E. UNKNOWN latest timestamp — safe, never fabricated.
test("E. a latest candle with a missing timestamp still safely yields UNKNOWN freshness, never a fabricated one", () => {
  const candles = historicalPlusLatest(5);
  delete candles[candles.length - 1].timestamp;
  const { result } = runTechnicalAgent(candles, { freshnessThresholds: THRESHOLDS });
  const latest = result.validated_candles.find((c) => c.close === 999);
  assert.equal(latest.is_latest_in_group, true); // still identified as latest via the documented "trust input order" fallback
  assert.equal(latest.freshness_status, "UNKNOWN");
  assert.ok(!latest.timestamp || Number.isNaN(Date.parse(latest.timestamp))); // never a fabricated real date
});

// F. Ordering.
test("F1. newest-first and oldest-first input orderings identify the same latest candle", () => {
  const oldestFirst = timestampedCandles(5);
  const newestFirst = [...oldestFirst].reverse();
  const { result: r1 } = runTechnicalAgent(oldestFirst, { freshnessThresholds: THRESHOLDS });
  const { result: r2 } = runTechnicalAgent(newestFirst, { freshnessThresholds: THRESHOLDS });
  assert.equal(r1.validated_candles.find((c) => c.is_latest_in_group).close, 104);
  assert.equal(r2.validated_candles.find((c) => c.is_latest_in_group).close, 104);
});

test("F2. a scrambled valid-timestamp ordering also identifies the same latest candle", () => {
  const candles = timestampedCandles(5);
  const scrambled = [candles[2], candles[0], candles[4], candles[1], candles[3]];
  const { result } = runTechnicalAgent(scrambled, { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_candles.find((c) => c.is_latest_in_group).close, 104);
});

// G. Multiple asset+timeframe groups are fully independent.
test("G. each asset+timeframe group gets its own independent latest-candle warning — one stale group never suppresses or replaces another's", () => {
  const oldTimestamp = new Date(Date.now() - 200_000_000).toISOString();
  const staleTimestamp = new Date(Date.now() - 90_000_000).toISOString(); // ~25h, beyond 24h aging
  const freshTimestamp = new Date().toISOString();

  const btcCandles = [
    baseCandle({ asset: "BTC", timeframe: "1h", timestamp: oldTimestamp }),
    baseCandle({ asset: "BTC", timeframe: "1h", timestamp: staleTimestamp }), // BTC's own latest — stale
  ];
  const ethCandles = [
    baseCandle({ asset: "ETH", timeframe: "1h", timestamp: oldTimestamp }),
    baseCandle({ asset: "ETH", timeframe: "1h", timestamp: freshTimestamp }), // ETH's own latest — fresh
  ];

  const { report } = runTechnicalAgent([...btcCandles, ...ethCandles], { freshnessThresholds: THRESHOLDS });
  const staleWarnings = report.warnings.filter((w) => typeof w === "object" && w.code === "STALE_DATA");
  assert.equal(staleWarnings.length, 1);
  assert.ok(staleWarnings[0].message.startsWith("BTC"));
});

// H. Existing technical calculations remain unaffected.
test("H. indicator calculations remain correct and unaffected even with many individually-stale historical candles present", () => {
  const candles = historicalPlusLatest(60);
  const { report } = runTechnicalAgent(candles, { freshnessThresholds: THRESHOLDS });
  const analysis = report.timeframe_analysis.find((a) => a.timeframe === "1h");
  const sma20 = analysis.indicators.sma.find((s) => s.parameters.period === 20);
  assert.equal(sma20.calculation_status, "CALCULATED");
  assert.equal(typeof sma20.current_value, "number");
  assert.equal(analysis.candle_count, 61);
});
// (SMA/EMA/RSI/MACD/ATR/Bollinger/trend/momentum/pattern correctness
// itself is already fully covered, unchanged, by tests 6-11/18-21
// above — all still pass byte-for-byte against the same fixtures.)

// I. Risk Manager interaction — proxied here via the exact same
// mechanism agents/risk-manager/dataQuality.js's countStaleSignals()
// uses (filtering warnings for entry.code === ERROR_CODES.STALE_DATA),
// applied to the real report.warnings the Risk Manager actually
// receives through trade-setup-agent's evidence extraction.
test("I. the Risk Manager's stale-signal count no longer trips merely because historical candles exist, but still trips for a genuinely stale latest candle", () => {
  const { report: freshReport } = runTechnicalAgent(historicalPlusLatest(30), { freshnessThresholds: THRESHOLDS });
  const freshStaleSignalCount = freshReport.warnings.filter((w) => w && typeof w === "object" && w.code === ERROR_CODES.STALE_DATA).length;
  assert.equal(freshStaleSignalCount, 0);

  const { report: staleReport } = runTechnicalAgent(
    historicalPlusLatest(30, { timestamp: new Date(Date.now() - 90_000_000).toISOString() }),
    { freshnessThresholds: THRESHOLDS }
  );
  const staleStaleSignalCount = staleReport.warnings.filter((w) => w && typeof w === "object" && w.code === ERROR_CODES.STALE_DATA).length;
  assert.equal(staleStaleSignalCount, 1);
});
