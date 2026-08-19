const test = require("node:test");
const assert = require("node:assert/strict");
const { createMacroRecord, validateMacroRecordStructure, MACRO_RECORD_FIELDS } = require("./macroRecord");
const { UNKNOWN } = require("../../core/constants");

test("createMacroRecord defaults every field to UNKNOWN — never invents content", () => {
  const record = createMacroRecord({ indicator: "CPI" });
  assert.equal(record.indicator, "CPI");
  assert.equal(record.actual_value, UNKNOWN);
  for (const field of MACRO_RECORD_FIELDS) {
    assert.ok(field in record, `missing field ${field}`);
  }
});

test("validateMacroRecordStructure accepts a fully-specified valid record", () => {
  const record = createMacroRecord({
    indicator: "CPI",
    country: "US",
    category: "INFLATION",
    classification: "FACT",
    verification_status: "VERIFIED_PRIMARY",
    freshness_status: "UNKNOWN",
    confidence: "HIGH",
    surprise_direction: "UNKNOWN",
    market_relevance: "DIRECT",
    impact_direction: "NEUTRAL",
  });
  const result = validateMacroRecordStructure(record);
  assert.equal(result.valid, true, result.errors.join(", "));
});

test("validateMacroRecordStructure rejects an invalid category", () => {
  const record = createMacroRecord({ category: "NOT_A_REAL_CATEGORY" });
  const result = validateMacroRecordStructure(record);
  assert.equal(result.valid, false);
});

test("validateMacroRecordStructure rejects FRESH without a real release_timestamp", () => {
  const record = createMacroRecord({ freshness_status: "FRESH" });
  const result = validateMacroRecordStructure(record);
  assert.equal(result.valid, false);
});
