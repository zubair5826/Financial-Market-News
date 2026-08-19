// Deterministic sentiment aggregation. Documented rule, exactly:
//
//   Each record contributes one vote to its bullish/bearish/neutral/
//   mixed/unknown count. UNKNOWN-sentiment records are excluded from
//   the weighted calculation entirely (there's no directional evidence
//   to weight). Every other record contributes
//   direction_value(BULLISH=+1, BEARISH=-1, NEUTRAL=0, MIXED=0)
//   multiplied by its weight (default 1 — every record counts equally
//   unless the caller supplies options.sentimentWeights.byStrength /
//   .byConfidence multiplier maps). weighted_sentiment is the weighted
//   average of those contributions, in [-1, 1]; UNKNOWN if there is no
//   weighted evidence at all.
//
//   Aggregate confidence scales with source_count via a conventional,
//   fully-overridable default (options.aggregationConfidenceThresholds
//   = { lowMax, mediumMax }, default { lowMax: 1, mediumMax: 4 }) — more
//   independent sources backing the aggregate is a standard notion of
//   higher confidence, not an invented rule specific to this project.

const { UNKNOWN } = require("../../core/constants");
const { CONFIDENCE_LEVELS } = require("../../core/confidence");
const { SENTIMENT_VALUES } = require("./sentimentRecord");

const DIRECTION_VALUE = Object.freeze({ BULLISH: 1, BEARISH: -1, NEUTRAL: 0, MIXED: 0 });

const DEFAULT_CONFIDENCE_THRESHOLDS = Object.freeze({ lowMax: 1, mediumMax: 4 });

function resolveWeight(record, options) {
  const weights = options.sentimentWeights;
  let weight = 1;
  if (!weights) return weight;

  if (weights.byStrength && weights.byStrength[record.sentiment_strength] !== undefined) {
    weight *= weights.byStrength[record.sentiment_strength];
  }
  if (weights.byConfidence && weights.byConfidence[record.confidence] !== undefined) {
    weight *= weights.byConfidence[record.confidence];
  }
  return weight;
}

function aggregateSentiment(records, options = {}) {
  const counts = { BULLISH: 0, BEARISH: 0, NEUTRAL: 0, MIXED: 0, UNKNOWN: 0 };
  let weightedSum = 0;
  let totalWeight = 0;

  for (const record of records) {
    const sentiment = Object.values(SENTIMENT_VALUES).includes(record.sentiment)
      ? record.sentiment
      : SENTIMENT_VALUES.UNKNOWN;
    counts[sentiment] += 1;

    if (sentiment === SENTIMENT_VALUES.UNKNOWN) continue;

    const weight = resolveWeight(record, options);
    weightedSum += DIRECTION_VALUE[sentiment] * weight;
    totalWeight += weight;
  }

  const sourceCount = records.length;
  const weightedSentiment = totalWeight > 0 ? weightedSum / totalWeight : UNKNOWN;

  const thresholds = options.aggregationConfidenceThresholds || DEFAULT_CONFIDENCE_THRESHOLDS;
  let confidence;
  if (sourceCount === 0) confidence = CONFIDENCE_LEVELS.UNKNOWN;
  else if (sourceCount <= thresholds.lowMax) confidence = CONFIDENCE_LEVELS.LOW;
  else if (sourceCount <= thresholds.mediumMax) confidence = CONFIDENCE_LEVELS.MEDIUM;
  else confidence = CONFIDENCE_LEVELS.HIGH;

  return {
    bullish_count: counts.BULLISH,
    bearish_count: counts.BEARISH,
    neutral_count: counts.NEUTRAL,
    mixed_count: counts.MIXED,
    unknown_count: counts.UNKNOWN,
    weighted_sentiment: weightedSentiment,
    source_count: sourceCount,
    confidence,
  };
}

module.exports = { aggregateSentiment, DIRECTION_VALUE, DEFAULT_CONFIDENCE_THRESHOLDS };
