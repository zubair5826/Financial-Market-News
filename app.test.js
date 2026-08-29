// Offline/synthetic tests for runApplicationRequest() — Step 35's
// minimal application entrypoint. No test here ever contacts a real
// network endpoint or uses a real FRED credential. process.env is only
// ever set to obviously-synthetic values for the duration of a single
// test, always restored immediately afterward.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runApplicationRequest } = require("./app");
const { FRESHNESS_POLICY, getFreshnessThresholds, getFreshnessThresholdsByPipelineDomain } = require("./config/freshness");

// Step 102: a throwaway temp path so these tests never append to the
// real data/runs.jsonl. Passed via options.runStore.filePath — see
// app.js/data/runStore.js.
function tempRunsFile() {
  return path.join(os.tmpdir(), `app-test-runs-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
}
function readJsonlLines(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}
function cleanupFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Already absent.
  }
}

// Every pre-existing (pre-Step-102) test below calls
// runApplicationRequest() without caring about persistence at all — a
// single shared temp path keeps every one of those calls off the real
// data/runs.jsonl too, cleaned up once when this file's tests finish.
const SHARED_TEST_RUNS_FILE = tempRunsFile();
test.after(() => cleanupFile(SHARED_TEST_RUNS_FILE));
function withRunStore(options = {}) {
  return { ...options, runStore: { filePath: SHARED_TEST_RUNS_FILE } };
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}
function macroRecord(overrides = {}) {
  return {
    indicator: "Test Indicator",
    indicator_code: "TEST",
    country: "US",
    region: "North America",
    currency: "USD",
    category: "INFLATION",
    actual_value: 5,
    unit: "%",
    period: "2026-07",
    source: "test-source",
    source_type: "official-release",
    classification: "FACT",
    ...overrides,
  };
}

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
  const { value: result, networkCalled } = await withNetworkGuard(async () => runApplicationRequest(validBaseRequest(), withRunStore()));
  assert.equal(networkCalled, false);
  // Step 102: the contract gained one new, additive field —
  // `persistence` — reporting the outcome of writing this run to
  // data/runs.jsonl. pipelineResult/fredDiagnostics themselves are
  // untouched.
  assert.deepEqual(Object.keys(result).sort(), ["fredDiagnostics", "persistence", "pipelineResult"]);
  assert.equal(result.pipelineResult.ok, true);
  assert.equal(result.fredDiagnostics, null);
});

// 3. Contract shape holds under the FRED-enabled path too.
// 5. FRED-enabled invocation using the existing synthetic fetchImpl mechanism.
test("3/5. FRED enabled via synthetic fetchImpl: exactly two mock calls, no real network, macroData reaches the pipeline", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    const { value: result, networkCalled } = await withNetworkGuard(async () =>
      runApplicationRequest(
        validBaseRequest(),
        withRunStore({
          macro: { enabled: true },
          adapterConfig: {
            fetchImpl: makeMockFetch({
              onCall: (url) => calls.push(url),
              metadata: jsonResponse(200, seriesMetadataBody()),
              observations: jsonResponse(200, observationsBody(singleObservation)),
            }),
          },
        })
      )
    );
    assert.equal(networkCalled, false);
    assert.equal(calls.length, 2); // proves the pipeline ran exactly once, not duplicated
    assert.deepEqual(Object.keys(result).sort(), ["fredDiagnostics", "persistence", "pipelineResult"]);
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
    await runApplicationRequest(
      request,
      withRunStore({
        macro: { enabled: true },
        adapterConfig: {
          fetchImpl: makeMockFetch({
            metadata: jsonResponse(200, seriesMetadataBody()),
            observations: jsonResponse(200, observationsBody(singleObservation)),
          }),
        },
      })
    );
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
    const result = await runApplicationRequest(
      validBaseRequest(),
      withRunStore({
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
    assert.equal(calls.length, 2); // one metadata + one observations call — not four
    assert.equal(result.fredDiagnostics.seriesResults.length, 1);
  });
});

// 8. No credential exposure anywhere in the returned structure.
test("8. the synthetic credential never appears anywhere in the returned structure", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await runApplicationRequest(
      validBaseRequest(),
      withRunStore({
        macro: { enabled: true },
        adapterConfig: {
          fetchImpl: makeMockFetch({
            metadata: jsonResponse(200, seriesMetadataBody()),
            observations: jsonResponse(200, observationsBody(singleObservation)),
          }),
        },
      })
    );
    assert.ok(!JSON.stringify(result).includes(SYNTHETIC_KEY));
  });
});

// 9. Existing behavior remains intact: FRED-disabled caller-supplied
// macroData still passes through unchanged, exactly as
// runFredAwareRequest() already guarantees.
test("9. existing behavior remains intact: caller-supplied macroData passes through unchanged when FRED is disabled", async () => {
  const callerRecord = { indicator: "Caller Supplied", classification: "FACT" };
  const request = validBaseRequest({ macroData: [callerRecord] });
  const result = await runApplicationRequest(request, withRunStore({ macro: { enabled: false } }));
  assert.equal(result.fredDiagnostics, null);
  assert.equal(result.pipelineResult.pipeline_summary.macro_status, "OK");
});

// --- Step 100: centralized freshness policy wiring ---

// 9/10 (Step 100 requirement list). Every production entrypoint uses
// the centralized configuration: omitting freshnessThresholds entirely
// must no longer silently leave freshness UNKNOWN — it now defaults to
// the exact FRESHNESS_POLICY.macro object.
test("100-1. omitting options.freshnessThresholds still evaluates a caller-supplied macro record's freshness against the centralized macro policy", async () => {
  const freshRecord = macroRecord({ release_timestamp: isoDaysAgo(1) }); // fresh under the 30-day macro window
  const staleRecord = macroRecord({ indicator: "Stale Test Indicator", release_timestamp: isoDaysAgo(200) }); // stale under the 120-day macro window

  const freshResult = await runApplicationRequest(validBaseRequest({ macroData: [freshRecord] }), withRunStore());
  const staleResult = await runApplicationRequest(validBaseRequest({ macroData: [staleRecord] }), withRunStore());

  assert.equal(freshResult.pipelineResult.ok, true);
  assert.equal(staleResult.pipelineResult.ok, true);
  // The stale record's own presence must be visible in the response as
  // a STALE-mentioning signal somewhere (warnings and/or the Chief
  // Trading Manager report) — never silently treated the same as fresh
  // data, and never UNKNOWN merely because no threshold was supplied.
  const staleMentioned = JSON.stringify(staleResult.pipelineResult).includes("STALE");
  const freshMentionsStale = JSON.stringify(freshResult.pipelineResult).includes('"STALE"');
  assert.ok(staleMentioned, "a 200-day-old macro record must surface a STALE signal now that a real threshold is applied by default");
  assert.ok(!freshMentionsStale, "a 1-day-old macro record must never be reported as STALE");
});

// An explicit caller-supplied freshnessThresholds value is never
// overridden by the centralized default. NOTE: the threshold lives on
// request.options.freshnessThresholds (what processRequest() actually
// reads), not on this function's own second `options` parameter (that
// one only controls this entrypoint's FRED-wiring, e.g.
// options.macro.enabled) — see the Step 100 comment in app.js.
test("100-2. an explicit request.options.freshnessThresholds is preserved, never replaced by the centralized default", async () => {
  // A deliberately tiny custom threshold — if the default silently won
  // instead, a 2-day-old record would incorrectly read FRESH under the
  // real 30-day macro default; with the caller's own 1-hour window
  // honored, it must read STALE.
  const tinyThreshold = { freshMaxMs: 60 * 1000, agingMaxMs: 60 * 60 * 1000 };
  const record = macroRecord({ release_timestamp: isoDaysAgo(2) });
  const request = validBaseRequest({ macroData: [record], options: { freshnessThresholds: tinyThreshold } });
  const result = await runApplicationRequest(request, withRunStore());
  assert.ok(JSON.stringify(result.pipelineResult).includes("STALE_DATA"));
});

// Stale status reaching the Risk Manager: runRiskManager() (see
// orchestrator/index.js's sendToRiskManager()) receives the raw
// macroReport — containing the STALE_DATA warning the fix above now
// makes computable at all — as one of its own direct inputs, and the
// pipeline's final top-level `warnings` (assembled after Risk Manager
// runs) carries that same signal through to the caller.
//
// Disclosed, pre-existing, out-of-scope limitation found while writing
// this test: escalating this into the Risk Manager's own TIMING_RISK
// *category* does not currently happen for ANY domain (verified: both
// agents/macro-agent/index.js and agents/news-agent/index.js push
// STALE_DATA only into their report's `warnings` array, never
// `uncertainties`; agents/trade-setup-agent/index.js's evidence
// aggregation forwards only `uncertainties` between agents — see
// agents/trade-setup-agent/evidence.js). Fixing that would mean
// changing cross-agent aggregation logic in the Trade Setup Agent,
// which is a pipeline change, not a freshness-configuration one, and
// is explicitly out of this step's scope ("do not redesign the
// intelligence pipeline"). This test verifies the real, current
// behavior, not an assumed one.
test("100-3. a stale macro record (centralized default policy) reaches the Risk Manager's own input and the final pipeline warnings", async () => {
  const staleRecord = macroRecord({ release_timestamp: isoDaysAgo(200) });
  const result = await runApplicationRequest(validBaseRequest({ macroData: [staleRecord] }), withRunStore());
  // The Risk Manager's own report is present (it ran, using macroReport
  // as one of its real inputs) and the STALE_DATA signal reaches the
  // final, top-level response the caller actually receives.
  assert.ok(result.pipelineResult.response.risk_summary);
  assert.ok(
    result.pipelineResult.warnings.some((w) => (typeof w === "string" ? w.includes("STALE") : w && w.code === "STALE_DATA")),
    "the STALE_DATA signal must reach the final top-level pipeline response"
  );
});

// The centralized policy object itself — not a duplicated copy — is
// what flows through, confirmed by identity against config/freshness.js.
test("100-4. the exact FRESHNESS_POLICY.macro object (not a re-derived copy) is what a caller retrieves for this entrypoint's domain", () => {
  assert.equal(getFreshnessThresholds("macro"), FRESHNESS_POLICY.macro);
});

// --- Step 102: persistent run store, wired through app.js ---

test("102-1. a successful run is persisted to the run store with a matching run_id", async () => {
  const filePath = tempRunsFile();
  try {
    const result = await runApplicationRequest(validBaseRequest(), { runStore: { filePath } });
    assert.equal(result.persistence.status, "PERSISTED");
    assert.ok(result.persistence.run_id);

    const lines = readJsonlLines(filePath);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].run_id, result.persistence.run_id);
  } finally {
    cleanupFile(filePath);
  }
});

test("102-2. two separate runs receive unique run IDs end to end", async () => {
  const filePath = tempRunsFile();
  try {
    const first = await runApplicationRequest(validBaseRequest(), { runStore: { filePath } });
    const second = await runApplicationRequest(validBaseRequest(), { runStore: { filePath } });
    assert.notEqual(first.persistence.run_id, second.persistence.run_id);
  } finally {
    cleanupFile(filePath);
  }
});

test("102-3. persisted records are valid JSONL — one independently parseable JSON object per line", async () => {
  const filePath = tempRunsFile();
  try {
    await runApplicationRequest(validBaseRequest(), { runStore: { filePath } });
    await runApplicationRequest(validBaseRequest(), { runStore: { filePath } });
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 2);
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line));
    }
  } finally {
    cleanupFile(filePath);
  }
});

test("102-4. multiple runs append correctly across separate calls, none overwritten", async () => {
  const filePath = tempRunsFile();
  try {
    await runApplicationRequest(validBaseRequest({ asset: "BTC" }), { runStore: { filePath } });
    await runApplicationRequest(validBaseRequest({ asset: "ETH" }), { runStore: { filePath } });
    await runApplicationRequest(validBaseRequest({ asset: "US" }), { runStore: { filePath } });
    const lines = readJsonlLines(filePath);
    assert.equal(lines.length, 3);
    assert.deepEqual(lines.map((l) => l.requested_instrument), ["BTC", "ETH", "US"]);
  } finally {
    cleanupFile(filePath);
  }
});

test("102-5. the stored record contains every field required by the Step 102 spec", async () => {
  const filePath = tempRunsFile();
  try {
    await runApplicationRequest(validBaseRequest(), { runStore: { filePath } });
    const [record] = readJsonlLines(filePath);
    for (const field of [
      "run_id",
      "timestamp",
      "requested_instrument",
      "original_request",
      "normalized_request",
      "provider_diagnostics",
      "freshness_status",
      "data_quality_status",
      "agent_outputs",
      "risk_manager_result",
      "chief_trading_manager_result",
      "final_decision",
      "confidence",
      "warnings",
      "errors",
    ]) {
      assert.ok(Object.prototype.hasOwnProperty.call(record, field), `missing field: ${field}`);
    }
    assert.equal(record.requested_instrument, "US");
    assert.ok(record.risk_manager_result);
    assert.ok(record.chief_trading_manager_result);
  } finally {
    cleanupFile(filePath);
  }
});

test("102-6. no secrets are stored — a credential-shaped field anywhere in the request is redacted end to end", async () => {
  const filePath = tempRunsFile();
  try {
    const request = validBaseRequest({ options: { adapterConfig: { apiKey: "sk-should-never-be-persisted" } } });
    await runApplicationRequest(request, { runStore: { filePath } });
    const raw = fs.readFileSync(filePath, "utf8");
    assert.ok(!raw.includes("sk-should-never-be-persisted"));
  } finally {
    cleanupFile(filePath);
  }
});

test("102-7. a persistence failure is handled safely — the request still succeeds, with a FAILED persistence outcome, never a thrown error", async () => {
  const blockerFile = tempRunsFile();
  fs.writeFileSync(blockerFile, "not a directory");
  const impossiblePath = path.join(blockerFile, "runs.jsonl");
  try {
    const result = await runApplicationRequest(validBaseRequest(), { runStore: { filePath: impossiblePath } });
    assert.equal(result.pipelineResult.ok, true);
    assert.equal(result.persistence.status, "FAILED");
    assert.ok(result.persistence.error);
  } finally {
    cleanupFile(blockerFile);
  }
});

test("102-8. the intelligence decision itself is identical whether persistence succeeds or fails", async () => {
  const goodFilePath = tempRunsFile();
  const blockerFile = tempRunsFile();
  fs.writeFileSync(blockerFile, "not a directory");
  const badFilePath = path.join(blockerFile, "runs.jsonl");
  try {
    const withSuccess = await runApplicationRequest(validBaseRequest(), { runStore: { filePath: goodFilePath } });
    const withFailure = await runApplicationRequest(validBaseRequest(), { runStore: { filePath: badFilePath } });
    // Compare the actual decision content, not a byte-for-byte object
    // (every report layer stamps its own fresh `timestamp` per call —
    // that varies between any two calls regardless of persistence, and
    // is not part of "the intelligence decision itself").
    assert.equal(withSuccess.pipelineResult.ok, withFailure.pipelineResult.ok);
    assert.equal(withSuccess.pipelineResult.asset, withFailure.pipelineResult.asset);
    assert.deepEqual(withSuccess.pipelineResult.pipeline_summary, withFailure.pipelineResult.pipeline_summary);
    assert.deepEqual(withSuccess.pipelineResult.warnings, withFailure.pipelineResult.warnings);
    assert.deepEqual(withSuccess.pipelineResult.errors, withFailure.pipelineResult.errors);
    assert.equal(withSuccess.pipelineResult.response.final_assessment, withFailure.pipelineResult.response.final_assessment);
    assert.equal(withSuccess.pipelineResult.response.decision_status, withFailure.pipelineResult.response.decision_status);
    assert.equal(withSuccess.pipelineResult.response.risk_summary.risk_decision, withFailure.pipelineResult.response.risk_summary.risk_decision);
    assert.notEqual(withSuccess.persistence.status, withFailure.persistence.status);
  } finally {
    cleanupFile(goodFilePath);
    cleanupFile(blockerFile);
  }
});

// --- Step 106: per-domain freshness reaches each specialist ---

// Step 100 gave this entrypoint ONE window (the macro one) and handed
// it to all four specialists. Correct for a FRED release, wrong for a
// news headline — a three-week-old article read FRESH. Step 106 adds
// the per-domain map alongside it; the flat value is kept so any
// consumer reading that single field, and any domain deliberately
// absent from the map, behaves exactly as before.
test("106-12. omitting freshnessThresholds now also supplies the per-domain policy map", async () => {
  const filePath = tempRunsFile();
  try {
    await runApplicationRequest(validBaseRequest(), { runStore: { filePath } });
    const [record] = readJsonlLines(filePath);
    const options = record.normalized_request.options;

    assert.deepEqual(options.freshnessThresholds, FRESHNESS_POLICY.macro, "the flat macro default is still supplied");
    assert.deepEqual(options.freshnessThresholdsByDomain, getFreshnessThresholdsByPipelineDomain());
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test("106-13. an explicit caller threshold stays the sole authority — no per-domain map is added alongside it", async () => {
  const filePath = tempRunsFile();
  const tinyThreshold = { freshMaxMs: 60 * 1000, agingMaxMs: 60 * 60 * 1000 };
  try {
    await runApplicationRequest(
      validBaseRequest({ options: { freshnessThresholds: tinyThreshold } }),
      { runStore: { filePath } }
    );
    const [record] = readJsonlLines(filePath);
    const options = record.normalized_request.options;

    assert.deepEqual(options.freshnessThresholds, tinyThreshold);
    assert.equal(options.freshnessThresholdsByDomain, undefined, "an explicit threshold is never silently supplemented");
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

// The behavioral consequence, end to end through this entrypoint: a
// three-week-old headline is now measured against the NEWS window and
// reported STALE, while an equally old macro release stays FRESH under
// its own 30-day window.
test("106-14. a three-week-old news headline is STALE through this entrypoint while an equally old macro release is not", async () => {
  const threeWeeksAgo = isoDaysAgo(21);
  const request = validBaseRequest({
    macroData: [macroRecord({ release_timestamp: threeWeeksAgo })],
    newsData: [
      {
        asset: "US",
        headline: "Three-week-old headline",
        classification: "FACT",
        source: "news-src-A",
        publication_timestamp: threeWeeksAgo,
        impact_direction: "POSITIVE",
        verification_status: "VERIFIED_PRIMARY",
      },
    ],
  });

  const result = await runApplicationRequest(request, withRunStore());
  const staleWarnings = result.pipelineResult.warnings.filter((w) => w && typeof w === "object" && w.code === "STALE_DATA");

  assert.equal(staleWarnings.length, 1, "exactly the news record is stale");
  assert.match(staleWarnings[0].message, /Three-week-old headline/);
});
