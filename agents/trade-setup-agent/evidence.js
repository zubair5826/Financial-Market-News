// Builds one structured evidence object per domain (NEWS/MACRO/
// TECHNICAL/SENTIMENT), directly from that domain's already-validated
// report — never re-deriving or re-classifying anything. Per the Step
// 9 spec, every input must retain source/timestamp/confidence/
// uncertainties/conflicts: this module copies those straight through
// from each report rather than summarizing them away. `items` carries
// forward a small sample of each report's own structured records (news
// key_events, macro key_indicators, sentiment_records, technical
// trend/levels), which already have their own classification/
// verification_status/source/timestamp fields from Steps 5–8 — so that
// provenance travels with the evidence rather than being stripped.

const UNKNOWN = "UNKNOWN";

function buildNewsEvidence(report) {
  if (!report) return null;
  return {
    domain: "NEWS",
    bias: report.overall_news_bias || UNKNOWN,
    confidence: report.confidence || UNKNOWN,
    uncertainties: report.uncertainties || [],
    conflicts: report.conflicting_reports || [],
    warnings: report.warnings || [],
    sources: report.sources || [],
    timestamp: report.timestamp || UNKNOWN,
    items: report.key_events || [],
  };
}

function buildMacroEvidence(report) {
  if (!report) return null;
  return {
    domain: "MACRO",
    bias: report.macro_bias || UNKNOWN,
    confidence: report.confidence || UNKNOWN,
    uncertainties: report.uncertainties || [],
    conflicts: report.conflicts || [],
    warnings: report.warnings || [],
    sources: report.sources || [],
    timestamp: report.timestamp || UNKNOWN,
    items: report.key_indicators || [],
  };
}

function buildTechnicalEvidence(report) {
  if (!report) return null;
  return {
    domain: "TECHNICAL",
    bias: report.technical_bias || UNKNOWN,
    confidence: report.confidence || UNKNOWN,
    uncertainties: report.uncertainties || [],
    conflicts: (report.technical_conflicts && report.technical_conflicts.conflicts) || [],
    warnings: report.warnings || [],
    sources: report.sources || [],
    timestamp: report.timestamp || UNKNOWN,
    items: [{ trend_analysis: report.trend_analysis, momentum: report.momentum }],
  };
}

function buildSentimentEvidence(report) {
  if (!report) return null;
  return {
    domain: "SENTIMENT",
    bias: report.sentiment_bias || UNKNOWN,
    confidence: report.confidence || UNKNOWN,
    uncertainties: report.uncertainties || [],
    conflicts: report.conflicts || [],
    warnings: report.warnings || [],
    sources: report.sources || [],
    timestamp: report.timestamp || UNKNOWN,
    items: (report.sentiment_records || []).slice(0, 5),
  };
}

module.exports = { buildNewsEvidence, buildMacroEvidence, buildTechnicalEvidence, buildSentimentEvidence };
