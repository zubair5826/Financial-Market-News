const test = require("node:test");
const assert = require("node:assert/strict");
const { determineFinalAssessment, FINAL_ASSESSMENTS } = require("./finalAssessment");

function s(bias) {
  return { bias };
}

test("determineFinalAssessment returns UNKNOWN when nothing was supplied at all", () => {
  const result = determineFinalAssessment({ specialistSummaries: [null, null, null, null], suppliedCount: 0, validCount: 0 });
  assert.equal(result.assessment, FINAL_ASSESSMENTS.UNKNOWN);
});

test("determineFinalAssessment returns NO_DECISION when reports were supplied but none were valid", () => {
  const result = determineFinalAssessment({ specialistSummaries: [null, null, null, null], suppliedCount: 4, validCount: 0 });
  assert.equal(result.assessment, FINAL_ASSESSMENTS.NO_DECISION);
});

test("determineFinalAssessment returns INSUFFICIENT_DATA with fewer than 2 tagged specialists", () => {
  const result = determineFinalAssessment({ specialistSummaries: [s("BULLISH"), null, null, null], suppliedCount: 1, validCount: 1 });
  assert.equal(result.assessment, FINAL_ASSESSMENTS.INSUFFICIENT_DATA);
});

test("determineFinalAssessment returns CONFLICTING_EVIDENCE when specialists directly oppose", () => {
  const result = determineFinalAssessment({
    specialistSummaries: [s("BULLISH"), s("BEARISH"), null, null],
    suppliedCount: 2,
    validCount: 2,
  });
  assert.equal(result.assessment, FINAL_ASSESSMENTS.CONFLICTING_EVIDENCE);
});

test("determineFinalAssessment returns MIXED when no opposition but a specialist's own bias is MIXED", () => {
  const result = determineFinalAssessment({
    specialistSummaries: [s("NEUTRAL"), s("MIXED"), null, null],
    suppliedCount: 2,
    validCount: 2,
  });
  assert.equal(result.assessment, FINAL_ASSESSMENTS.MIXED);
});

test("determineFinalAssessment returns NEUTRAL when all tagged specialists are NEUTRAL", () => {
  const result = determineFinalAssessment({
    specialistSummaries: [s("NEUTRAL"), s("NEUTRAL"), null, null],
    suppliedCount: 2,
    validCount: 2,
  });
  assert.equal(result.assessment, FINAL_ASSESSMENTS.NEUTRAL);
});

test("determineFinalAssessment returns BULLISH/BEARISH by majority", () => {
  const bullish = determineFinalAssessment({
    specialistSummaries: [s("BULLISH"), s("BULLISH"), s("NEUTRAL"), null],
    suppliedCount: 3,
    validCount: 3,
  });
  assert.equal(bullish.assessment, FINAL_ASSESSMENTS.BULLISH);

  const bearish = determineFinalAssessment({
    specialistSummaries: [s("BEARISH"), s("BEARISH"), s("NEUTRAL"), null],
    suppliedCount: 3,
    validCount: 3,
  });
  assert.equal(bearish.assessment, FINAL_ASSESSMENTS.BEARISH);
});

test("determineFinalAssessment never counts Trade Setup's own direction as a fifth vote (only 4 specialists accepted)", () => {
  // This is a structural guarantee, not a runtime check: the function
  // signature only accepts specialistSummaries (4), with Trade Setup
  // and Risk handled entirely separately in index.js/decisionStatus.js.
  const result = determineFinalAssessment({ specialistSummaries: [s("BULLISH"), s("BULLISH"), s("BULLISH"), s("BULLISH")], suppliedCount: 4, validCount: 4 });
  assert.equal(result.assessment, FINAL_ASSESSMENTS.BULLISH);
  assert.equal(result.tagged, 4);
});
