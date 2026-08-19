const test = require("node:test");
const assert = require("node:assert/strict");
const { assessImportance, IMPORTANCE_LEVELS } = require("./importance");
const { RELEVANCE_LEVELS } = require("./relevance");

test("assessImportance returns UNKNOWN when relevance is UNKNOWN", () => {
  const level = assessImportance({ verification_status: "VERIFIED_PRIMARY" }, RELEVANCE_LEVELS.UNKNOWN);
  assert.equal(level, IMPORTANCE_LEVELS.UNKNOWN);
});

test("assessImportance returns CRITICAL for DIRECT + verified + FACT", () => {
  const level = assessImportance(
    { verification_status: "VERIFIED_PRIMARY", classification: "FACT", freshness_status: "FRESH" },
    RELEVANCE_LEVELS.DIRECT
  );
  assert.equal(level, IMPORTANCE_LEVELS.CRITICAL);
});

test("assessImportance downgrades a stale CRITICAL-tier item to MEDIUM", () => {
  const level = assessImportance(
    { verification_status: "VERIFIED_PRIMARY", classification: "FACT", freshness_status: "STALE" },
    RELEVANCE_LEVELS.DIRECT
  );
  assert.equal(level, IMPORTANCE_LEVELS.MEDIUM);
});

test("assessImportance returns LOW for LOW_RELEVANCE regardless of verification", () => {
  const level = assessImportance({ verification_status: "VERIFIED_PRIMARY" }, RELEVANCE_LEVELS.LOW_RELEVANCE);
  assert.equal(level, IMPORTANCE_LEVELS.LOW);
});

test("assessImportance never derives a level from headline wording (no text is inspected)", () => {
  const sensational = { headline: "MARKET SHOCK!!! MASSIVE CRASH INCOMING", verification_status: "UNVERIFIED", classification: "UNVERIFIED" };
  const level = assessImportance(sensational, RELEVANCE_LEVELS.DIRECT);
  assert.equal(level, IMPORTANCE_LEVELS.LOW);
});
