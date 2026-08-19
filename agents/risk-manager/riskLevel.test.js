const test = require("node:test");
const assert = require("node:assert/strict");
const { assessRiskLevel, assessRiskDecision, RISK_LEVELS, RISK_DECISIONS } = require("./riskLevel");

test("assessRiskLevel returns UNKNOWN with no setup_status", () => {
  assert.equal(assessRiskLevel({ activeCategoryCount: 0, setupStatus: null, setupQuality: "HIGH" }), RISK_LEVELS.UNKNOWN);
});

test("assessRiskLevel returns UNKNOWN when the setup itself is DATA_UNAVAILABLE", () => {
  assert.equal(assessRiskLevel({ activeCategoryCount: 0, setupStatus: "DATA_UNAVAILABLE", setupQuality: "UNKNOWN" }), RISK_LEVELS.UNKNOWN);
});

test("assessRiskLevel scales with the number of active categories", () => {
  assert.equal(assessRiskLevel({ activeCategoryCount: 0, setupStatus: "SETUP_PRESENT", setupQuality: "HIGH" }), RISK_LEVELS.LOW);
  assert.equal(assessRiskLevel({ activeCategoryCount: 2, setupStatus: "SETUP_PRESENT", setupQuality: "HIGH" }), RISK_LEVELS.MODERATE);
  assert.equal(assessRiskLevel({ activeCategoryCount: 3, setupStatus: "SETUP_PRESENT", setupQuality: "HIGH" }), RISK_LEVELS.HIGH);
  assert.equal(assessRiskLevel({ activeCategoryCount: 5, setupStatus: "SETUP_PRESENT", setupQuality: "HIGH" }), RISK_LEVELS.CRITICAL);
});

test("assessRiskLevel floors at HIGH for CONFLICTING_EVIDENCE regardless of category count", () => {
  const level = assessRiskLevel({ activeCategoryCount: 0, setupStatus: "CONFLICTING_EVIDENCE", setupQuality: "HIGH" });
  assert.equal(level, RISK_LEVELS.HIGH);
});

test("assessRiskLevel never lowers a level the category count already earned", () => {
  // 5 categories -> CRITICAL; CONFLICTING_EVIDENCE floor (HIGH) must not downgrade it.
  const level = assessRiskLevel({ activeCategoryCount: 5, setupStatus: "CONFLICTING_EVIDENCE", setupQuality: "HIGH" });
  assert.equal(level, RISK_LEVELS.CRITICAL);
});

test("assessRiskDecision is never an execution decision — it maps only to review/acceptable/too-high states", () => {
  assert.equal(assessRiskDecision(RISK_LEVELS.LOW, "SETUP_PRESENT"), RISK_DECISIONS.RISK_ACCEPTABLE);
  assert.equal(assessRiskDecision(RISK_LEVELS.MODERATE, "SETUP_PRESENT"), RISK_DECISIONS.RISK_REQUIRES_REVIEW);
  assert.equal(assessRiskDecision(RISK_LEVELS.HIGH, "SETUP_PRESENT"), RISK_DECISIONS.RISK_REQUIRES_REVIEW);
  assert.equal(assessRiskDecision(RISK_LEVELS.CRITICAL, "SETUP_PRESENT"), RISK_DECISIONS.RISK_TOO_HIGH);
});

test("assessRiskDecision returns INSUFFICIENT_DATA whenever the underlying setup lacked enough data, regardless of risk_level", () => {
  assert.equal(assessRiskDecision(RISK_LEVELS.LOW, "INSUFFICIENT_DATA"), RISK_DECISIONS.INSUFFICIENT_DATA);
  assert.equal(assessRiskDecision(RISK_LEVELS.CRITICAL, "DATA_UNAVAILABLE"), RISK_DECISIONS.INSUFFICIENT_DATA);
});
