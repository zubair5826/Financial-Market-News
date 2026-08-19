const test = require("node:test");
const assert = require("node:assert/strict");
const { deriveSentimentStrength } = require("./strength");

test("deriveSentimentStrength trusts a caller-tagged strength as-is", () => {
  const strength = deriveSentimentStrength({ sentiment_strength: "STRONG", sentiment_score: "UNKNOWN" });
  assert.equal(strength, "STRONG");
});

test("deriveSentimentStrength returns UNKNOWN with no score and no tagged strength", () => {
  const strength = deriveSentimentStrength({ sentiment_strength: "UNKNOWN", sentiment_score: "UNKNOWN" });
  assert.equal(strength, "UNKNOWN");
});

test("deriveSentimentStrength returns UNKNOWN from a numeric score without configured thresholds", () => {
  const strength = deriveSentimentStrength({ sentiment_strength: "UNKNOWN", sentiment_score: 0.9 });
  assert.equal(strength, "UNKNOWN");
});

test("deriveSentimentStrength never infers strength from wording — only score magnitude vs configured thresholds", () => {
  const thresholds = { veryStrongMin: 0.8, strongMin: 0.5, moderateMin: 0.2 };
  const strength = deriveSentimentStrength({ sentiment_strength: "UNKNOWN", sentiment_score: 0.85 }, { strengthThresholds: thresholds });
  assert.equal(strength, "VERY_STRONG");
});

test("deriveSentimentStrength classifies WEAK below the moderate threshold", () => {
  const thresholds = { veryStrongMin: 0.8, strongMin: 0.5, moderateMin: 0.2 };
  const strength = deriveSentimentStrength({ sentiment_strength: "UNKNOWN", sentiment_score: 0.05 }, { strengthThresholds: thresholds });
  assert.equal(strength, "WEAK");
});
