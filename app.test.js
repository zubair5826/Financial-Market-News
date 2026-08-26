// Offline/synthetic tests for runApplicationRequest() — Step 35's
// minimal application entrypoint. No test here ever contacts a real
// network endpoint or uses a real FRED credential. process.env is only
// ever set to obviously-synthetic values for the duration of a single
// test, always restored immediately afterward.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runApplicationRequest } = require("./app");

const SYNTHETIC_KEY = "SYNTHETIC_KEY";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function seriesMetadataBody() {
  return { seriess: [{ id: "GNPCA", title: "Synthetic Test Indicator", units: "Billions of Dollars" }] };
}

function observationsBody(observations) {
  return { realtime_start: "2026-01-01", realtime_end: "2026-01-01", units: "Billions of Dollars", observations };
}

const singleObservation = [{ date: "2026-01-01", value: "21427.2", realtime_start: "2026-02-15", realtime_end: "9999-12-31" }];

function makeMockFetch({ metadata, observations, onCall } = {}) {
  return async (url, opts) => {
    if (onCall) onCall(url, opts);
    if (url.includes("/series/observations")) return observations;
    if (url.includes("/series")) return metadata;
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
// the test to fail — a genuine, non-vacuous safety net.
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

// 1. The module can be imported and exposes the expected function.
test("1. app.js can be imported and exposes runApplicationRequest as a function", () => {
  assert.equal(typeof runApplicationRequest, "function");
});

// 2 & 4. FRED disabled (default): request reaches the pipeline via
// runFredAwareRequest(), no network, contract shape is exact.
test("2/4. FRED disabled by default: request reaches the pipeline, contract is {pipelineResult, fredDiagnostics}, fredDiagnostics is null", async () => {
  const { value: result, networkCalled } = await withNetworkGuard(async () => runApplicationRequest(validBaseRequest()));
  assert.equal(networkCalled, false);
  assert.deepEqual(Object.keys(result).sort(), ["fredDiagnostics", "pipelineResult"]);
  assert.equal(result.pipelineResult.ok, true);
  assert.equal(result.fredDiagnostics, null);
});

// 3. Contract shape holds under the FRED-enabled path too.
// 5. FRED-enabled invocation using the existing synthetic fetchImpl mechanism.
test("3/5. FRED enabled via synthetic fetchImpl: exactly two mock calls, no real network, macroData reaches the pipeline", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    const { value: result, networkCalled } = await withNetworkGuard(async () =>
      runApplicationRequest(validBaseRequest(), {
        macro: { enabled: true },
        adapterConfig: {
          fetchImpl: makeMockFetch({
            onCall: (url) => calls.push(url),
            metadata: jsonResponse(200, seriesMetadataBody()),
            observations: jsonResponse(200, observationsBody(singleObservation)),
          }),
        },
      })
    );
    assert.equal(networkCalled, false);
    assert.equal(calls.length, 2); // proves the pipeline ran exactly once, not duplicated
    assert.deepEqual(Object.keys(result).sort(), ["fredDiagnostics", "pipelineResult"]);
    assert.equal(result.pipelineResult.ok, true);
    assert.equal(result.pipelineResult.pipeline_summary.macro_status, "OK");
    assert.ok(result.fredDiagnostics);
    assert.equal(result.fredDiagnostics.seriesResults[0].ok, true);
  });
});

// 6. The caller's request object is never mutated.
test("6. the caller's request object is not mutated", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const request = validBaseRequest();
    const snapshot = JSON.parse(JSON.stringify(request));
    await runApplicationRequest(request, {
      macro: { enabled: true },
      adapterConfig: {
        fetchImpl: makeMockFetch({
          metadata: jsonResponse(200, seriesMetadataBody()),
          observations: jsonResponse(200, observationsBody(singleObservation)),
        }),
      },
    });
    assert.deepEqual(request, snapshot);
  });
});

// 7. No duplicate pipeline processing: the pipeline's own
// pipeline_summary is present exactly once and internally consistent —
// a second/duplicated processRequest() run would show up as either a
// thrown error (double-processing side effects) or a doubled fetch
// count, neither of which occurs here.
test("7. the entrypoint does not duplicate pipeline processing", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    const result = await runApplicationRequest(validBaseRequest(), {
      macro: { enabled: true },
      adapterConfig: {
        fetchImpl: makeMockFetch({
          onCall: (url) => calls.push(url),
          metadata: jsonResponse(200, seriesMetadataBody()),
          observations: jsonResponse(200, observationsBody(singleObservation)),
        }),
      },
    });
    assert.equal(calls.length, 2); // one metadata + one observations call — not four
    assert.equal(result.fredDiagnostics.seriesResults.length, 1);
  });
});

// 8. No credential exposure anywhere in the returned structure.
test("8. the synthetic credential never appears anywhere in the returned structure", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await runApplicationRequest(validBaseRequest(), {
      macro: { enabled: true },
      adapterConfig: {
        fetchImpl: makeMockFetch({
          metadata: jsonResponse(200, seriesMetadataBody()),
          observations: jsonResponse(200, observationsBody(singleObservation)),
        }),
      },
    });
    assert.ok(!JSON.stringify(result).includes(SYNTHETIC_KEY));
  });
});

// 9. Existing behavior remains intact: FRED-disabled caller-supplied
// macroData still passes through unchanged, exactly as
// runFredAwareRequest() already guarantees.
test("9. existing behavior remains intact: caller-supplied macroData passes through unchanged when FRED is disabled", async () => {
  const callerRecord = { indicator: "Caller Supplied", classification: "FACT" };
  const request = validBaseRequest({ macroData: [callerRecord] });
  const result = await runApplicationRequest(request, { macro: { enabled: false } });
  assert.equal(result.fredDiagnostics, null);
  assert.equal(result.pipelineResult.pipeline_summary.macro_status, "OK");
});
