const test = require("node:test");
const assert = require("node:assert/strict");
const { assessConfluence, scoreDomain } = require("./confluence");

test("scoreDomain contributes 0 for a missing domain", () => {
  assert.equal(scoreDomain(null, "BULLISH"), 0);
});

test("scoreDomain contributes 0 when the domain's bias opposes the overall direction", () => {
  assert.equal(scoreDomain({ bias: "BEARISH", confidence: "HIGH", conflicts: [] }, "BULLISH"), 0);
});

test("scoreDomain contributes full confidence weight when the domain agrees", () => {
  assert.equal(scoreDomain({ bias: "BULLISH", confidence: "HIGH", conflicts: [] }, "BULLISH"), 1);
});

test("scoreDomain halves the contribution when the domain has unresolved internal conflicts", () => {
  assert.equal(scoreDomain({ bias: "BULLISH", confidence: "HIGH", conflicts: [{ x: 1 }] }, "BULLISH"), 0.5);
});

test("assessConfluence sums all four domain scores and computes a ratio out of 4, never just counting agents", () => {
  const evidenceSet = {
    newsEvidence: { bias: "BULLISH", confidence: "HIGH", conflicts: [] },
    macroEvidence: { bias: "BULLISH", confidence: "LOW", conflicts: [] },
    technicalEvidence: null,
    sentimentEvidence: { bias: "BEARISH", confidence: "HIGH", conflicts: [] },
  };
  const result = assessConfluence(evidenceSet, "BULLISH");
  // NEWS: 1 (HIGH, agrees), MACRO: 0.33 (LOW, agrees), TECHNICAL: 0 (missing), SENTIMENT: 0 (opposes)
  assert.equal(result.domain_scores.NEWS, 1);
  assert.equal(result.domain_scores.MACRO, 0.33);
  assert.equal(result.domain_scores.TECHNICAL, 0);
  assert.equal(result.domain_scores.SENTIMENT, 0);
  // Epsilon comparison — floating-point sums of values like 0.33 are
  // not guaranteed to equal a literal like 1.33 exactly.
  assert.ok(Math.abs(result.confluence_score - 1.33) < 1e-9);
  assert.ok(Math.abs(result.confluence_ratio - 0.3325) < 1e-9);
});
