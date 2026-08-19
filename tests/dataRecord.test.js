const test = require("node:test");
const assert = require("node:assert/strict");
const { createDataRecord, validateDataRecord, DATA_RECORD_FIELDS } = require("../core/dataRecord");
const { UNKNOWN } = require("../core/constants");
const { FRESHNESS_STATES } = require("../core/freshness");

test("createDataRecord defaults every field to UNKNOWN — never invents a value", () => {
  const record = createDataRecord({ asset: "TEST", data_type: "price" });
  assert.equal(record.asset, "TEST");
  assert.equal(record.value, UNKNOWN);
  for (const field of DATA_RECORD_FIELDS) {
    assert.ok(field in record, `missing field ${field}`);
  }
});

test("validateDataRecord accepts a fully-specified valid record", () => {
  const record = createDataRecord({
    asset: "TEST",
    data_type: "price",
    value: 100,
    unit: "USD",
    source: "example-source",
    source_type: "exchange",
    timestamp: new Date().toISOString(),
    data_age: "0s",
    freshness_status: FRESHNESS_STATES.FRESH,
    verification_status: "VERIFIED_PRIMARY",
    confidence: "HIGH",
    classification: "FACT",
    notes: "test record",
  });
  const result = validateDataRecord(record);
  assert.equal(result.valid, true, result.errors.join(", "));
});

test("validateDataRecord flags a record missing required fields", () => {
  const result = validateDataRecord({ asset: "TEST" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test("validateDataRecord rejects FRESH status without a real timestamp", () => {
  const record = createDataRecord({ freshness_status: FRESHNESS_STATES.FRESH });
  const result = validateDataRecord(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("timestamp")));
});

test("validateDataRecord rejects an invalid classification value", () => {
  const record = createDataRecord({ classification: "TOTALLY_MADE_UP" });
  const result = validateDataRecord(record);
  assert.equal(result.valid, false);
});
