// Deterministic technical indicator calculations, using only the
// candles supplied — never a fabricated value when there isn't enough
// data. Every function returns INSUFFICIENT_DATA (not enough candles
// for the configured period) or DATA_UNAVAILABLE (invalid parameters)
// rather than guessing. No indicator here decides BUY/SELL — each
// result carries a `technical_state` (an observation label, e.g.
// OVERBOUGHT_ZONE) that report.js and the caller must never treat as a
// trading instruction.
//
// Period defaults (SMA 20/50, EMA 9/20, RSI 14, MACD 12/26/9, ATR 14,
// Bollinger 20/2) are industry-standard conventions, not invented
// values — and every one is fully overridable via options.

const { UNKNOWN } = require("../../core/constants");
const { CONFIDENCE_LEVELS } = require("../../core/confidence");

const CALCULATION_STATUS = Object.freeze({
  CALCULATED: "CALCULATED",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  DATA_UNAVAILABLE: "DATA_UNAVAILABLE",
});

const RSI_ZONES = Object.freeze({
  OVERBOUGHT_ZONE: "OVERBOUGHT_ZONE",
  OVERSOLD_ZONE: "OVERSOLD_ZONE",
  NEUTRAL: "NEUTRAL",
  UNKNOWN: "UNKNOWN",
});

const MACD_STATES = Object.freeze({
  BULLISH_CROSS: "BULLISH_CROSS",
  BEARISH_CROSS: "BEARISH_CROSS",
  ABOVE_ZERO: "ABOVE_ZERO",
  BELOW_ZERO: "BELOW_ZERO",
  NEUTRAL: "NEUTRAL",
  UNKNOWN: "UNKNOWN",
});

const BAND_POSITIONS = Object.freeze({
  ABOVE_UPPER_BAND: "ABOVE_UPPER_BAND",
  BELOW_LOWER_BAND: "BELOW_LOWER_BAND",
  NEAR_UPPER_BAND: "NEAR_UPPER_BAND",
  NEAR_LOWER_BAND: "NEAR_LOWER_BAND",
  WITHIN_BANDS: "WITHIN_BANDS",
  UNKNOWN: "UNKNOWN",
});

const VOLATILITY_STATES = Object.freeze({
  LOW: "LOW",
  NORMAL: "NORMAL",
  HIGH: "HIGH",
  EXTREME: "EXTREME",
  UNKNOWN: "UNKNOWN",
});

function isNumeric(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function buildResult({ name, parameters, timeframe, value, status, dataRequired, confidence, notes, technicalState }) {
  const result = {
    indicator: name,
    parameters,
    timeframe: timeframe || UNKNOWN,
    current_value: value,
    calculation_status: status,
    data_required: dataRequired,
    confidence,
    notes: notes || UNKNOWN,
  };
  if (technicalState !== undefined) result.technical_state = technicalState;
  return result;
}

// ---- SMA ----

function calculateSMA(candles, period, timeframe) {
  const name = `SMA_${period}`;
  if (!Number.isInteger(period) || period < 1) {
    return buildResult({ name, parameters: { period }, timeframe, value: UNKNOWN, status: CALCULATION_STATUS.DATA_UNAVAILABLE, dataRequired: period, confidence: CONFIDENCE_LEVELS.UNKNOWN, notes: "Invalid period." });
  }
  if (!Array.isArray(candles) || candles.length < period) {
    return buildResult({ name, parameters: { period }, timeframe, value: UNKNOWN, status: CALCULATION_STATUS.INSUFFICIENT_DATA, dataRequired: period, confidence: CONFIDENCE_LEVELS.UNKNOWN, notes: `Requires ${period} candles; ${candles ? candles.length : 0} supplied.` });
  }

  const closes = candles.slice(-period).map((c) => c.close);
  const value = closes.reduce((sum, v) => sum + v, 0) / period;

  return buildResult({ name, parameters: { period }, timeframe, value, status: CALCULATION_STATUS.CALCULATED, dataRequired: period, confidence: CONFIDENCE_LEVELS.HIGH });
}

// ---- EMA ----
// Seeds with the SMA of the first `period` closes, then applies the
// standard EMA recurrence through the rest of the supplied candles —
// uses all supplied history for a converged current value, not just
// the most recent `period` candles.

function calculateEMA(candles, period, timeframe) {
  const name = `EMA_${period}`;
  if (!Number.isInteger(period) || period < 1) {
    return buildResult({ name, parameters: { period }, timeframe, value: UNKNOWN, status: CALCULATION_STATUS.DATA_UNAVAILABLE, dataRequired: period, confidence: CONFIDENCE_LEVELS.UNKNOWN, notes: "Invalid period." });
  }
  if (!Array.isArray(candles) || candles.length < period) {
    return buildResult({ name, parameters: { period }, timeframe, value: UNKNOWN, status: CALCULATION_STATUS.INSUFFICIENT_DATA, dataRequired: period, confidence: CONFIDENCE_LEVELS.UNKNOWN, notes: `Requires ${period} candles; ${candles ? candles.length : 0} supplied.` });
  }

  const closes = candles.map((c) => c.close);
  const multiplier = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = (closes[i] - ema) * multiplier + ema;
  }

  return buildResult({ name, parameters: { period }, timeframe, value: ema, status: CALCULATION_STATUS.CALCULATED, dataRequired: period, confidence: CONFIDENCE_LEVELS.HIGH });
}

function emaSeries(values, period) {
  if (values.length < period) return [];
  const multiplier = 2 / (period + 1);
  const series = new Array(values.length).fill(null);
  let ema = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  series[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
    series[i] = ema;
  }
  return series;
}

// ---- RSI (Wilder's smoothing) ----

function classifyRSIZone(rsiValue, options = {}) {
  if (!isNumeric(rsiValue)) return RSI_ZONES.UNKNOWN;
  const overbought = typeof options.overboughtThreshold === "number" ? options.overboughtThreshold : 70;
  const oversold = typeof options.oversoldThreshold === "number" ? options.oversoldThreshold : 30;
  if (rsiValue > overbought) return RSI_ZONES.OVERBOUGHT_ZONE;
  if (rsiValue < oversold) return RSI_ZONES.OVERSOLD_ZONE;
  return RSI_ZONES.NEUTRAL;
}

function calculateRSI(candles, period, timeframe, options = {}) {
  const name = `RSI_${period}`;
  const dataRequired = period + 1;
  if (!Number.isInteger(period) || period < 1) {
    return buildResult({ name, parameters: { period }, timeframe, value: UNKNOWN, status: CALCULATION_STATUS.DATA_UNAVAILABLE, dataRequired, confidence: CONFIDENCE_LEVELS.UNKNOWN, notes: "Invalid period.", technicalState: RSI_ZONES.UNKNOWN });
  }
  if (!Array.isArray(candles) || candles.length < dataRequired) {
    return buildResult({ name, parameters: { period }, timeframe, value: UNKNOWN, status: CALCULATION_STATUS.INSUFFICIENT_DATA, dataRequired, confidence: CONFIDENCE_LEVELS.UNKNOWN, notes: `Requires ${dataRequired} candles; ${candles ? candles.length : 0} supplied.`, technicalState: RSI_ZONES.UNKNOWN });
  }

  const closes = candles.map((c) => c.close);
  const deltas = [];
  for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i - 1]);

  let avgGain = deltas.slice(0, period).reduce((sum, d) => sum + (d > 0 ? d : 0), 0) / period;
  let avgLoss = deltas.slice(0, period).reduce((sum, d) => sum + (d < 0 ? -d : 0), 0) / period;

  for (let i = period; i < deltas.length; i++) {
    const gain = deltas[i] > 0 ? deltas[i] : 0;
    const loss = deltas[i] < 0 ? -deltas[i] : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  let rsi;
  if (avgGain === 0 && avgLoss === 0) rsi = 50;
  else if (avgLoss === 0) rsi = 100;
  else rsi = 100 - 100 / (1 + avgGain / avgLoss);

  return buildResult({
    name,
    parameters: { period },
    timeframe,
    value: rsi,
    status: CALCULATION_STATUS.CALCULATED,
    dataRequired,
    confidence: CONFIDENCE_LEVELS.HIGH,
    technicalState: classifyRSIZone(rsi, options),
  });
}

// ---- MACD ----

function calculateMACD(candles, params, timeframe) {
  const { fast = 12, slow = 26, signal = 9 } = params || {};
  const parameters = { fast, slow, signal };
  const dataRequired = slow + signal;

  if (!Array.isArray(candles) || candles.length < dataRequired) {
    return buildResult({
      name: "MACD",
      parameters,
      timeframe,
      value: UNKNOWN,
      status: CALCULATION_STATUS.INSUFFICIENT_DATA,
      dataRequired,
      confidence: CONFIDENCE_LEVELS.UNKNOWN,
      notes: `Requires at least ${dataRequired} candles; ${candles ? candles.length : 0} supplied.`,
      technicalState: MACD_STATES.UNKNOWN,
    });
  }

  const closes = candles.map((c) => c.close);
  const fastSeries = emaSeries(closes, fast);
  const slowSeries = emaSeries(closes, slow);

  const macdSeries = [];
  for (let i = 0; i < closes.length; i++) {
    if (fastSeries[i] != null && slowSeries[i] != null) {
      macdSeries.push(fastSeries[i] - slowSeries[i]);
    }
  }

  if (macdSeries.length < signal) {
    return buildResult({
      name: "MACD",
      parameters,
      timeframe,
      value: UNKNOWN,
      status: CALCULATION_STATUS.INSUFFICIENT_DATA,
      dataRequired,
      confidence: CONFIDENCE_LEVELS.UNKNOWN,
      notes: `Requires enough candles to build a ${signal}-period signal line from the MACD series.`,
      technicalState: MACD_STATES.UNKNOWN,
    });
  }

  const signalSeries = emaSeries(macdSeries, signal);
  const macdLine = macdSeries[macdSeries.length - 1];
  const signalLine = signalSeries[signalSeries.length - 1];
  const histogram = macdLine - signalLine;

  const prevMacd = macdSeries[macdSeries.length - 2];
  const prevSignal = signalSeries[signalSeries.length - 2];

  let state = MACD_STATES.NEUTRAL;
  if (isNumeric(prevMacd) && isNumeric(prevSignal)) {
    if (prevMacd <= prevSignal && macdLine > signalLine) state = MACD_STATES.BULLISH_CROSS;
    else if (prevMacd >= prevSignal && macdLine < signalLine) state = MACD_STATES.BEARISH_CROSS;
    else if (macdLine > 0) state = MACD_STATES.ABOVE_ZERO;
    else if (macdLine < 0) state = MACD_STATES.BELOW_ZERO;
  } else if (macdLine > 0) {
    state = MACD_STATES.ABOVE_ZERO;
  } else if (macdLine < 0) {
    state = MACD_STATES.BELOW_ZERO;
  }

  return buildResult({
    name: "MACD",
    parameters,
    timeframe,
    value: { macd_line: macdLine, signal_line: signalLine, histogram },
    status: CALCULATION_STATUS.CALCULATED,
    dataRequired,
    confidence: CONFIDENCE_LEVELS.HIGH,
    technicalState: state,
  });
}

// ---- ATR ----

function classifyVolatilityZone(atrValue, referencePrice, options = {}) {
  if (!isNumeric(atrValue) || !isNumeric(referencePrice) || referencePrice === 0) return VOLATILITY_STATES.UNKNOWN;
  const thresholds = options.volatilityThresholds;
  if (!thresholds) return VOLATILITY_STATES.UNKNOWN; // no universal threshold is assumed

  const atrPercent = (atrValue / referencePrice) * 100;
  if (atrPercent <= thresholds.lowMax) return VOLATILITY_STATES.LOW;
  if (atrPercent <= thresholds.normalMax) return VOLATILITY_STATES.NORMAL;
  if (atrPercent <= thresholds.highMax) return VOLATILITY_STATES.HIGH;
  return VOLATILITY_STATES.EXTREME;
}

function calculateATR(candles, period, timeframe, options = {}) {
  const name = `ATR_${period}`;
  const dataRequired = period + 1;

  if (!Number.isInteger(period) || period < 1) {
    return buildResult({ name, parameters: { period }, timeframe, value: UNKNOWN, status: CALCULATION_STATUS.DATA_UNAVAILABLE, dataRequired, confidence: CONFIDENCE_LEVELS.UNKNOWN, notes: "Invalid period.", technicalState: VOLATILITY_STATES.UNKNOWN });
  }
  if (!Array.isArray(candles) || candles.length < dataRequired) {
    return buildResult({ name, parameters: { period }, timeframe, value: UNKNOWN, status: CALCULATION_STATUS.INSUFFICIENT_DATA, dataRequired, confidence: CONFIDENCE_LEVELS.UNKNOWN, notes: `Requires ${dataRequired} candles; ${candles ? candles.length : 0} supplied.`, technicalState: VOLATILITY_STATES.UNKNOWN });
  }

  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }

  let atr = trueRanges.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  const currentClose = candles[candles.length - 1].close;
  const zone = classifyVolatilityZone(atr, currentClose, options);

  return buildResult({ name, parameters: { period }, timeframe, value: atr, status: CALCULATION_STATUS.CALCULATED, dataRequired, confidence: CONFIDENCE_LEVELS.HIGH, technicalState: zone });
}

// ---- Bollinger Bands ----
// NEAR_UPPER_BAND / NEAR_LOWER_BAND only ever fire when the caller
// supplies options.nearBandThresholdRatio — without it, this module
// does not invent a "near" distance, and prices between the bands
// simply read WITHIN_BANDS.

function calculateBollingerBands(candles, params, timeframe, options = {}) {
  const { period = 20, stdDevMultiplier = 2 } = params || {};
  const parameters = { period, stdDevMultiplier };

  if (!Array.isArray(candles) || candles.length < period) {
    return buildResult({
      name: "BOLLINGER_BANDS",
      parameters,
      timeframe,
      value: UNKNOWN,
      status: CALCULATION_STATUS.INSUFFICIENT_DATA,
      dataRequired: period,
      confidence: CONFIDENCE_LEVELS.UNKNOWN,
      notes: `Requires ${period} candles; ${candles ? candles.length : 0} supplied.`,
      technicalState: BAND_POSITIONS.UNKNOWN,
    });
  }

  const closes = candles.slice(-period).map((c) => c.close);
  const mean = closes.reduce((sum, v) => sum + v, 0) / period;
  const variance = closes.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  const middle = mean;
  const upper = middle + stdDevMultiplier * stdDev;
  const lower = middle - stdDevMultiplier * stdDev;
  const currentClose = candles[candles.length - 1].close;
  const bandWidth = upper - lower;

  let position = BAND_POSITIONS.WITHIN_BANDS;
  if (currentClose > upper) position = BAND_POSITIONS.ABOVE_UPPER_BAND;
  else if (currentClose < lower) position = BAND_POSITIONS.BELOW_LOWER_BAND;
  else if (typeof options.nearBandThresholdRatio === "number" && bandWidth > 0) {
    if (upper - currentClose <= bandWidth * options.nearBandThresholdRatio) position = BAND_POSITIONS.NEAR_UPPER_BAND;
    else if (currentClose - lower <= bandWidth * options.nearBandThresholdRatio) position = BAND_POSITIONS.NEAR_LOWER_BAND;
  }

  return buildResult({
    name: "BOLLINGER_BANDS",
    parameters,
    timeframe,
    value: { middle, upper, lower },
    status: CALCULATION_STATUS.CALCULATED,
    dataRequired: period,
    confidence: CONFIDENCE_LEVELS.HIGH,
    technicalState: position,
  });
}

// ---- Volume statistics ----
// If no candle in the batch has real volume, this returns NOT_AVAILABLE
// throughout, per the Step 7 spec's explicit instruction — never
// invented. "Unusual" volume is only ever classified when the caller
// supplies ratio thresholds; without them, volume_status is UNKNOWN.

function calculateVolumeStats(candles, options = {}) {
  const withVolume = (candles || []).filter((c) => isNumeric(c.volume));

  if (withVolume.length === 0) {
    return {
      average_volume: "NOT_AVAILABLE",
      current_volume: "NOT_AVAILABLE",
      volume_ratio: "NOT_AVAILABLE",
      volume_status: "NOT_AVAILABLE",
      calculation_status: CALCULATION_STATUS.DATA_UNAVAILABLE,
    };
  }

  const lookback = typeof options.volumeLookback === "number" ? options.volumeLookback : withVolume.length;
  const sample = withVolume.slice(-lookback);
  const average = sample.reduce((sum, c) => sum + c.volume, 0) / sample.length;
  const current = withVolume[withVolume.length - 1].volume;
  const ratio = average > 0 ? current / average : UNKNOWN;

  let status = "UNKNOWN";
  if (ratio !== UNKNOWN && typeof options.highVolumeRatio === "number" && ratio >= options.highVolumeRatio) {
    status = "UNUSUALLY_HIGH_VOLUME";
  } else if (ratio !== UNKNOWN && typeof options.lowVolumeRatio === "number" && ratio <= options.lowVolumeRatio) {
    status = "UNUSUALLY_LOW_VOLUME";
  } else if (ratio !== UNKNOWN && typeof options.highVolumeRatio === "number" && typeof options.lowVolumeRatio === "number") {
    status = "NORMAL_VOLUME";
  }

  return {
    average_volume: average,
    current_volume: current,
    volume_ratio: ratio,
    volume_status: status,
    calculation_status: CALCULATION_STATUS.CALCULATED,
  };
}

module.exports = {
  CALCULATION_STATUS,
  RSI_ZONES,
  MACD_STATES,
  BAND_POSITIONS,
  VOLATILITY_STATES,
  calculateSMA,
  calculateEMA,
  emaSeries,
  calculateRSI,
  classifyRSIZone,
  calculateMACD,
  calculateATR,
  classifyVolatilityZone,
  calculateBollingerBands,
  calculateVolumeStats,
};
