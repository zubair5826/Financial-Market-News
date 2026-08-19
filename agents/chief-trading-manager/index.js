// The Chief Trading Manager — the system's highest-level decision-
// intelligence component.
//
// Pipeline: RECEIVE 6 reports (News, Macro, Technical, Sentiment,
// Trade Setup, Risk Manager) -> VALIDATE each (never bypassed) ->
// build per-domain SUMMARIES (provenance preserved, nothing
// reclassified) -> FINAL ASSESSMENT (from the 4 specialists only,
// never double-counting Trade Setup's own already-derived direction)
// -> CONFLICT EXPLANATION -> DECISION STATUS (Risk Manager's
// RISK_TOO_HIGH is an absolute override, checked first) -> Chief
// Trading Manager Report for the user.
//
// It does not execute trades, send orders, or connect to a broker —
// there is no code path here that calls anything outside this
// process. final_assessment and decision_status are both decision-
// intelligence output only, never execution instructions — see
// report.js and README.md.

const { failSafe, ERROR_CODES } = require("../../core/errors");
const { logEvent } = require("../../logs/logger");
const { validateReport } = require("./reportValidation");
const {
  buildNewsSummary,
  buildMacroSummary,
  buildTechnicalSummary,
  buildSentimentSummary,
  buildTradeSetupSummary,
  buildRiskSummary,
} = require("./evidence");
const { determineFinalAssessment, FINAL_ASSESSMENTS } = require("./finalAssessment");
const { buildConflictingEvidence } = require("./conflicts");
const { determineDecisionStatus, DECISION_STATUS } = require("./decisionStatus");
const { buildChiefReport } = require("./report");

const UNKNOWN = "UNKNOWN";

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

function resolveAsset(reports, options) {
  if (options.requestedAsset) return options.requestedAsset;
  const assets = new Set();
  for (const r of reports) {
    const asset = r && (r.asset || r.requested_asset);
    if (asset && asset !== "UNKNOWN") assets.add(asset);
  }
  if (assets.size === 1) return [...assets][0];
  if (assets.size > 1) return "MULTIPLE";
  return UNKNOWN;
}

function emptyResult(warnings, errors, timestamp) {
  return {
    asset: UNKNOWN,
    final_assessment: FINAL_ASSESSMENTS.UNKNOWN,
    decision_status: DECISION_STATUS.NO_DECISION,
    news_summary: null,
    macro_summary: null,
    technical_summary: null,
    sentiment_summary: null,
    trade_setup_summary: null,
    risk_summary: null,
    supporting_evidence: [],
    conflicting_evidence: [],
    missing_information: ["news", "macro", "technical", "sentiment", "trade-setup", "risk"],
    suppliedCount: 0,
    validCount: 0,
    confidence: "UNKNOWN",
    uncertainties: [],
    warnings,
    errors,
    sources: [],
    timestamp,
  };
}

function processChiefDecision(inputs, options = {}) {
  const timestamp = new Date().toISOString();
  const warnings = [];
  const errors = [];

  if (!inputs || typeof inputs !== "object") {
    const err = failSafe(
      ERROR_CODES.MALFORMED_DATA,
      "Input must be an object with newsReport/macroReport/technicalReport/sentimentReport/tradeSetupReport/riskReport."
    );
    const result = emptyResult(warnings, [err], timestamp);
    logEvent({
      agent: "chief-trading-manager",
      request: { inputType: typeof inputs },
      dataSource: UNKNOWN,
      responseStatus: result.decision_status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  const newsReport = resolveReport(inputs.newsReport, "news-agent", warnings);
  const macroReport = resolveReport(inputs.macroReport, "macro-agent", warnings);
  const technicalReport = resolveReport(inputs.technicalReport, "technical-agent", warnings);
  const sentimentReport = resolveReport(inputs.sentimentReport, "sentiment-agent", warnings);
  const tradeSetupReport = resolveReport(inputs.tradeSetupReport, "trade-setup-agent", warnings);
  const riskReport = resolveReport(inputs.riskReport, "risk-manager", warnings);

  const rawInputs = [inputs.newsReport, inputs.macroReport, inputs.technicalReport, inputs.sentimentReport, inputs.tradeSetupReport, inputs.riskReport];
  const suppliedCount = rawInputs.filter(Boolean).length;

  const newsSummary = buildNewsSummary(newsReport);
  const macroSummary = buildMacroSummary(macroReport);
  const technicalSummary = buildTechnicalSummary(technicalReport);
  const sentimentSummary = buildSentimentSummary(sentimentReport);
  const tradeSetupSummary = buildTradeSetupSummary(tradeSetupReport);
  const riskSummary = buildRiskSummary(riskReport);

  const validCount = [newsSummary, macroSummary, technicalSummary, sentimentSummary, tradeSetupSummary, riskSummary].filter(Boolean).length;

  if (suppliedCount === 0) {
    warnings.push("No specialist or synthesis reports were supplied — no assessment can be made.");
    const result = emptyResult(warnings, errors, timestamp);
    logEvent({
      agent: "chief-trading-manager",
      request: { suppliedCount: 0 },
      dataSource: UNKNOWN,
      responseStatus: result.decision_status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  const specialistSummaries = [newsSummary, macroSummary, technicalSummary, sentimentSummary];
  const specialistSuppliedCount = [inputs.newsReport, inputs.macroReport, inputs.technicalReport, inputs.sentimentReport].filter(
    Boolean
  ).length;
  const specialistValidCount = specialistSummaries.filter(Boolean).length;

  const assessmentResult = determineFinalAssessment({
    specialistSummaries,
    suppliedCount: specialistSuppliedCount,
    validCount: specialistValidCount,
  });

  const namedSpecialists = { NEWS: newsSummary, MACRO: macroSummary, TECHNICAL: technicalSummary, SENTIMENT: sentimentSummary };
  const namedAll = { ...namedSpecialists, TRADE_SETUP: tradeSetupSummary, RISK: riskSummary };

  const conflictingEvidence = buildConflictingEvidence(namedSpecialists, namedAll, assessmentResult.assessment);

  const supportingEvidence = Object.values(namedSpecialists).filter((summary) => {
    if (!summary || summary.bias === "UNKNOWN") return false;
    if (assessmentResult.assessment === "CONFLICTING_EVIDENCE") {
      // The BULLISH/BEARISH specialists ARE the disagreement — already
      // detailed in conflictingEvidence above. Only a genuinely
      // uninvolved NEUTRAL/MIXED specialist counts as "supporting"
      // here; duplicating the disagreeing sides into both arrays would
      // be incoherent (each side can't "support" a conflict it's half of).
      return summary.bias === "NEUTRAL" || summary.bias === "MIXED";
    }
    const opposes =
      (summary.bias === "BULLISH" && assessmentResult.assessment === "BEARISH") ||
      (summary.bias === "BEARISH" && assessmentResult.assessment === "BULLISH");
    return !opposes;
  });

  const decisionStatus = determineDecisionStatus({ tradeSetupSummary, riskSummary });

  const missingInformation = [];
  if (!newsSummary) missingInformation.push("news");
  if (!macroSummary) missingInformation.push("macro");
  if (!technicalSummary) missingInformation.push("technical");
  if (!sentimentSummary) missingInformation.push("sentiment");
  if (!tradeSetupSummary) missingInformation.push("trade-setup");
  if (!riskSummary) missingInformation.push("risk");

  const uncertainties = [
    ...(newsSummary ? newsSummary.uncertainties : []),
    ...(macroSummary ? macroSummary.uncertainties : []),
    ...(technicalSummary ? technicalSummary.uncertainties : []),
    ...(sentimentSummary ? sentimentSummary.uncertainties : []),
    ...(tradeSetupSummary ? tradeSetupSummary.uncertainties : []),
    ...(riskSummary ? riskSummary.uncertainties : []),
  ];
  if (missingInformation.length > 0) {
    uncertainties.push(`Missing reports: ${missingInformation.join(", ")}.`);
  }

  // Per the CORE PRINCIPLE section, confidence must weigh each
  // specialist's own confidence rating, not just presence/absence and
  // conflicts — a batch of low-confidence specialists is genuinely
  // weaker evidence ("weak confluence") than the same count of
  // high-confidence ones, even with identical data completeness.
  const allSpecialistsHighConfidence = specialistSummaries.every((s) => !s || s.confidence === "HIGH");

  let confidence;
  if ([FINAL_ASSESSMENTS.UNKNOWN, FINAL_ASSESSMENTS.NO_DECISION, FINAL_ASSESSMENTS.INSUFFICIENT_DATA].includes(assessmentResult.assessment)) {
    confidence = "UNKNOWN";
  } else if (decisionStatus === DECISION_STATUS.HIGH_RISK_REVIEW_REQUIRED || conflictingEvidence.length > 0) {
    confidence = "LOW";
  } else if (missingInformation.length > 0 || !allSpecialistsHighConfidence) {
    confidence = "MEDIUM";
  } else {
    confidence = "HIGH";
  }

  const sources = Array.from(
    new Set([
      ...(newsSummary ? newsSummary.sources : []),
      ...(macroSummary ? macroSummary.sources : []),
      ...(technicalSummary ? technicalSummary.sources : []),
      ...(sentimentSummary ? sentimentSummary.sources : []),
      ...(tradeSetupSummary ? tradeSetupSummary.sources : []),
      ...(riskSummary ? riskSummary.sources : []),
    ])
  );

  const asset = resolveAsset([tradeSetupReport, newsReport, macroReport, technicalReport, sentimentReport], options);

  const result = {
    asset,
    final_assessment: assessmentResult.assessment,
    decision_status: decisionStatus,
    news_summary: newsSummary,
    macro_summary: macroSummary,
    technical_summary: technicalSummary,
    sentiment_summary: sentimentSummary,
    trade_setup_summary: tradeSetupSummary,
    risk_summary: riskSummary,
    supporting_evidence: supportingEvidence,
    conflicting_evidence: conflictingEvidence,
    missing_information: missingInformation,
    suppliedCount,
    validCount,
    confidence,
    uncertainties,
    warnings,
    errors,
    sources,
    timestamp,
  };

  logEvent({
    agent: "chief-trading-manager",
    request: { suppliedCount, asset },
    dataSource: sources.join(",") || UNKNOWN,
    responseStatus: decisionStatus,
    warnings,
    errors,
  });

  return result;
}

function runChiefTradingManager(inputs, options = {}) {
  const result = processChiefDecision(inputs, options);
  const report = buildChiefReport(result);
  return { result, report };
}

module.exports = { FINAL_ASSESSMENTS, DECISION_STATUS, processChiefDecision, runChiefTradingManager };
