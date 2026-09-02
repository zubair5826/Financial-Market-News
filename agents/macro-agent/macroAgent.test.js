// Integration-level tests for the Macro Agent pipeline, numbered to
// match the 24 required test scenarios from the Step 6 spec.

const test = require("node:test");
const assert = require("node:assert/strict");
const macroAgent = require("./index");
const { processMacroData, runMacroAgent, MACRO_AGENT_STATUS } = macroAgent;

const THRESHOLDS = { freshMaxMs: 60_000, agingMaxMs: 600_000 }; // test-only values

function baseRecord(overrides = {}) {
  return {
    indicator: "Consumer Price Index (CPI)",
    indicator_code: "CPI",
    country: "US",
    region: "North America",
    currency: "USD",
    category: "INFLATION",
    actual_value: 3.2,
    previous_value: 3.0,
    expected_value: 3.0,
    unit: "%",
    period: "2026-07",
    release_timestamp: new Date().toISOString(),
    source: "internal-test-source",
    source_type: "official-release",
    classification: "FACT",
    ...overrides,
  };
}

// 1. Valid macro record accepted.
test("1. a valid macro record is accepted and marked SUCCESS", () => {
  const result = processMacroData([baseRecord()], { freshnessThresholds: THRESHOLDS, requestedAsset: "USD" });
  assert.equal(result.agent_status, MACRO_AGENT_STATUS.SUCCESS);
  assert.equal(result.validated_records.length, 1);
});

// 2. Missing indicator rejected.
test("2. a record missing its indicator is rejected, not silently accepted", () => {
  const record = baseRecord();
  delete record.indicator;
  const result = processMacroData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records.length, 0);
  assert.equal(result.rejected_records.length, 1);
  assert.equal(result.agent_status, MACRO_AGENT_STATUS.FAILED);
});

// 3. Missing actual value handled safely.
test("3. a record with no actual_value is still processed, not rejected", () => {
  const record = baseRecord();
  delete record.actual_value;
  const result = processMacroData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records.length, 1);
  assert.equal(result.validated_records[0].surprise_direction, "UNKNOWN");
});

// 4. Actual and expected values produce a valid surprise calculation.
test("4. actual + expected values produce a real surprise calculation", () => {
  const result = processMacroData([baseRecord()], { freshnessThresholds: THRESHOLDS });
  const record = result.validated_records[0];
  assert.equal(record.surprise_direction, "ABOVE_EXPECTATION");
  assert.ok(typeof record.surprise_value === "number" && record.surprise_value > 0);
});

// 5. Missing expected value prevents surprise calculation.
test("5. a record with no expected_value cannot produce a surprise", () => {
  const record = baseRecord();
  delete record.expected_value;
  const result = processMacroData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].surprise_direction, "UNKNOWN");
});

// 6. ABOVE_EXPECTATION identified correctly.
test("6. actual above expected is identified as ABOVE_EXPECTATION", () => {
  const record = baseRecord({ actual_value: 4.0, expected_value: 3.0 });
  const result = processMacroData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].surprise_direction, "ABOVE_EXPECTATION");
});

// 7. BELOW_EXPECTATION identified correctly.
test("7. actual below expected is identified as BELOW_EXPECTATION", () => {
  const record = baseRecord({ actual_value: 2.0, expected_value: 3.0 });
  const result = processMacroData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].surprise_direction, "BELOW_EXPECTATION");
});

// 8. IN_LINE identified correctly.
test("8. an exact actual/expected match is identified as IN_LINE", () => {
  const record = baseRecord({ actual_value: 3.0, expected_value: 3.0 });
  const result = processMacroData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].surprise_direction, "IN_LINE");
});

// 9. Forecast remains FORECAST.
test("9. a FORECAST record's classification is never changed", () => {
  const result = processMacroData([baseRecord({ classification: "FORECAST" })], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].classification, "FORECAST");
});

// 10. Market expectation remains MARKET_EXPECTATION.
test("10. a MARKET_EXPECTATION record's classification is never changed", () => {
  const result = processMacroData([baseRecord({ classification: "MARKET_EXPECTATION" })], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].classification, "MARKET_EXPECTATION");
});

// 11. Scenario remains SCENARIO.
test("11. a SCENARIO record's classification is never changed", () => {
  const result = processMacroData([baseRecord({ classification: "SCENARIO" })], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].classification, "SCENARIO");
});

// 12. Forecast cannot become FACT.
test("12. classification is never upgraded toward FACT for any non-FACT input", () => {
  for (const classification of ["FORECAST", "MARKET_EXPECTATION", "SCENARIO", "UNVERIFIED"]) {
    const result = processMacroData([baseRecord({ classification })], { freshnessThresholds: THRESHOLDS });
    assert.notEqual(result.validated_records[0].classification, "FACT");
  }
});

// 13. Conflicting macro sources detected.
test("13. two disagreeing sources for the same indicator/country/period are flagged CONFLICTING, both preserved", () => {
  const a = baseRecord({ source: "source-A", actual_value: 3.2 });
  const b = baseRecord({ source: "source-B", actual_value: 3.8 });
  const result = processMacroData([a, b], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.agent_status, MACRO_AGENT_STATUS.CONFLICTING);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.validated_records.length, 2);
});

// 14. Missing timestamp becomes UNKNOWN freshness.
test("14. a record with no release_timestamp gets freshness_status UNKNOWN, not a guess", () => {
  const record = baseRecord();
  delete record.release_timestamp;
  const result = processMacroData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].freshness_status, "UNKNOWN");
});

// 15. Stale macro data handled correctly when thresholds are supplied.
test("15. data older than the configured aging threshold is marked STALE", () => {
  const oldTimestamp = new Date(Date.now() - 10_000_000).toISOString();
  const record = baseRecord({ release_timestamp: oldTimestamp });
  const result = processMacroData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].freshness_status, "STALE");
  assert.ok(result.warnings.some((w) => typeof w === "object" && w.code === "STALE_DATA"));
});

// 16. Upcoming scheduled event handled correctly.
test("16. an upcoming scheduled event is validated and preserved", () => {
  const futureTime = new Date(Date.now() + 86_400_000).toISOString();
  const result = processMacroData([], {
    upcomingEvents: [{ event: "CPI Release", scheduled_time: futureTime, country: "US", source: "calendar-test" }],
  });
  assert.equal(result.upcoming_events.length, 1);
  assert.equal(result.upcoming_events[0].event, "CPI Release");
  assert.equal(result.upcoming_events[0].scheduled_time, futureTime);
});

// 17. Missing event time is UNKNOWN.
test("17. an upcoming event with no scheduled_time keeps it as UNKNOWN, never invented", () => {
  const result = processMacroData([], { upcomingEvents: [{ event: "CPI Release" }] });
  assert.equal(result.upcoming_events[0].scheduled_time, "UNKNOWN");
});

// 18. Central-bank policy direction is separated from trading recommendation.
test("18. central bank policy_direction is reported without any trading recommendation field", () => {
  const { result, report } = runMacroAgent([], {
    centralBankEvents: [{ central_bank: "Federal Reserve", policy_direction: "HAWKISH" }],
  });
  assert.equal(result.central_bank_assessment.events[0].policy_direction, "HAWKISH");
  assert.equal("recommendation_type" in report, false);
});

// 19. Macro bias is separated from BUY/SELL.
test("19. macro_bias is an evidence label, not a trading instruction", () => {
  const { report } = runMacroAgent([baseRecord({ impact_direction: "POSITIVE" })], {
    freshnessThresholds: THRESHOLDS,
    requestedAsset: "USD",
  });
  assert.ok(["BULLISH", "BEARISH", "MIXED", "NEUTRAL", "UNKNOWN"].includes(report.macro_bias));
  assert.equal("recommendation_type" in report, false);
});

// 20. Missing macro data returns MACRO DATA UNAVAILABLE.
test("20. no input data at all returns UNAVAILABLE with a MACRO DATA UNAVAILABLE warning", () => {
  const result = processMacroData([]);
  assert.equal(result.agent_status, MACRO_AGENT_STATUS.UNAVAILABLE);
  assert.ok(result.warnings.some((w) => w.includes("MACRO DATA UNAVAILABLE")));
});

// 21. No fabricated economic values.
test("21. a record with no actual_value keeps it as the UNKNOWN sentinel, never a guessed number", () => {
  const record = baseRecord();
  delete record.actual_value;
  const result = processMacroData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].actual_value, "UNKNOWN");
});

// 22. No fabricated sources.
test("22. a record with no source keeps it as the UNKNOWN sentinel, never a guessed name", () => {
  const record = baseRecord();
  delete record.source;
  const result = processMacroData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].source, "UNKNOWN");
  assert.equal(result.validated_records[0].verification_status, "UNVERIFIED");
});

// 23. No fabricated dates.
test("23. a record with no release_timestamp keeps it as the UNKNOWN sentinel, never a guessed date", () => {
  const record = baseRecord();
  delete record.release_timestamp;
  const result = processMacroData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].release_timestamp, "UNKNOWN");
});

// 24. Macro Agent does not claim live data access without a provider.
test("24. the module exposes no live-fetch / external-access capability to claim", () => {
  const exportedNames = Object.keys(macroAgent).sort();
  assert.deepEqual(exportedNames, ["MACRO_AGENT_STATUS", "processMacroData", "runMacroAgent"].sort());
});

test("a provider failSafe()-shaped error passed as input is handled, not crashed on", () => {
  const providerError = { ok: false, code: "API_UNAVAILABLE", message: "no provider connected", details: {} };
  const result = processMacroData(providerError);
  assert.equal(result.agent_status, MACRO_AGENT_STATUS.UNAVAILABLE);
});

test("a non-array top-level input is rejected as FAILED", () => {
  const result = processMacroData("not-an-array");
  assert.equal(result.agent_status, MACRO_AGENT_STATUS.FAILED);
});

// --- Deduplication of identical report warnings/uncertainties ---
// (root cause: every FRED-style observation independently contributes
// its own copy of a freshness/verification/STALE message that carries
// no per-record detail — see agents/macro-agent/report.js/core/dedupe.js)

// Distinct `period` per record throughout, so records that would
// otherwise be indicator/country-identical are never grouped together
// by conflicts.js's own indicator_code::country::period key — conflict
// detection is not what these tests are about.
function missingTimestampRecord(overrides = {}) {
  const record = baseRecord(overrides);
  delete record.release_timestamp;
  return record;
}

function staleRecordFor(overrides = {}) {
  const oldTimestamp = new Date(Date.now() - 10_000_000).toISOString();
  return baseRecord({ release_timestamp: oldTimestamp, ...overrides });
}

test("25a. identical freshness-UNKNOWN uncertainties from multiple records with the same indicator/country/source are emitted only once", () => {
  const records = [
    missingTimestampRecord({ period: "2026-01" }),
    missingTimestampRecord({ period: "2026-02" }),
    missingTimestampRecord({ period: "2026-03" }),
  ];
  const { result, report } = runMacroAgent(records, { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records.length, 3); // underlying records unchanged
  const matching = report.uncertainties.filter((u) => u.includes("freshness UNKNOWN"));
  assert.equal(matching.length, 1);
});

test("25b. a genuinely different uncertainty (different indicator) is preserved alongside the deduplicated one", () => {
  const records = [
    missingTimestampRecord({ period: "2026-01" }),
    missingTimestampRecord({ period: "2026-02" }),
    missingTimestampRecord({ period: "2026-03", indicator: "Producer Price Index (PPI)", indicator_code: "PPI" }),
  ];
  const { report } = runMacroAgent(records, { freshnessThresholds: THRESHOLDS });
  const cpiMatches = report.uncertainties.filter((u) => u.includes("Consumer Price Index (CPI)") && u.includes("freshness UNKNOWN"));
  const ppiMatches = report.uncertainties.filter((u) => u.includes("Producer Price Index (PPI)") && u.includes("freshness UNKNOWN"));
  assert.equal(cpiMatches.length, 1);
  assert.equal(ppiMatches.length, 1);
});

test("25c. first-occurrence order is preserved after deduplication", () => {
  const records = [
    missingTimestampRecord({ period: "2026-01", indicator: "Alpha Indicator", indicator_code: "ALPHA" }),
    missingTimestampRecord({ period: "2026-02", indicator: "Beta Indicator", indicator_code: "BETA" }),
    missingTimestampRecord({ period: "2026-03", indicator: "Alpha Indicator", indicator_code: "ALPHA" }), // duplicate of the first
  ];
  const { report } = runMacroAgent(records, { freshnessThresholds: THRESHOLDS });
  const freshnessUncertainties = report.uncertainties.filter((u) => u.includes("freshness UNKNOWN"));
  assert.equal(freshnessUncertainties.length, 2);
  assert.ok(freshnessUncertainties[0].includes("Alpha Indicator"));
  assert.ok(freshnessUncertainties[1].includes("Beta Indicator"));
});

test("25d. identical object-shaped STALE_DATA warnings (failSafe results) from multiple stale records are deduplicated on the report, but not on the raw result", () => {
  const records = [
    staleRecordFor({ period: "2026-01" }),
    staleRecordFor({ period: "2026-02" }),
    staleRecordFor({ period: "2026-03" }),
  ];
  const { result, report } = runMacroAgent(records, { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records.length, 3); // underlying records unchanged

  const reportStaleWarnings = report.warnings.filter((w) => typeof w === "object" && w.code === "STALE_DATA");
  assert.equal(reportStaleWarnings.length, 1);

  // The raw result (what confidence, logging, and every other decision
  // actually reads) is untouched — every occurrence is still present.
  const rawStaleWarnings = result.warnings.filter((w) => typeof w === "object" && w.code === "STALE_DATA");
  assert.equal(rawStaleWarnings.length, 3);
});

test("25e. deduplication does not change agent_status, confidence, or any validated record", () => {
  const records = [
    missingTimestampRecord({ period: "2026-01" }),
    missingTimestampRecord({ period: "2026-02" }),
    missingTimestampRecord({ period: "2026-03" }),
  ];
  const { result, report } = runMacroAgent(records, { freshnessThresholds: THRESHOLDS });
  assert.equal(result.agent_status, MACRO_AGENT_STATUS.SUCCESS);
  assert.equal(report.confidence, "MEDIUM"); // driven by result.warnings.length > 0 (un-deduped) — unaffected by dedup
  assert.equal(result.validated_records.length, 3);
  assert.deepEqual(
    result.validated_records.map((r) => r.period),
    ["2026-01", "2026-02", "2026-03"]
  );
});
