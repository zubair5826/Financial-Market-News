// STEP 28 — Offline end-to-end integration test proving:
//   synthetic FRED provider data
//   -> fredMacroLiveSource.loadLiveMacroData()
//   -> macroData
//   -> synthetic application request
//   -> existing, UNMODIFIED processRequest()
//   -> normal pipeline result
//
// Entirely offline: a synthetic fetchImpl stands in for the real FRED
// API, and process.env.FRED_API_KEY is temporarily set to an obviously
// synthetic value for the duration of this file only, then restored.
// The real .env is never read; the real FRED_API_KEY is never used.
// processRequest() is called exactly as it already exists — no
// modification to it or to any other production file.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadLiveMacroData } = require("../providers/fredMacroLiveSource");
const { processRequest } = require("../orchestrator");

const SYNTHETIC_KEY = "SYNTHETIC_KEY";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Simulates the real two-call FRED behavior for GNPCA with deterministic,
// clearly-synthetic data (not a claim about real FRED values).
function makeSyntheticFredFetch(callLog) {
  return async (url, opts) => {
    callLog.push(url);
    if (url.includes("/series/observations")) {
      return jsonResponse(200, {
        realtime_start: "2026-01-01",
        realtime_end: "2026-01-01",
        units: "Billions of Dollars",
        observations: [{ date: "2026-01-01", value: "21427.2", realtime_start: "2026-02-15", realtime_end: "9999-12-31" }],
      });
    }
    if (url.includes("/series")) {
      return jsonResponse(200, { seriess: [{ id: "GNPCA", title: "Real Gross National Product", units: "Billions of Dollars" }] });
    }
    throw new Error(`Unexpected mock URL in STEP 28 test: ${url}`);
  };
}

async function withSyntheticEnvKey(fn) {
  const original = process.env.FRED_API_KEY;
  process.env.FRED_API_KEY = SYNTHETIC_KEY;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.FRED_API_KEY;
    else process.env.FRED_API_KEY = original;
  }
}

test("STEP 28: synthetic FRED data flows through loadLiveMacroData() -> request.macroData -> unmodified processRequest()", async () => {
  await withSyntheticEnvKey(async () => {
    const callLog = [];

    // 1. loadLiveMacroData() succeeds with the synthetic credential.
    const composition = await loadLiveMacroData(["GNPCA"], {
      adapterConfig: { fetchImpl: makeSyntheticFredFetch(callLog) },
    });

    // 2. Composition shape.
    assert.deepEqual(Object.keys(composition).sort(), ["macroData", "seriesResults", "warnings"]);

    // 3. seriesResults confirms GNPCA succeeded.
    assert.deepEqual(composition.seriesResults, [{ seriesId: "GNPCA", ok: true, recordCount: 1 }]);
    assert.deepEqual(composition.warnings, []);

    // 4. macroData contains the expected synthetic macro record.
    assert.equal(composition.macroData.length, 1);
    const composedRecord = composition.macroData[0];
    assert.equal(composedRecord.indicator, "Real Gross National Product");
    assert.equal(composedRecord.indicator_code, "GNPCA");
    assert.equal(composedRecord.actual_value, 21427.2);
    assert.equal(composedRecord.source, "Federal Reserve Bank of St. Louis (FRED)");

    // Network safety check: exactly two mock calls for the single series.
    assert.equal(callLog.length, 2);
    assert.ok(callLog.some((u) => u.includes("/series/observations")));
    assert.ok(callLog.some((u) => !u.includes("/series/observations") && u.includes("/series")));

    // 5/6/7/8. macroData reaches processRequest() via the request contract
    // already established and used by tests/pipeline.test.js — query,
    // asset, macroData, options.freshnessThresholds. processRequest() is
    // called exactly as it already exists, synchronously, unmodified.
    const request = {
      query: "Assess BTC",
      asset: "BTC",
      macroData: composition.macroData,
      options: {
        freshnessThresholds: { freshMaxMs: 3_600_000, agingMaxMs: 86_400_000 },
      },
    };

    const result = processRequest(request);

    // 6/7/8. processRequest() accepted the request, returned its normal
    // valid structure, and did not crash because macroData was supplied.
    assert.equal(result.ok, true);
    assert.equal(result.asset, "BTC");
    assert.equal(result.response.agent_name, "chief-trading-manager");
    assert.equal(result.pipeline_summary.macro_status, "OK");

    // 9. The composed macro data is actually visible in the returned
    // pipeline result, not merely accepted and ignored: the response's
    // macro_summary.sources includes the adapter's real source
    // attribution string, proving this exact composed record — not a
    // fabricated stand-in — was the one the Macro Agent processed.
    assert.ok(result.response.macro_summary.sources.includes("Federal Reserve Bank of St. Louis (FRED)"));
    // FRED never supplies impact_direction (frozen rule, Step 16B) — so
    // an UNKNOWN bias here is the correct, honest, already-tested
    // outcome, not a defect. Matches the same pattern already asserted
    // in tests/pipeline.test.js for domains with no impact_direction.
    assert.equal(result.response.macro_summary.bias, "UNKNOWN");

    // 10/11. No credential anywhere in either the composition or the
    // final pipeline result.
    assert.ok(!JSON.stringify(composition).includes(SYNTHETIC_KEY));
    assert.ok(!JSON.stringify(result).includes(SYNTHETIC_KEY));
  });
});

// 12. Zero real network requests — structural confirmation that this
// file itself never references a live network mechanism or hostname.
test("STEP 28: this test file makes zero real network requests (structural check)", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(__filename, "utf8");
  const codeOnly = src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n")
    .replace(/makeSyntheticFredFetch/g, ""); // strip this identifier so it cannot false-match a live fetch call below
  // Patterns are built dynamically (not written as literals) so this
  // file's own self-check code can never accidentally match itself —
  // the same false-positive class already fixed twice above.
  const fetchCallPattern = new RegExp("\\b" + "fetch" + "\\(");
  const hostnamePattern = new RegExp("st" + "louisfed", "i");
  assert.ok(!fetchCallPattern.test(codeOnly));
  assert.ok(!/require\(["'](http|https)["']\)/.test(codeOnly));
  assert.ok(!hostnamePattern.test(codeOnly));
});
