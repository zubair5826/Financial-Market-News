// Integration-level tests for the Data Controller pipeline, numbered to
// match the 12 required test scenarios from the Step 4 spec.

const test = require("node:test");
const assert = require("node:assert/strict");
const { processMarketData, runDataController, CONTROLLER_STATUS } = require("./index");
const { NOT_AVAILABLE } = require("../../core/constants");
const { FRESHNESS_STATES } = require("../../core/freshness");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");

const THRESHOLDS = { freshMaxMs: 60_000, agingMaxMs: 600_000 }; // 1 min fresh, 10 min aging — test-only values

function baseRecord(overrides = {}) {
  return {
    asset: "BTC",
    data_type: "price",
    value: 50000,
    unit: "USD",
    source: "internal-test-source",
    source_type: "test",
    timestamp: new Date().toISOString(),
    classification: "FACT",
    ...overrides,
  };
}

// 1. Valid data accepted.
test("1. valid data is accepted and marked SUCCESS", () => {
  const result = processMarketData([baseRecord()], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.controller_status, CONTROLLER_STATUS.SUCCESS);
  assert.equal(result.validated_data.length, 1);
  assert.equal(result.rejected_data.length, 0);
});

// 2. Missing required field rejected.
test("2. a record missing a required field is rejected, not silently accepted", () => {
  const record = baseRecord();
  delete record.source;
  const result = processMarketData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_data.length, 0);
  assert.equal(result.rejected_data.length, 1);
  assert.equal(result.controller_status, CONTROLLER_STATUS.FAILED);
});

// 3. Invalid classification rejected.
test("3. an invalid classification value is rejected", () => {
  const record = baseRecord({ classification: "TOTALLY_MADE_UP" });
  const result = processMarketData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_data.length, 0);
  assert.equal(result.rejected_data.length, 1);
});

// 4. Missing timestamp produces UNKNOWN freshness.
test("4. a record with no timestamp is still accepted, but freshness is UNKNOWN", () => {
  const record = baseRecord();
  delete record.timestamp;
  const result = processMarketData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_data.length, 1);
  assert.equal(result.validated_data[0].freshness_status, FRESHNESS_STATES.UNKNOWN);
});

// 5. Stale data is identified correctly when thresholds are supplied.
test("5. data older than the configured aging threshold is marked STALE", () => {
  const oldTimestamp = new Date(Date.now() - 10_000_000).toISOString();
  const record = baseRecord({ timestamp: oldTimestamp });
  const result = processMarketData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_data[0].freshness_status, FRESHNESS_STATES.STALE);
  assert.ok(result.warnings.some((w) => typeof w === "object" && w.code === "STALE_DATA"));
});

// 6. Conflicting sources are preserved and flagged.
test("6. two sources disagreeing on the same asset/data_type are flagged CONFLICTING, both preserved", () => {
  const a = baseRecord({ source: "source-A", value: 50000 });
  const b = baseRecord({ source: "source-B", value: 55000 });
  const result = processMarketData([a, b], { freshnessThresholds: THRESHOLDS });

  assert.equal(result.controller_status, CONTROLLER_STATUS.CONFLICTING);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.validated_data.length, 2);
  assert.ok(result.validated_data.every((r) => r.verification_status === SOURCE_VERIFICATION_STATES.CONFLICTING));
});

// 7. Unverified source remains UNVERIFIED.
test("7. a single, uncorroborated source remains UNVERIFIED (not upgraded, not hidden)", () => {
  const record = baseRecord();
  const result = processMarketData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_data[0].verification_status, SOURCE_VERIFICATION_STATES.UNVERIFIED);
});

// 8. Forecast cannot become FACT.
test("8. a FORECAST record's classification is never changed to FACT", () => {
  const record = baseRecord({ classification: "FORECAST" });
  const result = processMarketData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_data[0].classification, "FORECAST");
});

// 9. Scenario cannot become FACT.
test("9. a SCENARIO record's classification is never changed to FACT", () => {
  const record = baseRecord({ classification: "SCENARIO" });
  const result = processMarketData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_data[0].classification, "SCENARIO");
});

// 10. Missing data never becomes fabricated data.
test("10. a record with no value is rejected outright, never filled in with a guessed value", () => {
  const record = baseRecord();
  delete record.value;
  const result = processMarketData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_data.length, 0);
  assert.equal(result.rejected_data.length, 1);
  assert.equal(result.rejected_data[0].record.value, "UNKNOWN");
});

// 11. Invalid provider data is rejected.
test("11. a malformed entry from a batch (not an object) is rejected without crashing the batch", () => {
  const result = processMarketData(["not-a-record", baseRecord()], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.rejected_data.length, 1);
  assert.equal(result.validated_data.length, 1);
  assert.equal(result.controller_status, CONTROLLER_STATUS.PARTIAL);
});

test("11b. a non-array top-level input is rejected as FAILED, not processed", () => {
  const result = processMarketData("not-an-array");
  assert.equal(result.controller_status, CONTROLLER_STATUS.FAILED);
});

// 12. Data Controller does not produce trading recommendations.
test("12. the Data Controller's agent report never carries a trading recommendation", () => {
  const { report } = runDataController([baseRecord()], { freshnessThresholds: THRESHOLDS });
  assert.equal(report.recommendation_type, NOT_AVAILABLE);
  assert.equal(report.bias, "NOT_APPLICABLE");
  assert.equal(report.agent_name, "data-controller");
});

test("empty input array produces UNAVAILABLE, not a fabricated empty success", () => {
  const result = processMarketData([]);
  assert.equal(result.controller_status, CONTROLLER_STATUS.UNAVAILABLE);
});

test("a provider failSafe()-shaped error passed as input is handled, not crashed on", () => {
  const providerError = { ok: false, code: "API_UNAVAILABLE", message: "no provider connected", details: {} };
  const result = processMarketData(providerError);
  assert.equal(result.controller_status, CONTROLLER_STATUS.UNAVAILABLE);
  assert.equal(result.errors.length, 1);
});
