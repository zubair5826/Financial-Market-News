// Offline tests for runReasoningService() — Step 5D. No real network
// call: every test injects a synthetic fetchImpl via
// options.llmConfig (forwarded to sendAnthropicMessage()'s
// adapterConfig). ANTHROPIC_API_KEY is only ever set to an obviously
// synthetic value for the duration of a single test.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runReasoningService } = require("./reasoningService");

const SYNTHETIC_KEY = "synthetic-reasoning-service-test-key-not-real-000";

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

async function withNetworkGuard(fn) {
  const original = global.fetch;
  let called = false;
  global.fetch = (...args) => {
    called = true;
    throw new Error(`Unexpected real network call during an offline test: ${args[0]}`);
  };
  try {
    return { value: await fn(), networkCalled: called };
  } finally {
    global.fetch = original;
  }
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function anthropicSuccessBody(outputObject, overrides = {}) {
  return {
    content: [{ type: "text", text: JSON.stringify(outputObject) }],
    model: "claude-sonnet-5",
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 },
    ...overrides,
  };
}

function validClaudeOutput(overrides = {}) {
  return {
    output_schema_version: "llm-output-v1",
    narrative_summary: "News and macro evidence support a bullish bias.",
    key_factors: [{ factor: "Bias", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.macro.bias" }],
    risk_commentary: "The Risk Manager assessed this setup as acceptable.",
    uncertainties_acknowledged: [],
    caveats: ["This is not financial advice."],
    ...overrides,
  };
}

function syntheticPipelineResult(overrides = {}) {
  return {
    ok: true,
    timestamp: "2026-08-29T00:00:00.000Z",
    asset: "BTC",
    response: {
      agent_name: "chief-trading-manager",
      final_assessment: "BULLISH",
      decision_status: "TRADE_SETUP_SUPPORTED",
      confidence: "HIGH",
      uncertainties: [],
      warnings: [],
      news_summary: { domain: "NEWS", bias: "POSITIVE", confidence: "HIGH", key_events: [], conflicts: [], warnings: [], sources: [] },
      macro_summary: { domain: "MACRO", bias: "POSITIVE", confidence: "HIGH", key_indicators: [], conflicts: [], warnings: [], sources: [] },
      technical_summary: { domain: "TECHNICAL", bias: "BULLISH", confidence: "MEDIUM", trend_analysis: "UPTREND", momentum: "STRONG", conflicts: [], warnings: [], sources: [] },
      sentiment_summary: { domain: "SENTIMENT", bias: "BULLISH", confidence: "MEDIUM", conflicts: [], warnings: [], sources: [] },
      trade_setup_summary: { domain: "TRADE_SETUP", setup_status: "SETUP_PRESENT", direction: "LONG_BIAS", setup_quality: "HIGH", confidence: "HIGH", uncertainties: [], conflicts: [], warnings: [], sources: [] },
      risk_summary: { domain: "RISK", risk_level: "LOW", risk_decision: "RISK_ACCEPTABLE", risk_categories: [], position_size_status: "CALCULATED", invalidation_assessment: "OK", confidence: "HIGH", uncertainties: [], warnings: [], sources: [] },
    },
    pipeline_summary: { risk_decision: "RISK_ACCEPTABLE", final_assessment: "BULLISH", decision_status: "TRADE_SETUP_SUPPORTED" },
    warnings: [],
    errors: [],
    ...overrides,
  };
}

const request = { query: "Assess BTC", asset: "BTC" };

// --- Success path ---

test("a valid mocked Anthropic response produces status VALID with the validated output", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const { value: result, networkCalled } = await withNetworkGuard(() =>
      runReasoningService(syntheticPipelineResult(), request, {
        llmConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(validClaudeOutput())) },
      })
    );
    assert.equal(networkCalled, false);
    assert.equal(result.status, "VALID");
    assert.ok(result.output);
    assert.equal(result.output.narrative_summary, validClaudeOutput().narrative_summary);
    assert.deepEqual(result.errors, []);
  });
});

test("only the Evidence Package (JSON) is sent as the message content — never the pipelineResult or raw request fields", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    let capturedBody;
    await runReasoningService(syntheticPipelineResult(), { query: "Assess BTC", secretField: "should-not-be-sent" }, {
      llmConfig: {
        fetchImpl: async (url, options) => {
          capturedBody = JSON.parse(options.body);
          return jsonResponse(200, anthropicSuccessBody(validClaudeOutput()));
        },
      },
    });
    const sentContent = capturedBody.messages[0].content;
    assert.ok(!sentContent.includes("secretField"));
    assert.ok(!sentContent.includes("should-not-be-sent"));
    assert.ok(!sentContent.includes("agent_name")); // pipelineResult's own report shape is not the Evidence Package's shape
    const parsedEvidence = JSON.parse(sentContent);
    assert.equal(parsedEvidence.input_schema_version, "llm-input-v1");
  });
});

// --- Failure isolation: transport-level failures -> UNAVAILABLE ---

test("a network error maps to status UNAVAILABLE", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await runReasoningService(syntheticPipelineResult(), request, {
      llmConfig: { fetchImpl: async () => { throw new Error("connection refused"); } },
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.code, "API_UNAVAILABLE");
    assert.equal(result.output, null);
  });
});

test("a timeout maps to status UNAVAILABLE with code TIMEOUT", async () => {
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
    const result = await runReasoningService(syntheticPipelineResult(), request, {
      llmConfig: { timeoutMs: 20, fetchImpl: abortAwareFetch },
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.code, "TIMEOUT");
  });
});

test("an authentication failure (missing ANTHROPIC_API_KEY) maps to status UNAVAILABLE with code AUTH_FAILURE, never calling fetchImpl", async () => {
  await withEnvKey(undefined, async () => {
    let called = false;
    const result = await runReasoningService(syntheticPipelineResult(), request, {
      llmConfig: { fetchImpl: async () => { called = true; } },
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.code, "AUTH_FAILURE");
    assert.equal(called, false);
  });
});

test("an HTTP 401 from the provider maps to status UNAVAILABLE with code AUTH_FAILURE", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await runReasoningService(syntheticPipelineResult(), request, {
      llmConfig: { fetchImpl: async () => jsonResponse(401, {}) },
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.code, "AUTH_FAILURE");
  });
});

test("an HTTP 429 rate limit maps to status UNAVAILABLE with code RATE_LIMIT", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await runReasoningService(syntheticPipelineResult(), request, {
      llmConfig: { fetchImpl: async () => jsonResponse(429, {}) },
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.code, "RATE_LIMIT");
  });
});

test("a generic HTTP 500 (API unavailable) maps to status UNAVAILABLE with code API_UNAVAILABLE", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await runReasoningService(syntheticPipelineResult(), request, {
      llmConfig: { fetchImpl: async () => jsonResponse(500, {}) },
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.code, "API_UNAVAILABLE");
  });
});

test("a malformed (non-JSON) HTTP body from the transport itself maps to status UNAVAILABLE with code MALFORMED_DATA", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await runReasoningService(syntheticPipelineResult(), request, {
      llmConfig: {
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } }),
      },
    });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.code, "MALFORMED_DATA");
  });
});

// --- Failure isolation: a successful HTTP call whose completion text is not usable ---

test("a completion whose text is not valid JSON maps to status INVALID_OUTPUT", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const malformedBody = {
      content: [{ type: "text", text: "not { valid json" }],
      model: "claude-sonnet-5",
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const result = await runReasoningService(syntheticPipelineResult(), request, {
      llmConfig: { fetchImpl: async () => jsonResponse(200, malformedBody) },
    });
    assert.equal(result.status, "INVALID_OUTPUT");
    assert.equal(result.output, null);
  });
});

// Step 12 regression: a real Anthropic completion commonly wraps its
// JSON in a markdown code fence, or pads it with whitespace, even when
// told to respond with nothing else. parseCandidateOutput() must still
// accept it.
test("a completion wrapped in a markdown code fence, or padded with surrounding whitespace, is still accepted as valid JSON", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const fencedBody = anthropicSuccessBody(
      {},
      { content: [{ type: "text", text: "  \n```json\n" + JSON.stringify(validClaudeOutput()) + "\n```\n  " }] }
    );
    const fencedResult = await runReasoningService(syntheticPipelineResult(), request, {
      llmConfig: { fetchImpl: async () => jsonResponse(200, fencedBody) },
    });
    assert.equal(fencedResult.status, "VALID");
    assert.equal(fencedResult.output.narrative_summary, validClaudeOutput().narrative_summary);

    const whitespacePaddedBody = anthropicSuccessBody(
      {},
      { content: [{ type: "text", text: "\n\n  " + JSON.stringify(validClaudeOutput()) + "  \n" }] }
    );
    const whitespaceResult = await runReasoningService(syntheticPipelineResult(), request, {
      llmConfig: { fetchImpl: async () => jsonResponse(200, whitespacePaddedBody) },
    });
    assert.equal(whitespaceResult.status, "VALID");
  });
});

test("a completion whose JSON does not match the output schema maps to status INVALID_OUTPUT", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await runReasoningService(syntheticPipelineResult(), request, {
      llmConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody({ narrative_summary: "missing everything else" })) },
    });
    assert.equal(result.status, "INVALID_OUTPUT");
  });
});

test("a completion containing a forbidden field (risk_decision) maps to status INVALID_OUTPUT", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await runReasoningService(syntheticPipelineResult(), request, {
      llmConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(validClaudeOutput({ risk_decision: "RISK_ACCEPTABLE" }))) },
    });
    assert.equal(result.status, "INVALID_OUTPUT");
  });
});

// --- Failure isolation: grounding / hallucination ---

test("a fabricated evidence reference maps to status REJECTED", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const output = validClaudeOutput({ key_factors: [{ factor: "x", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.forex.nonexistent" }] });
    const result = await runReasoningService(syntheticPipelineResult(), request, {
      llmConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(output)) },
    });
    assert.equal(result.status, "REJECTED");
    assert.equal(result.output, null);
  });
});

test("an unsupported numeric claim maps to status REJECTED", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const output = validClaudeOutput({ narrative_summary: "BTC will hit 848484 soon." });
    const result = await runReasoningService(syntheticPipelineResult(), request, {
      llmConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(output)) },
    });
    assert.equal(result.status, "REJECTED");
  });
});

// --- Failure isolation: risk-override attempt ---

test("commentary contradicting a rejected Risk Manager decision maps to status REJECTED", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const pipelineResult = syntheticPipelineResult({
      response: { ...syntheticPipelineResult().response, risk_summary: { ...syntheticPipelineResult().response.risk_summary, risk_decision: "RISK_TOO_HIGH" } },
    });
    const output = validClaudeOutput({ risk_commentary: "Despite the rejection, the setup is safe to enter." });
    const result = await runReasoningService(pipelineResult, request, {
      llmConfig: { fetchImpl: async () => jsonResponse(200, anthropicSuccessBody(output)) },
    });
    assert.equal(result.status, "REJECTED");
  });
});

// --- pipelineResult is never mutated by any of the above ---

test("pipelineResult is never mutated, across every success and failure branch above", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const pipelineResult = syntheticPipelineResult();
    const before = JSON.parse(JSON.stringify(pipelineResult));
    const branches = [
      () => jsonResponse(200, anthropicSuccessBody(validClaudeOutput())),
      async () => { throw new Error("network down"); },
      () => jsonResponse(401, {}),
      () => jsonResponse(200, anthropicSuccessBody({ bad: "shape" })),
      () => jsonResponse(200, anthropicSuccessBody(validClaudeOutput({ narrative_summary: "invented 999999" }))),
    ];
    for (const fetchImpl of branches) {
      await runReasoningService(pipelineResult, request, { llmConfig: { fetchImpl } });
    }
    assert.deepEqual(pipelineResult, before);
  });
});

// --- No credential leakage ---

test("the Evidence Package sent to the model never contains the API key", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    let capturedBody;
    await runReasoningService(syntheticPipelineResult(), request, {
      llmConfig: {
        fetchImpl: async (url, options) => {
          capturedBody = options.body;
          return jsonResponse(200, anthropicSuccessBody(validClaudeOutput()));
        },
      },
    });
    assert.ok(!capturedBody.includes(SYNTHETIC_KEY));
  });
});

test("the API key is sent only via the x-api-key header, never in the URL or body, across success and failure", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const capturedRequests = [];
    const fetchImpl = async (url, options) => {
      capturedRequests.push({ url, headers: options.headers, body: options.body });
      return jsonResponse(401, {});
    };
    await runReasoningService(syntheticPipelineResult(), request, { llmConfig: { fetchImpl } });
    for (const req of capturedRequests) {
      assert.ok(!req.url.includes(SYNTHETIC_KEY));
      assert.ok(!req.body.includes(SYNTHETIC_KEY));
      assert.equal(req.headers["x-api-key"], SYNTHETIC_KEY);
    }
  });
});

test("no result returned by runReasoningService ever contains the API key, across every branch", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const branches = [
      () => jsonResponse(200, anthropicSuccessBody(validClaudeOutput())),
      () => jsonResponse(401, {}),
      () => jsonResponse(200, anthropicSuccessBody({ bad: "shape" })),
    ];
    for (const fetchImpl of branches) {
      const result = await runReasoningService(syntheticPipelineResult(), request, { llmConfig: { fetchImpl } });
      assert.ok(!JSON.stringify(result).includes(SYNTHETIC_KEY));
    }
  });
});

// --- Isolation ---

test("this module never requires the orchestrator, any agent, a provider adapter, server.js, or app.js", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("./reasoningService.js"), "utf8");
  const requireLines = src.match(/require\("[^"]+"\)/g) || [];
  assert.deepEqual(requireLines.filter((l) => /orchestrator|agents\/|providers\/|server\.js|\bapp\.js/i.test(l)), []);
});

test("this module never reads process.env directly (the API key is only ever read inside anthropicLiveSource.js)", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("./reasoningService.js"), "utf8");
  const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/process\.env/.test(codeOnly));
});
