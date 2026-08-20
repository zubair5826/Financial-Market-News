// Offline/synthetic tests for composeMacroData() — Step 21's composition
// layer. No test in this file ever contacts a real network endpoint or
// uses a real FRED credential; every test injects a synthetic mock
// adapter (a plain object with a fetchData() function), never the real
// FredMacroAdapter's default fetch path.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { composeMacroData } = require("./fredMacroComposer");

function macroRecord(overrides = {}) {
  return {
    indicator: "Synthetic Indicator",
    indicator_code: overrides.seriesId || "SYNTH",
    country: "UNKNOWN",
    region: "UNKNOWN",
    currency: "UNKNOWN",
    category: "UNKNOWN",
    actual_value: 1,
    previous_value: "UNKNOWN",
    expected_value: "UNKNOWN",
    forecast_value: "UNKNOWN",
    unit: "Percent",
    period: "2026-01-01",
    release_timestamp: "UNKNOWN",
    retrieved_timestamp: new Date().toISOString(),
    source: "Federal Reserve Bank of St. Louis (FRED)",
    source_type: "UNKNOWN",
    classification: "FACT",
    verification_status: "UNKNOWN",
    freshness_status: "UNKNOWN",
    confidence: "UNKNOWN",
    surprise_value: "UNKNOWN",
    surprise_direction: "UNKNOWN",
    market_relevance: "UNKNOWN",
    potential_market_impact: "UNKNOWN",
    impact_direction: "UNKNOWN",
    evidence: { fred_series_id: overrides.seriesId || "SYNTH", realtime_start: "UNKNOWN", realtime_end: "UNKNOWN", api_version: "v1", endpoint: "series/observations" },
    notes: "UNKNOWN",
    ...overrides,
  };
}

// responses: { [seriesId]: {ok:true,data:[...]} | {ok:false,code,message} }
function makeMockAdapter(responses, extra = {}) {
  const calls = [];
  return {
    calls,
    ...extra,
    fetchData: async (request) => {
      calls.push(request.seriesId);
      const response = responses[request.seriesId];
      if (!response) throw new Error(`no mock response configured for series '${request.seriesId}'`);
      return response;
    },
  };
}

// 1. Single series success.
test("1. single series success: macroData contains both records, one successful seriesResults entry, no warnings", async () => {
  const adapter = makeMockAdapter({
    A: { ok: true, data: [macroRecord({ seriesId: "A", period: "2026-01-01" }), macroRecord({ seriesId: "A", period: "2026-02-01" })] },
  });
  const result = await composeMacroData(["A"], adapter);
  assert.equal(result.macroData.length, 2);
  assert.equal(result.seriesResults.length, 1);
  assert.deepEqual(result.seriesResults[0], { seriesId: "A", ok: true, recordCount: 2 });
  assert.deepEqual(result.warnings, []);
});

// 2. Multiple series success.
test("2. multiple series success: all records aggregated, ordering deterministic", async () => {
  const adapter = makeMockAdapter({
    A: { ok: true, data: [macroRecord({ seriesId: "A" })] },
    B: { ok: true, data: [macroRecord({ seriesId: "B" }), macroRecord({ seriesId: "B" })] },
    C: { ok: true, data: [macroRecord({ seriesId: "C" })] },
  });
  const result = await composeMacroData(["A", "B", "C"], adapter);
  assert.equal(result.macroData.length, 4);
  assert.equal(result.seriesResults.length, 3);
  assert.deepEqual(result.seriesResults.map((r) => r.seriesId), ["A", "B", "C"]);
  assert.ok(result.seriesResults.every((r) => r.ok === true));
});

// 3. Duplicate series IDs.
test("3. duplicate series IDs: fetched exactly once each, no duplicate records", async () => {
  const adapter = makeMockAdapter({
    A: { ok: true, data: [macroRecord({ seriesId: "A" })] },
    B: { ok: true, data: [macroRecord({ seriesId: "B" })] },
  });
  const result = await composeMacroData(["A", "A", "B"], adapter);
  assert.equal(adapter.calls.length, 2);
  assert.equal(adapter.calls.filter((id) => id === "A").length, 1);
  assert.equal(adapter.calls.filter((id) => id === "B").length, 1);
  assert.equal(result.macroData.length, 2);
});

// 4-9. Failure-code isolation, one shared parameterized structure.
const FAILURE_CODES = ["AUTH_FAILURE", "RATE_LIMIT", "TIMEOUT", "API_UNAVAILABLE", "MALFORMED_DATA", "INVALID_RESPONSE"];
let failureTestNumber = 4;
for (const code of FAILURE_CODES) {
  test(`${failureTestNumber}. ${code} isolation: failed series reports the code, successful series remain in macroData`, async () => {
    const adapter = makeMockAdapter({
      A: { ok: true, data: [macroRecord({ seriesId: "A" })] },
      B: { ok: false, code, message: `FRED ${code} for series B.` },
      C: { ok: true, data: [macroRecord({ seriesId: "C" })] },
    });
    const result = await composeMacroData(["A", "B", "C"], adapter);
    const failed = result.seriesResults.find((r) => r.seriesId === "B");
    assert.equal(failed.ok, false);
    assert.equal(failed.code, code);
    assert.equal(result.macroData.some((r) => r.evidence.fred_series_id === "A"), true);
    assert.equal(result.macroData.some((r) => r.evidence.fred_series_id === "C"), true);
    assert.equal(result.macroData.some((r) => r.evidence.fred_series_id === "B"), false);
    assert.equal(result.macroData.length, 2);
  });
  failureTestNumber++;
}

// 10. Empty successful result is success, not failure.
test("10. an empty successful result (ok:true, data:[]) is success with zero records, not a failure or a warning", async () => {
  const adapter = makeMockAdapter({ A: { ok: true, data: [] } });
  const result = await composeMacroData(["A"], adapter);
  assert.deepEqual(result.seriesResults[0], { seriesId: "A", ok: true, recordCount: 0 });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.macroData, []);
});

// 11. All series fail.
test("11. all series fail: macroData is empty, every series has a failure entry, warnings exist, no placeholder record", async () => {
  const adapter = makeMockAdapter({
    A: { ok: false, code: "API_UNAVAILABLE", message: "down" },
    B: { ok: false, code: "RATE_LIMIT", message: "too many requests" },
  });
  const result = await composeMacroData(["A", "B"], adapter);
  assert.equal(result.macroData.length, 0);
  assert.equal(result.seriesResults.length, 2);
  assert.ok(result.seriesResults.every((r) => r.ok === false));
  assert.equal(result.warnings.length, 2);
});

// 12. No partial records — the composer trusts the adapter's single atomic outcome.
test("12. no partial records: a series whose adapter call resolves ok:false contributes zero records (composer never reproduces adapter internals)", async () => {
  // Simulates what the real adapter's two-call atomicity already
  // collapses into: a single, final ok:false result. The composer has
  // no knowledge of "metadata" vs "observations" at all — it only ever
  // sees this one outcome, exactly as designed in Step 20.
  const adapter = makeMockAdapter({ A: { ok: false, code: "TIMEOUT", message: "observations call timed out" } });
  const result = await composeMacroData(["A"], adapter);
  assert.equal(result.macroData.length, 0);
  assert.equal(result.seriesResults[0].ok, false);
});

// 13. UNKNOWN value preservation.
test("13. a record containing UNKNOWN values is preserved exactly, never converted", async () => {
  const record = macroRecord({ seriesId: "A", actual_value: "UNKNOWN", forecast_value: "UNKNOWN", release_timestamp: "UNKNOWN" });
  const adapter = makeMockAdapter({ A: { ok: true, data: [record] } });
  const result = await composeMacroData(["A"], adapter);
  assert.equal(result.macroData[0].actual_value, "UNKNOWN");
  assert.equal(result.macroData[0].forecast_value, "UNKNOWN");
  assert.equal(result.macroData[0].release_timestamp, "UNKNOWN");
  assert.deepEqual(result.macroData[0], record);
});

// 14. No fabricated records at all when everything fails.
test("14. no fabricated records: when all series fail, the composer never invents an UNKNOWN/null/0 placeholder record", async () => {
  const adapter = makeMockAdapter({ A: { ok: false, code: "MALFORMED_DATA", message: "bad shape" } });
  const result = await composeMacroData(["A"], adapter);
  assert.deepEqual(result.macroData, []);
  assert.equal(result.macroData.some((r) => r === null || r === 0 || r === "UNKNOWN"), false);
});

// 15. Credential leakage — the composer never reaches into adapter internals.
test("15. credential leakage: a secret held on the adapter object itself never appears in seriesResults/warnings", async () => {
  const secret = "synthetic-secret-should-never-leak-000";
  const adapter = makeMockAdapter(
    { A: { ok: false, code: "AUTH_FAILURE", message: "Authentication failed." } },
    { apiKey: secret } // simulates a real adapter holding a credential internally — composer must never touch this
  );
  const result = await composeMacroData(["A"], adapter);
  const serialized = JSON.stringify({ seriesResults: result.seriesResults, warnings: result.warnings });
  assert.ok(!serialized.includes(secret));
});

// 16. request.macroData compatibility.
test("16. composition.macroData can be spread directly into a request object", async () => {
  const record = macroRecord({ seriesId: "A" });
  const adapter = makeMockAdapter({ A: { ok: true, data: [record] } });
  const composition = await composeMacroData(["A"], adapter);
  const request = { query: "Assess macro", macroData: composition.macroData };
  assert.equal(Array.isArray(request.macroData), true);
  assert.deepEqual(request.macroData, [record]);
});

// 17. Real, unmodified Macro Agent compatibility.
test("17. composed macroData is accepted by the real, unmodified Macro Agent without validation rejection", async () => {
  const { runMacroAgent } = require("../agents/macro-agent");
  const record = macroRecord({ seriesId: "A", indicator: "Real Gross National Product", actual_value: 21427.2 });
  const adapter = makeMockAdapter({ A: { ok: true, data: [record] } });
  const composition = await composeMacroData(["A"], adapter);
  const { report } = runMacroAgent(composition.macroData, {});
  assert.equal(report.agent_name, "macro-agent");
  assert.notEqual(report.agent_status, "FAILED");
});

// 18. Orchestrator remains unchanged (verified in Section 21 of the report via git diff; structural check here too).
// Scans only actual require() calls, not comment text — the module's own
// header comment legitimately mentions "orchestrator" while explaining
// that this file is NOT part of it, which must not itself trip this check
// (the same false-positive class fixed in Step 18A/18C).
test("18. the composer never requires() the orchestrator", () => {
  const src = fs.readFileSync(require.resolve("./fredMacroComposer.js"), "utf8");
  const requireLines = src.match(/require\("[^"]+"\)/g) || [];
  assert.deepEqual(requireLines.filter((line) => /orchestrator/i.test(line)), []);
});

// 19. Data Controller not involved.
test("19. the composer never requires or calls Data Controller", () => {
  const src = fs.readFileSync(require.resolve("./fredMacroComposer.js"), "utf8");
  assert.ok(!/data-controller|dataController/i.test(src));
});

// 20. Exactly one fetch per unique series.
test("20. exactly one adapter.fetchData() call per unique series, regardless of repeated IDs", async () => {
  const adapter = makeMockAdapter({
    A: { ok: true, data: [] },
    B: { ok: true, data: [] },
    C: { ok: true, data: [] },
  });
  await composeMacroData(["A", "B", "A", "C", "B", "C"], adapter);
  assert.equal(adapter.calls.length, 3);
});

// 21. Two adapter instances remain isolated.
test("21. two separate adapter instances used in two separate compositions do not contaminate each other", async () => {
  const adapter1 = makeMockAdapter({ A: { ok: true, data: [macroRecord({ seriesId: "A" })] } });
  const adapter2 = makeMockAdapter({ B: { ok: true, data: [macroRecord({ seriesId: "B" })] } });
  const [result1, result2] = await Promise.all([composeMacroData(["A"], adapter1), composeMacroData(["B"], adapter2)]);
  assert.equal(result1.macroData[0].evidence.fred_series_id, "A");
  assert.equal(result2.macroData[0].evidence.fred_series_id, "B");
  assert.equal(adapter1.calls.length, 1);
  assert.equal(adapter2.calls.length, 1);
});

// 22. Concurrent composition isolation, including on the same adapter instance.
test("22. concurrent composeMacroData() calls remain correct and independent, including on the same adapter instance", async () => {
  const adapter1 = makeMockAdapter({ A: { ok: true, data: [macroRecord({ seriesId: "A" })] }, B: { ok: true, data: [macroRecord({ seriesId: "B" })] } });
  const adapter2 = makeMockAdapter({ C: { ok: true, data: [macroRecord({ seriesId: "C" })] }, D: { ok: true, data: [macroRecord({ seriesId: "D" })] } });
  const [r1, r2] = await Promise.all([composeMacroData(["A", "B"], adapter1), composeMacroData(["C", "D"], adapter2)]);
  assert.equal(r1.macroData.length, 2);
  assert.equal(r2.macroData.length, 2);

  const sharedAdapter = makeMockAdapter({ A: { ok: true, data: [macroRecord({ seriesId: "A" })] }, B: { ok: true, data: [macroRecord({ seriesId: "B" })] } });
  const [same1, same2] = await Promise.all([composeMacroData(["A"], sharedAdapter), composeMacroData(["B"], sharedAdapter)]);
  assert.equal(same1.macroData[0].evidence.fred_series_id, "A");
  assert.equal(same2.macroData[0].evidence.fred_series_id, "B");
});

// 23. healthCheck() is never called during normal composition.
test("23. adapter.healthCheck() is never called by composeMacroData()", async () => {
  let healthCheckCalls = 0;
  const adapter = makeMockAdapter(
    { A: { ok: true, data: [macroRecord({ seriesId: "A" })] } },
    { healthCheck: async () => { healthCheckCalls++; return { ok: true }; } }
  );
  await composeMacroData(["A"], adapter);
  assert.equal(healthCheckCalls, 0);
});

// 24. No network access — structural + behavioral.
// Scans only non-comment lines: the module's own header comment
// legitimately states "it does not read process.env", which must not
// itself trip this check (same false-positive class as test 18).
test("24. the composer never references fetch, http, https, or process.env — it only ever calls adapter.fetchData()", () => {
  const src = fs.readFileSync(require.resolve("./fredMacroComposer.js"), "utf8");
  const codeOnly = src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.ok(!/\bfetch\(/.test(codeOnly));
  assert.ok(!/require\(["'](http|https)["']\)/.test(codeOnly));
  assert.ok(!/process\.env/.test(codeOnly));
  assert.ok(!/stlouisfed/i.test(codeOnly));
});

// 25. Input immutability.
test("25. the caller's seriesIds array is never mutated", async () => {
  const seriesIds = ["A", "A", "B"];
  const original = [...seriesIds];
  const adapter = makeMockAdapter({ A: { ok: true, data: [] }, B: { ok: true, data: [] } });
  await composeMacroData(seriesIds, adapter);
  assert.deepEqual(seriesIds, original);
});

// Additional: minimal input validation, never throws.
test("a missing/empty seriesIds array fails safely with a warning, never throws, never calls fetchData", async () => {
  let called = false;
  const adapter = { fetchData: async () => { called = true; } };
  const result = await composeMacroData([], adapter);
  assert.deepEqual(result.macroData, []);
  assert.deepEqual(result.seriesResults, []);
  assert.ok(result.warnings.length > 0);
  assert.equal(called, false);
});

test("an adapter without fetchData() fails safely with a warning, never throws", async () => {
  const result = await composeMacroData(["A"], {});
  assert.deepEqual(result.macroData, []);
  assert.ok(result.warnings.length > 0);
});

// Additional: unrelated options are never forwarded into fetchData().
test("only observationParams from options is forwarded into fetchData(), nothing else", async () => {
  let capturedRequest;
  const adapter = {
    fetchData: async (request) => {
      capturedRequest = request;
      return { ok: true, data: [] };
    },
  };
  await composeMacroData(["A"], adapter, { observationParams: { units: "pc1" }, unrelatedOption: "should-not-appear" });
  assert.deepEqual(Object.keys(capturedRequest).sort(), ["observationParams", "seriesId"]);
  assert.deepEqual(capturedRequest.observationParams, { units: "pc1" });
});
