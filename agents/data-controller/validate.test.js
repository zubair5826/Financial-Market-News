const test = require("node:test");
const assert = require("node:assert/strict");
const { validateControllerInput } = require("./validate");
const { normalizeRecord } = require("./normalize");

test("validateControllerInput accepts a record with all required fields present", () => {
  const record = normalizeRecord({
    asset: "BTC",
    data_type: "price",
    value: 50000,
    source: "internal-test",
    classification: "FACT",
  });
  const result = validateControllerInput(record);
  assert.equal(result.valid, true, result.errors.join(", "));
});

test("validateControllerInput rejects a record missing a required field", () => {
  const record = normalizeRecord({ asset: "BTC", data_type: "price" });
  const result = validateControllerInput(record);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("DATA UNAVAILABLE")));
});

test("validateControllerInput does not require a timestamp (freshness handles that separately)", () => {
  const record = normalizeRecord({
    asset: "BTC",
    data_type: "price",
    value: 50000,
    source: "internal-test",
    classification: "FACT",
  });
  const result = validateControllerInput(record);
  assert.equal(result.valid, true, result.errors.join(", "));
});
