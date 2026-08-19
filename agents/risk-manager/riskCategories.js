// Structured risk categories and factors — every category activated
// here is backed by a narrow, documented evidence rule (never a vague
// impression), each paired with the concrete evidence that triggered
// it so the reasoning is auditable. UNKNOWN exists in the vocabulary
// but is never auto-activated by this module.
//
//   DATA_RISK: a domain's evidence is missing, or any input is
//     UNVERIFIED.
//   CONFLICT_RISK: the Trade Setup Agent's own conflicting_evidence is
//     non-empty.
//   TIMING_RISK: an input is STALE/freshness-UNKNOWN, or a major
//     scheduled macro event falls within a configured near-term
//     window (never guessed — see dataQuality.js).
//   TECHNICAL_RISK: technical timeframes disagree
//     (technical_conflicts: CONFLICTING_SIGNALS).
//   NEWS_RISK / MACRO_RISK / SENTIMENT_RISK: that domain's own report
//     has unresolved internal conflicts.
//   VOLATILITY_RISK: the Technical Agent reports HIGH or EXTREME
//     volatility (only when a technicalReport was actually supplied —
//     never assumed).
//   LIQUIDITY_RISK: the Technical Agent reports UNUSUALLY_LOW_VOLUME
//     — never inferred merely from volume being NOT_AVAILABLE (that's
//     a data gap, not evidence of illiquidity).
//   MARKET_RISK: the trade setup's own quality is LOW/UNKNOWN or its
//     direction is MIXED/UNKNOWN — the broad evidence about market
//     direction itself is weak or contradictory.
//   EXECUTION_RISK: position sizing and/or invalidation levels are not
//     fully available, so acting on this setup would require filling
//     in gaps this agent refuses to guess.

const { UNKNOWN } = require("../../core/constants");

const RISK_CATEGORIES = Object.freeze({
  MARKET_RISK: "MARKET_RISK",
  VOLATILITY_RISK: "VOLATILITY_RISK",
  LIQUIDITY_RISK: "LIQUIDITY_RISK",
  NEWS_RISK: "NEWS_RISK",
  MACRO_RISK: "MACRO_RISK",
  TECHNICAL_RISK: "TECHNICAL_RISK",
  SENTIMENT_RISK: "SENTIMENT_RISK",
  DATA_RISK: "DATA_RISK",
  CONFLICT_RISK: "CONFLICT_RISK",
  TIMING_RISK: "TIMING_RISK",
  EXECUTION_RISK: "EXECUTION_RISK",
  UNKNOWN: "UNKNOWN",
});

function detectRiskCategories({ tradeSetupReport, macroReport, technicalReport, dataQuality, positionSizeStatus, invalidationStatus }) {
  const categories = new Set();
  const factors = [];

  function flag(category, reason, evidence) {
    categories.add(category);
    factors.push({ category, reason, evidence: evidence !== undefined ? evidence : UNKNOWN });
  }

  if (dataQuality.missing_information.length > 0) {
    flag(RISK_CATEGORIES.DATA_RISK, `Missing domain evidence: ${dataQuality.missing_information.join(", ")}.`, dataQuality.missing_information);
  }
  if (dataQuality.unverified) {
    flag(RISK_CATEGORIES.DATA_RISK, "One or more inputs are UNVERIFIED.", UNKNOWN);
  }
  if (dataQuality.conflicting) {
    flag(RISK_CATEGORIES.CONFLICT_RISK, "Cross-domain evidence conflicts within the trade setup.", tradeSetupReport.conflicting_evidence);
  }
  if (dataQuality.stale) {
    flag(RISK_CATEGORIES.TIMING_RISK, "One or more inputs are STALE.", UNKNOWN);
  }
  if (dataQuality.upcoming_events_near === true) {
    flag(
      RISK_CATEGORIES.TIMING_RISK,
      "A major scheduled macro event falls within the configured near-term window.",
      macroReport ? macroReport.upcoming_events : UNKNOWN
    );
  }
  if (dataQuality.technical_timeframe_conflict) {
    flag(
      RISK_CATEGORIES.TECHNICAL_RISK,
      "Technical timeframes disagree (technical_conflicts: CONFLICTING_SIGNALS).",
      technicalReport ? technicalReport.technical_conflicts : UNKNOWN
    );
  }
  if (tradeSetupReport.news_evidence && (tradeSetupReport.news_evidence.conflicts || []).length > 0) {
    flag(RISK_CATEGORIES.NEWS_RISK, "News domain reports unresolved internal conflicts.", tradeSetupReport.news_evidence.conflicts);
  }
  if (tradeSetupReport.macro_evidence && (tradeSetupReport.macro_evidence.conflicts || []).length > 0) {
    flag(RISK_CATEGORIES.MACRO_RISK, "Macro domain reports unresolved internal conflicts.", tradeSetupReport.macro_evidence.conflicts);
  }
  if (tradeSetupReport.sentiment_evidence && (tradeSetupReport.sentiment_evidence.conflicts || []).length > 0) {
    flag(
      RISK_CATEGORIES.SENTIMENT_RISK,
      "Sentiment domain reports unresolved internal conflicts.",
      tradeSetupReport.sentiment_evidence.conflicts
    );
  }
  if (technicalReport && technicalReport.volatility && ["HIGH", "EXTREME"].includes(technicalReport.volatility.volatility)) {
    flag(RISK_CATEGORIES.VOLATILITY_RISK, `Technical Agent reports ${technicalReport.volatility.volatility} volatility.`, technicalReport.volatility);
  }
  if (technicalReport && technicalReport.volume_analysis && technicalReport.volume_analysis.volume_status === "UNUSUALLY_LOW_VOLUME") {
    flag(RISK_CATEGORIES.LIQUIDITY_RISK, "Technical Agent reports unusually low volume.", technicalReport.volume_analysis);
  }
  if (dataQuality.weak_setup_evidence) {
    flag(RISK_CATEGORIES.MARKET_RISK, `Trade setup quality is ${tradeSetupReport.setup_quality}; direction is ${tradeSetupReport.direction}.`, {
      setup_quality: tradeSetupReport.setup_quality,
      direction: tradeSetupReport.direction,
    });
  }
  if (positionSizeStatus === "DATA_UNAVAILABLE" || invalidationStatus === "DATA_UNAVAILABLE") {
    flag(RISK_CATEGORIES.EXECUTION_RISK, "Position sizing and/or invalidation levels are not fully available.", {
      position_size_status: positionSizeStatus,
      invalidation_status: invalidationStatus,
    });
  }

  return { categories: Array.from(categories), factors };
}

module.exports = { RISK_CATEGORIES, detectRiskCategories };
