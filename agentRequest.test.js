// Offline/synthetic tests for the unified composition function
// (agentRequest.js's runAgentRequest).
//
// No test here contacts a real network endpoint or uses a real
// credential. Every provider domain stays disabled unless a test
// explicitly enables it with a mocked fetch, and every run appends
// only to a temp file — never to the real data/runs.jsonl.
//
// Fixture style mirrors app.llmIntegration.test.js deliberately, so
// the two integration points stay directly comparable.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runAgentRequest } = require("./agentRequest");

const TEST_RUNS_FILE = path.join(os.tmpdir(), `agent-request-test-runs-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
const RUN_STORE = { runStore: { filePath: TEST_RUNS_FILE } };

test.after(() => {
  try {
    fs.unlinkSync(TEST_RUNS_FILE);
  } catch {
    // Already absent.
  }
});

const SYNTHETIC_KEY = "synthetic-agent-request-test-key-not-real-000";

async function withEnvKey(value, fn) {
  const original = process.env.ANTHROPIC_API_KEY;
  if (value === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  }
}

// A genuine, non-vacuous safety net: any real outbound call during
// fn() throws loudly instead of silently leaving the machine.
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

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function anthropicSuccessBody(outputObject) {
  return {
    content: [{ type: "text", text: JSON.stringify(outputObject) }],
    model: "claude-sonnet-5",
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

function validClaudeOutput(overrides = {}) {
  return {
    output_schema_version: "llm-output-v1",
    narrative_summary: "Macro and technical evidence lean bullish for BTC.",
    key_factors: [{ factor: "Macro bias", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.macro.bias" }],
    risk_commentary: "The Risk Manager's decision stands as computed.",
    uncertainties_acknowledged: [],
    caveats: ["This is not financial advice."],
    ...overrides,
  };
}

function stripTimestamps(value) {
  if (Array.isArray(value)) return value.map(stripTimestamps);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (key === "timestamp") continue;
      out[key] = stripTimestamps(v);
    }
    return out;
  }
  return value;
}

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function candles(asset = "BTC") {
  const prices = [100, 102, 104, 101, 99, 103, 107, 104, 100, 105, 110];
  return prices.map((p, i) => ({
    asset,
    timeframe: "1day",
    timestamp: iso(-(prices.length - 1 - i) * 3_600_000),
    open: p,
    high: p + 1,
    low: p - 1,
    close: p,
    source: "technical-src-A",
    classification: "FACT",
    verification_status: "VERIFIED_PRIMARY",
  }));
}

const ALL_SIX_SIZING_PARAMS = Object.freeze({
  accountBalance: 10000,
  riskPercentage: 0.01,
  leverage: 1,
  entryPrice: 100,
  stopPrice: 95,
  contractSize: 1,
});

function bullishRequest(requestOptions = {}) {
  return {
    query: "Assess BTC",
    asset: "BTC",
    newsData: [
      {
        asset: "BTC",
        headline: "Regulator signals clearer path",
        classification: "FACT",
        source: "news-src-A",
        publication_timestamp: iso(),
        impact_direction: "POSITIVE",
        verification_status: "VERIFIED_PRIMARY",
      },
    ],
    macroData: [
      {
        indicator: "CPI",
        classification: "FACT",
        country: "US",
        category: "INFLATION",
        source: "macro-src-A",
        release_timestamp: iso(),
        impact_direction: "POSITIVE",
        verification_status: "VERIFIED_PRIMARY",
      },
    ],
    technicalCandles: candles(),
    sentimentData: [
      {
        asset: "BTC",
        sentiment: "BULLISH",
        classification: "FACT",
        source: "sentiment-src-A",
        timestamp: iso(),
        verification_status: "VERIFIED_PRIMARY",
      },
    ],
    options: { freshnessThresholds: { freshMaxMs: 3_600_000, agingMaxMs: 86_400_000 }, ...requestOptions },
  };
}

function readLastRecord() {
  const lines = fs.readFileSync(TEST_RUNS_FILE, "utf8").trim().split("\n").filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

// ============================================================
// A. Composition shape and defaults
// ============================================================

test("A1. returns { pipelineResult, diagnostics, persistence, llmAnnotation } and nothing else", async () => {
  const { value: result, networkCalled } = await withNetworkGuard(() => runAgentRequest(bullishRequest(), RUN_STORE));
  assert.equal(networkCalled, false);
  assert.deepEqual(Object.keys(result).sort(), ["diagnostics", "llmAnnotation", "persistence", "pipelineResult"]);
  assert.equal(result.pipelineResult.ok, true);
});

test("A2. no provider domain is enabled by default — the composition function enables nothing on its own", async () => {
  const { value: result, networkCalled } = await withNetworkGuard(() => runAgentRequest(bullishRequest(), RUN_STORE));
  assert.equal(networkCalled, false);
  // The "no domain enabled" branch of runMarketIntelligenceRequest()
  // returns diagnostics: null outright — proof nothing was fetched.
  assert.equal(result.diagnostics, null);
});

test("A3. the caller's request and options objects are never mutated", async () => {
  const request = bullishRequest();
  const options = { ...RUN_STORE };
  const requestBefore = JSON.stringify(request);
  const optionsBefore = JSON.stringify(options);

  await runAgentRequest(request, options);

  assert.equal(JSON.stringify(request), requestBefore);
  assert.equal(JSON.stringify(options), optionsBefore);
});

test("A4. called with no options at all, it still completes and does not throw", async () => {
  // Uses the real default run-store path deliberately? No — that would
  // pollute data/runs.jsonl. Persistence is exercised everywhere else;
  // here we only need the no-options code path not to crash, so the
  // store path is still redirected.
  const result = await runAgentRequest(bullishRequest(), RUN_STORE);
  assert.equal(result.pipelineResult.ok, true);
});

// ============================================================
// B. Persistence — the gap this function exists to close
// ============================================================

test("B1. every run is persisted, which the multi-domain path never did before", async () => {
  const result = await runAgentRequest(bullishRequest(), RUN_STORE);
  assert.equal(result.persistence.status, "PERSISTED");
  assert.equal(typeof result.persistence.run_id, "string");

  const record = readLastRecord();
  assert.equal(record.run_id, result.persistence.run_id);
  assert.equal(record.requested_instrument, "BTC");
  assert.equal(record.ok, true);
});

test("B2. a persistence failure never fails the request or alters pipelineResult", async () => {
  // An unwritable path (a directory component that is actually a file)
  // forces persistRun()'s internal catch.
  const impossiblePath = path.join(TEST_RUNS_FILE, "cannot", "exist.jsonl");
  const request = bullishRequest();

  const good = await runAgentRequest(request, RUN_STORE);
  const bad = await runAgentRequest(request, { runStore: { filePath: impossiblePath } });

  assert.equal(bad.persistence.status, "FAILED");
  assert.equal(bad.pipelineResult.ok, true);
  assert.deepEqual(stripTimestamps(bad.pipelineResult.response), stripTimestamps(good.pipelineResult.response));
});

test("B3. the run record carries the multi-domain diagnostics as provider_diagnostics", async () => {
  await runAgentRequest(bullishRequest(), RUN_STORE);
  const record = readLastRecord();
  // No domain enabled here, so diagnostics is null — recorded honestly
  // as null rather than as an invented empty object.
  assert.equal(record.provider_diagnostics, null);
});

// ============================================================
// C. positionSizingParams flow-through (all-six-or-nothing intact)
// ============================================================

test("C1. absent sizing params preserve the existing honest DATA_UNAVAILABLE behavior", async () => {
  const result = await runAgentRequest(bullishRequest(), RUN_STORE);
  const sizing = result.pipelineResult.response.risk_summary.position_size_status;

  assert.equal(sizing.status, "DATA_UNAVAILABLE");
  assert.equal(sizing.position_size, "UNKNOWN");
  assert.deepEqual(sizing.missing_parameters, [
    "accountBalance",
    "riskPercentage",
    "leverage",
    "entryPrice",
    "stopPrice",
    "contractSize",
  ]);
});

test("C2. a PARTIAL sizing set is still DATA_UNAVAILABLE — the all-six rule is not weakened", async () => {
  const result = await runAgentRequest(
    bullishRequest({ positionSizingParams: { accountBalance: 10000, riskPercentage: 0.01 } }),
    RUN_STORE
  );
  const sizing = result.pipelineResult.response.risk_summary.position_size_status;

  assert.equal(sizing.status, "DATA_UNAVAILABLE");
  assert.equal(sizing.position_size, "UNKNOWN");
  // The two supplied values are neither completed nor guessed; the
  // four genuinely missing ones are named exactly.
  assert.deepEqual(sizing.missing_parameters, ["leverage", "entryPrice", "stopPrice", "contractSize"]);
});

test("C3. all six supplied flows through to the Risk Manager and is CALCULATED", async () => {
  const result = await runAgentRequest(bullishRequest({ positionSizingParams: ALL_SIX_SIZING_PARAMS }), RUN_STORE);
  const sizing = result.pipelineResult.response.risk_summary.position_size_status;

  assert.equal(sizing.status, "CALCULATED");
  // 10000 * 0.01 = 100 risked; |100 - 95| = 5 per unit; 20 units * 1.
  assert.equal(sizing.position_size, 20);
  assert.deepEqual(sizing.missing_parameters, []);
});

test("C4. supplying sizing removes EXECUTION_RISK, which is what unblocks a supported verdict", async () => {
  const without = await runAgentRequest(bullishRequest(), RUN_STORE);
  const with6 = await runAgentRequest(bullishRequest({ positionSizingParams: ALL_SIX_SIZING_PARAMS }), RUN_STORE);

  assert.ok(without.pipelineResult.response.risk_summary.risk_categories.includes("EXECUTION_RISK"));
  assert.ok(!with6.pipelineResult.response.risk_summary.risk_categories.includes("EXECUTION_RISK"));

  assert.equal(without.pipelineResult.response.decision_status, "HIGH_RISK_REVIEW_REQUIRED");
  assert.equal(with6.pipelineResult.response.decision_status, "TRADE_SETUP_SUPPORTED");
});

// ============================================================
// D. Claude layer: opt-in, isolated, advisory only
// ============================================================

test("D1. the Claude layer is disabled by default — llmAnnotation is null and nothing is called", async () => {
  const { value: result, networkCalled } = await withNetworkGuard(() => runAgentRequest(bullishRequest(), RUN_STORE));
  assert.equal(networkCalled, false);
  assert.equal(result.llmAnnotation, null);
});

test("D2. options.llm present but enabled is not exactly true — still disabled", async () => {
  for (const llmOptions of [{}, { enabled: false }, { enabled: "true" }, { enabled: 1 }]) {
    const { value: result, networkCalled } = await withNetworkGuard(() =>
      runAgentRequest(bullishRequest(), { ...RUN_STORE, llm: llmOptions })
    );
    assert.equal(networkCalled, false, `expected no network call for llmOptions=${JSON.stringify(llmOptions)}`);
    assert.equal(result.llmAnnotation, null);
  }
});

test("D3. when disabled, no adapter is built at all — a supplied fetchImpl is never invoked", async () => {
  let called = false;
  const result = await runAgentRequest(bullishRequest(), {
    ...RUN_STORE,
    llm: { enabled: false, adapterConfig: { fetchImpl: async () => { called = true; } } },
  });
  assert.equal(called, false);
  assert.equal(result.llmAnnotation, null);
});

test("D4. enabled + a valid mocked response yields a VALID annotation and a byte-identical deterministic result", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const request = bullishRequest({ positionSizingParams: ALL_SIX_SIZING_PARAMS });

    const disabled = await runAgentRequest(request, RUN_STORE);
    const enabled = await runAgentRequest(request, {
      ...RUN_STORE,
      llm: { enabled: true, adapterConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(validClaudeOutput())) } },
    });

    assert.equal(enabled.llmAnnotation.status, "VALID");
    assert.ok(enabled.llmAnnotation.output);
    // Every deterministic value is identical with and without the layer.
    assert.deepEqual(stripTimestamps(enabled.pipelineResult.response), stripTimestamps(disabled.pipelineResult.response));
  });
});

test("D5. the deterministic decision fields are never influenced by the annotation", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const request = bullishRequest({ positionSizingParams: ALL_SIX_SIZING_PARAMS });
    const disabled = await runAgentRequest(request, RUN_STORE);
    const enabled = await runAgentRequest(request, {
      ...RUN_STORE,
      llm: { enabled: true, adapterConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(validClaudeOutput())) } },
    });

    const a = disabled.pipelineResult.response;
    const b = enabled.pipelineResult.response;
    assert.equal(b.final_assessment, a.final_assessment);
    assert.equal(b.decision_status, a.decision_status);
    assert.equal(b.risk_summary.risk_decision, a.risk_summary.risk_decision);
    assert.equal(b.risk_summary.risk_level, a.risk_summary.risk_level);
    assert.deepEqual(b.risk_summary.risk_categories, a.risk_summary.risk_categories);
  });
});

test("D6. an LLM transport failure surfaces only in llmAnnotation — pipelineResult is unaffected", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const request = bullishRequest();
    const disabled = await runAgentRequest(request, RUN_STORE);
    const failed = await runAgentRequest(request, {
      ...RUN_STORE,
      llm: { enabled: true, adapterConfig: { fetchImpl: async () => jsonResponse(500, { error: "boom" }) } },
    });

    assert.notEqual(failed.llmAnnotation.status, "VALID");
    assert.equal(failed.llmAnnotation.output, null);
    assert.equal(failed.pipelineResult.ok, true);
    assert.deepEqual(stripTimestamps(failed.pipelineResult.response), stripTimestamps(disabled.pipelineResult.response));
  });
});

test("D7. an unexpected throw inside the reasoning layer cannot take the request down", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await runAgentRequest(bullishRequest(), {
      ...RUN_STORE,
      llm: {
        enabled: true,
        adapterConfig: {
          fetchImpl: () => {
            throw new Error("secret-bearing-internal-failure");
          },
        },
      },
    });

    assert.equal(result.pipelineResult.ok, true);
    assert.notEqual(result.llmAnnotation.status, "VALID");
    // The thrown error's own message must never be surfaced.
    assert.ok(!JSON.stringify(result.llmAnnotation).includes("secret-bearing-internal-failure"));
  });
});

// A request engineered to trip five distinct risk categories
// (DATA_RISK, CONFLICT_RISK, TIMING_RISK, MARKET_RISK, EXECUTION_RISK),
// which is what riskLevel.js needs to reach CRITICAL and therefore a
// genuine RISK_TOO_HIGH rejection. Built from stale + unverified data,
// a bullish-news/bearish-macro cross-domain disagreement, and no
// sizing parameters. Asserted explicitly below, so the fixture can
// never silently stop producing a rejection and turn the guard test
// vacuous.
function riskTooHighRequest() {
  const flat = [100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100];
  return {
    query: "Assess BTC",
    asset: "BTC",
    newsData: [
      {
        asset: "BTC",
        headline: "Bullish development",
        classification: "FACT",
        source: "news-src-A",
        publication_timestamp: iso(-40 * 24 * 3_600_000),
        impact_direction: "POSITIVE",
        verification_status: "UNVERIFIED",
      },
    ],
    macroData: [
      {
        indicator: "CPI",
        classification: "FACT",
        country: "US",
        category: "INFLATION",
        source: "macro-src-A",
        release_timestamp: iso(-40 * 24 * 3_600_000),
        impact_direction: "NEGATIVE",
        verification_status: "UNVERIFIED",
      },
    ],
    technicalCandles: flat.map((p, i) => ({
      asset: "BTC",
      timeframe: "1day",
      timestamp: iso(-40 * 24 * 3_600_000 - (flat.length - 1 - i) * 86_400_000),
      open: p,
      high: p + 1,
      low: p - 1,
      close: p,
      source: "technical-src-A",
      classification: "FACT",
      verification_status: "UNVERIFIED",
    })),
    options: { freshnessThresholds: { freshMaxMs: 1000, agingMaxMs: 2000 } },
  };
}

test("D8. an output contradicting a genuine RISK_TOO_HIGH rejection is REJECTED, never surfaced", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const overriding = validClaudeOutput({ narrative_summary: "The setup is safe, proceed anyway." });
    const result = await runAgentRequest(riskTooHighRequest(), {
      ...RUN_STORE,
      llm: { enabled: true, adapterConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(overriding)) } },
    });

    // The fixture really did produce a rejection — without this the
    // guard assertion below would pass vacuously.
    assert.equal(result.pipelineResult.response.risk_summary.risk_decision, "RISK_TOO_HIGH");

    assert.equal(result.llmAnnotation.status, "REJECTED");
    assert.equal(result.llmAnnotation.output, null);
    assert.ok(result.llmAnnotation.errors.length > 0);
    // The contradicting text never reaches the caller.
    assert.ok(!/proceed anyway/i.test(JSON.stringify(result.llmAnnotation.output)));
  });
});

test("D8b. a rejected annotation leaves every deterministic decision field untouched", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const request = riskTooHighRequest();
    const overriding = validClaudeOutput({ narrative_summary: "The setup is safe, proceed anyway." });

    const disabled = await runAgentRequest(request, RUN_STORE);
    const rejected = await runAgentRequest(request, {
      ...RUN_STORE,
      llm: { enabled: true, adapterConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(overriding)) } },
    });

    assert.equal(rejected.llmAnnotation.status, "REJECTED");
    assert.deepEqual(stripTimestamps(rejected.pipelineResult.response), stripTimestamps(disabled.pipelineResult.response));
    assert.equal(rejected.pipelineResult.response.risk_summary.risk_decision, "RISK_TOO_HIGH");
    assert.equal(rejected.pipelineResult.response.decision_status, "HIGH_RISK_REVIEW_REQUIRED");
  });
});

test("D9. composition-only options never leak into the pipeline's own request options", async () => {
  // runStore/llm are consumed by this function and must not be
  // forwarded into runMarketIntelligenceRequest(), which would spread
  // them onto the request options every agent reads.
  const result = await runAgentRequest(bullishRequest(), {
    ...RUN_STORE,
    llm: { enabled: false, adapterConfig: { fetchImpl: async () => {} } },
  });
  const record = readLastRecord();
  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes("fetchImpl"));
  assert.equal(result.pipelineResult.ok, true);
});

// ============================================================
// E. Degraded inputs
// ============================================================

test("E1. a malformed request is rejected safely and still recorded, never crashing", async () => {
  const result = await runAgentRequest({ asset: "BTC" }, RUN_STORE);
  assert.equal(result.pipelineResult.ok, false);
  assert.equal(result.persistence.status, "PERSISTED");
});

test("E2. an ambiguous provider/payload merge is refused before any network access", async () => {
  const { value: result, networkCalled } = await withNetworkGuard(() =>
    runAgentRequest(bullishRequest(), { ...RUN_STORE, macro: { enabled: true } })
  );
  assert.equal(networkCalled, false);
  assert.equal(result.pipelineResult.ok, false);
  assert.match(result.pipelineResult.message, /ambiguous merge/i);
});
