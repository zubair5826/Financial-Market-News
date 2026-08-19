// Integration-level tests for the Chief Trading Manager pipeline,
// numbered to match the 20 required test scenarios from the Step 11
// spec. Fixtures are built complete against reportValidation.js's own
// required-field list for each of the 6 report types — an incomplete
// fixture would be silently rejected and treated as "not supplied,"
// making a test pass without exercising the intended code path (this
// exact mistake was caught and fixed during Step 10's review).

const test = require("node:test");
const assert = require("node:assert/strict");
const chiefTradingManager = require("./index");
const { processChiefDecision, runChiefTradingManager, FINAL_ASSESSMENTS, DECISION_STATUS } = chiefTradingManager;

function newsReport(overrides = {}) {
  return {
    agent_name: "news-agent",
    timestamp: new Date().toISOString(),
    requested_asset: "BTC",
    overall_news_bias: "BULLISH",
    confidence: "HIGH",
    uncertainties: [],
    conflicting_reports: [],
    warnings: [],
    sources: ["news-A"],
    ...overrides,
  };
}

function macroReport(overrides = {}) {
  return {
    agent_name: "macro-agent",
    timestamp: new Date().toISOString(),
    requested_asset: "BTC",
    macro_bias: "BULLISH",
    confidence: "HIGH",
    uncertainties: [],
    conflicts: [],
    warnings: [],
    sources: ["macro-A"],
    ...overrides,
  };
}

function technicalReport(overrides = {}) {
  return {
    agent_name: "technical-agent",
    timestamp: new Date().toISOString(),
    requested_asset: "BTC",
    technical_bias: "BULLISH",
    confidence: "HIGH",
    uncertainties: [],
    technical_conflicts: { status: "NO_CONFLICT", conflicts: [] },
    warnings: [],
    sources: ["technical-A"],
    ...overrides,
  };
}

function sentimentReport(overrides = {}) {
  return {
    agent_name: "sentiment-agent",
    timestamp: new Date().toISOString(),
    requested_asset: "BTC",
    sentiment_bias: "BULLISH",
    confidence: "HIGH",
    uncertainties: [],
    conflicts: [],
    warnings: [],
    sources: ["sentiment-A"],
    ...overrides,
  };
}

function tradeSetupReport(overrides = {}) {
  return {
    agent_name: "trade-setup-agent",
    timestamp: new Date().toISOString(),
    asset: "BTC",
    setup_status: "SETUP_PRESENT",
    direction: "BULLISH",
    conflicting_evidence: [],
    setup_quality: "HIGH",
    confidence: "HIGH",
    uncertainties: [],
    warnings: [],
    sources: ["setup-A"],
    ...overrides,
  };
}

function riskReport(overrides = {}) {
  return {
    agent_name: "risk-manager",
    timestamp: new Date().toISOString(),
    asset: "BTC",
    risk_level: "LOW",
    risk_decision: "RISK_ACCEPTABLE",
    risk_categories: [],
    confidence: "HIGH",
    uncertainties: [],
    warnings: [],
    sources: ["risk-A"],
    ...overrides,
  };
}

function allBullishInputs() {
  return {
    newsReport: newsReport(),
    macroReport: macroReport(),
    technicalReport: technicalReport(),
    sentimentReport: sentimentReport(),
    tradeSetupReport: tradeSetupReport(),
    riskReport: riskReport(),
  };
}

// 1. All specialist reports accepted.
test("1. all six reports are accepted and produce a coherent decision", () => {
  const result = processChiefDecision(allBullishInputs());
  assert.equal(result.final_assessment, FINAL_ASSESSMENTS.BULLISH);
  assert.equal(result.decision_status, DECISION_STATUS.TRADE_SETUP_SUPPORTED);
  assert.equal(result.confidence, "HIGH");
});

// 2. Conflicting reports.
test("2. News BULLISH vs Technical BEARISH produces CONFLICTING_EVIDENCE with a full explanation, nothing hidden", () => {
  const inputs = {
    newsReport: newsReport({ overall_news_bias: "BULLISH" }),
    technicalReport: technicalReport({ technical_bias: "BEARISH" }),
  };
  const result = processChiefDecision(inputs);
  assert.equal(result.final_assessment, FINAL_ASSESSMENTS.CONFLICTING_EVIDENCE);
  const disagreement = result.conflicting_evidence.find((c) => c.type === "SPECIALIST_DISAGREEMENT");
  assert.ok(disagreement);
  assert.deepEqual(disagreement.bullish_agents, ["NEWS"]);
  assert.deepEqual(disagreement.bearish_agents, ["TECHNICAL"]);
  assert.ok(disagreement.missing_information.includes("MACRO"));
  assert.ok(disagreement.missing_information.includes("SENTIMENT"));
  // Disagreeing specialists must not also appear as "supporting" evidence.
  assert.equal(result.supporting_evidence.length, 0);
});

// 3. Missing report.
test("3. a missing sentiment report is handled — sentiment_summary is null, other domains still process", () => {
  const inputs = allBullishInputs();
  delete inputs.sentimentReport;
  const result = processChiefDecision(inputs);
  assert.equal(result.sentiment_summary, null);
  assert.ok(result.missing_information.includes("sentiment"));
  assert.notEqual(result.final_assessment, FINAL_ASSESSMENTS.UNKNOWN);
});

// 4. Stale report.
test("4. a STALE mention in a domain's uncertainties is preserved, not hidden", () => {
  const inputs = allBullishInputs();
  inputs.newsReport = newsReport({ uncertainties: ['"CPI" from source-A is STALE DATA.'] });
  const result = processChiefDecision(inputs);
  assert.ok(result.uncertainties.some((u) => u.includes("STALE DATA")));
});

// 5. Unverified report.
test("5. an UNVERIFIED mention in a domain's uncertainties is preserved, not hidden", () => {
  const inputs = allBullishInputs();
  inputs.sentimentReport = sentimentReport({ uncertainties: ["BTC sentiment from source-A: UNVERIFIED."] });
  const result = processChiefDecision(inputs);
  assert.ok(result.uncertainties.some((u) => u.includes("UNVERIFIED")));
});

// 6. Strong confluence.
test("6. four agreeing, high-confidence specialists produce HIGH confidence", () => {
  const result = processChiefDecision(allBullishInputs());
  assert.equal(result.confidence, "HIGH");
});

// 7. Weak confluence.
test("7. four agreeing but low-confidence specialists produce MEDIUM confidence, not HIGH", () => {
  const inputs = {
    newsReport: newsReport({ confidence: "LOW" }),
    macroReport: macroReport({ confidence: "LOW" }),
    technicalReport: technicalReport({ confidence: "LOW" }),
    sentimentReport: sentimentReport({ confidence: "LOW" }),
  };
  const result = processChiefDecision(inputs);
  assert.equal(result.final_assessment, FINAL_ASSESSMENTS.BULLISH);
  assert.equal(result.confidence, "MEDIUM");
});

// 8. Risk Manager high-risk override.
test("8. RISK_TOO_HIGH forces HIGH_RISK_REVIEW_REQUIRED even when every specialist is BULLISH", () => {
  const inputs = allBullishInputs();
  inputs.riskReport = riskReport({ risk_decision: "RISK_TOO_HIGH", risk_level: "CRITICAL" });
  const result = processChiefDecision(inputs);
  assert.equal(result.final_assessment, FINAL_ASSESSMENTS.BULLISH); // evidence direction is unaffected...
  assert.equal(result.decision_status, DECISION_STATUS.HIGH_RISK_REVIEW_REQUIRED); // ...but the decision is not
  assert.equal(result.confidence, "LOW");
});

// 9. Missing critical data.
test("9. no reports supplied at all returns UNKNOWN assessment and NO_DECISION, never a guess", () => {
  const result = processChiefDecision({});
  assert.equal(result.final_assessment, FINAL_ASSESSMENTS.UNKNOWN);
  assert.equal(result.decision_status, DECISION_STATUS.NO_DECISION);
  assert.equal(result.confidence, "UNKNOWN");
});

// 10. Forecast preservation.
test("10. a FORECAST-classified item passed through a domain's key_events keeps that classification", () => {
  const inputs = allBullishInputs();
  inputs.newsReport = newsReport({ key_events: [{ headline: "Analyst projects a rate cut", classification: "FORECAST" }] });
  const result = processChiefDecision(inputs);
  assert.equal(result.news_summary.key_events[0].classification, "FORECAST");
});

// 11. Scenario preservation.
test("11. a SCENARIO-classified item passed through a domain's key_indicators keeps that classification", () => {
  const inputs = allBullishInputs();
  inputs.macroReport = macroReport({ key_indicators: [{ indicator: "Hypothetical inflation shock", classification: "SCENARIO" }] });
  const result = processChiefDecision(inputs);
  assert.equal(result.macro_summary.key_indicators[0].classification, "SCENARIO");
});

// 12. Expectation preservation.
test("12. a MARKET_EXPECTATION-classified item is never upgraded to FACT", () => {
  const inputs = allBullishInputs();
  inputs.macroReport = macroReport({ key_indicators: [{ indicator: "Consensus rate expectation", classification: "MARKET_EXPECTATION" }] });
  const result = processChiefDecision(inputs);
  assert.equal(result.macro_summary.key_indicators[0].classification, "MARKET_EXPECTATION");
  assert.notEqual(result.macro_summary.key_indicators[0].classification, "FACT");
});

// 13. No fabricated information.
test("13. every summary field traces back to the supplied report — nothing invented for a missing domain", () => {
  const inputs = allBullishInputs();
  delete inputs.macroReport;
  const result = processChiefDecision(inputs);
  assert.equal(result.macro_summary, null);
  assert.equal(result.missing_information.includes("macro"), true);
});

// 14. No broker connection.
test("14. no export or code path implies a broker/exchange integration", () => {
  const exportedNames = Object.keys(chiefTradingManager);
  assert.equal(exportedNames.some((n) => /broker|exchange/i.test(n)), false);
});

// 15. No execution.
test("15. the module exposes no order/position/execution capability — exactly 4 exports", () => {
  const exportedNames = Object.keys(chiefTradingManager).sort();
  assert.deepEqual(exportedNames, ["DECISION_STATUS", "FINAL_ASSESSMENTS", "processChiefDecision", "runChiefTradingManager"].sort());
});

// 16. Final assessment.
test("16. final_assessment is always one of the 8 documented states, never an invented one", () => {
  const allowed = ["BULLISH", "BEARISH", "NEUTRAL", "MIXED", "NO_DECISION", "INSUFFICIENT_DATA", "CONFLICTING_EVIDENCE", "UNKNOWN"];
  const result = processChiefDecision(allBullishInputs());
  assert.ok(allowed.includes(result.final_assessment));
});

// 17. Confidence.
test("17. confidence is UNKNOWN when the assessment itself is UNKNOWN/NO_DECISION/INSUFFICIENT_DATA", () => {
  const result = processChiefDecision({ newsReport: newsReport() }); // only 1 specialist -> INSUFFICIENT_DATA
  assert.equal(result.final_assessment, FINAL_ASSESSMENTS.INSUFFICIENT_DATA);
  assert.equal(result.confidence, "UNKNOWN");
});

// 18. Uncertainty.
test("18. missing reports are explicitly listed as an uncertainty, never silently dropped", () => {
  const inputs = allBullishInputs();
  delete inputs.riskReport;
  const result = processChiefDecision(inputs);
  assert.ok(result.uncertainties.some((u) => u.includes("Missing reports") && u.includes("risk")));
});

// 19. Conflict reporting.
test("19. conflicting_evidence is never empty when final_assessment is CONFLICTING_EVIDENCE", () => {
  const inputs = {
    newsReport: newsReport({ overall_news_bias: "BEARISH" }),
    sentimentReport: sentimentReport({ sentiment_bias: "BULLISH" }),
  };
  const result = processChiefDecision(inputs);
  assert.equal(result.final_assessment, FINAL_ASSESSMENTS.CONFLICTING_EVIDENCE);
  assert.ok(result.conflicting_evidence.length > 0);
});

// 20. No guaranteed outcome.
test("20. the full report never claims a guarantee, and no BUY/SELL/LONG/SHORT appears anywhere", () => {
  const { report } = runChiefTradingManager(allBullishInputs());
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.toLowerCase().includes("guarantee"));
  assert.ok(!/"BUY"|"SELL"|"LONG"|"SHORT"/.test(serialized));
  assert.equal("recommendation_type" in report, false);
});

test("malformed (non-object) input is rejected safely, never crashes", () => {
  const result = processChiefDecision("not-an-object");
  assert.equal(result.decision_status, DECISION_STATUS.NO_DECISION);
});

test("a report with the wrong agent_name is treated as not supplied, not blindly trusted", () => {
  const inputs = allBullishInputs();
  inputs.newsReport = { ...inputs.newsReport, agent_name: "some-other-agent" };
  const result = processChiefDecision(inputs);
  assert.equal(result.news_summary, null);
  assert.ok(result.warnings.some((w) => w.includes("failed structural validation")));
});

test("key_assumptions are methodological only — never a claim about market outcomes", () => {
  const { report } = runChiefTradingManager(allBullishInputs());
  assert.ok(Array.isArray(report.key_assumptions));
  assert.ok(report.key_assumptions.length > 0);
  assert.ok(!report.key_assumptions.some((a) => /will rise|will fall|guaranteed/i.test(a)));
});
