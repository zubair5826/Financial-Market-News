// Builds the Technical Report — this agent's primary output contract,
// per the Step 7 spec's field list. Same pattern as the News/Macro
// reports: a sibling contract to core/agentMessage.js, no
// recommendation_type field anywhere in this shape.
//
// The spec lists both flat fields (indicators, trend_analysis,
// market_structure, ...) AND a `timeframe_analysis` array — to avoid
// ambiguity/redundancy this treats `timeframe_analysis` as the full
// per-timeframe breakdown, and the flat fields as a convenience view of
// one "primary" timeframe (options.primaryTimeframe if supplied and
// present, else whichever analyzed timeframe has the most candles).
// Documented explicitly since the spec doesn't disambiguate this
// itself.

const { UNKNOWN } = require("../../core/constants");
const { CONFIDENCE_LEVELS } = require("../../core/confidence");
const { dedupeExact } = require("../../core/dedupe");

function pickPrimaryAnalysis(analyses, options) {
  if (analyses.length === 0) return null;
  if (options.primaryTimeframe) {
    const match = analyses.find((a) => a.timeframe === options.primaryTimeframe);
    if (match) return match;
  }
  return [...analyses].sort((a, b) => b.candle_count - a.candle_count)[0];
}

function deriveTechnicalBias(analyses) {
  let bullish = 0;
  let bearish = 0;
  for (const a of analyses) {
    if (a.trend === "UPTREND" || a.trend === "STRONG_UPTREND") bullish += 1;
    else if (a.trend === "DOWNTREND" || a.trend === "STRONG_DOWNTREND") bearish += 1;
  }
  const tagged = bullish + bearish;
  if (tagged === 0) return "UNKNOWN";
  // Majority rules first — a lopsided batch (e.g. 3 timeframes
  // bullish vs 1 bearish) is BULLISH, not MIXED. MIXED is reserved
  // for a genuine tie between opposing timeframes.
  if (bullish > bearish) return "BULLISH";
  if (bearish > bullish) return "BEARISH";
  return "MIXED";
}

function buildTechnicalReport(result, options = {}) {
  const analyses = result.timeframe_analyses;
  const primary = pickPrimaryAnalysis(analyses, options);

  const sources = Array.from(new Set(result.validated_candles.map((c) => c.source)));

  const uncertainties = [];
  for (const c of result.validated_candles) {
    if (c.freshness_status === "UNKNOWN") {
      uncertainties.push(`${c.asset} (${c.timeframe}) candle from ${c.source}: freshness UNKNOWN.`);
    }
  }
  for (const a of analyses) {
    if (a.trend === "UNKNOWN") uncertainties.push(`${a.timeframe}: trend UNKNOWN — insufficient evidence.`);
    if (a.market_structure.market_structure === "UNKNOWN") uncertainties.push(`${a.timeframe}: market structure UNKNOWN — insufficient swing evidence.`);
  }

  let confidence;
  if (analyses.length === 0) {
    confidence = CONFIDENCE_LEVELS.UNKNOWN;
  } else if (result.technical_conflicts.status === "CONFLICTING_SIGNALS" || result.rejected_candles.length > 0) {
    confidence = CONFIDENCE_LEVELS.LOW;
  } else if (result.warnings.length > 0) {
    confidence = CONFIDENCE_LEVELS.MEDIUM;
  } else {
    confidence = CONFIDENCE_LEVELS.HIGH;
  }

  return {
    agent_name: "technical-agent",
    timestamp: result.timestamp,
    requested_asset: options.requestedAsset || UNKNOWN,
    timeframes_analyzed: analyses.map((a) => a.timeframe),
    candles_analyzed: result.validated_candles.length,
    indicators: primary ? primary.indicators : UNKNOWN,
    trend_analysis: primary ? primary.trend : UNKNOWN,
    market_structure: primary ? primary.market_structure : UNKNOWN,
    support_levels: primary ? primary.support_levels : [],
    resistance_levels: primary ? primary.resistance_levels : [],
    momentum: primary ? primary.momentum : UNKNOWN,
    volatility: primary ? primary.volatility : UNKNOWN,
    volume_analysis: primary ? primary.volume_analysis : UNKNOWN,
    patterns: primary ? primary.patterns : [],
    breakout_analysis: primary ? primary.breakout_analysis : UNKNOWN,
    // Full multi-timeframe breakdown — see module comment above.
    timeframe_analysis: analyses,
    technical_conflicts: result.technical_conflicts,
    // Evidence-based label only — NOT a trading instruction. BULLISH
    // here never means BUY, and this field never contains
    // BUY/SELL/LONG/SHORT — see README.md.
    technical_bias: deriveTechnicalBias(analyses),
    confidence,
    // Deduplicated here only — the report's own presentation layer.
    // result.warnings (used for confidence above, logging, and every
    // other decision) is read from its original, un-deduplicated form;
    // only the copy exposed on this report is collapsed, and only
    // exact-duplicate entries are ever removed — see core/dedupe.js.
    uncertainties: dedupeExact(uncertainties),
    warnings: dedupeExact(result.warnings),
    sources,
  };
}

module.exports = { buildTechnicalReport };
