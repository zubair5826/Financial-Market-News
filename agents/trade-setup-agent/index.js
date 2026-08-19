// The Trade Setup Agent.
//
// Pipeline: RECEIVE the 4 domain reports -> VALIDATE each (never
// bypassed — reportValidation.js) -> build per-domain EVIDENCE
// (provenance preserved) -> AGGREGATE DIRECTION -> CONFLUENCE ->
// SETUP QUALITY -> SETUP STATUS -> POTENTIAL LEVELS / INVALIDATION
// (technical only, never invented) -> SETUP RISKS -> Trade Setup
// Report for the future Risk Manager and Chief Trading Manager.
//
// It does not execute trades, send orders, or connect to a broker —
// there is no code path here that calls anything outside this
// process. `direction` is setup direction, never an execution
// instruction; see report.js and README.md. Mirrors the architecture
// of agents/data-controller, agents/news-agent, agents/macro-agent,
// agents/technical-agent, and agents/sentiment-agent, adapted for an
// agent that consumes other agents' reports rather than raw data.

const { failSafe, ERROR_CODES } = require("../../core/errors");
const { UNKNOWN } = require("../../core/constants");
const { logEvent } = require("../../logs/logger");
const { validateReport } = require("./reportValidation");
const { buildNewsEvidence, buildMacroEvidence, buildTechnicalEvidence, buildSentimentEvidence } = require("./evidence");
const { aggregateDirection } = require("./direction");
const { assessConfluence } = require("./confluence");
const { assessSetupQuality } = require("./quality");
const { deriveLevels, deriveInvalidationConditions } = require("./levels");
const { detectSetupRisks } = require("./risks");
const { buildTradeSetupReport } = require("./report");

const SETUP_STATUS = Object.freeze({
  SETUP_PRESENT: "SETUP_PRESENT",
  SETUP_NOT_PRESENT: "SETUP_NOT_PRESENT",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  CONFLICTING_EVIDENCE: "CONFLICTING_EVIDENCE",
  DATA_UNAVAILABLE: "DATA_UNAVAILABLE",
  UNKNOWN: "UNKNOWN",
});

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

// If the caller didn't say which asset this setup is about, fall back
// to the domain reports' own requested_asset fields — "MULTIPLE" if
// they disagree (mirroring the Data Controller's convention for the
// same situation), never guessed.
function resolveAsset(reports, options) {
  if (options.requestedAsset) return options.requestedAsset;

  const assets = new Set();
  for (const r of reports) {
    if (r && r.requested_asset && r.requested_asset !== "UNKNOWN") assets.add(r.requested_asset);
  }
  if (assets.size === 1) return [...assets][0];
  if (assets.size > 1) return "MULTIPLE";
  return UNKNOWN;
}

function emptyResult(status, warnings, errors, timestamp) {
  return {
    setup_status: status,
    direction: "UNKNOWN",
    asset: UNKNOWN,
    news_evidence: null,
    macro_evidence: null,
    technical_evidence: null,
    sentiment_evidence: null,
    supporting_evidence: [],
    conflicting_evidence: [],
    confluence: { domain_scores: { NEWS: 0, MACRO: 0, TECHNICAL: 0, SENTIMENT: 0 }, confluence_score: 0, confluence_ratio: 0 },
    setup_quality: "UNKNOWN",
    potential_levels: [],
    invalidation_conditions: [{ condition: "DATA_UNAVAILABLE", reason: "No domain reports were supplied." }],
    setup_risks: ["DATA_RISK"],
    confidence: "UNKNOWN",
    uncertainties: [],
    warnings,
    errors,
    sources: [],
    timestamp,
  };
}

function processTradeSetup(inputs, options = {}) {
  const timestamp = new Date().toISOString();
  const warnings = [];
  const errors = [];

  if (!inputs || typeof inputs !== "object") {
    const err = failSafe(
      ERROR_CODES.MALFORMED_DATA,
      "Input must be an object with newsReport/macroReport/technicalReport/sentimentReport."
    );
    const result = emptyResult(SETUP_STATUS.DATA_UNAVAILABLE, warnings, [err], timestamp);
    logEvent({
      agent: "trade-setup-agent",
      request: { inputType: typeof inputs },
      dataSource: UNKNOWN,
      responseStatus: result.setup_status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  const newsReport = resolveReport(inputs.newsReport, "news-agent", warnings);
  const macroReport = resolveReport(inputs.macroReport, "macro-agent", warnings);
  const technicalReport = resolveReport(inputs.technicalReport, "technical-agent", warnings);
  const sentimentReport = resolveReport(inputs.sentimentReport, "sentiment-agent", warnings);

  const newsEvidence = buildNewsEvidence(newsReport);
  const macroEvidence = buildMacroEvidence(macroReport);
  const technicalEvidence = buildTechnicalEvidence(technicalReport);
  const sentimentEvidence = buildSentimentEvidence(sentimentReport);

  const suppliedCount = [newsReport, macroReport, technicalReport, sentimentReport].filter(Boolean).length;

  if (suppliedCount === 0) {
    warnings.push("TRADE SETUP DATA UNAVAILABLE — no domain reports were supplied.");
    const result = emptyResult(SETUP_STATUS.DATA_UNAVAILABLE, warnings, errors, timestamp);
    logEvent({
      agent: "trade-setup-agent",
      request: { suppliedCount: 0 },
      dataSource: UNKNOWN,
      responseStatus: result.setup_status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  const { direction, taggedDomains } = aggregateDirection([newsEvidence, macroEvidence, technicalEvidence, sentimentEvidence]);
  const confluenceResult = assessConfluence({ newsEvidence, macroEvidence, technicalEvidence, sentimentEvidence }, direction);

  const domainEvidenceList = [newsEvidence, macroEvidence, technicalEvidence, sentimentEvidence];
  const supportingEvidence = [];
  const conflictingEvidence = [];
  let hasOpposingEvidence = false;

  for (const evidence of domainEvidenceList) {
    if (!evidence || evidence.bias === "UNKNOWN") continue;

    // When the overall direction is itself MIXED, that IS the
    // disagreement — every directionally-tagged domain (BULLISH or
    // BEARISH) is part of it, not just ones opposing a single pole
    // (there is no single pole to oppose). Without this branch, a
    // BULLISH domain and a BEARISH domain both fail the "opposes
    // BULLISH"/"opposes BEARISH" checks and would wrongly both land in
    // supporting_evidence.
    const isConflicting =
      direction === "MIXED"
        ? evidence.bias === "BULLISH" || evidence.bias === "BEARISH"
        : (evidence.bias === "BULLISH" && direction === "BEARISH") || (evidence.bias === "BEARISH" && direction === "BULLISH");

    if (isConflicting) {
      hasOpposingEvidence = true;
      conflictingEvidence.push(evidence);
    } else {
      supportingEvidence.push(evidence);
    }

    if (evidence.conflicts && evidence.conflicts.length > 0) {
      conflictingEvidence.push({ domain: evidence.domain, type: "INTERNAL_CONFLICT", detail: evidence.conflicts });
    }
  }

  const setupQuality = assessSetupQuality(
    { taggedDomains, hasOpposingEvidence, confluenceRatio: confluenceResult.confluence_ratio },
    options
  );

  const levels = deriveLevels(technicalReport, direction);
  const invalidationConditions = deriveInvalidationConditions(levels, direction);
  const setupRisks = detectSetupRisks({ newsEvidence, macroEvidence, technicalEvidence, sentimentEvidence }, conflictingEvidence);

  let setupStatus;
  if (taggedDomains < 2) setupStatus = SETUP_STATUS.INSUFFICIENT_DATA;
  else if (direction === "MIXED") setupStatus = SETUP_STATUS.CONFLICTING_EVIDENCE;
  else if (direction === "UNKNOWN") setupStatus = SETUP_STATUS.INSUFFICIENT_DATA;
  else if (direction === "NEUTRAL") setupStatus = SETUP_STATUS.SETUP_NOT_PRESENT;
  else if (setupQuality === "HIGH" || setupQuality === "MEDIUM") setupStatus = SETUP_STATUS.SETUP_PRESENT;
  else setupStatus = SETUP_STATUS.SETUP_NOT_PRESENT;

  let confidence;
  if (setupStatus === SETUP_STATUS.INSUFFICIENT_DATA) confidence = "LOW";
  else if (conflictingEvidence.length > 0) confidence = "LOW";
  else if (taggedDomains < 4) confidence = "MEDIUM";
  else confidence = "HIGH";

  const asset = resolveAsset([newsReport, macroReport, technicalReport, sentimentReport], options);

  const uncertainties = [
    ...(newsEvidence ? newsEvidence.uncertainties : []),
    ...(macroEvidence ? macroEvidence.uncertainties : []),
    ...(technicalEvidence ? technicalEvidence.uncertainties : []),
    ...(sentimentEvidence ? sentimentEvidence.uncertainties : []),
  ];
  if (suppliedCount < 4) {
    uncertainties.push(`Only ${suppliedCount} of 4 domain reports were supplied.`);
  }

  const sources = Array.from(
    new Set([
      ...(newsEvidence ? newsEvidence.sources : []),
      ...(macroEvidence ? macroEvidence.sources : []),
      ...(technicalEvidence ? technicalEvidence.sources : []),
      ...(sentimentEvidence ? sentimentEvidence.sources : []),
    ])
  );

  const result = {
    setup_status: setupStatus,
    direction,
    asset,
    news_evidence: newsEvidence,
    macro_evidence: macroEvidence,
    technical_evidence: technicalEvidence,
    sentiment_evidence: sentimentEvidence,
    supporting_evidence: supportingEvidence,
    conflicting_evidence: conflictingEvidence,
    confluence: confluenceResult,
    setup_quality: setupQuality,
    potential_levels: levels.potential_levels,
    invalidation_conditions: invalidationConditions,
    setup_risks: setupRisks,
    confidence,
    uncertainties,
    warnings,
    errors,
    sources,
    timestamp,
  };

  logEvent({
    agent: "trade-setup-agent",
    request: { suppliedCount, requestedAsset: options.requestedAsset || UNKNOWN },
    dataSource: sources.join(",") || UNKNOWN,
    responseStatus: setupStatus,
    warnings,
    errors,
  });

  return result;
}

function runTradeSetupAgent(inputs, options = {}) {
  const result = processTradeSetup(inputs, options);
  const report = buildTradeSetupReport(result, options);
  return { result, report };
}

module.exports = { SETUP_STATUS, processTradeSetup, runTradeSetupAgent };
