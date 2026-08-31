// Offline/synthetic tests for sendAnthropicMessage() — Step 5A's live-
// source boundary. No test here ever contacts a real network endpoint
// or uses a real Anthropic credential; the injected fetchImpl (via
// options.adapterConfig) is always a synthetic mock, exactly mirroring
// the pattern already established in fredMacroLiveSource.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { sendAnthropicMessage } = require("./anthropicLiveSource");

const SYNTHETIC_KEY = "synthetic-live-source-anthropic-key-not-real-000";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function successBody(overrides = {}) {
  return {
    content: [{ type: "text", text: "Synthetic completion text." }],
    model: "claude-sonnet-5",
    stop_reason: "end_turn",
    usage: { input_tokens: 5, output_tokens: 7 },
    ...overrides,
  };
}

// Runs fn() with process.env.ANTHROPIC_API_KEY set to `value` (or
// deleted if undefined), always restoring the original value afterward
// so this test file never leaks env state into any other test file run
// in the same process — mirrors fredMacroLiveSource.test.js's
// withEnvKey() exactly.
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

const basicRequest = { messages: [{ role: "user", content: "Hello" }] };

test("a configured synthetic credential produces a successful sendMessage() result", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await sendAnthropicMessage(basicRequest, {
      adapterConfig: { fetchImpl: async () => jsonResponse(200, successBody()) },
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.text, "Synthetic completion text.");
  });
});

test("a missing ANTHROPIC_API_KEY returns a documented AUTH_FAILURE and never invokes fetchImpl", async () => {
  await withEnvKey(undefined, async () => {
    let called = false;
    const result = await sendAnthropicMessage(basicRequest, {
      adapterConfig: {
        fetchImpl: async () => {
          called = true;
          return jsonResponse(200, successBody());
        },
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "AUTH_FAILURE");
    assert.equal(called, false);
  });
});

test("an empty-string ANTHROPIC_API_KEY is treated the same as missing", async () => {
  await withEnvKey("", async () => {
    let called = false;
    const result = await sendAnthropicMessage(basicRequest, {
      adapterConfig: {
        fetchImpl: async () => {
          called = true;
        },
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "AUTH_FAILURE");
    assert.equal(called, false);
  });
});

test("an adapter/network failure is passed through as a failSafe() result, not thrown", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await sendAnthropicMessage(basicRequest, {
      adapterConfig: {
        fetchImpl: async () => {
          throw new Error("connection refused");
        },
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "API_UNAVAILABLE");
  });
});

test("the synthetic credential never appears anywhere in the returned structure, success or failure", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const successResult = await sendAnthropicMessage(basicRequest, {
      adapterConfig: { fetchImpl: async () => jsonResponse(200, successBody()) },
    });
    assert.ok(!JSON.stringify(successResult).includes(SYNTHETIC_KEY));

    const failureResult = await sendAnthropicMessage(basicRequest, {
      adapterConfig: { fetchImpl: async () => jsonResponse(401, {}) },
    });
    assert.ok(!JSON.stringify(failureResult).includes(SYNTHETIC_KEY));
  });
});

test("sanity check: the synthetic key genuinely reaches the outgoing request header (proves the leakage test above is not vacuous)", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    let capturedHeaders;
    await sendAnthropicMessage(basicRequest, {
      adapterConfig: {
        fetchImpl: async (url, options) => {
          capturedHeaders = options.headers;
          return jsonResponse(200, successBody());
        },
      },
    });
    assert.equal(capturedHeaders["x-api-key"], SYNTHETIC_KEY);
  });
});

test("the returned shape exactly matches AnthropicAdapter#sendMessage()'s own output on success", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await sendAnthropicMessage(basicRequest, {
      adapterConfig: { fetchImpl: async () => jsonResponse(200, successBody()) },
    });
    assert.deepEqual(Object.keys(result).sort(), ["data", "ok"]);
    assert.deepEqual(Object.keys(result.data).sort(), ["model", "stopReason", "text", "usage"]);
  });
});

test("options.adapterConfig overrides (e.g. timeoutMs) are forwarded through to the constructed adapter", async () => {
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
    const result = await sendAnthropicMessage(basicRequest, {
      adapterConfig: { timeoutMs: 20, fetchImpl: abortAwareFetch },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "TIMEOUT");
  });
});

test("this file never references fetch(), http/https require(), or any credential literal", () => {
  const src = fs.readFileSync(require.resolve("./anthropicLiveSource.js"), "utf8");
  const codeOnly = src.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.ok(!/\bfetch\(/.test(codeOnly));
  assert.ok(!/require\(["'](http|https)["']\)/.test(codeOnly));
  assert.ok(!/["'][A-Za-z0-9]{20,}["']/.test(codeOnly));
});

test("this is the only file in llm/ whose actual code reads process.env.ANTHROPIC_API_KEY (comments may mention it)", () => {
  const filesToCheck = ["config.js", "anthropicAdapter.js", "anthropicLiveSource.js"];
  const matches = filesToCheck.filter((f) => {
    const src = fs.readFileSync(require.resolve(`./${f}`), "utf8");
    const codeOnly = src
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    return /process\.env\.ANTHROPIC_API_KEY/.test(codeOnly);
  });
  assert.deepEqual(matches, ["anthropicLiveSource.js"]);
});

test("sendAnthropicMessage is not called by app.js, server.js, or orchestrator/index.js (not wired in yet)", () => {
  const path = require("node:path");
  const candidates = ["../app.js", "../server.js", "../orchestrator/index.js"];
  for (const rel of candidates) {
    const full = path.resolve(__dirname, rel);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, "utf8");
    assert.ok(!/anthropicLiveSource|sendAnthropicMessage/.test(src), `${rel} unexpectedly references the Anthropic live source`);
  }
});
