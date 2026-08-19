const test = require("node:test");
const assert = require("node:assert/strict");
const { assessImportance, IMPORTANCE_LEVELS } = require("./importance");
const { RELEVANCE_LEVELS } = require("./relevance");

test("assessImportance returns UNKNOWN when relevance is UNKNOWN", () => {
  const level = assessImportance({ verification_status: "VERIFIED_PRIMARY" }, RELEVANCE_LEVELS.UNKNOWN);
  assert.equal(level, IMPORTANCE_LEVELS.UNKNOWN);
});

test("assessImportance returns CRITICAL for DIRECT + verified + high-sensitivity category", () => {
  const level = assessImportance(
    { verification_status: "VERIFIED_PRIMARY", category: "INFLATION", freshness_status: "FRESH" },
    RELEVANCE_LEVELS.DIRECT
  );
  assert.equal(level, IMPORTANCE_LEVELS.CRITICAL);
});

test("assessImportance downgrades a stale CRITICAL-tier record to MEDIUM", () => {
  const level = assessImportance(
    { verification_status: "VERIFIED_PRIMARY", category: "INFLATION", freshness_status: "STALE" },
    RELEVANCE_LEVELS.DIRECT
  );
  assert.equal(level, IMPORTANCE_LEVELS.MEDIUM);
});

test("assessImportance returns LOW for LOW relevance regardless of verification", () => {
  const level = assessImportance({ verification_status: "VERIFIED_PRIMARY" }, RELEVANCE_LEVELS.LOW);
  assert.equal(level, IMPORTANCE_LEVELS.LOW);
});

test("assessImportance never derives a level from the indicator's name/wording", () => {
  const record = { indicator: "SHOCKING RECORD-BREAKING CRISIS INDEX", verification_status: "UNVERIFIED" };
  const level = assessImportance(record, RELEVANCE_LEVELS.DIRECT);
  assert.equal(level, IMPORTANCE_LEVELS.LOW);
});
