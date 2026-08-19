const test = require("node:test");
const assert = require("node:assert/strict");
const { aggregateSentiment } = require("./aggregation");
const { UNKNOWN } = require("../../core/constants");

function record(sentiment, overrides = {}) {
  return { sentiment, confidence: "UNKNOWN", sentiment_strength: "UNKNOWN", ...overrides };
}

test("aggregateSentiment returns UNKNOWN weighted_sentiment and confidence with no records — insufficient evidence", () => {
  const result = aggregateSentiment([]);
  assert.equal(result.weighted_sentiment, UNKNOWN);
  assert.equal(result.confidence, "UNKNOWN");
  assert.equal(result.source_count, 0);
});

test("aggregateSentiment counts each sentiment value correctly", () => {
  const records = [record("BULLISH"), record("BULLISH"), record("BEARISH"), record("NEUTRAL")];
  const result = aggregateSentiment(records);
  assert.equal(result.bullish_count, 2);
  assert.equal(result.bearish_count, 1);
  assert.equal(result.neutral_count, 1);
});

test("aggregateSentiment computes a positive weighted_sentiment when bullish dominates", () => {
  const records = [record("BULLISH"), record("BULLISH"), record("BEARISH")];
  const result = aggregateSentiment(records);
  assert.ok(result.weighted_sentiment > 0);
});

test("aggregateSentiment default weighting treats every record equally (documented default)", () => {
  const records = [record("BULLISH", { sentiment_strength: "WEAK" }), record("BULLISH", { sentiment_strength: "VERY_STRONG" })];
  const result = aggregateSentiment(records);
  assert.equal(result.weighted_sentiment, 1); // both count as +1 with default weight 1
});

test("aggregateSentiment respects a configured weighting scheme", () => {
  const records = [record("BULLISH", { sentiment_strength: "WEAK" }), record("BEARISH", { sentiment_strength: "VERY_STRONG" })];
  const weights = { byStrength: { WEAK: 1, VERY_STRONG: 3 } };
  const result = aggregateSentiment(records, { sentimentWeights: weights });
  // (1*1 + -1*3) / (1+3) = -2/4 = -0.5
  assert.equal(result.weighted_sentiment, -0.5);
});

test("aggregateSentiment excludes UNKNOWN-sentiment entries from the weighted calculation", () => {
  const records = [record("UNKNOWN"), record("UNKNOWN")];
  const result = aggregateSentiment(records);
  assert.equal(result.weighted_sentiment, UNKNOWN);
});
