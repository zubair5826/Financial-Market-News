const test = require("node:test");
const assert = require("node:assert/strict");
const { deriveSentimentBias, buildMarketImpactAssessment } = require("./impact");

test("deriveSentimentBias returns UNKNOWN with no tagged evidence", () => {
  assert.equal(deriveSentimentBias({ BULLISH: 0, BEARISH: 0, MIXED: 0, NEUTRAL: 0 }), "UNKNOWN");
});

test("deriveSentimentBias returns BULLISH when bullish outweighs bearish", () => {
  assert.equal(deriveSentimentBias({ BULLISH: 3, BEARISH: 1, MIXED: 0, NEUTRAL: 0 }), "BULLISH");
});

test("deriveSentimentBias returns MIXED when both bullish and bearish are present", () => {
  assert.equal(deriveSentimentBias({ BULLISH: 2, BEARISH: 2, MIXED: 0, NEUTRAL: 0 }), "MIXED");
});

test("buildMarketImpactAssessment maps BULLISH bias to POSITIVE impact with evidence-based language, never a price guarantee", () => {
  const assessment = buildMarketImpactAssessment("BULLISH");
  assert.equal(assessment.impact_direction, "POSITIVE");
  assert.ok(assessment.notes.includes("Sentiment evidence is currently positive"));
  assert.ok(!/will rise|guaranteed/i.test(assessment.notes));
});

test("buildMarketImpactAssessment maps UNKNOWN bias to UNKNOWN impact", () => {
  const assessment = buildMarketImpactAssessment("UNKNOWN");
  assert.equal(assessment.impact_direction, "UNKNOWN");
});
