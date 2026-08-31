// Offline/synthetic tests for runIntelligence() / summarize() —
// Step 37's minimal user-facing intelligence runner. No test here
// ever contacts a real network endpoint or uses a real FRED
// credential. process.env is only ever set to obviously-synthetic
// values for the duration of a single test, always restored
// immediately afterward.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runIntelligence, summarize } = require("./runIntelligence");

const SYNTHETIC_KEY = "SYNTHETIC_KEY";

// Step 102: every runIntelligence() call now persists a run record.
// A throwaway per-test temp path keeps these tests from ever appending
// to the real data/runs.jsonl — mirrors app.test.js's own convention.
function tempRunsFile() {
  return path.join(os.tmpdir(), `run-intelligence-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
}
function cleanupFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Already absent.
  }
}

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

function makeMockFetch({ onCall } = {}) {
  return async (url) => {
    if (onCall) onCall(url);
    if (url.includes("/series/observations")) return jsonResponse(200, observationsBody(singleObservation));
    if (url.includes("/series")) return jsonResponse(200, seriesMetadataBody());
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

// Guards against any real network call for the duration of fn().
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

// 1. The module can be imported and exposes both functions.
test("1. runIntelligence.js can be imported and exposes runIntelligence + summarize as functions", () => {
  assert.equal(typeof runIntelligence, "function");
  assert.equal(typeof summarize, "function");
});

// 2. The runner calls through to the existing app.js entrypoint: with
// no FRED credential present, the existing safe empty-result behavior
// is preserved (no network), proving app.js/runFredAwareRequest() —
// not some duplicated logic — actually handled the call.
test("2. runIntelligence calls the existing app.js entrypoint (no credential -> existing safe empty-result behavior, no network)", async () => {
  const filePath = tempRunsFile();
  try {
    await withEnvKey(undefined, async () => {
      const { value: result, networkCalled } = await withNetworkGuard(async () =>
        runIntelligence({ query: "Assess US macro conditions", asset: "US" }, { runStore: { filePath } })
      );
      assert.equal(networkCalled, false);
      // Step 102: the contract gained one new, additive field —
      // `persistence` — see app.js/data/runStore.js. Step 5D added a
      // second additive field, `llmAnnotation` (null here since the
      // LLM layer is disabled by default) — see app.js/llm/reasoningService.js.
      assert.deepEqual(Object.keys(result).sort(), ["fredDiagnostics", "llmAnnotation", "persistence", "pipelineResult"]);
      assert.equal(result.llmAnnotation, null);
      assert.equal(result.pipelineResult.ok, true);
      assert.ok(result.fredDiagnostics); // FRED path was reached (enabled:true), just returned empty due to missing credential
      assert.deepEqual(result.fredDiagnostics.warnings, ["FRED_API_KEY not configured."]);
    });
  } finally {
    cleanupFile(filePath);
  }
});

// 3. FRED-enabled path works through the existing mechanisms (synthetic fetchImpl).
test("3. FRED-enabled path works via the existing synthetic fetchImpl mechanism: exactly two mock calls, macro_status OK", async () => {
  const filePath = tempRunsFile();
  try {
    await withEnvKey(SYNTHETIC_KEY, async () => {
      const calls = [];
      const { value: result, networkCalled } = await withNetworkGuard(async () =>
        runIntelligence(
          { query: "Assess US macro conditions", asset: "US" },
          { adapterConfig: { fetchImpl: makeMockFetch({ onCall: (u) => calls.push(u) }) }, runStore: { filePath } }
        )
      );
      assert.equal(networkCalled, false);
      assert.equal(calls.length, 2); // proves no duplicated pipeline execution (not 4)
      assert.equal(result.pipelineResult.ok, true);
      assert.equal(result.pipelineResult.pipeline_summary.macro_status, "OK");
      assert.ok(result.fredDiagnostics);
      assert.equal(result.fredDiagnostics.seriesResults[0].ok, true);
    });
  } finally {
    cleanupFile(filePath);
  }
});

// 4. No request mutation: the caller's {query, asset} input is never touched.
test("4. the caller's input object is not mutated", async () => {
  const filePath = tempRunsFile();
  try {
    await withEnvKey(SYNTHETIC_KEY, async () => {
      const input = { query: "Assess US macro conditions", asset: "US" };
      const snapshot = JSON.parse(JSON.stringify(input));
      await runIntelligence(input, { adapterConfig: { fetchImpl: makeMockFetch() }, runStore: { filePath } });
      assert.deepEqual(input, snapshot);
    });
  } finally {
    cleanupFile(filePath);
  }
});

// 5. No credential exposure anywhere in the returned structure.
test("5. the synthetic credential never appears anywhere in the returned structure", async () => {
  const filePath = tempRunsFile();
  try {
    await withEnvKey(SYNTHETIC_KEY, async () => {
      const result = await runIntelligence(
        { query: "Assess US macro conditions", asset: "US" },
        { adapterConfig: { fetchImpl: makeMockFetch() }, runStore: { filePath } }
      );
      assert.ok(!JSON.stringify(result).includes(SYNTHETIC_KEY));
    });
  } finally {
    cleanupFile(filePath);
  }
});

// 6. summarize() reads only existing fields, never invents one, and never leaks a credential.
test("6. summarize() produces a concise object built only from existing pipelineResult/fredDiagnostics fields", async () => {
  const filePath = tempRunsFile();
  try {
    await withEnvKey(SYNTHETIC_KEY, async () => {
      const result = await runIntelligence(
        { query: "Assess US macro conditions", asset: "US" },
        { adapterConfig: { fetchImpl: makeMockFetch() }, runStore: { filePath } }
      );
      const display = summarize(result);
      assert.equal(display.asset, result.pipelineResult.asset);
      assert.equal(display.ok, result.pipelineResult.ok);
      assert.equal(display.macro_status, result.pipelineResult.pipeline_summary.macro_status);
      assert.equal(display.fred_status, "ENABLED");
      assert.deepEqual(display.warnings, result.pipelineResult.warnings);
      assert.deepEqual(display.errors, result.pipelineResult.errors);
      assert.ok(!JSON.stringify(display).includes(SYNTHETIC_KEY));
    });
  } finally {
    cleanupFile(filePath);
  }
});

// 7. summarize() reports fred_status DISABLED-equivalent semantics correctly reflect a null fredDiagnostics
// (exercised directly, without going through the network-touching runner, to prove summarize() itself
// makes no assumption beyond what it's given).
test("7. summarize() reports fred_status DISABLED when fredDiagnostics is null", () => {
  const display = summarize({
    pipelineResult: { asset: "US", ok: true, pipeline_summary: { macro_status: "MISSING" }, warnings: [], errors: [] },
    fredDiagnostics: null,
  });
  assert.equal(display.fred_status, "DISABLED");
});
