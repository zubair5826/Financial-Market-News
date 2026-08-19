// Technical conflict detection — two kinds, both from the Step 7 spec's
// own examples. Never picks a winner: both signals are preserved in the
// conflict record, exactly as agents/data-controller, agents/news-agent,
// and agents/macro-agent's conflicts.js modules never auto-resolve a
// disagreement.
//
//   PRICE_MOMENTUM_CONFLICT: price is above the fast moving average
//     while momentum reads negative (or below while momentum reads
//     positive) on the same timeframe.
//   TREND_MOMENTUM_CONFLICT: the timeframe's trend classification and
//     its momentum classification point in opposite directions.
//   TIMEFRAME_CONFLICT: two different timeframes' trend classifications
//     point in opposite directions (e.g. 1H bullish, 4H bearish).

const CONFLICT_STATES = Object.freeze({
  NO_CONFLICT: "NO_CONFLICT",
  CONFLICTING_SIGNALS: "CONFLICTING_SIGNALS",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  UNKNOWN: "UNKNOWN",
});

function isNumeric(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function detectPriceMomentumConflict(analysis) {
  // NOTE: analysis objects (built by agents/technical-agent/index.js's
  // analyzeTimeframeGroup) use current_price (snake_case), matching this
  // project's field-naming convention everywhere else — not currentPrice.
  const { current_price: currentPrice, fastSMA, momentum, timeframe } = analysis;
  if (!isNumeric(currentPrice) || !isNumeric(fastSMA)) return null;

  const priceAboveMA = currentPrice > fastSMA;
  const priceBelowMA = currentPrice < fastSMA;
  const negativeMomentum = momentum === "NEGATIVE" || momentum === "STRONG_NEGATIVE";
  const positiveMomentum = momentum === "POSITIVE" || momentum === "STRONG_POSITIVE";

  if ((priceAboveMA && negativeMomentum) || (priceBelowMA && positiveMomentum)) {
    return { type: "PRICE_MOMENTUM_CONFLICT", timeframe, current_price: currentPrice, fastSMA, momentum };
  }
  return null;
}

function detectTrendMomentumConflict(analysis) {
  const { trend, momentum, timeframe } = analysis;
  const bullishTrend = trend === "UPTREND" || trend === "STRONG_UPTREND";
  const bearishTrend = trend === "DOWNTREND" || trend === "STRONG_DOWNTREND";
  const negativeMomentum = momentum === "NEGATIVE" || momentum === "STRONG_NEGATIVE";
  const positiveMomentum = momentum === "POSITIVE" || momentum === "STRONG_POSITIVE";

  if ((bullishTrend && negativeMomentum) || (bearishTrend && positiveMomentum)) {
    return { type: "TREND_MOMENTUM_CONFLICT", timeframe, trend, momentum };
  }
  return null;
}

function detectIntraTimeframeConflicts(analysis) {
  return [detectPriceMomentumConflict(analysis), detectTrendMomentumConflict(analysis)].filter(Boolean);
}

function detectMultiTimeframeConflicts(analyses) {
  const conflicts = [];
  const withTrend = analyses.filter((a) => a.trend && a.trend !== "UNKNOWN");

  for (let i = 0; i < withTrend.length; i++) {
    for (let j = i + 1; j < withTrend.length; j++) {
      const a = withTrend[i];
      const b = withTrend[j];
      const aBull = a.trend.includes("UPTREND");
      const aBear = a.trend.includes("DOWNTREND");
      const bBull = b.trend.includes("UPTREND");
      const bBear = b.trend.includes("DOWNTREND");
      if ((aBull && bBear) || (aBear && bBull)) {
        conflicts.push({ type: "TIMEFRAME_CONFLICT", timeframes: [a.timeframe, b.timeframe], trends: [a.trend, b.trend] });
      }
    }
  }

  return conflicts;
}

function assessTechnicalConflicts(analyses) {
  if (!Array.isArray(analyses) || analyses.length === 0) {
    return { status: CONFLICT_STATES.INSUFFICIENT_DATA, conflicts: [] };
  }

  const intra = analyses.flatMap(detectIntraTimeframeConflicts);
  const multi = analyses.length > 1 ? detectMultiTimeframeConflicts(analyses) : [];
  const all = [...intra, ...multi];

  return { status: all.length > 0 ? CONFLICT_STATES.CONFLICTING_SIGNALS : CONFLICT_STATES.NO_CONFLICT, conflicts: all };
}

module.exports = { CONFLICT_STATES, assessTechnicalConflicts };
