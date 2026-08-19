// Sentiment strength — deterministic, never inferred from emotional
// wording (this module never inspects any free-text field). If the
// source already tagged a valid sentiment_strength, that's trusted
// as-is (pass-through). Otherwise, strength is derived only from a
// numeric sentiment_score's magnitude against caller-configured
// thresholds — with no thresholds configured, strength stays UNKNOWN
// rather than guessed, same discipline as every other threshold in
// this project (core/freshness.js, the Macro Agent's volatility zones,
// the Technical Agent's ATR volatility zones).

const { STRENGTH_LEVELS } = require("./sentimentRecord");

function isNumeric(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function deriveSentimentStrength(record, options = {}) {
  if (
    record.sentiment_strength &&
    record.sentiment_strength !== "UNKNOWN" &&
    Object.values(STRENGTH_LEVELS).includes(record.sentiment_strength)
  ) {
    return record.sentiment_strength;
  }

  if (!isNumeric(record.sentiment_score)) return STRENGTH_LEVELS.UNKNOWN;

  const thresholds = options.strengthThresholds;
  if (!thresholds) return STRENGTH_LEVELS.UNKNOWN;

  const magnitude = Math.abs(record.sentiment_score);
  if (magnitude >= thresholds.veryStrongMin) return STRENGTH_LEVELS.VERY_STRONG;
  if (magnitude >= thresholds.strongMin) return STRENGTH_LEVELS.STRONG;
  if (magnitude >= thresholds.moderateMin) return STRENGTH_LEVELS.MODERATE;
  return STRENGTH_LEVELS.WEAK;
}

module.exports = { deriveSentimentStrength };
