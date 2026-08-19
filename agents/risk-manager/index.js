// The Risk Manager.
//
// Pipeline: RECEIVE the Trade Setup Agent report (+ optional News/
// Macro/Technical/Sentiment reports for deeper detail) -> VALIDATE
// each (never bypassed) -> DATA QUALITY -> POSITION SIZE (only if
// every parameter is explicitly supplied) -> INVALIDATION (technical
// levels only, never invented) -> RISK CATEGORIES/FACTORS -> RISK
// LEVEL -> RISK DECISION -> Risk Report.
//
// It does not execute trades, send orders, or connect to a broker —
// there is no code path here that calls anything outside this
// process. risk_decision is never an execution decision — see
// report.js and README.md. Mirrors the architecture of
// agents/trade-setup-agent, adapted for an agent that evaluates a
// setup rather than proposing one.

const { failSafe, ERROR_CODES } = require("../../core/errors");
const { UNKNOWN } = require("../../core/constants");
const { logEvent } = require("../../logs/logger");
const { validateReport } = require("./reportValidation");
const { assessDataQuality } = require("./dataQuality");
const { calculatePositionSize } = require("./positionSizing");
const { assessInvalidation } = require("./invalidation");
const { detectRiskCategories } = require("./riskCategories");
const { assessRiskLevel, assessRiskDecision, RISK_LEVELS, RISK_DECISIONS } = require("./riskLevel");
const { buildRiskReport } = require("./report");

function resolveReport(rawReport, expectedAgentName, warnings) {
  if (!rawReport) return null;
  const validation = validateReport(rawReport, expectedAgentName);
  if (!validation.valid) {
    warnings.push(
      `Supplied ${expectedAgentName} report failed structural validation and was treated as unavailable: ${validation.errors.join(" ")}`
    );
    return null;
  }
  return rawReport;
}

function emptyResult(warnings, errors, timestamp) {
  return {
    tradeSetupReport: null,
    asset: UNKNOWN,
    risk_level: RISK_LEVELS.UNKNOWN,
    risk_categories: [],
    risk_factors: [],
    data_quality: {
      stale: false,
      unverified: false,
      conflicting: false,
      missing_information: ["news", "macro", "technical", "sentiment"],
      technical_timeframe_conflict: false,
      upcoming_events_near: UNKNOWN,
      weak_setup_evidence: true,
    },
    conflicts: [],
    missing_information: ["trade-setup-agent report"],
    position_size: { status: "DATA_UNAVAILABLE", position_size: UNKNOWN, missing_parameters: [], notes: "No trade setup reference supplied." },
    invalidation_assessment: { status: "DATA_UNAVAILABLE", conditions: [], notes: "No trade setup reference supplied." },
    risk_decision: RISK_DECISIONS.INSUFFICIENT_DATA,
    confidence: "UNKNOWN",
    uncertainties: [],
    warnings,
    errors,
    sources: [],
    timestamp,
  };
}

function processRiskAssessment(inputs, options = {}) {
  const timestamp = new Date().toISOString();
  const warnings = [];
  const errors = [];

  if (!inputs || typeof inputs !== "object") {
    const err = failSafe(ERROR_CODES.MALFORMED_DATA, "Input must be an object with a tradeSetupReport (and optional domain reports).");
    const result = emptyResult(warnings, [err], timestamp);
    logEvent({
      agent: "risk-manager",
      request: { inputType: typeof inputs },
      dataSource: UNKNOWN,
      responseStatus: result.risk_decision,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  const tradeSetupReport = resolveReport(inputs.tradeSetupReport, "trade-setup-agent", warnings);
  const newsReport = resolveReport(inputs.newsReport, "news-agent", warnings);
  const macroReport = resolveReport(inputs.macroReport, "macro-agent", warnings);
  const technicalReport = resolveReport(inputs.technicalReport, "technical-agent", warnings);
  const sentimentReport = resolveReport(inputs.sentimentReport, "sentiment-agent", warnings);

  if (!tradeSetupReport) {
    warnings.push("No valid trade setup reference was supplied — risk cannot be assessed.");
    const result = emptyResult(warnings, errors, timestamp);
    logEvent({
      agent: "risk-manager",
      request: { hasSetup: false },
      dataSource: UNKNOWN,
      responseStatus: result.risk_decision,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  const dataQuality = assessDataQuality({ tradeSetupReport, macroReport, technicalReport }, options);
  const positionSize = calculatePositionSize(options.positionSizingParams || {});
  const invalidationAssessment = assessInvalidation(tradeSetupReport);

  const { categories, factors } = detectRiskCategories({
    tradeSetupReport,
    macroReport,
    technicalReport,
    dataQuality,
    positionSizeStatus: positionSize.status,
    invalidationStatus: invalidationAssessment.status,
  });

  const riskLevel = assessRiskLevel({
    activeCategoryCount: categories.length,
    setupStatus: tradeSetupReport.setup_status,
    setupQuality: tradeSetupReport.setup_quality,
  });
  const riskDecision = assessRiskDecision(riskLevel, tradeSetupReport.setup_status);

  const missingInformation = [...dataQuality.missing_information];
  if (positionSize.status === "DATA_UNAVAILABLE" && Array.isArray(positionSize.missing_parameters)) {
    for (const p of positionSize.missing_parameters) missingInformation.push(`position-sizing:${p}`);
  }

  // Computed AFTER missingInformation is fully assembled — confidence
  // must reflect position-sizing gaps too, not just domain-evidence
  // gaps, or a setup with unknown position sizing could misleadingly
  // report HIGH confidence.
  let confidence;
  if (riskDecision === RISK_DECISIONS.INSUFFICIENT_DATA || riskDecision === RISK_DECISIONS.UNKNOWN) confidence = "UNKNOWN";
  else if (riskLevel === RISK_LEVELS.CRITICAL) confidence = "LOW";
  else if (missingInformation.length > 0) confidence = "MEDIUM";
  else confidence = "HIGH";

  const uncertainties = [...(tradeSetupReport.uncertainties || [])];
  if (dataQuality.upcoming_events_near === UNKNOWN) {
    uncertainties.push("Whether a major scheduled event is near could not be determined (no window configured or no scheduled_time data).");
  }
  if (positionSize.status === "DATA_UNAVAILABLE") {
    uncertainties.push("Position size could not be calculated — required parameters were not supplied.");
  }

  const sources = Array.from(
    new Set([
      ...(tradeSetupReport.sources || []),
      ...(newsReport ? newsReport.sources : []),
      ...(macroReport ? macroReport.sources : []),
      ...(technicalReport ? technicalReport.sources : []),
      ...(sentimentReport ? sentimentReport.sources : []),
    ])
  );

  const result = {
    tradeSetupReport,
    asset: options.requestedAsset || tradeSetupReport.asset || UNKNOWN,
    risk_level: riskLevel,
    risk_categories: categories,
    risk_factors: factors,
    data_quality: dataQuality,
    conflicts: tradeSetupReport.conflicting_evidence || [],
    missing_information: missingInformation,
    position_size: positionSize,
    invalidation_assessment: invalidationAssessment,
    risk_decision: riskDecision,
    confidence,
    uncertainties,
    warnings,
    errors,
    sources,
    timestamp,
  };

  logEvent({
    agent: "risk-manager",
    request: { hasSetup: true, asset: result.asset },
    dataSource: sources.join(",") || UNKNOWN,
    responseStatus: riskDecision,
    warnings,
    errors,
  });

  return result;
}

function runRiskManager(inputs, options = {}) {
  const result = processRiskAssessment(inputs, options);
  const report = buildRiskReport(result);
  return { result, report };
}

module.exports = { RISK_LEVELS, RISK_DECISIONS, processRiskAssessment, runRiskManager };
