const test = require("node:test");
const assert = require("node:assert/strict");
const { createNewsRecord, validateNewsRecordStructure, NEWS_RECORD_FIELDS } = require("./newsRecord");
const { UNKNOWN } = require("../../core/constants");

test("createNewsRecord defaults every field to UNKNOWN — never invents content", () => {
  const record = createNewsRecord({ headline: "Test headline" });
  assert.equal(record.headline, "Test headline");
  assert.equal(record.source, UNKNOWN);
  for (const field of NEWS_RECORD_FIELDS) {
    assert.ok(field in record, `missing field ${field}`);
  }
});

test("validateNewsRecordStructure accepts a fully-specified valid record", () => {
  const record = createNewsRecord({
    headline: "Central bank holds rates steady",
    source: "test-source",
    classification: "FACT",
    verification_status: "VERIFIED_PRIMARY",
    freshness_status: "UNKNOWN",
    confidence: "HIGH",
    impact_direction: "NEUTRAL",
  });
  const result = validateNewsRecordStructure(record);
  assert.equal(result.valid, true, result.errors.join(", "));
});

test("validateNewsRecordStructure rejects an invalid classification", () => {
  const record = createNewsRecord({ classification: "NOT_REAL" });
  const result = validateNewsRecordStructure(record);
  assert.equal(result.valid, false);
});

test("validateNewsRecordStructure rejects an invalid impact_direction", () => {
  const record = createNewsRecord({ impact_direction: "SKYROCKETING" });
  const result = validateNewsRecordStructure(record);
  assert.equal(result.valid, false);
});

test("validateNewsRecordStructure rejects FRESH without a real publication_timestamp", () => {
  const record = createNewsRecord({ freshness_status: "FRESH" });
  const result = validateNewsRecordStructure(record);
  assert.equal(result.valid, false);
});
