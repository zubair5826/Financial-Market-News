// Offline/synthetic tests for AnthropicAdapter — Step 5A. No real
// network call is ever made here: every test injects a synthetic
// fetchImpl mock via config.fetchImpl, exactly mirroring the pattern
// established in providers/adapters/fredMacroAdapter.test.js. No real
// Anthropic credentials are used — apiKey values below are obviously
// synthetic test strings, never anything resembling a real key. Do not
// add a live network call to this file.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { AnthropicAdapter } = require("./anthropicAdapter");
const { UNKNOWN } = require("../core/constants");
const { ERROR_CODES } = require("../core/errors");

const TEST_API_KEY = "synthetic-test-anthropic-key-not-real-000000";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function malformedJsonResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError("Unexpected token in JSON");
    },
  };
}

function successBody(overrides = {}) {
  return {
    content: [{ type: "text", text: "Synthetic completion text." }],
    model: "claude-sonnet-5",
    stop_reason: "end_turn",
    usage: { input_tokens: 12, output_tokens: 34 },
    ...overrides,
  };
}

// A fetchImpl that genuinely observes AbortSignal, mirroring
// fredMacroAdapter.test.js's makeAbortAwareFetch() — proves timeout
// cancellation actually works end-to-end, not merely that a timer wins
// a race against a request that never learns it should give up.
function makeAbortAwareFetch() {
  return (url, options) =>
    new Promise((resolve, reject) => {
      const signal = options && options.signal;
      const onAbort = () => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        reject(err);
      };
      if (!signal) return;
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    });
}

function baseAdapter(overrides = {}) {
  return new AnthropicAdapter({ apiKey: TEST_API_KEY, ...overrides });
}

const basicRequest = { messages: [{ role: "user", content: "Hello" }] };

test("a successful mocked response maps every field correctly", async () => {
  const adapter = baseAdapter({ fetchImpl: async () => jsonResponse(200, successBody()) });
  const result = await adapter.sendMessage(basicRequest);
  assert.equal(result.ok, true);
  assert.equal(result.data.text, "Synthetic completion text.");
  assert.equal(result.data.model, "claude-sonnet-5");
  assert.equal(result.data.stopReason, "end_turn");
  assert.equal(result.data.usage.inputTokens, 12);
  assert.equal(result.data.usage.outputTokens, 34);
});

test("no configured API key fails safely with AUTH_FAILURE, without calling fetchImpl", async () => {
  let called = false;
  const adapter = new AnthropicAdapter({
    fetchImpl: async () => {
      called = true;
      return jsonResponse(200, successBody());
    },
  });
  const result = await adapter.sendMessage(basicRequest);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.AUTH_FAILURE);
  assert.equal(called, false);
});

test("a missing/empty messages array is rejected safely without calling fetchImpl", async () => {
  let called = false;
  const adapter = baseAdapter({
    fetchImpl: async () => {
      called = true;
      return jsonResponse(200, successBody());
    },
  });
  const result = await adapter.sendMessage({});
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.MISSING_DATA);
  assert.equal(called, false);
});

test("an HTTP 401 response produces failSafe(AUTH_FAILURE)", async () => {
  const adapter = baseAdapter({ fetchImpl: async () => jsonResponse(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }) });
  const result = await adapter.sendMessage(basicRequest);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.AUTH_FAILURE);
});

test("an HTTP 403 response produces failSafe(AUTH_FAILURE)", async () => {
  const adapter = baseAdapter({ fetchImpl: async () => jsonResponse(403, {}) });
  const result = await adapter.sendMessage(basicRequest);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.AUTH_FAILURE);
});

test("an HTTP 429 response produces failSafe(RATE_LIMIT)", async () => {
  const adapter = baseAdapter({ fetchImpl: async () => jsonResponse(429, { type: "error", error: { type: "rate_limit_error", message: "rate limited" } }) });
  const result = await adapter.sendMessage(basicRequest);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.RATE_LIMIT);
});

test("a generic non-2xx HTTP response (e.g. 500) produces failSafe(API_UNAVAILABLE)", async () => {
  const adapter = baseAdapter({ fetchImpl: async () => jsonResponse(500, {}) });
  const result = await adapter.sendMessage(basicRequest);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.API_UNAVAILABLE);
});

test("a generic network rejection produces failSafe(API_UNAVAILABLE)", async () => {
  const adapter = baseAdapter({
    fetchImpl: async () => {
      throw new Error("ENOTFOUND api.anthropic.com");
    },
  });
  const result = await adapter.sendMessage(basicRequest);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.API_UNAVAILABLE);
});

test("a request that never resolves times out (via a genuinely aborted signal) and produces failSafe(TIMEOUT)", async () => {
  const adapter = baseAdapter({ timeoutMs: 20, fetchImpl: makeAbortAwareFetch() });
  const result = await adapter.sendMessage(basicRequest);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.TIMEOUT);
});

test("the injected fetchImpl receives a genuine AbortSignal that is not aborted for a completed request", async () => {
  let capturedSignal;
  const adapter = baseAdapter({
    fetchImpl: async (url, options) => {
      capturedSignal = options && options.signal;
      return jsonResponse(200, successBody());
    },
  });
  await adapter.sendMessage(basicRequest);
  assert.ok(capturedSignal instanceof AbortSignal);
  assert.equal(capturedSignal.aborted, false);
});

test("malformed JSON in the response produces failSafe(MALFORMED_DATA)", async () => {
  const adapter = baseAdapter({ fetchImpl: async () => malformedJsonResponse(200) });
  const result = await adapter.sendMessage(basicRequest);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.MALFORMED_DATA);
});

test("a response missing a usable text content block produces failSafe(MALFORMED_DATA)", async () => {
  const adapter = baseAdapter({ fetchImpl: async () => jsonResponse(200, successBody({ content: [] })) });
  const result = await adapter.sendMessage(basicRequest);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.MALFORMED_DATA);
});

test("a response missing usage data produces failSafe(MALFORMED_DATA)", async () => {
  const adapter = baseAdapter({ fetchImpl: async () => jsonResponse(200, successBody({ usage: undefined })) });
  const result = await adapter.sendMessage(basicRequest);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.MALFORMED_DATA);
});

test("a response missing model falls back to UNKNOWN rather than fabricating a model name", async () => {
  const adapter = baseAdapter({ fetchImpl: async () => jsonResponse(200, successBody({ model: undefined })) });
  const result = await adapter.sendMessage(basicRequest);
  assert.equal(result.ok, true);
  assert.equal(result.data.model, UNKNOWN);
});

test("a defensive {type:'error'} body arriving with a 2xx status is still treated as a failure, not fabricated data", async () => {
  const adapter = baseAdapter({
    fetchImpl: async () => jsonResponse(200, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
  });
  const result = await adapter.sendMessage(basicRequest);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.INVALID_RESPONSE);
  assert.ok(result.message.includes("Overloaded"));
});

test("no automatic retry occurs — fetchImpl is called exactly once per sendMessage() call, even on failure", async () => {
  let callCount = 0;
  const adapter = baseAdapter({
    fetchImpl: async () => {
      callCount++;
      return jsonResponse(500, {});
    },
  });
  await adapter.sendMessage(basicRequest);
  assert.equal(callCount, 1);
});

test("a custom system prompt and maxTokens/model overrides are forwarded into the request body", async () => {
  let capturedBody;
  const adapter = baseAdapter({
    fetchImpl: async (url, options) => {
      capturedBody = JSON.parse(options.body);
      return jsonResponse(200, successBody());
    },
  });
  await adapter.sendMessage({
    messages: [{ role: "user", content: "Hi" }],
    system: "You are a transport test.",
    maxTokens: 50,
    model: "claude-opus-5",
  });
  assert.equal(capturedBody.system, "You are a transport test.");
  assert.equal(capturedBody.max_tokens, 50);
  assert.equal(capturedBody.model, "claude-opus-5");
});

test("the request is sent as a real POST with the correct Anthropic headers, and the key is never placed in the URL", async () => {
  let capturedUrl, capturedOptions;
  const adapter = baseAdapter({
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return jsonResponse(200, successBody());
    },
  });
  await adapter.sendMessage(basicRequest);
  assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
  assert.ok(!capturedUrl.includes(TEST_API_KEY));
  assert.equal(capturedOptions.method, "POST");
  assert.equal(capturedOptions.headers["x-api-key"], TEST_API_KEY);
  assert.equal(capturedOptions.headers["anthropic-version"], "2023-06-01");
});

test("the timeout timer is cleared after a successful request (no leaked timer)", async () => {
  const originalClearTimeout = global.clearTimeout;
  let clearCount = 0;
  global.clearTimeout = (...args) => {
    clearCount++;
    return originalClearTimeout(...args);
  };
  try {
    const adapter = baseAdapter({ fetchImpl: async () => jsonResponse(200, successBody()) });
    await adapter.sendMessage(basicRequest);
    assert.ok(clearCount >= 1);
  } finally {
    global.clearTimeout = originalClearTimeout;
  }
});

// --- Credential-leakage coverage across every failure branch ---

function assertCredentialNotExposed(result, secret, label) {
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(secret), `credential leaked in result for: ${label}`);
}

function failureBranches() {
  return [
    { label: "network failure", fetchImpl: async () => { throw new Error("connection refused"); } },
    { label: "401 authentication failure", fetchImpl: async () => jsonResponse(401, {}) },
    { label: "403 forbidden failure", fetchImpl: async () => jsonResponse(403, {}) },
    { label: "429 rate-limit failure", fetchImpl: async () => jsonResponse(429, {}) },
    { label: "500 generic failure", fetchImpl: async () => jsonResponse(500, {}) },
    { label: "malformed JSON", fetchImpl: async () => malformedJsonResponse() },
    { label: "malformed response shape (no content)", fetchImpl: async () => jsonResponse(200, successBody({ content: [] })) },
    { label: "timeout / AbortError", fetchImpl: makeAbortAwareFetch() },
  ];
}

for (const branch of failureBranches()) {
  test(`${branch.label}: the configured API key never appears anywhere in the failSafe() result`, async () => {
    const adapter = baseAdapter({ timeoutMs: 20, fetchImpl: branch.fetchImpl });
    const result = await adapter.sendMessage(basicRequest);
    assert.equal(result.ok, false);
    assertCredentialNotExposed(result, TEST_API_KEY, branch.label);
  });
}

test("the API key never appears anywhere in a successful result's data", async () => {
  const adapter = baseAdapter({ fetchImpl: async () => jsonResponse(200, successBody()) });
  const result = await adapter.sendMessage(basicRequest);
  assert.equal(result.ok, true);
  assert.ok(!JSON.stringify(result.data).includes(TEST_API_KEY));
});

test("no failure branch ever throws an exception — sendMessage always resolves to a structured result", async () => {
  for (const branch of failureBranches()) {
    const adapter = baseAdapter({ timeoutMs: 20, fetchImpl: branch.fetchImpl });
    try {
      await adapter.sendMessage(basicRequest);
    } catch (err) {
      assert.fail(`sendMessage() threw for "${branch.label}": ${err && err.message}`);
    }
  }
});

test("the adapter source never calls console.* — structurally, it cannot log the credential", () => {
  const src = fs.readFileSync(require.resolve("./anthropicAdapter.js"), "utf8");
  assert.ok(!/console\./.test(src));
});

test("no console output occurs across any failure branch (runtime spy, not just a structural check)", async () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  let called = false;
  console.log = console.warn = console.error = () => {
    called = true;
  };
  try {
    for (const branch of failureBranches()) {
      const adapter = baseAdapter({ timeoutMs: 20, fetchImpl: branch.fetchImpl });
      await adapter.sendMessage(basicRequest);
    }
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  assert.equal(called, false);
});

test("the adapter never requires the orchestrator, Data Controller, or any downstream decision agent — a genuinely isolated transport", () => {
  const src = fs.readFileSync(require.resolve("./anthropicAdapter.js"), "utf8");
  const requireLines = src.match(/require\("[^"]+"\)/g) || [];
  const forbidden = requireLines.filter((line) =>
    /orchestrator|data-controller|dataRecord|trade-setup-agent|risk-manager|chief-trading-manager|broker|exchange|app\.js/i.test(line)
  );
  assert.deepEqual(forbidden, []);
});

test("the adapter does not extend ProviderAdapter (disclosed architectural deviation)", () => {
  const { ProviderAdapter } = require("../providers/ProviderAdapter");
  const adapter = baseAdapter({ fetchImpl: async () => jsonResponse(200, successBody()) });
  assert.equal(adapter instanceof ProviderAdapter, false);
});

test("a healthCheck-style probe is not exposed — sendMessage is the only public transport method (no fetchData either)", () => {
  const adapter = baseAdapter();
  assert.equal(typeof adapter.fetchData, "undefined");
  assert.equal(typeof adapter.sendMessage, "function");
});
