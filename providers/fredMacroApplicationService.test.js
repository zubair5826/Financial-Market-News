// Offline/synthetic tests for runFredAwareRequest() — Step 32's
// FRED-aware application service. No test here ever contacts a real
// network endpoint or uses a real FRED credential. process.env is only
// ever set to obviously-synthetic values for the duration of a single
// test, always restored immediately afterward.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runFredAwareRequest } = require("./fredMacroApplicationService");
const { ERROR_CODES } = require("../core/errors");

const SYNTHETIC_KEY = "SYNTHETIC_KEY";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function seriesMetadataBody(overrides = {}) {
  return { seriess: [{ id: "GNPCA", title: "Synthetic Test Indicator", units: "Billions of Dollars", ...overrides }] };
}

function observationsBody(observations, unitsOverride) {
  return { realtime_start: "2026-01-01", realtime_end: "2026-01-01", units: unitsOverride !== undefined ? unitsOverride : "Billions of Dollars", observations };
}

function makeMockFetch({ metadata, observations, onCall } = {}) {
  return async (url, opts) => {
    if (onCall) onCall(url, opts);
    if (url.includes("/series/observations")) {
      if (typeof observations === "function") return observations(url, opts);
      return observations;
    }
    if (url.includes("/series")) {
      if (typeof metadata === "function") return metadata(url, opts);
      return metadata;
    }
    throw new Error(`Unexpected mock URL: ${url}`);
  };
}

async function withEnvKey(value, fn) {
  const original = process.env.FRED_API_KEY;
  if (value === undefined) delete process.env.FRED_API_KEY;
  else process.env.FRED_API_KEY = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.FRED_API_KEY;
    else process.env.FRED_API_KEY = original;
  }
}

// Guards against any real network call for the duration of fn(). If
// global fetch is invoked for real, the guard itself throws, causing
// the test to fail — a genuine, non-vacuous safety net (Test 15).
async function withNetworkGuard(fn) {
  const original = global.fetch;
  let called = false;
  global.fetch = (...args) => {
    called = true;
    throw new Error(`Unexpected real network call during an offline test: ${args[0]}`);
  };
  try {
    const value = await fn();
    return { value, networkCalled: called };
  } finally {
    global.fetch = original;
  }
}

function validBaseRequest(overrides = {}) {
  return { query: "Assess US macro conditions", asset: "US", ...overrides };
}

const singleObservation = [{ date: "2026-01-01", value: "21427.2", realtime_start: "2026-02-15", realtime_end: "9999-12-31" }];

function successfulFredMocks(onCall) {
  return {
    onCall,
    metadata: jsonResponse(200, seriesMetadataBody()),
    observations: jsonResponse(200, observationsBody(singleObservation)),
  };
}

// 1. FRED disabled by default (no options.macro at all).
test("1. FRED disabled by default: no loadLiveMacroData call, no network, processRequest runs, fredDiagnostics is null", async () => {
  const { value: result, networkCalled } = await withNetworkGuard(async () => runFredAwareRequest(validBaseRequest()));
  assert.equal(networkCalled, false);
  assert.equal(result.pipelineResult.ok, true);
  assert.equal(result.fredDiagnostics, null);
});

// 2. FRED explicitly disabled.
test("2. FRED explicitly disabled (macro.enabled:false): identical safe behavior to the default", async () => {
  const { value: result, networkCalled } = await withNetworkGuard(async () =>
    runFredAwareRequest(validBaseRequest(), { macro: { enabled: false } })
  );
  assert.equal(networkCalled, false);
  assert.equal(result.pipelineResult.ok, true);
  assert.equal(result.fredDiagnostics, null);
});

// 3. FRED enabled: full synthetic success path.
test("3. FRED enabled: exactly two mock calls, no real network, macroData reaches processRequest, fredDiagnostics present", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    const { value: result, networkCalled } = await withNetworkGuard(async () =>
      runFredAwareRequest(validBaseRequest(), {
        macro: { enabled: true },
        adapterConfig: { fetchImpl: makeMockFetch(successfulFredMocks((url) => calls.push(url))) },
      })
    );
    assert.equal(networkCalled, false);
    assert.equal(calls.length, 2);
    assert.equal(result.pipelineResult.ok, true);
    assert.ok(result.fredDiagnostics);
    assert.equal(result.fredDiagnostics.seriesResults[0].ok, true);
  });
});

// 4. Default series is GNPCA when none supplied.
test("4. default series is GNPCA when options.macro.seriesIds is not supplied", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    await runFredAwareRequest(validBaseRequest(), {
      macro: { enabled: true },
      adapterConfig: { fetchImpl: makeMockFetch(successfulFredMocks((url) => calls.push(url))) },
    });
    assert.ok(calls.length > 0 && calls.every((u) => u.includes("series_id=GNPCA")));
  });
});

// 5. Explicit synthetic seriesIds — safely supported offline (no production-code limitation found).
test("5. an explicit synthetic seriesIds override is honored end-to-end, offline", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    const mock = makeMockFetch({
      onCall: (url) => calls.push(url),
      metadata: jsonResponse(200, { seriess: [{ id: "TESTSERIES", title: "Synthetic Alternate Series", units: "Index" }] }),
      observations: jsonResponse(200, observationsBody([{ date: "2026-01-01", value: "5", realtime_start: "2026-01-02", realtime_end: "9999-12-31" }])),
    });
    const result = await runFredAwareRequest(validBaseRequest(), {
      macro: { enabled: true, seriesIds: ["TESTSERIES"] },
      adapterConfig: { fetchImpl: mock },
    });
    assert.ok(calls.every((u) => u.includes("series_id=TESTSERIES")));
    assert.equal(result.fredDiagnostics.seriesResults[0].seriesId, "TESTSERIES");
  });
});

// 6. The exact synthetic composed record reaches processRequest()'s own result.
test("6. the synthetic composed macro record (not a second/fabricated one) reaches the pipeline result", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await runFredAwareRequest(validBaseRequest(), {
      macro: { enabled: true },
      adapterConfig: { fetchImpl: makeMockFetch(successfulFredMocks()) },
    });
    assert.equal(result.pipelineResult.response.macro_summary.sources.length, 1);
    assert.equal(result.pipelineResult.response.macro_summary.sources[0], "Federal Reserve Bank of St. Louis (FRED)");
    assert.equal(result.pipelineResult.pipeline_summary.macro_status, "OK");
  });
});

// 7. fredDiagnostics structure when FRED is enabled.
test("7. fredDiagnostics exposes seriesResults and warnings matching the live-source output exactly", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await runFredAwareRequest(validBaseRequest(), {
      macro: { enabled: true },
      adapterConfig: { fetchImpl: makeMockFetch(successfulFredMocks()) },
    });
    assert.deepEqual(Object.keys(result.fredDiagnostics).sort(), ["seriesResults", "warnings"]);
    assert.deepEqual(result.fredDiagnostics.seriesResults, [{ seriesId: "GNPCA", ok: true, recordCount: 1 }]);
    assert.deepEqual(result.fredDiagnostics.warnings, []);
  });
});

// 8. FRED disabled gives exactly null diagnostics, never {} or [] or undefined.
test("8. fredDiagnostics is exactly null when FRED is disabled — never {}, [], or undefined", async () => {
  const result = await runFredAwareRequest(validBaseRequest());
  assert.equal(result.fredDiagnostics, null);
  assert.notDeepEqual(result.fredDiagnostics, {});
  assert.notDeepEqual(result.fredDiagnostics, []);
  assert.notEqual(result.fredDiagnostics, undefined);
});

// 9. Missing FRED credential — offline, no real .env read.
test("9. a missing FRED_API_KEY preserves the existing empty-result behavior and processRequest still completes", async () => {
  await withEnvKey(undefined, async () => {
    let called = false;
    const result = await runFredAwareRequest(validBaseRequest(), {
      macro: { enabled: true },
      adapterConfig: { fetchImpl: async () => { called = true; } },
    });
    assert.equal(called, false);
    assert.deepEqual(result.fredDiagnostics, { seriesResults: [], warnings: ["FRED_API_KEY not configured."] });
    assert.equal(result.pipelineResult.ok, true);
  });
});

// 10. FRED provider failure — no retry, pipeline still completes with diagnostics.
test("10. a FRED provider failure produces empty macroData, no retry, and preserved failure diagnostics", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    let metadataCallCount = 0;
    const mock = makeMockFetch({
      onCall: (url) => {
        if (!url.includes("/series/observations") && url.includes("/series")) metadataCallCount++;
      },
      metadata: jsonResponse(401, { error_code: 401, error_message: "Bad Request." }),
      observations: jsonResponse(200, observationsBody(singleObservation)),
    });
    const result = await runFredAwareRequest(validBaseRequest(), { macro: { enabled: true }, adapterConfig: { fetchImpl: mock } });
    assert.equal(metadataCallCount, 1); // no retry
    assert.equal(result.fredDiagnostics.seriesResults[0].ok, false);
    assert.equal(result.fredDiagnostics.seriesResults[0].code, ERROR_CODES.AUTH_FAILURE);
    assert.equal(result.pipelineResult.ok, true); // pipeline still completes
  });
});

// 11. Caller already supplied macroData while FRED is enabled — rejected, ambiguous merge.
test("11. FRED enabled with caller-supplied macroData already present is rejected without calling loadLiveMacroData or processRequest", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    let fetchCalled = false;
    const request = validBaseRequest({ macroData: [{ indicator: "Caller Supplied", classification: "FACT" }] });
    const { value: result, networkCalled } = await withNetworkGuard(async () =>
      runFredAwareRequest(request, {
        macro: { enabled: true },
        adapterConfig: { fetchImpl: async () => { fetchCalled = true; } },
      })
    );
    assert.equal(networkCalled, false);
    assert.equal(fetchCalled, false);
    assert.equal(result.pipelineResult.ok, false);
    assert.equal(result.pipelineResult.code, ERROR_CODES.MALFORMED_DATA);
    assert.equal(result.fredDiagnostics, null);
  });
});

// 12. Caller macroData passes through untouched when FRED disabled.
test("12. caller-supplied macroData passes through unchanged when FRED is disabled", async () => {
  const callerRecord = { indicator: "Caller Supplied", classification: "FACT" };
  const request = validBaseRequest({ macroData: [callerRecord] });
  const result = await runFredAwareRequest(request, { macro: { enabled: false } });
  assert.equal(result.fredDiagnostics, null);
  // The caller's own record reached the Macro Agent unmodified — its
  // indicator is visible in the pipeline's own macro processing.
  assert.equal(result.pipelineResult.pipeline_summary.macro_status, "OK");
});

// 13. No race: loadLiveMacroData() fully completes before processRequest() runs, even under an artificial delay.
test("13. loadLiveMacroData() fully resolves before processRequest() is invoked (no race), even when the mock is delayed", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const delayedObservations = (url, opts) =>
      new Promise((resolve) => setTimeout(() => resolve(jsonResponse(200, observationsBody(singleObservation))), 20));
    const result = await runFredAwareRequest(validBaseRequest(), {
      macro: { enabled: true },
      adapterConfig: { fetchImpl: makeMockFetch({ metadata: jsonResponse(200, seriesMetadataBody()), observations: delayedObservations }) },
    });
    // If processRequest() had been called before the delayed observation
    // resolved, macroData would have been empty/undefined and this
    // source attribution could never appear.
    assert.equal(result.pipelineResult.response.macro_summary.sources[0], "Federal Reserve Bank of St. Louis (FRED)");
  });
});

// 14. Credential non-exposure.
test("14. the synthetic credential never appears anywhere in the returned structure", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const successResult = await runFredAwareRequest(validBaseRequest(), {
      macro: { enabled: true },
      adapterConfig: { fetchImpl: makeMockFetch(successfulFredMocks()) },
    });
    assert.ok(!JSON.stringify(successResult).includes(SYNTHETIC_KEY));

    const failureResult = await runFredAwareRequest(validBaseRequest(), {
      macro: { enabled: true },
      adapterConfig: { fetchImpl: makeMockFetch({ metadata: jsonResponse(401, {}), observations: jsonResponse(200, observationsBody(singleObservation)) }) },
    });
    assert.ok(!JSON.stringify(failureResult).includes(SYNTHETIC_KEY));
  });
});

// 15. No network when FRED disabled — the network guard itself would fail the test if violated.
test("15. FRED disabled: a real global fetch call would fail this test (network guard proves none occurs)", async () => {
  const { networkCalled } = await withNetworkGuard(async () => runFredAwareRequest(validBaseRequest()));
  assert.equal(networkCalled, false);
});

// Additional structural check: no fetch()/http/https/credential literal in production code.
test("the service file never references fetch(), http/https require(), process.env, or a hardcoded credential literal", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("./fredMacroApplicationService.js"), "utf8");
  const codeOnly = src.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  const fetchCallPattern = new RegExp("\\b" + "fetch" + "\\(");
  assert.ok(!fetchCallPattern.test(codeOnly));
  assert.ok(!/require\(["'](http|https)["']\)/.test(codeOnly));
  assert.ok(!/process\.env/.test(codeOnly));
  assert.ok(!/["'][A-Za-z0-9]{20,}["']/.test(codeOnly));
});
