// Integration-level tests for the Trade Setup Agent pipeline, numbered
// to match the 20 required test scenarios from the Step 9 spec.

const test = require("node:test");
const assert = require("node:assert/strict");
const tradeSetupAgent = require("./index");
const { processTradeSetup, runTradeSetupAgent, SETUP_STATUS } = tradeSetupAgent;

function newsReport(overrides = {}) {
  return {
    agent_name: "news-agent",
    timestamp: new Date().toISOString(),
    requested_asset: "BTC",
    news_items: [],
    key_events: [],
    relevant_events: [],
    conflicting_reports: [],
    unverified_reports: [],
    market_impact_assessment: { counts: {}, items: [] },
    overall_news_bias: "BULLISH",
    confidence: "HIGH",
    uncertainties: [],
    warnings: [],
    sources: ["news-source-A"],
    ...overrides,
  };
}

function macroReport(overrides = {}) {
  return {
    agent_name: "macro-agent",
    timestamp: new Date().toISOString(),
    requested_asset: "BTC",
    macro_records: [],
    key_indicators: [],
    upcoming_events: [],
    economic_surprises: [],
    central_bank_assessment: { events: [], overall_policy_direction: "UNKNOWN" },
    macro_risks: [],
    market_impact_assessment: { counts: {}, items: [] },
    macro_bias: "BULLISH",
    confidence: "HIGH",
    uncertainties: [],
    conflicts: [],
    warnings: [],
    sources: ["macro-source-A"],
    ...overrides,
  };
}

function technicalReport(overrides = {}) {
  return {
    agent_name: "technical-agent",
    timestamp: new Date().toISOString(),
    requested_asset: "BTC",
    timeframes_analyzed: ["1h"],
    candles_analyzed: 55,
    indicators: {},
    trend_analysis: "UPTREND",
    market_structure: { market_structure: "HIGHER_HIGH", evidence: [] },
    support_levels: [{ level: 100, type: "SUPPORT", timeframe: "1h", evidence: [], strength: "MODERATE", confidence: "MEDIUM" }],
    resistance_levels: [{ level: 120, type: "RESISTANCE", timeframe: "1h", evidence: [], strength: "WEAK", confidence: "LOW" }],
    momentum: "POSITIVE",
    volatility: { volatility: "NORMAL", basis: "ATR", atr_value: 5 },
    volume_analysis: { average_volume: 1000, current_volume: 1200, volume_ratio: 1.2, volume_status: "UNKNOWN", calculation_status: "CALCULATED" },
    patterns: ["HIGHER_HIGH_HIGHER_LOW"],
    breakout_analysis: { status: "NONE", level: null },
    timeframe_analysis: [],
    technical_conflicts: { status: "NO_CONFLICT", conflicts: [] },
    technical_bias: "BULLISH",
    confidence: "HIGH",
    uncertainties: [],
    warnings: [],
    sources: ["technical-source-A"],
    ...overrides,
  };
}

function sentimentReport(overrides = {}) {
  return {
    agent_name: "sentiment-agent",
    timestamp: new Date().toISOString(),
    requested_asset: "BTC",
    sentiment_records: [],
    source_breakdown: {},
    sentiment_distribution: {
      bullish_count: 1,
      bearish_count: 0,
      neutral_count: 0,
      mixed_count: 0,
      unknown_count: 0,
      weighted_sentiment: 1,
      source_count: 1,
      confidence: "LOW",
    },
    sentiment_bias: "BULLISH",
    sentiment_strength: { VERY_STRONG: 0, STRONG: 0, MODERATE: 1, WEAK: 0, UNKNOWN: 0 },
    conflicts: [],
    unverified_sentiment: [],
    market_impact_assessment: { impact_direction: "POSITIVE", based_on: "aggregated sentiment_bias", notes: "n/a" },
    confidence: "MEDIUM",
    uncertainties: [],
    warnings: [],
    sources: ["sentiment-source-A"],
    ...overrides,
  };
}

function allBullishInputs() {
  return {
    newsReport: newsReport(),
    macroReport: macroReport(),
    technicalReport: technicalReport(),
    sentimentReport: sentimentReport(),
  };
}

// 1. All four inputs accepted.
test("1. all four domain reports are accepted and produce a coherent setup", () => {
  const result = processTradeSetup(allBullishInputs());
  assert.notEqual(result.setup_status, SETUP_STATUS.DATA_UNAVAILABLE);
  assert.ok(result.news_evidence && result.macro_evidence && result.technical_evidence && result.sentiment_evidence);
});

// 2. Missing technical report.
test("2. a missing technical report is handled — technical_evidence is null, other domains still process", () => {
  const inputs = allBullishInputs();
  delete inputs.technicalReport;
  const result = processTradeSetup(inputs);
  assert.equal(result.technical_evidence, null);
  assert.notEqual(result.setup_status, SETUP_STATUS.DATA_UNAVAILABLE);
  assert.ok(result.setup_risks.includes("DATA_RISK"));
});

// 3. Missing news report.
test("3. a missing news report is handled — news_evidence is null, other domains still process", () => {
  const inputs = allBullishInputs();
  delete inputs.newsReport;
  const result = processTradeSetup(inputs);
  assert.equal(result.news_evidence, null);
  assert.notEqual(result.setup_status, SETUP_STATUS.DATA_UNAVAILABLE);
});

// 4. Missing macro report.
test("4. a missing macro report is handled — macro_evidence is null, other domains still process", () => {
  const inputs = allBullishInputs();
  delete inputs.macroReport;
  const result = processTradeSetup(inputs);
  assert.equal(result.macro_evidence, null);
  assert.notEqual(result.setup_status, SETUP_STATUS.DATA_UNAVAILABLE);
});

// 5. Missing sentiment report.
test("5. a missing sentiment report is handled — sentiment_evidence is null, other domains still process", () => {
  const inputs = allBullishInputs();
  delete inputs.sentimentReport;
  const result = processTradeSetup(inputs);
  assert.equal(result.sentiment_evidence, null);
  assert.notEqual(result.setup_status, SETUP_STATUS.DATA_UNAVAILABLE);
});

// 6. Conflicting evidence.
test("6. opposing domain biases (technical BULLISH vs news BEARISH) produce CONFLICTING_EVIDENCE, both preserved", () => {
  const inputs = {
    technicalReport: technicalReport({ technical_bias: "BULLISH" }),
    newsReport: newsReport({ overall_news_bias: "BEARISH" }),
  };
  const result = processTradeSetup(inputs);
  assert.equal(result.setup_status, SETUP_STATUS.CONFLICTING_EVIDENCE);
  assert.equal(result.conflicting_evidence.length, 2);
});

// 7. Strong confluence.
test("7. four agreeing, high-confidence domains produce SETUP_PRESENT with HIGH quality", () => {
  const result = processTradeSetup(allBullishInputs());
  assert.equal(result.setup_status, SETUP_STATUS.SETUP_PRESENT);
  assert.equal(result.setup_quality, "HIGH");
});

// 8. Weak confluence.
test("8. two agreeing but low-confidence domains produce SETUP_NOT_PRESENT with LOW quality", () => {
  const inputs = {
    technicalReport: technicalReport({ technical_bias: "BULLISH", confidence: "LOW" }),
    sentimentReport: sentimentReport({ sentiment_bias: "BULLISH", confidence: "LOW" }),
  };
  const result = processTradeSetup(inputs);
  assert.equal(result.setup_quality, "LOW");
  assert.equal(result.setup_status, SETUP_STATUS.SETUP_NOT_PRESENT);
});

// 9. Missing prices.
test("9. with no technical report, potential_levels is empty and invalidation is DATA_UNAVAILABLE", () => {
  const inputs = allBullishInputs();
  delete inputs.technicalReport;
  const result = processTradeSetup(inputs);
  assert.deepEqual(result.potential_levels, []);
  assert.equal(result.invalidation_conditions[0].condition, "DATA_UNAVAILABLE");
});

// 10. No fabricated levels.
test("10. every potential_levels entry traces back exactly to the technical report's own level numbers", () => {
  const result = processTradeSetup(allBullishInputs());
  const values = result.potential_levels.map((l) => l.level);
  assert.ok(values.every((v) => v === 100 || v === 120));
});

// 11. No guaranteed profit.
test("11. no field or text in the report ever claims a guarantee of profit or outcome", () => {
  const { report } = runTradeSetupAgent(allBullishInputs());
  const serialized = JSON.stringify(report).toLowerCase();
  assert.ok(!serialized.includes("guarantee"));
});

// 12. No broker calls.
test("12. the module has no broker/exchange integration of any kind", () => {
  const exportedNames = Object.keys(tradeSetupAgent).sort();
  assert.equal(exportedNames.some((n) => /broker|exchange/i.test(n)), false);
});

// 13. No execution.
test("13. the module exposes no order/position/execution capability — exactly 3 exports", () => {
  const exportedNames = Object.keys(tradeSetupAgent).sort();
  assert.deepEqual(exportedNames, ["SETUP_STATUS", "processTradeSetup", "runTradeSetupAgent"].sort());
});

// 14. Setup direction separated from execution.
test("14. direction is an evidence label, never an execution order — no recommendation_type, no BUY/SELL/LONG/SHORT", () => {
  const { report } = runTradeSetupAgent(allBullishInputs());
  assert.ok(["BULLISH", "BEARISH", "NEUTRAL", "MIXED", "UNKNOWN"].includes(report.direction));
  assert.equal("recommendation_type" in report, false);
  const serialized = JSON.stringify(report);
  assert.ok(!/"BUY"|"SELL"|"LONG"|"SHORT"/.test(serialized));
});

// 15. Setup quality calculation.
test("15. setup_quality is UNKNOWN when fewer than 2 domains have usable evidence", () => {
  const result = processTradeSetup({ technicalReport: technicalReport() });
  assert.equal(result.setup_quality, "UNKNOWN");
  assert.equal(result.setup_status, SETUP_STATUS.INSUFFICIENT_DATA);
});

// 16. Confidence handling.
test("16. report confidence is LOW when conflicting_evidence is non-empty, HIGH only with all 4 domains agreeing", () => {
  const conflicting = processTradeSetup({
    technicalReport: technicalReport({ technical_bias: "BULLISH" }),
    newsReport: newsReport({ overall_news_bias: "BEARISH" }),
  });
  assert.equal(conflicting.confidence, "LOW");

  const full = processTradeSetup(allBullishInputs());
  assert.equal(full.confidence, "HIGH");
});

// 17. Stale input handling.
// Step 101: TIMING_RISK is read from the domain report's structured
// STALE_DATA warning object (failSafe()'s `.code`), never from an
// uncertainty's message text — this fixture mirrors exactly what
// news-agent/index.js itself pushes into `warnings` for a real STALE
// record.
test("17. a domain reporting a structured STALE_DATA warning results in a TIMING_RISK flag", () => {
  const inputs = allBullishInputs();
  inputs.newsReport = newsReport({
    warnings: [{ ok: false, code: "STALE_DATA", message: '"Fed holds rates" from source-A is STALE DATA.', details: {} }],
  });
  const result = processTradeSetup(inputs);
  assert.ok(result.setup_risks.includes("TIMING_RISK"));
});

// 18. Unverified input handling.
test("18. an UNVERIFIED note in a domain's uncertainties is preserved in the aggregate uncertainties, not hidden", () => {
  const inputs = allBullishInputs();
  inputs.sentimentReport = sentimentReport({ uncertainties: ["BTC sentiment from source-A: UNVERIFIED."] });
  const result = processTradeSetup(inputs);
  assert.ok(result.uncertainties.some((u) => u.includes("UNVERIFIED")));
});

// 19. Scenario remains SCENARIO.
test("19. a SCENARIO-classified macro key_indicator keeps that classification when passed through as evidence", () => {
  const inputs = allBullishInputs();
  inputs.macroReport = macroReport({ key_indicators: [{ indicator: "Hypothetical inflation shock", classification: "SCENARIO" }] });
  const result = processTradeSetup(inputs);
  assert.equal(result.macro_evidence.items[0].classification, "SCENARIO");
});

// 20. Forecast remains FORECAST.
test("20. a FORECAST-classified news key_event keeps that classification when passed through as evidence", () => {
  const inputs = allBullishInputs();
  inputs.newsReport = newsReport({ key_events: [{ headline: "Analyst projects rate cut", classification: "FORECAST" }] });
  const result = processTradeSetup(inputs);
  assert.equal(result.news_evidence.items[0].classification, "FORECAST");
});

test("malformed (non-object) input is rejected as DATA_UNAVAILABLE, not crashed on", () => {
  const result = processTradeSetup("not-an-object");
  assert.equal(result.setup_status, SETUP_STATUS.DATA_UNAVAILABLE);
});

test("no inputs at all returns DATA_UNAVAILABLE with a clear warning", () => {
  const result = processTradeSetup({});
  assert.equal(result.setup_status, SETUP_STATUS.DATA_UNAVAILABLE);
  assert.ok(result.warnings.some((w) => w.includes("TRADE SETUP DATA UNAVAILABLE")));
});

test("a report with the wrong agent_name is treated as not supplied, not blindly trusted", () => {
  const inputs = allBullishInputs();
  inputs.technicalReport = { ...inputs.technicalReport, agent_name: "some-other-agent" };
  const result = processTradeSetup(inputs);
  assert.equal(result.technical_evidence, null);
  assert.ok(result.warnings.some((w) => w.includes("failed structural validation")));
});
