// Builds one structured summary per input report — never re-deriving
// or re-classifying anything from it. Per the CORE PRINCIPLE and
// INFORMATION HIERARCHY sections of the Step 11 spec, this agent must
// weigh freshness/verification/confidence/conflicts/missing data/
// classification/source quality rather than trust any one agent
// automatically, and must never convert FORECAST/SCENARIO/EXPECTATION/
// UNVERIFIED into FACT/ACTUAL/VERIFIED anywhere it passes evidence
// through. Every summary here copies its bias, confidence,
// uncertainties, conflicts, warnings, sources, and timestamp straight
// from the source report — nothing is reclassified or upgraded.

const UNKNOWN = "UNKNOWN";

function buildNewsSummary(report) {
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
    key_events: report.key_events || [],
  };
}

function buildMacroSummary(report) {
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
    key_indicators: report.key_indicators || [],
    macro_risks: report.macro_risks || [],
  };
}

function buildTechnicalSummary(report) {
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
    trend_analysis: report.trend_analysis,
    momentum: report.momentum,
  };
}

function buildSentimentSummary(report) {
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
    sentiment_distribution: report.sentiment_distribution,
  };
}

function buildTradeSetupSummary(report) {
  if (!report) return null;
  return {
    domain: "TRADE_SETUP",
    setup_status: report.setup_status || UNKNOWN,
    direction: report.direction || UNKNOWN,
    setup_quality: report.setup_quality || UNKNOWN,
    confidence: report.confidence || UNKNOWN,
    uncertainties: report.uncertainties || [],
    conflicts: report.conflicting_evidence || [],
    warnings: report.warnings || [],
    sources: report.sources || [],
    timestamp: report.timestamp || UNKNOWN,
    potential_levels: report.potential_levels || [],
  };
}

function buildRiskSummary(report) {
  if (!report) return null;
  return {
    domain: "RISK",
    risk_level: report.risk_level || UNKNOWN,
    risk_decision: report.risk_decision || UNKNOWN,
    risk_categories: report.risk_categories || [],
    // Copied verbatim from the Risk Report's own already-computed
    // data_quality object (agents/risk-manager/dataQuality.js) — never
    // re-derived, re-thresholded, or summarized here, exactly like
    // every other field above.
    //
    // WHY THIS FIELD EXISTS. Three downstream consumers already read
    // `response.risk_summary.data_quality` and all three found nothing,
    // because this summary never carried it:
    //   - data/runStore.js#buildRunRecord -> freshness_status /
    //     data_quality_status were therefore recorded as "UNKNOWN" on
    //     EVERY persisted run, which silently defeated the run store's
    //     stated purpose of making data quality measurable later;
    //   - llm/evidencePackage.js -> the Evidence Package's own
    //     freshness_status/data_quality_status were likewise always
    //     UNKNOWN (that file's two "missing fields" tests document
    //     both the absent and the present case, and only the absent
    //     case could ever occur);
    //   - the Chief Trading Manager Report itself, i.e. the report a
    //     user actually reads, never surfaced freshness at all.
    // This was a REPORTING gap only, never a decision gap: the Risk
    // Manager passes its dataQuality object DIRECTLY to
    // riskCategories.js#detectRiskCategories(), so stale/unverified/
    // conflicting data has always correctly raised risk. Adding the
    // field here changes nothing about how any decision is computed —
    // it only stops three readers from being told UNKNOWN about a
    // value the pipeline had already determined.
    // `null` when the Risk Report carried none, never a guessed value.
    data_quality: report.data_quality || null,
    position_size_status: report.position_size_status || null,
    invalidation_assessment: report.invalidation_assessment || null,
    confidence: report.confidence || UNKNOWN,
    uncertainties: report.uncertainties || [],
    warnings: report.warnings || [],
    sources: report.sources || [],
    timestamp: report.timestamp || UNKNOWN,
  };
}

module.exports = {
  buildNewsSummary,
  buildMacroSummary,
  buildTechnicalSummary,
  buildSentimentSummary,
  buildTradeSetupSummary,
  buildRiskSummary,
};
