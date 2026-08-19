const test = require("node:test");
const assert = require("node:assert/strict");
const { assessSetupQuality, QUALITY_LEVELS } = require("./quality");

test("assessSetupQuality returns UNKNOWN with fewer than 2 tagged domains", () => {
  const quality = assessSetupQuality({ taggedDomains: 1, hasOpposingEvidence: false, confluenceRatio: 1 });
  assert.equal(quality, QUALITY_LEVELS.UNKNOWN);
});

test("assessSetupQuality caps quality at LOW when there is opposing evidence, regardless of confluence ratio", () => {
  const quality = assessSetupQuality({ taggedDomains: 4, hasOpposingEvidence: true, confluenceRatio: 0.95 });
  assert.equal(quality, QUALITY_LEVELS.LOW);
});

test("assessSetupQuality returns HIGH at or above the default high threshold", () => {
  const quality = assessSetupQuality({ taggedDomains: 4, hasOpposingEvidence: false, confluenceRatio: 0.8 });
  assert.equal(quality, QUALITY_LEVELS.HIGH);
});

test("assessSetupQuality returns MEDIUM between the medium and high thresholds", () => {
  const quality = assessSetupQuality({ taggedDomains: 3, hasOpposingEvidence: false, confluenceRatio: 0.5 });
  assert.equal(quality, QUALITY_LEVELS.MEDIUM);
});

test("assessSetupQuality returns LOW below the medium threshold", () => {
  const quality = assessSetupQuality({ taggedDomains: 2, hasOpposingEvidence: false, confluenceRatio: 0.1 });
  assert.equal(quality, QUALITY_LEVELS.LOW);
});

test("assessSetupQuality respects caller-configured thresholds", () => {
  const quality = assessSetupQuality(
    { taggedDomains: 2, hasOpposingEvidence: false, confluenceRatio: 0.5 },
    { qualityThresholds: { highMin: 0.4, mediumMin: 0.2 } }
  );
  assert.equal(quality, QUALITY_LEVELS.HIGH);
});

test("HIGH quality is documented as evidence strength only, never a profitability guarantee", () => {
  // Structural check: the module exports no field or function implying
  // a profitability/outcome guarantee.
  const moduleExports = require("./quality");
  const keys = Object.keys(moduleExports);
  assert.ok(!keys.some((k) => /profit|guarantee/i.test(k)));
});
