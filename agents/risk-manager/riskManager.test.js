// Integration-level tests for the Risk Manager pipeline, covering each
// scenario listed in the Step 10 spec's TESTING section.

const test = require("node:test");
const assert = require("node:assert/strict");
const riskManager = require("./index");
const { processRiskAssessment, runRiskManager, RISK_LEVELS, RISK_DECISIONS } = riskManager;

function tradeSetupReport(overrides = {}) {
  return {
    agent_name: "trade-setup-agent",
    timestamp: new Date().toISOString(),
    asset: "BTC",
    setup_status: "SETUP_PRESENT",
    direction: "BULLISH",
    supporting_evidence: [],
    conflicting_evidence: [],
    technical_evidence: { domain: "TECHNICAL", bias: "BULLISH", confidence: "HIGH", conflicts: [], uncertainties: [], sources: ["tech-A"] },
    news_evidence: { domain: "NEWS", bias: "BULLISH", confidence: "HIGH", conflicts: [], uncertainties: [], sources: ["news-A"] },
    macro_evidence: { domain: "MACRO", bias: "BULLISH", confidence: "HIGH", conflicts: [], uncertainties: [], sources: ["macro-A"] },
    sentiment_evidence: { domain: "SENTIMENT", bias: "BULLISH", confidence: "HIGH", conflicts: [], uncertainties: [], sources: ["sent-A"] },
    confluence: { domain_scores: {}, confluence_score: 4, confluence_ratio: 1 },
    setup_quality: "HIGH",
    potential_levels: [{ level: 100, type: "SUPPORT", level_type: "PROPOSED_SETUP_LEVEL" }],
    invalidation_conditions: [{ condition: "CLOSE_BELOW_LEVEL", level: 100, level_type: "PROPOSED_SETUP_LEVEL" }],
    setup_risks: [],
    confidence: "HIGH",
    uncertainties: [],
    warnings: [],
    sources: ["setup-source-A"],
    ...overrides,
  };
}

const FULL_SIZING_PARAMS = { accountBalance: 10000, riskPercentage: 0.01, leverage: 1, entryPrice: 100, stopPrice: 95, contractSize: 1 };

// Complete fixtures satisfying reportValidation.js's required-field
// list for each report type — an incomplete fixture would silently
// fail validation and be treated as "not supplied," which would make
// a test pass without actually exercising the code path it's meant to.
function fullMacroReport(overrides = {}) {
  return {
    agent_name: "macro-agent",
    macro_bias: "BULLISH",
    confidence: "HIGH",
    uncertainties: [],
    conflicts: [],
    warnings: [],
    sources: ["macro-A"],
    upcoming_events: [],
    ...overrides,
  };
}

function fullTechnicalReport(overrides = {}) {
  return {
    agent_name: "technical-agent",
    technical_bias: "BULLISH",
    confidence: "HIGH",
    uncertainties: [],
    technical_conflicts: { status: "NO_CONFLICT", conflicts: [] },
    volatility: { volatility: "NORMAL", basis: "ATR", atr_value: 5 },
    volume_analysis: { volume_status: "UNKNOWN" },
    warnings: [],
    sources: ["technical-A"],
    ...overrides,
  };
}

// 1. Valid setup.
test("valid setup: a clean, fully-specified setup with full sizing params produces LOW risk / RISK_ACCEPTABLE", () => {
  const result = processRiskAssessment({ tradeSetupReport: tradeSetupReport() }, { positionSizingParams: FULL_SIZING_PARAMS });
  assert.equal(result.risk_level, RISK_LEVELS.LOW);
  assert.equal(result.risk_decision, RISK_DECISIONS.RISK_ACCEPTABLE);
  assert.equal(result.confidence, "HIGH");
});

// 2. Missing setup.
test("missing setup: no trade setup reference returns UNKNOWN risk and INSUFFICIENT_DATA decision", () => {
  const result = processRiskAssessment({});
  assert.equal(result.risk_level, RISK_LEVELS.UNKNOWN);
  assert.equal(result.risk_decision, RISK_DECISIONS.INSUFFICIENT_DATA);
});

// 3. Stale data.
test("stale data: a STALE mention in the setup's uncertainties flags TIMING_RISK", () => {
  const setup = tradeSetupReport({ uncertainties: ['"CPI" from source-A is STALE DATA.'] });
  const result = processRiskAssessment({ tradeSetupReport: setup });
  assert.ok(result.risk_categories.includes("TIMING_RISK"));
  assert.equal(result.data_quality.stale, true);
});

// 4. Conflicting data.
test("conflicting data: non-empty conflicting_evidence flags CONFLICT_RISK and floors risk at HIGH", () => {
  const setup = tradeSetupReport({
    setup_status: "CONFLICTING_EVIDENCE",
    conflicting_evidence: [{ domain: "NEWS", bias: "BEARISH" }],
    setup_quality: "LOW",
  });
  const result = processRiskAssessment({ tradeSetupReport: setup });
  assert.ok(result.risk_categories.includes("CONFLICT_RISK"));
  assert.equal(result.risk_level, RISK_LEVELS.HIGH);
  assert.equal(result.risk_decision, RISK_DECISIONS.RISK_REQUIRES_REVIEW);
  assert.equal(result.conflicts.length, 1);
});

// 5. Missing price (no validated technical levels).
test("missing price: no real invalidation levels reports DATA_UNAVAILABLE and flags EXECUTION_RISK", () => {
  const setup = tradeSetupReport({ invalidation_conditions: [{ condition: "DATA_UNAVAILABLE", reason: "no technical report supplied" }] });
  const result = processRiskAssessment({ tradeSetupReport: setup }, { positionSizingParams: FULL_SIZING_PARAMS });
  assert.equal(result.invalidation_assessment.status, "DATA_UNAVAILABLE");
  assert.ok(result.risk_categories.includes("EXECUTION_RISK"));
});

// 6. Missing account data / 7. Missing risk parameters / 12. Position size unavailable.
test("missing account data / risk parameters: position size reports DATA_UNAVAILABLE, never a guessed size", () => {
  const result = processRiskAssessment({ tradeSetupReport: tradeSetupReport() }); // no positionSizingParams supplied
  assert.equal(result.position_size.status, "DATA_UNAVAILABLE");
  assert.equal(result.position_size.position_size, "UNKNOWN");
  assert.ok(result.risk_categories.includes("EXECUTION_RISK"));
  assert.ok(result.missing_information.some((m) => m.startsWith("position-sizing:")));
});

// 8. High volatility.
test("high volatility: a supplied technical report reporting EXTREME volatility flags VOLATILITY_RISK", () => {
  const technicalReport = fullTechnicalReport({ volatility: { volatility: "EXTREME", basis: "ATR", atr_value: 50 } });
  const result = processRiskAssessment({ tradeSetupReport: tradeSetupReport(), technicalReport });
  assert.ok(result.risk_categories.includes("VOLATILITY_RISK"));
});

// 9. Major event risk.
test("major event risk: an upcoming macro event within the configured window flags TIMING_RISK, never invented timing", () => {
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  const macroReport = fullMacroReport({ upcoming_events: [{ event: "CPI Release", scheduled_time: soon }] });
  const result = processRiskAssessment(
    { tradeSetupReport: tradeSetupReport(), macroReport },
    { upcomingEventWindowMs: 86_400_000 }
  );
  assert.ok(result.risk_categories.includes("TIMING_RISK"));
  assert.equal(result.data_quality.upcoming_events_near, true);
});

test("major event risk is UNKNOWN, not assumed false, without a configured window", () => {
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  const macroReport = fullMacroReport({ upcoming_events: [{ event: "CPI Release", scheduled_time: soon }] });
  const result = processRiskAssessment({ tradeSetupReport: tradeSetupReport(), macroReport });
  assert.equal(result.data_quality.upcoming_events_near, "UNKNOWN");
});

// 10. Unverified source.
test("unverified source: an UNVERIFIED mention in the setup's uncertainties flags DATA_RISK", () => {
  const setup = tradeSetupReport({ uncertainties: ["BTC sentiment from source-A: UNVERIFIED."] });
  const result = processRiskAssessment({ tradeSetupReport: setup });
  assert.equal(result.data_quality.unverified, true);
  assert.ok(result.risk_categories.includes("DATA_RISK"));
});

// 11. Risk escalation.
test("risk escalation: more independent risk factors escalate risk_level from LOW toward HIGH/CRITICAL", () => {
  const clean = processRiskAssessment({ tradeSetupReport: tradeSetupReport() }, { positionSizingParams: FULL_SIZING_PARAMS });
  assert.equal(clean.risk_level, RISK_LEVELS.LOW);

  const degraded = tradeSetupReport({
    news_evidence: { domain: "NEWS", bias: "BULLISH", confidence: "LOW", conflicts: [{ x: 1 }], uncertainties: [], sources: [] },
    sentiment_evidence: null,
    setup_quality: "LOW",
  });
  const escalated = processRiskAssessment({ tradeSetupReport: degraded });
  const rank = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };
  assert.ok(rank[escalated.risk_level] > rank[clean.risk_level]);
});

// 13. No execution.
test("no execution: the module exposes no order/position/execution capability", () => {
  const exportedNames = Object.keys(riskManager).sort();
  assert.deepEqual(exportedNames, ["RISK_DECISIONS", "RISK_LEVELS", "processRiskAssessment", "runRiskManager"].sort());
});

// 14. No broker calls.
test("no broker calls: no export or code path implies a broker/exchange integration", () => {
  const exportedNames = Object.keys(riskManager);
  assert.equal(exportedNames.some((n) => /broker|exchange|order/i.test(n)), false);
});

// 15. No fabricated values.
test("no fabricated values: the full report never claims a guarantee, and position_size stays UNKNOWN without params", () => {
  const { report } = runRiskManager({ tradeSetupReport: tradeSetupReport() });
  const serialized = JSON.stringify(report).toLowerCase();
  assert.ok(!serialized.includes("guarantee"));
  assert.equal(report.position_size_status.position_size, "UNKNOWN");
  assert.equal("recommendation_type" in report, false);
});

test("risk_decision is never an execution instruction — no BUY/SELL/LONG/SHORT anywhere in the report", () => {
  const { report } = runRiskManager({ tradeSetupReport: tradeSetupReport() }, { positionSizingParams: FULL_SIZING_PARAMS });
  const serialized = JSON.stringify(report);
  assert.ok(!/"BUY"|"SELL"|"LONG"|"SHORT"/.test(serialized));
});

test("malformed (non-object) input is rejected safely, never crashes", () => {
  const result = processRiskAssessment("not-an-object");
  assert.equal(result.risk_decision, RISK_DECISIONS.INSUFFICIENT_DATA);
});

test("a trade setup report with the wrong agent_name is treated as not supplied, not blindly trusted", () => {
  const result = processRiskAssessment({ tradeSetupReport: { ...tradeSetupReport(), agent_name: "some-other-agent" } });
  assert.equal(result.risk_decision, RISK_DECISIONS.INSUFFICIENT_DATA);
  assert.ok(result.warnings.some((w) => w.includes("failed structural validation")));
});
