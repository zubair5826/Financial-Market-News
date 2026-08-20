// Offline/synthetic tests for FredMacroAdapter — the concrete adapter
// implementing the contract frozen across Steps 16C/17/17A/17B/18.
//
// No real network call is ever made here: every test injects a synthetic
// fetchImpl mock via config.fetchImpl (see FredMacroAdapter's
// constructor). No real FRED credentials are used — apiKey values below
// are obviously-synthetic test strings, never anything resembling a real
// key. Do not add a live network call to this file.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { FredMacroAdapter } = require("./fredMacroAdapter");
const { UNKNOWN } = require("../../core/constants");
const { ERROR_CODES } = require("../../core/errors");

const TEST_API_KEY = "synthetic-test-key-not-real-000000";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function seriesMetadataBody(overrides = {}) {
  return {
    seriess: [{ id: "GNPCA", title: "Real Gross National Product", units: "Billions of Dollars", ...overrides }],
  };
}

function observationsBody(observations, unitsOverride) {
  return {
    realtime_start: "2026-08-19",
    realtime_end: "2026-08-19",
    units: unitsOverride !== undefined ? unitsOverride : "Billions of Dollars",
    observations,
  };
}

// A mock fetchImpl that dispatches by URL path so metadata vs. observation
// calls can return independently-configured responses. Forwards the
// second (options) argument — e.g. { signal } — through to function-typed
// metadata/observations values, so Step 18D's abort-aware mocks can
// inspect the AbortSignal the adapter passes in.
function makeMockFetch({ metadata, observations, onCall } = {}) {
  return async (url, options) => {
    if (onCall) onCall(url, options);
    // /series/observations is checked first since it also contains
    // "/series" as a substring — order matters here.
    if (url.includes("/series/observations")) {
      if (typeof observations === "function") return observations(url, options);
      return observations;
    }
    if (url.includes("/series")) {
      if (typeof metadata === "function") return metadata(url, options);
      return metadata;
    }
    throw new Error(`Unexpected mock URL: ${url}`);
  };
}

// Step 18D: a fetchImpl that genuinely observes AbortSignal, the way a
// real fetch(url, { signal }) call would — used to prove timeout
// cancellation actually works end-to-end (the request is told to stop),
// not merely that a timer wins a race against a request that never
// learns it should give up.
function makeAbortAwareFetch() {
  return (url, options) =>
    new Promise((resolve, reject) => {
      const signal = options && options.signal;
      const onAbort = () => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        reject(err);
      };
      if (!signal) return; // no signal supplied — nothing to observe, never resolves
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    });
}

function baseAdapter(overrides = {}) {
  return new FredMacroAdapter({ apiKey: TEST_API_KEY, ...overrides });
}

const singleObservation = [{ date: "2026-01-01", value: "21427.2", realtime_start: "2026-02-15", realtime_end: "9999-12-31" }];

// 1-6, 9-15. Full success path — checks the bulk of field mappings at once.
test("1-6,9-15. a successful metadata+observation fetch maps every frozen field correctly", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody(singleObservation)),
    }),
  });

  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.ok, true);
  assert.equal(result.data.length, 1);
  const record = result.data[0];

  assert.equal(record.indicator, "Real Gross National Product"); // 2. title mapping
  assert.equal(record.indicator_code, "GNPCA"); // 3. series_id mapping
  assert.equal(record.unit, "Billions of Dollars"); // 4. units mapping
  assert.equal(record.period, "2026-01-01"); // 5. period mapping
  assert.equal(record.actual_value, 21427.2); // 6. numeric conversion
  assert.equal(record.release_timestamp, UNKNOWN); // 8 (release_timestamp stays UNKNOWN)
  assert.ok(typeof record.retrieved_timestamp === "string" && !Number.isNaN(Date.parse(record.retrieved_timestamp))); // 9
  assert.equal(record.evidence.realtime_start, "2026-02-15"); // 10
  assert.equal(record.evidence.realtime_end, "9999-12-31"); // 11
  assert.equal(record.evidence.fred_series_id, "GNPCA"); // 12
  assert.equal(record.evidence.api_version, "v1"); // 12
  assert.equal(record.evidence.endpoint, "series/observations"); // 12
  assert.equal(record.expected_value, UNKNOWN); // 13
  assert.equal(record.forecast_value, UNKNOWN); // 14
  assert.equal(record.impact_direction, UNKNOWN); // 15
  assert.equal(record.source, "Federal Reserve Bank of St. Louis (FRED)");
});

// 7. "." -> UNKNOWN, never 0.
test('7. a FRED "." observation value maps to UNKNOWN, never 0 or a fabricated number', async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody([{ date: "2026-01-01", value: ".", realtime_start: "2026-02-15", realtime_end: "9999-12-31" }])),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.data[0].actual_value, UNKNOWN);
  assert.notEqual(result.data[0].actual_value, 0);
});

// Step 18A regression: empty/whitespace-only observation values must map
// to UNKNOWN, never a fabricated 0 (JavaScript's Number("") quirk).
test("18B. an empty string observation value maps to UNKNOWN, never 0", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody([{ date: "2026-01-01", value: "", realtime_start: "2026-02-15", realtime_end: "9999-12-31" }])),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.data[0].actual_value, UNKNOWN);
});

test("18B. a single-space observation value maps to UNKNOWN, never 0", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody([{ date: "2026-01-01", value: " ", realtime_start: "2026-02-15", realtime_end: "9999-12-31" }])),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.data[0].actual_value, UNKNOWN);
});

test("18B. whitespace-only observation values (spaces, tab, newline) all map to UNKNOWN, never 0", async () => {
  for (const whitespaceValue of ["   ", "\t", "\n"]) {
    const adapter = baseAdapter({
      fetchImpl: makeMockFetch({
        metadata: jsonResponse(200, seriesMetadataBody()),
        observations: jsonResponse(
          200,
          observationsBody([{ date: "2026-01-01", value: whitespaceValue, realtime_start: "2026-02-15", realtime_end: "9999-12-31" }])
        ),
      }),
    });
    const result = await adapter.fetchData({ seriesId: "GNPCA" });
    assert.equal(result.data[0].actual_value, UNKNOWN, `expected UNKNOWN for ${JSON.stringify(whitespaceValue)}`);
  }
});

test("18B. a genuine numeric zero string (\"0\") still maps to real 0, not UNKNOWN", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody([{ date: "2026-01-01", value: "0", realtime_start: "2026-02-15", realtime_end: "9999-12-31" }])),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.data[0].actual_value, 0);
  assert.notEqual(result.data[0].actual_value, UNKNOWN);
});

test("18B. valid positive and negative numeric strings remain correctly numeric after the fix", async () => {
  const observations = [
    { date: "2026-01-01", value: "21427.2", realtime_start: "2026-02-15", realtime_end: "9999-12-31" },
    { date: "2026-02-01", value: "-1.5", realtime_start: "2026-02-15", realtime_end: "9999-12-31" },
  ];
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody(observations)),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.data[0].actual_value, 21427.2);
  assert.equal(result.data[1].actual_value, -1.5);
});

test("18B. a non-numeric string still maps to UNKNOWN (unchanged by the fix)", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody([{ date: "2026-01-01", value: "N/A", realtime_start: "2026-02-15", realtime_end: "9999-12-31" }])),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.data[0].actual_value, UNKNOWN);
});

test("18B. \".\" still maps to UNKNOWN (unchanged by the fix)", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody([{ date: "2026-01-01", value: ".", realtime_start: "2026-02-15", realtime_end: "9999-12-31" }])),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.data[0].actual_value, UNKNOWN);
});

// 8. release_timestamp is never derived from any other field.
test("8. release_timestamp stays UNKNOWN even though realtime_start/realtime_end/period are all present", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody(singleObservation)),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.data[0].release_timestamp, UNKNOWN);
});

// 16. Metadata request failure (network-level).
test("16. a metadata request failure produces failSafe(), never a MacroRecord", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: async () => {
        throw new Error("connection refused");
      },
      observations: jsonResponse(200, observationsBody(singleObservation)),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.API_UNAVAILABLE);
  assert.equal(result.data, undefined); // 27. no MacroRecord produced
});

// 17. Observation request failure — metadata succeeded but must not produce a partial record.
test("17. an observation request failure produces failSafe(), even though metadata succeeded", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: async () => {
        throw new Error("connection refused");
      },
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.API_UNAVAILABLE);
  assert.equal(result.data, undefined); // 27. no partial record
});

// 18. Malformed metadata (missing title/seriess).
test("18. a malformed metadata response (no usable title) produces failSafe(MALFORMED_DATA)", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, { seriess: [] }),
      observations: jsonResponse(200, observationsBody(singleObservation)),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.MALFORMED_DATA);
});

// 19. Malformed observations (missing observations array).
test("19. a malformed observations response (no observations array) produces failSafe(MALFORMED_DATA)", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, { units: "Percent" }),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.MALFORMED_DATA);
});

// 20. Authentication failure (HTTP 401/403).
test("20. an HTTP 401 response produces failSafe(AUTH_FAILURE)", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(401, { error_code: 401, error_message: "Bad Request. The value for variable api_key is not registered." }),
      observations: jsonResponse(200, observationsBody(singleObservation)),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.AUTH_FAILURE);
});

// 21. Rate limit (HTTP 429).
test("21. an HTTP 429 response produces failSafe(RATE_LIMIT)", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(429, {}),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.RATE_LIMIT);
});

// 22. Generic network failure.
test("22. a generic network rejection produces failSafe(API_UNAVAILABLE)", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: async () => {
        throw new Error("ENOTFOUND api.stlouisfed.org");
      },
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.API_UNAVAILABLE);
});

// 23. Timeout — an abort-aware mock (Step 18D) paired with a tiny timeoutMs.
// Previously used a bare never-resolving Promise; updated (not weakened —
// same scenario, same required outcome) because the timeout mechanism
// itself changed from a Promise.race to real AbortController cancellation
// (Step 18D) — a mock that ignores its signal entirely would now hang
// forever instead of demonstrating anything, since nothing races it
// anymore. The abort-aware mock instead behaves the way a real fetch()
// call genuinely would under cancellation.
test("23. a request that never resolves times out (via a genuinely aborted signal) and produces failSafe(TIMEOUT)", async () => {
  const adapter = baseAdapter({
    timeoutMs: 20,
    fetchImpl: makeMockFetch({
      metadata: makeAbortAwareFetch(),
      observations: jsonResponse(200, observationsBody(singleObservation)),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.TIMEOUT);
});

// --- Step 18D: timeout cancellation regression tests ---

test("18D. the injected fetchImpl receives a genuine AbortSignal for every request", async () => {
  const capturedSignals = [];
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      onCall: (url, options) => capturedSignals.push(options && options.signal),
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody(singleObservation)),
    }),
  });
  await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(capturedSignals.length, 2); // metadata + observations
  for (const signal of capturedSignals) {
    assert.ok(signal instanceof AbortSignal);
    assert.equal(signal.aborted, false); // not aborted — this request completed in time
  }
});

test("18D. the AbortSignal genuinely becomes aborted once timeoutMs elapses", async () => {
  const capturedSignals = [];
  const adapter = baseAdapter({
    timeoutMs: 20,
    fetchImpl: makeMockFetch({
      onCall: (url, options) => capturedSignals.push(options && options.signal),
      metadata: makeAbortAwareFetch(),
      observations: jsonResponse(200, observationsBody(singleObservation)),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.code, ERROR_CODES.TIMEOUT);
  assert.equal(capturedSignals.length, 1);
  assert.equal(capturedSignals[0].aborted, true);
});

test("18D. a metadata timeout prevents the observations request from ever being made", async () => {
  let observationsCalled = false;
  const adapter = baseAdapter({
    timeoutMs: 20,
    fetchImpl: makeMockFetch({
      metadata: makeAbortAwareFetch(),
      observations: async () => {
        observationsCalled = true;
        return jsonResponse(200, observationsBody(singleObservation));
      },
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.code, ERROR_CODES.TIMEOUT);
  assert.equal(observationsCalled, false);
});

test("18D. an observations timeout after successful metadata still produces no MacroRecord (atomicity holds under timeout too)", async () => {
  const adapter = baseAdapter({
    timeoutMs: 20,
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: makeAbortAwareFetch(),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.TIMEOUT);
  assert.equal("data" in result, false);
});

test("18D. the timeout timer is cleared after a successful request (no leaked timer)", async () => {
  const originalClearTimeout = global.clearTimeout;
  let clearCount = 0;
  global.clearTimeout = (...args) => {
    clearCount++;
    return originalClearTimeout(...args);
  };
  try {
    const adapter = baseAdapter({
      fetchImpl: makeMockFetch({
        metadata: jsonResponse(200, seriesMetadataBody()),
        observations: jsonResponse(200, observationsBody(singleObservation)),
      }),
    });
    await adapter.fetchData({ seriesId: "GNPCA" });
    assert.ok(clearCount >= 2); // one clearTimeout per request: metadata + observations
  } finally {
    global.clearTimeout = originalClearTimeout;
  }
});

test("18D. the timeout timer is cleared after an ordinary (non-timeout) request failure (no leaked timer)", async () => {
  const originalClearTimeout = global.clearTimeout;
  let clearCount = 0;
  global.clearTimeout = (...args) => {
    clearCount++;
    return originalClearTimeout(...args);
  };
  try {
    const adapter = baseAdapter({
      fetchImpl: makeMockFetch({
        metadata: async () => {
          throw new Error("connection refused");
        },
        observations: jsonResponse(200, observationsBody(singleObservation)),
      }),
    });
    const result = await adapter.fetchData({ seriesId: "GNPCA" });
    assert.equal(result.code, ERROR_CODES.API_UNAVAILABLE);
    assert.ok(clearCount >= 1);
  } finally {
    global.clearTimeout = originalClearTimeout;
  }
});

test("18D. the configured API key never appears in a TIMEOUT failSafe() result", async () => {
  const adapter = baseAdapter({
    timeoutMs: 20,
    fetchImpl: makeMockFetch({
      metadata: makeAbortAwareFetch(),
      observations: jsonResponse(200, observationsBody(singleObservation)),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.code, ERROR_CODES.TIMEOUT);
  assert.ok(!JSON.stringify(result).includes(TEST_API_KEY));
});

// 24. FRED's own structured error body, translated.
test("24. a FRED structured error body (error_code/error_message) is translated to failSafe(INVALID_RESPONSE)", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, { error_code: 400, error_message: "Bad Request. Variable series_id is not a known series." }),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.INVALID_RESPONSE);
  assert.ok(result.message.includes("Bad Request"));
});

// 25. Credential never exposed in error/log output, across several failure paths.
test("25. the configured API key never appears in any failSafe() output, across every failure scenario", async () => {
  const scenarios = [
    baseAdapter({
      fetchImpl: makeMockFetch({
        metadata: async () => {
          throw new Error("connection refused");
        },
        observations: jsonResponse(200, observationsBody(singleObservation)),
      }),
    }),
    baseAdapter({
      fetchImpl: makeMockFetch({ metadata: jsonResponse(401, {}), observations: jsonResponse(200, observationsBody(singleObservation)) }),
    }),
    baseAdapter({
      fetchImpl: makeMockFetch({ metadata: jsonResponse(200, seriesMetadataBody()), observations: jsonResponse(429, {}) }),
    }),
  ];
  for (const adapter of scenarios) {
    const result = await adapter.fetchData({ seriesId: "GNPCA" });
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(TEST_API_KEY));
  }
});

// --- Step 18E: comprehensive credential-leakage coverage across every ---
// --- failure branch, for both the metadata and observations calls.    ---

// A response whose .json() itself throws — simulates a body that isn't
// valid JSON, distinct from a well-formed-but-wrong-shape body.
function malformedJsonResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError("Unexpected token in JSON");
    },
  };
}

// Recursively covers the whole result via JSON serialization (which
// already walks every nested object/array) — genuinely fails if the
// production adapter ever includes the secret anywhere in the structure.
function assertCredentialNotExposed(result, secret, label) {
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(secret), `credential leaked in result for: ${label}`);
}

function metadataFailureBranches() {
  return [
    { label: "network failure", metadata: async () => { throw new Error("connection refused"); } },
    {
      label: "401 authentication failure",
      metadata: jsonResponse(401, { error_code: 401, error_message: "Bad Request. The value for variable api_key is not registered." }),
    },
    { label: "403 forbidden failure", metadata: jsonResponse(403, { error_code: 403, error_message: "Forbidden." }) },
    { label: "429 rate-limit failure", metadata: jsonResponse(429, {}) },
    { label: "malformed JSON", metadata: malformedJsonResponse() },
    { label: "malformed response shape (no usable title)", metadata: jsonResponse(200, { seriess: [] }) },
    {
      label: "FRED structured error response",
      metadata: jsonResponse(200, { error_code: 400, error_message: "Bad Request. Variable series_id is not a known series." }),
    },
    { label: "timeout / AbortError", metadata: makeAbortAwareFetch() },
  ];
}

function observationsFailureBranches() {
  return [
    { label: "network failure", observations: async () => { throw new Error("connection refused"); } },
    { label: "401 authentication failure", observations: jsonResponse(401, { error_code: 401, error_message: "Bad Request." }) },
    { label: "403 forbidden failure", observations: jsonResponse(403, { error_code: 403, error_message: "Forbidden." }) },
    { label: "429 rate-limit failure", observations: jsonResponse(429, {}) },
    { label: "malformed JSON", observations: malformedJsonResponse() },
    { label: "malformed response shape (no observations array)", observations: jsonResponse(200, { units: "Percent" }) },
    {
      label: "FRED structured error response",
      observations: jsonResponse(200, { error_code: 400, error_message: "Bad Request. Variable series_id is not a known series." }),
    },
    { label: "timeout / AbortError", observations: makeAbortAwareFetch() },
  ];
}

for (const branch of metadataFailureBranches()) {
  test(`18E. metadata ${branch.label} never exposes the credential or the authenticated URL`, async () => {
    const capturedUrls = [];
    const adapter = baseAdapter({
      timeoutMs: 20,
      fetchImpl: makeMockFetch({
        onCall: (url) => capturedUrls.push(url),
        metadata: branch.metadata,
        observations: jsonResponse(200, observationsBody(singleObservation)),
      }),
    });
    const result = await adapter.fetchData({ seriesId: "GNPCA" });
    assert.equal(result.ok, false);
    assertCredentialNotExposed(result, TEST_API_KEY, branch.label);

    const metadataUrl = capturedUrls.find((u) => !u.includes("/observations"));
    // Sanity check: the URL genuinely does carry the key internally, as
    // expected for real request construction — proving this test isn't
    // vacuous (there IS a credential-bearing string in play here).
    assert.ok(metadataUrl && metadataUrl.includes(TEST_API_KEY), `expected the captured metadata URL to carry the key for: ${branch.label}`);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(metadataUrl), `full authenticated URL leaked in result for: ${branch.label}`);
  });
}

for (const branch of observationsFailureBranches()) {
  test(`18E. observations ${branch.label} never exposes the credential or the authenticated URL`, async () => {
    const capturedUrls = [];
    const adapter = baseAdapter({
      timeoutMs: 20,
      fetchImpl: makeMockFetch({
        onCall: (url) => capturedUrls.push(url),
        metadata: jsonResponse(200, seriesMetadataBody()),
        observations: branch.observations,
      }),
    });
    const result = await adapter.fetchData({ seriesId: "GNPCA" });
    assert.equal(result.ok, false);
    assertCredentialNotExposed(result, TEST_API_KEY, branch.label);

    const observationsUrl = capturedUrls.find((u) => u.includes("/observations"));
    assert.ok(observationsUrl && observationsUrl.includes(TEST_API_KEY), `expected the captured observations URL to carry the key for: ${branch.label}`);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(observationsUrl), `full authenticated URL leaked in result for: ${branch.label}`);
  });
}

test("18E. no failure branch ever throws an exception — fetchData always resolves to a structured result, so nothing can leak via a thrown error", async () => {
  const scenarios = [...metadataFailureBranches(), ...observationsFailureBranches()];
  for (const branch of scenarios) {
    const adapter = baseAdapter({
      timeoutMs: 20,
      fetchImpl: makeMockFetch({
        metadata: branch.metadata || jsonResponse(200, seriesMetadataBody()),
        observations: branch.observations || jsonResponse(200, observationsBody(singleObservation)),
      }),
    });
    try {
      await adapter.fetchData({ seriesId: "GNPCA" });
    } catch (err) {
      assert.fail(`fetchData() threw for "${branch.label}": ${err && err.message}`);
    }
  }
});

test("18E. the API key never appears anywhere in a successful result's MacroRecord data", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody(singleObservation)),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.ok, true);
  assert.ok(!JSON.stringify(result.data).includes(TEST_API_KEY));
});

test("18E. the adapter source never calls console.* — structurally, it cannot log the credential", () => {
  const src = fs.readFileSync(require.resolve("./fredMacroAdapter.js"), "utf8");
  assert.ok(!/console\./.test(src));
});

test("18E. no console output occurs across any failure branch (runtime spy, not just a structural check)", async () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  let called = false;
  console.log = console.warn = console.error = () => {
    called = true;
  };
  try {
    for (const branch of [...metadataFailureBranches(), ...observationsFailureBranches()]) {
      const adapter = baseAdapter({
        timeoutMs: 20,
        fetchImpl: makeMockFetch({
          metadata: branch.metadata || jsonResponse(200, seriesMetadataBody()),
          observations: branch.observations || jsonResponse(200, observationsBody(singleObservation)),
        }),
      });
      await adapter.fetchData({ seriesId: "GNPCA" });
    }
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  assert.equal(called, false);
});

// 26. Both calls use the same series_id.
test("26. the metadata call and the observations call both use the same series_id", async () => {
  const calledUrls = [];
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      onCall: (url) => calledUrls.push(url),
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody(singleObservation)),
    }),
  });
  await adapter.fetchData({ seriesId: "UNRATE" });
  assert.equal(calledUrls.length, 2);
  assert.ok(calledUrls.every((u) => u.includes("series_id=UNRATE")));
});

// 27. No MacroRecord is produced when either required call fails (aggregate check across the failure tests above).
test("27. every failure result has no .data field — atomicity is never silently violated", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({ metadata: jsonResponse(401, {}), observations: jsonResponse(200, observationsBody(singleObservation)) }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.ok, false);
  assert.equal("data" in result, false);
});

// 28. Empty observations is not an error.
test("28. an empty observations array is a successful, empty result — not a failure", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody([])),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, []);
});

// 29. Multiple observations map correctly without cross-contaminating vintage metadata.
test("29. multiple observations each preserve their own period/value/vintage independently", async () => {
  const observations = [
    { date: "2026-01-01", value: "100.1", realtime_start: "2026-02-01", realtime_end: "2026-02-28" },
    { date: "2026-02-01", value: "101.5", realtime_start: "2026-03-01", realtime_end: "9999-12-31" },
    { date: "2026-03-01", value: ".", realtime_start: "2026-04-01", realtime_end: "9999-12-31" },
  ];
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody(observations)),
    }),
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.data.length, 3);
  assert.equal(result.data[0].period, "2026-01-01");
  assert.equal(result.data[0].actual_value, 100.1);
  assert.equal(result.data[0].evidence.realtime_end, "2026-02-28");
  assert.equal(result.data[1].period, "2026-02-01");
  assert.equal(result.data[1].actual_value, 101.5);
  assert.equal(result.data[2].period, "2026-03-01");
  assert.equal(result.data[2].actual_value, UNKNOWN); // "." preserved as UNKNOWN, not mixed with sibling values
});

// 30. Structural isolation from Data Controller and the rest of the pipeline.
// Scans only actual require() calls (the same pattern used by
// tests/pipeline.test.js's "no external API" check) — comments that
// merely explain the isolation (e.g. "never core/dataRecord.js") must
// not themselves trip this check.
test("30. the adapter never requires Data Controller, core/dataRecord, or any downstream decision agent", () => {
  const src = fs.readFileSync(require.resolve("./fredMacroAdapter.js"), "utf8");
  const requireLines = src.match(/require\("[^"]+"\)/g) || [];
  const forbidden = requireLines.filter((line) =>
    /data-controller|dataRecord|trade-setup-agent|risk-manager|chief-trading-manager|broker|exchange/i.test(line)
  );
  assert.deepEqual(forbidden, []);
});

// Additional: malformed top-level request is rejected safely.
test("a malformed request (missing seriesId) is rejected safely, never crashes", async () => {
  const adapter = baseAdapter({ fetchImpl: makeMockFetch({ metadata: jsonResponse(200, {}), observations: jsonResponse(200, {}) }) });
  const result = await adapter.fetchData({});
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.MALFORMED_DATA);
});

// Additional: no API key configured fails safely without ever attempting a request.
test("no configured API key fails safely with AUTH_FAILURE, without calling fetchImpl", async () => {
  let called = false;
  const adapter = new FredMacroAdapter({
    fetchImpl: async () => {
      called = true;
      return jsonResponse(200, {});
    },
  });
  const result = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.AUTH_FAILURE);
  assert.equal(called, false);
});

// Updated for Step 18G: healthCheck() now genuinely probes connectivity
// when configured (Step 18F's approved Design C), so it DOES call
// fetchImpl in that case — the prior assumption that it never does no
// longer holds and this test is updated accordingly (not weakened; the
// missing-key short-circuit behavior it also checks is unchanged).
test("healthCheck: an unconfigured adapter fails safe with AUTH_FAILURE without ever calling fetchImpl", async () => {
  let called = false;
  const unconfigured = new FredMacroAdapter({
    fetchImpl: async () => {
      called = true;
    },
  });
  const failResult = await unconfigured.healthCheck();
  assert.equal(failResult.ok, false);
  assert.equal(failResult.code, ERROR_CODES.AUTH_FAILURE);
  assert.equal(called, false);
});

// --- Step 18G: healthCheck() connectivity-probe regression tests ---

test("18G-1. missing API key returns AUTH_FAILURE and never calls fetchImpl", async () => {
  let called = false;
  const adapter = new FredMacroAdapter({
    fetchImpl: async () => {
      called = true;
    },
  });
  const result = await adapter.healthCheck();
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.AUTH_FAILURE);
  assert.equal(called, false);
});

test("18G-2. a configured key with a successful synthetic response returns ok:true and no MacroRecord", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({ metadata: jsonResponse(200, seriesMetadataBody()) }),
  });
  const result = await adapter.healthCheck();
  assert.equal(result.ok, true);
  assert.equal(result.data, undefined); // 12. never a MacroRecord/array of records
  assert.equal(Array.isArray(result.data), false);
});

test("18G-3. HTTP 401 during the connectivity probe maps to AUTH_FAILURE", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({ metadata: jsonResponse(401, { error_code: 401, error_message: "Bad Request." }) }),
  });
  const result = await adapter.healthCheck();
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.AUTH_FAILURE);
});

test("18G-4. HTTP 403 during the connectivity probe maps to AUTH_FAILURE", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({ metadata: jsonResponse(403, { error_code: 403, error_message: "Forbidden." }) }),
  });
  const result = await adapter.healthCheck();
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.AUTH_FAILURE);
});

test("18G-5. HTTP 429 during the connectivity probe maps to RATE_LIMIT", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({ metadata: jsonResponse(429, {}) }),
  });
  const result = await adapter.healthCheck();
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.RATE_LIMIT);
});

test("18G-6. a timeout during the connectivity probe (abort-aware mock) maps to TIMEOUT", async () => {
  const adapter = baseAdapter({
    timeoutMs: 20,
    fetchImpl: makeMockFetch({ metadata: makeAbortAwareFetch() }),
  });
  const result = await adapter.healthCheck();
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.TIMEOUT);
});

test("18G-7. a generic network rejection during the connectivity probe maps to API_UNAVAILABLE", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: async () => {
        throw new Error("connection refused");
      },
    }),
  });
  const result = await adapter.healthCheck();
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.API_UNAVAILABLE);
});

test("18G-8. malformed JSON during the connectivity probe maps to MALFORMED_DATA", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({ metadata: malformedJsonResponse() }),
  });
  const result = await adapter.healthCheck();
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.MALFORMED_DATA);
});

test("18G-8b. a FRED structured error response during the connectivity probe maps to INVALID_RESPONSE (existing behavior, reused)", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, { error_code: 400, error_message: "Bad Request. Variable series_id is not a known series." }),
    }),
  });
  const result = await adapter.healthCheck();
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.INVALID_RESPONSE);
});

test("18G-9. the credential and the authenticated URL never appear in any healthCheck() result, across every failure branch", async () => {
  const branches = [
    { label: "401", metadata: jsonResponse(401, {}) },
    { label: "403", metadata: jsonResponse(403, {}) },
    { label: "429", metadata: jsonResponse(429, {}) },
    { label: "malformed JSON", metadata: malformedJsonResponse() },
    {
      label: "network failure",
      metadata: async () => {
        throw new Error("connection refused");
      },
    },
    { label: "timeout", metadata: makeAbortAwareFetch() },
  ];
  for (const branch of branches) {
    const capturedUrls = [];
    const adapter = baseAdapter({
      timeoutMs: 20,
      fetchImpl: makeMockFetch({ onCall: (url) => capturedUrls.push(url), metadata: branch.metadata }),
    });
    const result = await adapter.healthCheck();
    assert.equal(result.ok, false);
    assertCredentialNotExposed(result, TEST_API_KEY, `healthCheck ${branch.label}`);
    const probeUrl = capturedUrls[0];
    assert.ok(probeUrl && probeUrl.includes(TEST_API_KEY), `expected the probe URL to carry the key for: ${branch.label}`);
    assert.ok(!JSON.stringify(result).includes(probeUrl), `full authenticated URL leaked in healthCheck result for: ${branch.label}`);
  }
});

test("18G-10. the connectivity probe targets fred/series, never fred/series/observations", async () => {
  const capturedUrls = [];
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      onCall: (url) => capturedUrls.push(url),
      metadata: jsonResponse(200, seriesMetadataBody()),
    }),
  });
  await adapter.healthCheck();
  assert.equal(capturedUrls.length, 1);
  assert.ok(capturedUrls[0].includes("/series"));
  assert.ok(!capturedUrls[0].includes("/series/observations"));
});

test("18G-11. a healthCheck() call does not corrupt or interfere with a subsequent fetchData() call", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody(singleObservation)),
    }),
  });
  const healthResult = await adapter.healthCheck();
  assert.equal(healthResult.ok, true);

  const fetchResult = await adapter.fetchData({ seriesId: "GNPCA" });
  assert.equal(fetchResult.ok, true);
  assert.equal(fetchResult.data[0].indicator, "Real Gross National Product");
  assert.equal(fetchResult.data[0].actual_value, 21427.2);
});

test("18G-11b. concurrent healthCheck() and fetchData() calls on the same adapter remain independent", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({
      metadata: jsonResponse(200, seriesMetadataBody()),
      observations: jsonResponse(200, observationsBody(singleObservation)),
    }),
  });
  const [healthResult, fetchResult] = await Promise.all([adapter.healthCheck(), adapter.fetchData({ seriesId: "GNPCA" })]);
  assert.equal(healthResult.ok, true);
  assert.equal(healthResult.data, undefined);
  assert.equal(fetchResult.ok, true);
  assert.equal(fetchResult.data.length, 1);
  assert.equal(fetchResult.data[0].actual_value, 21427.2);
});

test("18G-12. a successful healthCheck() result never resembles a MacroRecord (no indicator/period/actual_value/evidence fields)", async () => {
  const adapter = baseAdapter({
    fetchImpl: makeMockFetch({ metadata: jsonResponse(200, seriesMetadataBody()) }),
  });
  const result = await adapter.healthCheck();
  assert.equal(result.ok, true);
  for (const macroRecordField of ["indicator", "indicator_code", "actual_value", "period", "evidence", "release_timestamp"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(result, macroRecordField), false, `unexpected MacroRecord-shaped field: ${macroRecordField}`);
  }
});
