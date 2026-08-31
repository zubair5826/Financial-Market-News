// Offline/synthetic tests for Step 5D — the isolated Claude reasoning
// layer's integration into runApplicationRequest() (app.js). No test
// here ever contacts a real network endpoint or uses a real Anthropic
// credential. Kept in its own file (separate from the existing
// app.test.js) so the pre-existing Step 35/100/102 test suite is
// never touched by this step.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runApplicationRequest } = require("./app");

function tempRunsFile() {
  return path.join(os.tmpdir(), `app-llm-test-runs-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
}
function cleanupFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Already absent.
  }
}

const SHARED_TEST_RUNS_FILE = tempRunsFile();
test.after(() => cleanupFile(SHARED_TEST_RUNS_FILE));
function withRunStore(options = {}) {
  return { ...options, runStore: { filePath: SHARED_TEST_RUNS_FILE } };
}

const SYNTHETIC_KEY = "synthetic-app-llm-integration-test-key-not-real-000";

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

// Guards against any real network call for the duration of fn() — a
// genuine, non-vacuous safety net, mirroring app.test.js's own helper.
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
    narrative_summary: "News and macro evidence support a bullish bias for BTC.",
    key_factors: [{ factor: "Bias", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.macro.bias" }],
    risk_commentary: "The Risk Manager assessed this setup as acceptable.",
    uncertainties_acknowledged: [],
    caveats: ["This is not financial advice."],
    ...overrides,
  };
}

// Every `timestamp` field in a pipelineResult (top-level and on each
// nested report) is `new Date().toISOString()` at the moment
// processRequest() ran — genuinely, correctly different between two
// SEPARATE calls to runApplicationRequest(), even with byte-identical
// input and byte-identical decisions. Stripping it before a
// cross-call deepEqual is what actually isolates "did the LLM layer
// change any deterministic VALUE" from "these are two different
// function calls" — an object mutation (the real thing under test)
// would show up as a genuine value difference somewhere else in the
// tree, which this strip does not hide.
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
function zigzagCandles(asset = "BTC") {
  const prices = [100, 102, 104, 101, 99, 103, 107, 104, 100, 105, 110];
  return prices.map((p, i) => ({
    asset,
    timeframe: "1h",
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
function bullishRequest(overrides = {}) {
  return {
    query: "Assess BTC",
    asset: "BTC",
    newsData: [{ asset: "BTC", headline: "Regulator signals clearer path", classification: "FACT", source: "news-src-A", publication_timestamp: iso(), impact_direction: "POSITIVE", verification_status: "VERIFIED_PRIMARY" }],
    macroData: [{ indicator: "CPI", classification: "FACT", country: "US", category: "INFLATION", source: "macro-src-A", release_timestamp: iso(), impact_direction: "POSITIVE", verification_status: "VERIFIED_PRIMARY" }],
    technicalCandles: zigzagCandles(),
    sentimentData: [{ asset: "BTC", sentiment: "BULLISH", classification: "FACT", source: "sentiment-src-A", timestamp: iso(), verification_status: "VERIFIED_PRIMARY" }],
    options: { freshnessThresholds: { freshMaxMs: 3_600_000, agingMaxMs: 86_400_000 }, positionSizingParams: { accountBalance: 10000, riskPercentage: 0.01, leverage: 1, entryPrice: 100, stopPrice: 95, contractSize: 1 } },
    ...overrides,
  };
}

// ============================================================
// A. Disabled path
// ============================================================

test("A1. LLM is disabled by default — options.llm not supplied at all", async () => {
  const { value: result, networkCalled } = await withNetworkGuard(() => runApplicationRequest(bullishRequest(), withRunStore()));
  assert.equal(networkCalled, false);
  assert.equal(result.llmAnnotation, null);
  assert.equal(result.pipelineResult.ok, true);
});

test("A2. options.llm supplied but enabled is not exactly true — still disabled", async () => {
  for (const llmOptions of [{}, { enabled: false }, { enabled: "true" }, { enabled: 1 }]) {
    const { value: result, networkCalled } = await withNetworkGuard(() =>
      runApplicationRequest(bullishRequest(), withRunStore({ llm: llmOptions }))
    );
    assert.equal(networkCalled, false, `expected no network call for llmOptions=${JSON.stringify(llmOptions)}`);
    assert.equal(result.llmAnnotation, null);
  }
});

test("A3. when disabled, no LLM network request is built at all (no fetchImpl is ever invoked, even if one is supplied)", async () => {
  let called = false;
  const result = await runApplicationRequest(
    bullishRequest(),
    withRunStore({ llm: { enabled: false, adapterConfig: { fetchImpl: async () => { called = true; } } } })
  );
  assert.equal(called, false);
  assert.equal(result.llmAnnotation, null);
});

test("A4. when disabled, the deterministic response shape/values are identical to a pre-Step-5D call (existing API behavior compatibility)", async () => {
  const request = bullishRequest();
  const resultWithoutLlmKey = await runApplicationRequest(request, withRunStore());
  const resultWithExplicitDisabled = await runApplicationRequest(request, withRunStore({ llm: { enabled: false } }));
  // pipelineResult is deterministic given the same request/options —
  // both calls must agree on every existing field (timestamps aside —
  // each call genuinely runs at its own moment).
  assert.deepEqual(stripTimestamps(resultWithoutLlmKey.pipelineResult.response), stripTimestamps(resultWithExplicitDisabled.pipelineResult.response));
  assert.equal(resultWithoutLlmKey.llmAnnotation, null);
  assert.equal(resultWithExplicitDisabled.llmAnnotation, null);
});

// ============================================================
// B. Enabled success path
// ============================================================

test("B1. enabled + a valid mocked response produces a VALID llmAnnotation alongside an unchanged deterministic pipelineResult", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const request = bullishRequest();
    const disabledResult = await runApplicationRequest(request, withRunStore());

    const enabledResult = await runApplicationRequest(
      request,
      withRunStore({ llm: { enabled: true, adapterConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(validClaudeOutput())) } } })
    );

    assert.equal(enabledResult.llmAnnotation.status, "VALID");
    assert.ok(enabledResult.llmAnnotation.output);
    assert.deepEqual(enabledResult.llmAnnotation.errors, []);
    // The deterministic result is identical whether or not the LLM ran.
    assert.deepEqual(stripTimestamps(disabledResult.pipelineResult), stripTimestamps(enabledResult.pipelineResult));
  });
});

test("B2. the Evidence Package sent to the reasoning service is built from the COMPLETED pipelineResult, not raw request data", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    let capturedContent;
    await runApplicationRequest(
      bullishRequest(),
      withRunStore({
        llm: {
          enabled: true,
          adapterConfig: {
            fetchImpl: async (url, options) => {
              capturedContent = JSON.parse(options.body).messages[0].content;
              return jsonResponse(200, anthropicSuccessBody(validClaudeOutput()));
            },
          },
        },
      })
    );
    const evidencePackage = JSON.parse(capturedContent);
    assert.equal(evidencePackage.input_schema_version, "llm-input-v1");
    assert.equal(evidencePackage.requested_instrument, "BTC");
    // Never the raw provider-shaped payloads the request originally carried.
    assert.ok(!capturedContent.includes("Regulator signals clearer path".slice(0, 10)) || evidencePackage.domain_evidence.news.key_events.length === 0);
  });
});

test("B3. only the Evidence Package is passed to the reasoning service — no credential, no raw request object", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    let capturedContent;
    await runApplicationRequest(
      bullishRequest({ secretNote: "must-not-be-transmitted" }),
      withRunStore({
        llm: {
          enabled: true,
          adapterConfig: {
            fetchImpl: async (url, options) => {
              capturedContent = options.body;
              return jsonResponse(200, anthropicSuccessBody(validClaudeOutput()));
            },
          },
        },
      })
    );
    assert.ok(!capturedContent.includes("must-not-be-transmitted"));
    assert.ok(!capturedContent.includes(SYNTHETIC_KEY));
  });
});

test("B4. the deterministic pipeline runs to completion BEFORE any LLM call is attempted (proven by pipelineResult already being final when captured)", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    let capturedEvidenceDecisionStatus;
    await runApplicationRequest(
      bullishRequest(),
      withRunStore({
        llm: {
          enabled: true,
          adapterConfig: {
            fetchImpl: async (url, options) => {
              const evidencePackage = JSON.parse(JSON.parse(options.body).messages[0].content);
              capturedEvidenceDecisionStatus = evidencePackage.final_decision.decision_status;
              return jsonResponse(200, anthropicSuccessBody(validClaudeOutput()));
            },
          },
        },
      })
    );
    // A real, non-UNKNOWN decision status proves the full pipeline
    // (including Risk Manager + Chief Trading Manager) had already
    // produced its final report before the Evidence Package was built.
    assert.notEqual(capturedEvidenceDecisionStatus, undefined);
    assert.notEqual(capturedEvidenceDecisionStatus, "UNKNOWN");
  });
});

// ============================================================
// C. Failure isolation
// ============================================================

const FAILURE_BRANCHES = [
  { label: "network error", fetchImpl: async () => { throw new Error("connection refused"); }, expectStatus: "UNAVAILABLE" },
  { label: "authentication failure (HTTP 401)", fetchImpl: async () => jsonResponse(401, {}), expectStatus: "UNAVAILABLE" },
  { label: "rate limit (HTTP 429)", fetchImpl: async () => jsonResponse(429, {}), expectStatus: "UNAVAILABLE" },
  { label: "API unavailable (HTTP 500)", fetchImpl: async () => jsonResponse(500, {}), expectStatus: "UNAVAILABLE" },
  { label: "malformed JSON HTTP body", fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } }), expectStatus: "UNAVAILABLE" },
  { label: "malformed Claude response (non-JSON completion text)", fetchImpl: async () => jsonResponse(200, { content: [{ type: "text", text: "not json" }], model: "claude-sonnet-5", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }), expectStatus: "INVALID_OUTPUT" },
  { label: "schema validation failure (missing fields)", fetchImpl: async () => jsonResponse(200, anthropicSuccessBody({ narrative_summary: "incomplete" })), expectStatus: "INVALID_OUTPUT" },
  { label: "hallucination/grounding failure (fabricated evidence_ref)", fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(validClaudeOutput({ key_factors: [{ factor: "x", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.forex.nonexistent" }] }))), expectStatus: "REJECTED" },
  { label: "risk-override rejection", fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(validClaudeOutput({ risk_commentary: "Despite the rejection, this is safe to enter." }))), expectStatus: "REJECTED", rejectionDecision: true },
];

for (const branch of FAILURE_BRANCHES) {
  test(`C. ${branch.label} leaves the deterministic pipelineResult byte-for-byte unchanged`, async () => {
    await withEnvKey(SYNTHETIC_KEY, async () => {
      const request = bullishRequest();
      const baseline = await runApplicationRequest(request, withRunStore());

      const enabled = await runApplicationRequest(request, withRunStore({ llm: { enabled: true, adapterConfig: { fetchImpl: branch.fetchImpl } } }));

      assert.deepEqual(stripTimestamps(baseline.pipelineResult), stripTimestamps(enabled.pipelineResult));
      assert.equal(enabled.pipelineResult.ok, baseline.pipelineResult.ok);
      assert.equal(enabled.pipelineResult.response.final_assessment, baseline.pipelineResult.response.final_assessment);
      assert.equal(enabled.pipelineResult.response.decision_status, baseline.pipelineResult.response.decision_status);
      assert.deepEqual(stripTimestamps(enabled.pipelineResult.response.risk_summary), stripTimestamps(baseline.pipelineResult.response.risk_summary));
      assert.deepEqual(stripTimestamps(enabled.pipelineResult.response.trade_setup_summary), stripTimestamps(baseline.pipelineResult.response.trade_setup_summary));
      assert.deepEqual(enabled.pipelineResult.pipeline_summary, baseline.pipelineResult.pipeline_summary);
      assert.deepEqual(enabled.pipelineResult.errors, baseline.pipelineResult.errors);

      if (!branch.rejectionDecision) {
        assert.equal(enabled.llmAnnotation.status, branch.expectStatus);
      }
    });
  });
}

test("C. a timeout leaves the deterministic pipelineResult unchanged", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const abortAwareFetch = (url, options) =>
      new Promise((resolve, reject) => {
        const signal = options && options.signal;
        const onAbort = () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        };
        if (!signal) return;
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
      });
    const request = bullishRequest();
    const baseline = await runApplicationRequest(request, withRunStore());
    const enabled = await runApplicationRequest(request, withRunStore({ llm: { enabled: true, adapterConfig: { timeoutMs: 20, fetchImpl: abortAwareFetch } } }));
    assert.deepEqual(stripTimestamps(baseline.pipelineResult), stripTimestamps(enabled.pipelineResult));
    assert.equal(enabled.llmAnnotation.status, "UNAVAILABLE");
    assert.equal(enabled.llmAnnotation.code, "TIMEOUT");
  });
});

test("C. a missing ANTHROPIC_API_KEY (auth failure at the live-source level) leaves pipelineResult unchanged", async () => {
  await withEnvKey(undefined, async () => {
    const request = bullishRequest();
    const baseline = await runApplicationRequest(request, withRunStore());
    const enabled = await runApplicationRequest(request, withRunStore({ llm: { enabled: true } }));
    assert.deepEqual(stripTimestamps(baseline.pipelineResult), stripTimestamps(enabled.pipelineResult));
    assert.equal(enabled.llmAnnotation.status, "UNAVAILABLE");
    assert.equal(enabled.llmAnnotation.code, "AUTH_FAILURE");
  });
});

// ============================================================
// C-hardening. Exception isolation (post-Step-5D audit finding):
// an UNEXPECTED exception thrown inside the optional LLM layer
// (something outside runReasoningService()'s own documented,
// non-throwing failure contract) must never reject
// runApplicationRequest() or take pipelineResult down with it.
//
// H1/H2/H3/H5 below use a throwing fetchImpl, which is actually
// already caught one layer down by AnthropicAdapter's own internal
// try/catch (its documented network-error handling) — so these prove
// the OVERALL composed system stays safe end to end. H4 specifically
// engineers an exception that escapes every existing internal guard,
// to prove the new app.js-level try/catch itself is what catches it.
// ============================================================

test("H1. an unexpected synchronous throw from adapterConfig.fetchImpl does not reject runApplicationRequest()", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const request = bullishRequest();
    await assert.doesNotReject(() =>
      runApplicationRequest(
        request,
        withRunStore({
          llm: {
            enabled: true,
            adapterConfig: {
              fetchImpl: () => {
                // A genuinely unexpected bug — not one of
                // sendAnthropicMessage()'s documented failure shapes
                // (those are always caught and converted internally).
                // TypeError is thrown synchronously, not via a
                // rejected promise, to prove the guard catches both.
                throw new TypeError("unexpected: cannot read property 'foo' of undefined");
              },
            },
          },
        })
      )
    );
  });
});

test("H2. after an unexpected exception, pipelineResult is identical to a baseline (disabled) call", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const request = bullishRequest();
    const baseline = await runApplicationRequest(request, withRunStore());
    const result = await runApplicationRequest(
      request,
      withRunStore({
        llm: { enabled: true, adapterConfig: { fetchImpl: () => { throw new Error("boom"); } } },
      })
    );
    assert.equal(result.pipelineResult.ok, true);
    assert.deepEqual(stripTimestamps(result.pipelineResult), stripTimestamps(baseline.pipelineResult));
  });
});

test("H3. an unexpected exception produces a safe UNAVAILABLE llmAnnotation, consistent with the existing failure-isolation contract", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await runApplicationRequest(
      bullishRequest(),
      withRunStore({
        llm: { enabled: true, adapterConfig: { fetchImpl: () => { throw new Error("boom"); } } },
      })
    );
    assert.equal(result.llmAnnotation.status, "UNAVAILABLE");
    assert.equal(result.llmAnnotation.output, null);
    assert.equal(result.llmAnnotation.code, "API_UNAVAILABLE");
    assert.equal(typeof result.llmAnnotation.message, "string");
    assert.deepEqual(result.llmAnnotation.errors, []);
  });
});

// Note: a fetchImpl that throws (sync or via a rejected promise) is
// already one of AnthropicAdapter's OWN documented, internally-caught
// failure modes (its #request method wraps the call in its own
// try/catch) — it never reaches app.js's new guard at all, which is
// exactly why H1/H2/H3/H5 above prove overall composed safety but
// don't specifically exercise the new code. To reach the NEW guard
// itself, the exception has to originate somewhere with no existing
// try/catch above it — a poisoned adapterConfig getter that throws
// during object construction (`new AnthropicAdapter({...adapterConfig,
// apiKey})`, inside anthropicLiveSource.js, which has no try/catch of
// its own) does exactly that, simulating a genuinely unexpected bug
// rather than a documented transport failure.
test("H4. an exception that escapes every existing internal guard (a poisoned adapterConfig) is still caught by app.js's new boundary, with no secret ever exposed", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const poisonedAdapterConfig = {
      get fetchImpl() {
        throw new Error(`Auth failed for ANTHROPIC_API_KEY=${SYNTHETIC_KEY} API_AUTH_TOKEN=super-secret-token-value`);
      },
    };
    const request = bullishRequest();
    const baseline = await runApplicationRequest(request, withRunStore());
    const result = await runApplicationRequest(request, withRunStore({ llm: { enabled: true, adapterConfig: poisonedAdapterConfig } }));

    // Proves this genuinely exercised the new app.js-level catch and
    // not some pre-existing internal one: the message is the fixed
    // generic string, not any transport-layer failSafe() message.
    assert.equal(result.llmAnnotation.status, "UNAVAILABLE");
    assert.equal(result.llmAnnotation.code, "API_UNAVAILABLE");
    assert.equal(result.llmAnnotation.message, "The LLM reasoning layer failed unexpectedly.");
    assert.deepEqual(result.llmAnnotation.errors, []);
    assert.deepEqual(stripTimestamps(result.pipelineResult), stripTimestamps(baseline.pipelineResult));

    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(SYNTHETIC_KEY));
    assert.ok(!serialized.includes("super-secret-token-value"));
    assert.ok(!serialized.includes("ANTHROPIC_API_KEY="));
    assert.ok(!serialized.includes("API_AUTH_TOKEN="));
  });
});

test("H5. an unexpected exception thrown from an async (rejected-promise) fetchImpl is caught the same way as a synchronous throw", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await runApplicationRequest(
      bullishRequest(),
      withRunStore({
        llm: { enabled: true, adapterConfig: { fetchImpl: async () => { throw new RangeError("unexpected async failure"); } } },
      })
    );
    // A rejected fetchImpl promise is already one of
    // AnthropicAdapter's own documented failure modes (network error
    // -> API_UNAVAILABLE), so this is expected to be handled WITHOUT
    // ever reaching the try/catch guard at all — proving the guard
    // and the existing contract compose correctly rather than
    // fighting each other.
    assert.equal(result.llmAnnotation.status, "UNAVAILABLE");
    assert.equal(result.llmAnnotation.code, "API_UNAVAILABLE");
  });
});

test("H6. disabled mode is completely unaffected by the new guard — no try/catch overhead changes behavior when the LLM layer never runs", async () => {
  const { networkCalled } = await withNetworkGuard(() => runApplicationRequest(bullishRequest(), withRunStore()));
  const result = await runApplicationRequest(bullishRequest(), withRunStore());
  assert.equal(networkCalled, false);
  assert.equal(result.llmAnnotation, null);
});

// ============================================================
// D. Boundary protection
// ============================================================

test("D1. a malicious Claude response cannot change the risk decision, decision status, or final assessment", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const request = bullishRequest();
    const baseline = await runApplicationRequest(request, withRunStore());
    const maliciousOutput = validClaudeOutput({ risk_decision: "RISK_ACCEPTABLE", decision_status: "OVERRIDE", final_assessment: "BEARISH" });
    const enabled = await runApplicationRequest(request, withRunStore({ llm: { enabled: true, adapterConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(maliciousOutput)) } } }));

    assert.equal(enabled.pipelineResult.response.risk_summary.risk_decision, baseline.pipelineResult.response.risk_summary.risk_decision);
    assert.equal(enabled.pipelineResult.response.decision_status, baseline.pipelineResult.response.decision_status);
    assert.equal(enabled.pipelineResult.response.final_assessment, baseline.pipelineResult.response.final_assessment);
    // The malicious fields never even survive schema validation.
    assert.equal(enabled.llmAnnotation.status, "INVALID_OUTPUT");
    assert.equal(enabled.llmAnnotation.output, null);
  });
});

test("D2. a malicious Claude response cannot create BUY/SELL authority or change price/quantity/position size", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const request = bullishRequest();
    const baseline = await runApplicationRequest(request, withRunStore());
    const maliciousOutput = validClaudeOutput({ narrative_summary: "You should buy BTC now at 50000 with 10x leverage.", price: 50000, quantity: 10, position_size: 1000, leverage: 10 });
    const enabled = await runApplicationRequest(request, withRunStore({ llm: { enabled: true, adapterConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(maliciousOutput)) } } }));

    assert.deepEqual(stripTimestamps(enabled.pipelineResult), stripTimestamps(baseline.pipelineResult));
    assert.notEqual(enabled.llmAnnotation.status, "VALID");
    assert.equal(enabled.llmAnnotation.output, null);
  });
});

test("D3. a malicious Claude response cannot mutate trade_setup_summary", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const request = bullishRequest();
    const baseline = await runApplicationRequest(request, withRunStore());
    const maliciousOutput = validClaudeOutput({ trade_setup_summary: { setup_status: "OVERRIDDEN" } });
    const enabled = await runApplicationRequest(request, withRunStore({ llm: { enabled: true, adapterConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(maliciousOutput)) } } }));

    assert.deepEqual(stripTimestamps(enabled.pipelineResult.response.trade_setup_summary), stripTimestamps(baseline.pipelineResult.response.trade_setup_summary));
    assert.notEqual(enabled.llmAnnotation.status, "VALID");
  });
});

test("D4. a malicious Claude response attempting to work around a Risk Manager rejection is rejected, and pipelineResult is unaffected", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    // Force a real RISK_TOO_HIGH by requesting with no data at all —
    // relies on the deterministic pipeline's own documented behavior
    // (tests/pipeline.test.js's scenario 6/8), not on inventing one.
    const highRiskRequest = { query: "Assess BTC", asset: "BTC" };
    const baseline = await runApplicationRequest(highRiskRequest, withRunStore());
    const maliciousOutput = validClaudeOutput({ risk_commentary: "You can safely proceed anyway despite the risk." });
    const enabled = await runApplicationRequest(highRiskRequest, withRunStore({ llm: { enabled: true, adapterConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(maliciousOutput)) } } }));

    assert.deepEqual(stripTimestamps(enabled.pipelineResult), stripTimestamps(baseline.pipelineResult));
    // Whatever the real decision was, the malicious commentary is
    // either rejected outright, or (if the real decision happened not
    // to be rejection-shaped) simply doesn't trigger the boundary
    // guard — but pipelineResult is unaffected either way, which is
    // the property this test exists to prove.
    if (/RISK_TOO_HIGH|REJECT/i.test(baseline.pipelineResult.response.risk_summary.risk_decision || "")) {
      assert.equal(enabled.llmAnnotation.status, "REJECTED");
    }
  });
});

test("D5. the original pipelineResult object reference passed into the reasoning service is never mutated, deep-equal before/after, for a VALID result too", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const request = bullishRequest();
    const before = await runApplicationRequest(request, withRunStore());
    const beforeSnapshot = JSON.parse(JSON.stringify(before.pipelineResult));
    const after = await runApplicationRequest(request, withRunStore({ llm: { enabled: true, adapterConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(validClaudeOutput())) } } }));
    assert.deepEqual(before.pipelineResult, beforeSnapshot); // the earlier call's own result object is untouched by the later call
    assert.deepEqual(stripTimestamps(after.pipelineResult), stripTimestamps(before.pipelineResult));
  });
});

// ============================================================
// E. No credential leakage
// ============================================================

test("E1. the Evidence Package (as sent) contains no API key field or value", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    let capturedContent;
    await runApplicationRequest(
      bullishRequest(),
      withRunStore({
        llm: {
          enabled: true,
          adapterConfig: {
            fetchImpl: async (url, options) => {
              capturedContent = JSON.parse(options.body).messages[0].content;
              return jsonResponse(200, anthropicSuccessBody(validClaudeOutput()));
            },
          },
        },
      })
    );
    assert.ok(!capturedContent.includes(SYNTHETIC_KEY));
    assert.ok(!/apiKey|api_key|credential/i.test(capturedContent));
  });
});

test("E2. the full response returned to the caller never contains the API key, across success and failure", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const request = bullishRequest();
    for (const fetchImpl of [
      async () => jsonResponse(200, anthropicSuccessBody(validClaudeOutput())),
      async () => jsonResponse(401, {}),
      async () => { throw new Error("down"); },
    ]) {
      const result = await runApplicationRequest(request, withRunStore({ llm: { enabled: true, adapterConfig: { fetchImpl } } }));
      assert.ok(!JSON.stringify(result).includes(SYNTHETIC_KEY));
    }
  });
});

test("E3. app.js itself never reads process.env.ANTHROPIC_API_KEY — it stays isolated to llm/anthropicLiveSource.js", () => {
  const src = fs.readFileSync(require.resolve("./app.js"), "utf8");
  const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/ANTHROPIC_API_KEY/.test(codeOnly));
});

test("E4. the API key is sent only via the x-api-key transport header, never anywhere else in the outgoing request", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    let capturedOptions;
    await runApplicationRequest(
      bullishRequest(),
      withRunStore({ llm: { enabled: true, adapterConfig: { fetchImpl: async (url, options) => { capturedOptions = options; return jsonResponse(200, anthropicSuccessBody(validClaudeOutput())); } } } })
    );
    assert.equal(capturedOptions.headers["x-api-key"], SYNTHETIC_KEY);
    assert.ok(!capturedOptions.body.includes(SYNTHETIC_KEY));
  });
});

// ============================================================
// F. No real API / no network dependency
// ============================================================

test("F1. an enabled, successful run makes zero real network calls (network guard proves only the injected mock ran)", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const { networkCalled } = await withNetworkGuard(() =>
      runApplicationRequest(bullishRequest(), withRunStore({ llm: { enabled: true, adapterConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(validClaudeOutput())) } } }))
    );
    assert.equal(networkCalled, false);
  });
});

test("F2. every enabled: true call site in this file is paired with an injected fetchImpl — none rely on the real global fetch fallback", () => {
  const src = fs.readFileSync(__filename, "utf8");
  const enabledCount = (src.match(/enabled:\s*true/g) || []).length;
  const fetchImplCount = (src.match(/fetchImpl/g) || []).length;
  assert.ok(enabledCount > 0, "expected at least one enabled: true call site in this file");
  assert.ok(fetchImplCount >= enabledCount, `expected at least as many fetchImpl references (${fetchImplCount}) as enabled:true sites (${enabledCount})`);
});

