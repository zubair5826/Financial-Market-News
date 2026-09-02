// The Technical Analysis Agent.
//
// Pipeline: RECEIVE -> VALIDATE OHLCV -> CHECK TIMESTAMP/FRESHNESS ->
// CLASSIFY (pass-through, never mutated) -> group by timeframe ->
// per timeframe: CALCULATE INDICATORS -> MARKET STRUCTURE -> TREND ->
// MOMENTUM -> VOLATILITY -> PATTERNS -> BREAKOUT -> SUPPORT/RESISTANCE
// -> across timeframes: DETECT CONFLICTS -> return a Technical Report.
//
// It does not execute trades, connect to a broker, or recommend a
// direction — see report.js, whose Technical Report output has no
// recommendation_type field and never contains BUY/SELL/LONG/SHORT. No
// external market-data provider is connected; `input` is data supplied
// internally by the system (see README.md). Mirrors the architecture of
// agents/data-controller, agents/news-agent, and agents/macro-agent.

const { computeFreshness, FRESHNESS_STATES } = require("../../core/freshness");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { failSafe, ERROR_CODES } = require("../../core/errors");
const { UNKNOWN } = require("../../core/constants");
const { logEvent } = require("../../logs/logger");
const { normalizeCandle } = require("./normalize");
const { validateCandleInput } = require("./validate");
const {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateATR,
  calculateBollingerBands,
  calculateVolumeStats,
} = require("./indicators");
const { assessMarketStructure } = require("./structure");
const { assessTrend } = require("./trend");
const { assessMomentum } = require("./momentum");
const { assessVolatility } = require("./volatility");
const { detectPatterns, assessBreakout } = require("./patterns");
const { identifySupportResistance } = require("./supportResistance");
const { assessTechnicalConflicts } = require("./conflicts");
const { buildTechnicalReport } = require("./report");

const TECHNICAL_AGENT_STATUS = Object.freeze({
  SUCCESS: "SUCCESS",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
  CONFLICTING: "CONFLICTING",
  UNAVAILABLE: "UNAVAILABLE",
});

const UNAVAILABLE_CODES = new Set([
  ERROR_CODES.API_UNAVAILABLE,
  ERROR_CODES.TIMEOUT,
  ERROR_CODES.RATE_LIMIT,
  ERROR_CODES.AUTH_FAILURE,
]);

// SMA 20/50, EMA 9/20, RSI 14, MACD 12/26/9, ATR 14, Bollinger 20/2 are
// industry-standard conventional periods, not invented — every one is
// overridable via options.indicatorConfig.
const DEFAULT_INDICATOR_CONFIG = Object.freeze({
  sma: [20, 50],
  ema: [9, 20],
  rsi: { period: 14 },
  macd: { fast: 12, slow: 26, signal: 9 },
  atr: { period: 14 },
  bollinger: { period: 20, stdDevMultiplier: 2 },
});

function isNumeric(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function resolveFreshnessThresholds(candle, options) {
  const cfg = options.freshnessThresholds;
  if (!cfg) return undefined;
  if (typeof cfg.freshMaxMs === "number" && typeof cfg.agingMaxMs === "number") return cfg;
  return cfg[candle.timeframe];
}

// Trusts the supplied array order as chronological (oldest first) when
// timestamps aren't uniformly available to sort by — documented
// assumption, since we can't reliably reorder without evidence.
function sortCandlesChronologically(candles) {
  const allHaveTimestamps = candles.every(
    (c) => c.timestamp && c.timestamp !== UNKNOWN && !Number.isNaN(Date.parse(c.timestamp))
  );
  if (!allHaveTimestamps) return candles;
  return [...candles].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

// A compact multi-day fetch (e.g. Alpha Vantage's outputsize=compact)
// legitimately includes many genuinely old candles alongside the
// current one — historical context technical analysis actually needs
// (see analyzeTimeframeGroup below). Only ONE candle per asset+
// timeframe group is "the latest," and only its own freshness result
// is decision-relevant; every other candle in the group being old is
// expected, not a data-quality problem worth its own warning.
//
// Reuses sortCandlesChronologically() itself — never a second,
// competing ordering implementation — so this inherits the exact same
// ordering guarantee (a full re-sort when every candle in the group
// has a valid timestamp) and the exact same documented fallback
// (trust the group's own supplied order when at least one doesn't).
//
// Returns a Map keyed by "asset::timeframe" to that group's single
// latest candle (by reference, so callers can compare with ===).
function identifyLatestCandlePerGroup(candles) {
  const groups = new Map();
  for (const candle of candles) {
    const key = `${candle.asset}::${candle.timeframe}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candle);
  }

  const latestByGroup = new Map();
  for (const [key, groupCandles] of groups) {
    const sorted = sortCandlesChronologically(groupCandles);
    latestByGroup.set(key, sorted[sorted.length - 1]);
  }
  return latestByGroup;
}

function analyzeTimeframeGroup(timeframe, rawGroupCandles, options) {
  const candles = sortCandlesChronologically(rawGroupCandles);
  const lastCandle = candles[candles.length - 1];
  const currentPrice = lastCandle && isNumeric(lastCandle.close) ? lastCandle.close : UNKNOWN;

  const indicatorConfig = { ...DEFAULT_INDICATOR_CONFIG, ...(options.indicatorConfig || {}) };

  const smaResults = (indicatorConfig.sma || []).map((period) => calculateSMA(candles, period, timeframe));
  const emaResults = (indicatorConfig.ema || []).map((period) => calculateEMA(candles, period, timeframe));
  const rsiResult = calculateRSI(candles, indicatorConfig.rsi.period, timeframe, options.rsiOptions || {});
  const macdResult = calculateMACD(candles, indicatorConfig.macd, timeframe);
  const atrResult = calculateATR(candles, indicatorConfig.atr.period, timeframe, options.volatilityOptions || {});
  const bollingerResult = calculateBollingerBands(candles, indicatorConfig.bollinger, timeframe, options.bollingerOptions || {});
  const volumeAnalysis = calculateVolumeStats(candles, options.volumeOptions || {});

  const sortedPeriods = [...(indicatorConfig.sma || [])].sort((a, b) => a - b);
  const fastSMAResult = sortedPeriods.length >= 1 ? smaResults.find((r) => r.parameters.period === sortedPeriods[0]) : null;
  const slowSMAResult = sortedPeriods.length >= 2 ? smaResults.find((r) => r.parameters.period === sortedPeriods[1]) : null;
  const fastSMA = fastSMAResult && fastSMAResult.calculation_status === "CALCULATED" ? fastSMAResult.current_value : UNKNOWN;
  const slowSMA = slowSMAResult && slowSMAResult.calculation_status === "CALCULATED" ? slowSMAResult.current_value : UNKNOWN;

  const marketStructureResult = assessMarketStructure(candles, options.structureOptions || {});
  const trend = assessTrend({
    currentPrice,
    fastSMA,
    slowSMA,
    marketStructure: marketStructureResult.market_structure,
  });

  const rsiValue = rsiResult.calculation_status === "CALCULATED" ? rsiResult.current_value : UNKNOWN;
  const macdHistogram = macdResult.calculation_status === "CALCULATED" ? macdResult.current_value.histogram : UNKNOWN;
  const momentum = assessMomentum({ rsiValue, macdHistogram }, options.momentumOptions || {});

  const volatility = assessVolatility(atrResult);
  const patterns = detectPatterns(candles, marketStructureResult, options.patternOptions || {});
  const breakoutAnalysis = assessBreakout(candles, options.breakoutOptions || {});
  const levels = identifySupportResistance(candles, { ...(options.levelOptions || {}), timeframe });

  return {
    timeframe,
    candle_count: candles.length,
    current_price: currentPrice,
    indicators: {
      sma: smaResults,
      ema: emaResults,
      rsi: rsiResult,
      macd: macdResult,
      atr: atrResult,
      bollinger_bands: bollingerResult,
    },
    market_structure: marketStructureResult,
    trend,
    momentum,
    volatility,
    volume_analysis: volumeAnalysis,
    patterns,
    breakout_analysis: breakoutAnalysis,
    support_levels: levels.support_levels,
    resistance_levels: levels.resistance_levels,
    fastSMA,
    slowSMA,
    rsiValue,
    macdHistogram,
  };
}

function emptyResult(status, warnings, errors, timestamp) {
  return {
    agent_status: status,
    validated_candles: [],
    rejected_candles: [],
    timeframe_analyses: [],
    technical_conflicts: { status: "INSUFFICIENT_DATA", conflicts: [] },
    warnings,
    errors,
    timestamp,
  };
}

function processTechnicalData(input, options = {}) {
  const timestamp = new Date().toISOString();

  // Structurally ready for a future provider adapter's failSafe()
  // result — no provider is connected yet, but this path exists so
  // wiring one up later doesn't require a rewrite.
  if (input && typeof input === "object" && !Array.isArray(input) && input.ok === false && input.code) {
    const status = UNAVAILABLE_CODES.has(input.code) ? TECHNICAL_AGENT_STATUS.UNAVAILABLE : TECHNICAL_AGENT_STATUS.FAILED;
    const result = emptyResult(status, [], [input], timestamp);
    logEvent({
      agent: "technical-agent",
      request: { inputType: "provider-error", code: input.code },
      dataSource: UNKNOWN,
      responseStatus: status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  if (!Array.isArray(input)) {
    const err = failSafe(ERROR_CODES.MALFORMED_DATA, "Input must be an array of raw OHLCV candles.");
    const result = emptyResult(TECHNICAL_AGENT_STATUS.FAILED, [], [err], timestamp);
    logEvent({
      agent: "technical-agent",
      request: { inputType: typeof input },
      dataSource: UNKNOWN,
      responseStatus: result.agent_status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  if (input.length === 0) {
    const result = emptyResult(
      TECHNICAL_AGENT_STATUS.UNAVAILABLE,
      ["TECHNICAL DATA UNAVAILABLE — no market data was supplied."],
      [],
      timestamp
    );
    logEvent({
      agent: "technical-agent",
      request: { recordCount: 0 },
      dataSource: UNKNOWN,
      responseStatus: result.agent_status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  const warnings = [];
  const errors = [];
  const validated = [];
  const rejected = [];

  // Pass 1: normalize + structurally validate every raw candle exactly
  // as before. Freshness is deliberately NOT computed yet here — it
  // needs every candle in a group already collected (pass 2 below)
  // before "which one is latest" can be determined.
  const normalizedCandidates = [];
  for (const raw of input) {
    const candle = normalizeCandle(raw, options.fieldMap || {});

    const validation = validateCandleInput(candle);
    if (!validation.valid) {
      const code = validation.missingFields.length > 0 ? ERROR_CODES.MISSING_DATA : ERROR_CODES.MALFORMED_DATA;
      const allErrors = [
        ...validation.missingFields.map((f) => `Missing required field: ${f} (DATA UNAVAILABLE).`),
        ...validation.structuralErrors,
        ...validation.ohlcErrors,
      ];
      rejected.push({
        record: candle,
        errors: allErrors,
        reason: failSafe(code, "Candle failed Technical Agent validation.", { errors: allErrors }),
      });
      continue;
    }

    normalizedCandidates.push(candle);
  }

  for (const r of rejected) errors.push(r.reason);

  // Pass 2: exactly one "latest" candle per asset+timeframe group —
  // see identifyLatestCandlePerGroup's own comment for why grouping
  // happens here rather than deferring to the per-timeframe analysis
  // grouping further below (that grouping is also asset-filtered by
  // options.requestedAsset first; freshness must be evaluated for
  // every supplied asset's own latest candle, not only the requested
  // one — unchanged from the pre-existing behavior of evaluating every
  // validated candle, just narrowed to one per group instead of all).
  const latestCandleByGroup = identifyLatestCandlePerGroup(normalizedCandidates);

  // Pass 3: freshness is computed here from timestamp, never trusted
  // from the caller's own "real-time" claim — for EVERY candle,
  // exactly as before (still needed by report.js's own per-candle
  // checks and by anything downstream sampling individual candles).
  // Only the WARNING/UNCERTAINTY a stale or unknown-freshness result
  // would otherwise contribute is now narrowed to the group's single
  // latest candle — a historical candle being old is expected, not a
  // data-quality problem worth its own repeated signal.
  for (const candle of normalizedCandidates) {
    const thresholds = resolveFreshnessThresholds(candle, options);
    candle.freshness_status = computeFreshness(candle.timestamp, thresholds);

    const groupKey = `${candle.asset}::${candle.timeframe}`;
    candle.is_latest_in_group = latestCandleByGroup.get(groupKey) === candle;

    if (candle.is_latest_in_group) {
      if (candle.freshness_status === FRESHNESS_STATES.UNKNOWN) {
        const reason =
          !candle.timestamp || candle.timestamp === UNKNOWN ? "no timestamp was supplied" : "no freshness thresholds were configured";
        warnings.push(`Freshness UNKNOWN for ${candle.asset} (${candle.timeframe}) from ${candle.source} — ${reason}.`);
      } else if (candle.freshness_status === FRESHNESS_STATES.STALE) {
        warnings.push(
          failSafe(ERROR_CODES.STALE_DATA, `${candle.asset} (${candle.timeframe}) candle from ${candle.source} is STALE DATA.`, {
            asset: candle.asset,
            timeframe: candle.timeframe,
          })
        );
      }
    }

    if (candle.verification_status === UNKNOWN) {
      candle.verification_status = SOURCE_VERIFICATION_STATES.UNVERIFIED;
    }

    validated.push(candle);
  }

  // Everything supplied is validated above regardless of asset; only
  // the requested asset's candles are grouped/analyzed below. This
  // means agent_status can be SUCCESS even when nothing relevant to
  // requestedAsset was found — check timeframe_analyses/candles_analyzed
  // for that. Documented in README.md.
  const relevantCandles = options.requestedAsset
    ? validated.filter((c) => c.asset === options.requestedAsset)
    : validated;

  const groups = new Map();
  for (const candle of relevantCandles) {
    if (!groups.has(candle.timeframe)) groups.set(candle.timeframe, []);
    groups.get(candle.timeframe).push(candle);
  }

  const timeframeAnalyses = [];
  for (const [timeframe, candles] of groups) {
    timeframeAnalyses.push(analyzeTimeframeGroup(timeframe, candles, options));
  }

  const conflictResult = assessTechnicalConflicts(timeframeAnalyses);

  if (input.length > 0 && validated.length === 0 && rejected.length > 0) {
    errors.push(
      failSafe(ERROR_CODES.MISSING_DATA, "No candle passed validation — INSUFFICIENT DATA.", {
        rejectedCount: rejected.length,
      })
    );
  }

  let status;
  if (input.length > 0 && validated.length === 0) status = TECHNICAL_AGENT_STATUS.FAILED;
  else if (conflictResult.status === "CONFLICTING_SIGNALS") status = TECHNICAL_AGENT_STATUS.CONFLICTING;
  else if (rejected.length > 0) status = TECHNICAL_AGENT_STATUS.PARTIAL;
  else status = TECHNICAL_AGENT_STATUS.SUCCESS;

  const result = {
    agent_status: status,
    validated_candles: validated,
    rejected_candles: rejected,
    timeframe_analyses: timeframeAnalyses,
    technical_conflicts: conflictResult,
    warnings,
    errors,
    timestamp,
  };

  logEvent({
    agent: "technical-agent",
    request: { recordCount: input.length, requestedAsset: options.requestedAsset || UNKNOWN },
    dataSource: Array.from(new Set(validated.map((c) => c.source))).join(",") || UNKNOWN,
    responseStatus: status,
    warnings,
    errors,
  });

  return result;
}

function runTechnicalAgent(input, options = {}) {
  const result = processTechnicalData(input, options);
  const report = buildTechnicalReport(result, options);
  return { result, report };
}

module.exports = { TECHNICAL_AGENT_STATUS, processTechnicalData, runTechnicalAgent };
