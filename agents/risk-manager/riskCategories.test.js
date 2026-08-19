const test = require("node:test");
const assert = require("node:assert/strict");
const { detectRiskCategories, RISK_CATEGORIES } = require("./riskCategories");

function cleanDataQuality() {
  return {
    stale: false,
    unverified: false,
    conflicting: false,
    missing_information: [],
    technical_timeframe_conflict: false,
    upcoming_events_near: "UNKNOWN",
    weak_setup_evidence: false,
  };
}

function cleanSetupReport() {
  return { conflicting_evidence: [], setup_quality: "HIGH", direction: "BULLISH", news_evidence: null, macro_evidence: null, sentiment_evidence: null };
}

test("detectRiskCategories flags nothing when data quality is clean and sizing/invalidation are available", () => {
  const { categories } = detectRiskCategories({
    tradeSetupReport: cleanSetupReport(),
    macroReport: null,
    technicalReport: null,
    dataQuality: cleanDataQuality(),
    positionSizeStatus: "CALCULATED",
    invalidationStatus: "AVAILABLE",
  });
  assert.deepEqual(categories, []);
});

test("detectRiskCategories flags EXECUTION_RISK when position size is unavailable", () => {
  const { categories, factors } = detectRiskCategories({
    tradeSetupReport: cleanSetupReport(),
    macroReport: null,
    technicalReport: null,
    dataQuality: cleanDataQuality(),
    positionSizeStatus: "DATA_UNAVAILABLE",
    invalidationStatus: "AVAILABLE",
  });
  assert.ok(categories.includes(RISK_CATEGORIES.EXECUTION_RISK));
  assert.ok(factors.some((f) => f.category === RISK_CATEGORIES.EXECUTION_RISK));
});

test("detectRiskCategories flags VOLATILITY_RISK only when the technical report reports HIGH/EXTREME, never assumed", () => {
  const withoutReport = detectRiskCategories({
    tradeSetupReport: cleanSetupReport(),
    macroReport: null,
    technicalReport: null,
    dataQuality: cleanDataQuality(),
    positionSizeStatus: "CALCULATED",
    invalidationStatus: "AVAILABLE",
  });
  assert.equal(withoutReport.categories.includes(RISK_CATEGORIES.VOLATILITY_RISK), false);

  const withExtreme = detectRiskCategories({
    tradeSetupReport: cleanSetupReport(),
    macroReport: null,
    technicalReport: { volatility: { volatility: "EXTREME" }, volume_analysis: {} },
    dataQuality: cleanDataQuality(),
    positionSizeStatus: "CALCULATED",
    invalidationStatus: "AVAILABLE",
  });
  assert.ok(withExtreme.categories.includes(RISK_CATEGORIES.VOLATILITY_RISK));
});

test("detectRiskCategories flags LIQUIDITY_RISK only from UNUSUALLY_LOW_VOLUME, never from volume being merely unavailable", () => {
  const notAvailable = detectRiskCategories({
    tradeSetupReport: cleanSetupReport(),
    macroReport: null,
    technicalReport: { volatility: {}, volume_analysis: { volume_status: "NOT_AVAILABLE" } },
    dataQuality: cleanDataQuality(),
    positionSizeStatus: "CALCULATED",
    invalidationStatus: "AVAILABLE",
  });
  assert.equal(notAvailable.categories.includes(RISK_CATEGORIES.LIQUIDITY_RISK), false);

  const lowVolume = detectRiskCategories({
    tradeSetupReport: cleanSetupReport(),
    macroReport: null,
    technicalReport: { volatility: {}, volume_analysis: { volume_status: "UNUSUALLY_LOW_VOLUME" } },
    dataQuality: cleanDataQuality(),
    positionSizeStatus: "CALCULATED",
    invalidationStatus: "AVAILABLE",
  });
  assert.ok(lowVolume.categories.includes(RISK_CATEGORIES.LIQUIDITY_RISK));
});

test("detectRiskCategories never auto-activates UNKNOWN", () => {
  const { categories } = detectRiskCategories({
    tradeSetupReport: cleanSetupReport(),
    macroReport: null,
    technicalReport: null,
    dataQuality: cleanDataQuality(),
    positionSizeStatus: "CALCULATED",
    invalidationStatus: "AVAILABLE",
  });
  assert.equal(categories.includes(RISK_CATEGORIES.UNKNOWN), false);
});
