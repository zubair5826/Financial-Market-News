const test = require("node:test");
const assert = require("node:assert/strict");
const { createSentimentRecord, validateSentimentRecordStructure, SENTIMENT_RECORD_FIELDS } = require("./sentimentRecord");
const { UNKNOWN } = require("../../core/constants");

test("createSentimentRecord defaults every field to UNKNOWN — never invents content", () => {
  const record = createSentimentRecord({ asset: "BTC" });
  assert.equal(record.asset, "BTC");
  assert.equal(record.sentiment_score, UNKNOWN);
  for (const field of SENTIMENT_RECORD_FIELDS) {
    assert.ok(field in record, `missing field ${field}`);
  }
});

test("validateSentimentRecordStructure accepts a fully-specified valid record", () => {
  const record = createSentimentRecord({
    asset: "BTC",
    sentiment: "BULLISH",
    source_type: "SOCIAL_MEDIA",
    sentiment_strength: "MODERATE",
    classification: "FACT",
    verification_status: "VERIFIED_PRIMARY",
    freshness_status: "UNKNOWN",
    confidence: "HIGH",
  });
  const result = validateSentimentRecordStructure(record);
  assert.equal(result.valid, true, result.errors.join(", "));
});

test("validateSentimentRecordStructure rejects an invalid sentiment value", () => {
  const record = createSentimentRecord({ sentiment: "SUPER_BULLISH" });
  const result = validateSentimentRecordStructure(record);
  assert.equal(result.valid, false);
});

test("validateSentimentRecordStructure rejects a non-numeric sentiment_score", () => {
  const record = createSentimentRecord({ sentiment_score: "very positive" });
  const result = validateSentimentRecordStructure(record);
  assert.equal(result.valid, false);
});

test("validateSentimentRecordStructure rejects FRESH without a real timestamp", () => {
  const record = createSentimentRecord({ freshness_status: "FRESH" });
  const result = validateSentimentRecordStructure(record);
  assert.equal(result.valid, false);
});
