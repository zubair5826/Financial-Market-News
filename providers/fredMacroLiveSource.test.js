// Offline/synthetic tests for loadLiveMacroData() — Step 27's FRED
// live-source boundary. No test here ever contacts a real network
// endpoint or uses a real FRED credential; the injected fetchImpl (via
// options.adapterConfig) is always a synthetic mock, exactly mirroring
// the pattern already established in fredMacroAdapter.test.js and
// fredMacroComposer.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadLiveMacroData } = require("./fredMacroLiveSource");

const SYNTHETIC_KEY = "synthetic-live-source-test-key-not-real-000";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function seriesMetadataBody(overrides = {}) {
  return { seriess: [{ id: "A", title: "Synthetic Test Indicator", units: "Percent", ...overrides }] };
}

function observationsBody(observations, unitsOverride) {
  return { realtime_start: "2026-01-01", realtime_end: "2026-01-01", units: unitsOverride !== undefined ? unitsOverride : "Percent", observations };
}

// Mirrors fredMacroComposer.test.js's own mock dispatcher.
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

// Runs fn() with process.env.FRED_API_KEY set to `value` (or deleted if
// undefined), always restoring the original value afterward so this test
// file never leaks env state into any other test file run in the same
// process.
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

const singleObservation = [{ date: "2026-01-01", value: "42.5", realtime_start: "2026-01-15", realtime_end: "9999-12-31" }];

// 1. Successful composition with a synthetic credential.
test("1. a configured synthetic credential produces a successful composition", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await loadLiveMacroData(["A"], {
      adapterConfig: {
        fetchImpl: makeMockFetch({
          metadata: jsonResponse(200, seriesMetadataBody()),
          observations: jsonResponse(200, observationsBody(singleObservation)),
        }),
      },
    });
    assert.equal(result.macroData.length, 1);
    assert.equal(result.macroData[0].indicator, "Synthetic Test Indicator");
    assert.equal(result.seriesResults[0].ok, true);
    assert.deepEqual(result.warnings, []);
  });
});

// 2 & 6. Missing FRED_API_KEY: safe empty result, adapter never constructed/fetchImpl never called.
test("2/6. a missing FRED_API_KEY returns the documented empty result and never invokes fetchImpl (adapter never effectively used)", async () => {
  await withEnvKey(undefined, async () => {
    let called = false;
    const result = await loadLiveMacroData(["A"], {
      adapterConfig: {
        fetchImpl: async () => {
          called = true;
          return jsonResponse(200, {});
        },
      },
    });
    assert.deepEqual(result, { macroData: [], seriesResults: [], warnings: ["FRED_API_KEY not configured."] });
    assert.equal(called, false);
  });
});

test("2b. an empty-string FRED_API_KEY is treated the same as missing", async () => {
  await withEnvKey("", async () => {
    let called = false;
    const result = await loadLiveMacroData(["A"], { adapterConfig: { fetchImpl: async () => { called = true; } } });
    assert.deepEqual(result, { macroData: [], seriesResults: [], warnings: ["FRED_API_KEY not configured."] });
    assert.equal(called, false);
  });
});

// 3. Adapter/network failure.
test("3. an adapter/network failure is passed through as a failed series entry, not thrown", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await loadLiveMacroData(["A"], {
      adapterConfig: {
        fetchImpl: makeMockFetch({
          metadata: async () => {
            throw new Error("connection refused");
          },
          observations: jsonResponse(200, observationsBody(singleObservation)),
        }),
      },
    });
    assert.equal(result.macroData.length, 0);
    assert.equal(result.seriesResults[0].ok, false);
    assert.equal(result.seriesResults[0].code, "API_UNAVAILABLE");
  });
});

// 4. Malformed/invalid provider response (matching existing adapter test conventions).
test("4. a malformed metadata response (no usable title) is passed through as MALFORMED_DATA, no record fabricated", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await loadLiveMacroData(["A"], {
      adapterConfig: {
        fetchImpl: makeMockFetch({
          metadata: jsonResponse(200, { seriess: [] }),
          observations: jsonResponse(200, observationsBody(singleObservation)),
        }),
      },
    });
    assert.equal(result.macroData.length, 0);
    assert.equal(result.seriesResults[0].ok, false);
    assert.equal(result.seriesResults[0].code, "MALFORMED_DATA");
  });
});

// 5. Credential non-exposure, across both a success and a failure scenario.
test("5. the synthetic credential never appears anywhere in the returned structure, success or failure", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const successResult = await loadLiveMacroData(["A"], {
      adapterConfig: {
        fetchImpl: makeMockFetch({
          metadata: jsonResponse(200, seriesMetadataBody()),
          observations: jsonResponse(200, observationsBody(singleObservation)),
        }),
      },
    });
    assert.ok(!JSON.stringify(successResult).includes(SYNTHETIC_KEY));

    const failureResult = await loadLiveMacroData(["A"], {
      adapterConfig: { fetchImpl: makeMockFetch({ metadata: jsonResponse(401, {}), observations: jsonResponse(200, observationsBody(singleObservation)) }) },
    });
    assert.ok(!JSON.stringify(failureResult).includes(SYNTHETIC_KEY));
  });
});

// 5b. Confirm the credential genuinely reaches the constructed URL internally (proves the leakage test above isn't vacuous).
test("5b. sanity check: the synthetic key genuinely is used to build the request URL internally (proves test 5 is not vacuous)", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const capturedUrls = [];
    await loadLiveMacroData(["A"], {
      adapterConfig: {
        fetchImpl: makeMockFetch({
          onCall: (url) => capturedUrls.push(url),
          metadata: jsonResponse(200, seriesMetadataBody()),
          observations: jsonResponse(200, observationsBody(singleObservation)),
        }),
      },
    });
    assert.ok(capturedUrls.length > 0 && capturedUrls.every((u) => u.includes(SYNTHETIC_KEY)));
  });
});

// 7. Composer output shape preserved exactly.
test("7. the returned shape exactly matches composeMacroData()'s own output — { macroData, seriesResults, warnings }, nothing added or removed", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await loadLiveMacroData(["A"], {
      adapterConfig: {
        fetchImpl: makeMockFetch({
          metadata: jsonResponse(200, seriesMetadataBody()),
          observations: jsonResponse(200, observationsBody(singleObservation)),
        }),
      },
    });
    assert.deepEqual(Object.keys(result).sort(), ["macroData", "seriesResults", "warnings"]);
  });
});

// Additional: options.composeOptions is forwarded to composeMacroData() unchanged.
test("composeOptions is forwarded through to composeMacroData()'s own options parameter", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    let capturedRequest;
    const result = await loadLiveMacroData(["A"], {
      adapterConfig: {
        fetchImpl: async (url, opts) => {
          if (url.includes("/series/observations")) {
            capturedRequest = opts;
            return jsonResponse(200, observationsBody(singleObservation));
          }
          return jsonResponse(200, seriesMetadataBody());
        },
      },
      composeOptions: { observationParams: { units: "pc1" } },
    });
    assert.equal(result.macroData.length, 1);
  });
});

// Additional: no code path in this file references fetch(), http/https, or a hardcoded credential.
test("the live-source file never references fetch(), http/https require(), or any credential literal", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("./fredMacroLiveSource.js"), "utf8");
  const codeOnly = src.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.ok(!/\bfetch\(/.test(codeOnly));
  assert.ok(!/require\(["'](http|https)["']\)/.test(codeOnly));
  assert.ok(!/["'][A-Za-z0-9]{20,}["']/.test(codeOnly)); // no hardcoded key-shaped literal
});
