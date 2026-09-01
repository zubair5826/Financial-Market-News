// Offline tests for POST /api/market-intelligence — the new HTTP
// transport wrapper around the existing, unmodified
// runMarketIntelligenceRequest() (providers/marketIntelligenceApplicationService.js).
// Kept in its own file (never touching server.test.js) so the
// pre-existing /health and /api/intelligence test suite is provably
// unaffected. Exercises only the HTTP transport (routing, auth, rate
// limiting, body parsing, response shape) — domain-level provider
// composition itself is already covered by
// providers/marketIntelligenceApplicationService.test.js. Every
// request here is a real local HTTP call to an ephemeral port on
// 127.0.0.1 — never an external network call, and no credential is
// ever configured in this environment for FRED/Alpha Vantage, so every
// enabled domain safely resolves through its own documented
// "not configured" path if exercised.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const TEST_AUTH_TOKEN = "SYNTHETIC_TEST_AUTH_TOKEN_MARKET_INTEL";
const AUTH_HEADERS = Object.freeze({ Authorization: `Bearer ${TEST_AUTH_TOKEN}` });
const JSON_AUTH_HEADERS = Object.freeze({ "Content-Type": "application/json", Authorization: `Bearer ${TEST_AUTH_TOKEN}` });

process.env.API_AUTH_TOKEN = TEST_AUTH_TOKEN;
test.after(() => {
  delete process.env.API_AUTH_TOKEN;
});

// Mirrors server.test.js's own helper exactly — each test file owns
// its fixtures, per this repo's established convention.
function freshServerModule() {
  delete require.cache[require.resolve("./server")];
  return require("./server");
}

async function withRunningServer(fn) {
  const { server, shutdown } = freshServerModule();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    return await fn({ baseUrl, server });
  } finally {
    await shutdown("TEST_CLEANUP");
  }
}

async function withRateLimitEnv({ windowMs, maxRequests }, fn) {
  const originalWindow = process.env.RATE_LIMIT_WINDOW_MS;
  const originalMax = process.env.RATE_LIMIT_MAX_REQUESTS;
  if (windowMs !== undefined) process.env.RATE_LIMIT_WINDOW_MS = String(windowMs);
  if (maxRequests !== undefined) process.env.RATE_LIMIT_MAX_REQUESTS = String(maxRequests);
  try {
    return await fn();
  } finally {
    if (originalWindow === undefined) delete process.env.RATE_LIMIT_WINDOW_MS;
    else process.env.RATE_LIMIT_WINDOW_MS = originalWindow;
    if (originalMax === undefined) delete process.env.RATE_LIMIT_MAX_REQUESTS;
    else process.env.RATE_LIMIT_MAX_REQUESTS = originalMax;
  }
}

// Guards against any real EXTERNAL network call for the duration of
// fn() — mirrors app.test.js/app.llmIntegration.test.js's own helper,
// adapted here to allow the test's own local HTTP call to the running
// test server (allowedPrefix) through to the real fetch, since that
// call itself uses the same global fetch this guard would otherwise
// intercept. Only a call to any OTHER URL (i.e. what the production
// code itself would make to a real provider) trips the guard.
async function withNetworkGuard(allowedPrefix, fn) {
  const original = global.fetch;
  let externalCallDetected = false;
  global.fetch = (...args) => {
    const url = String(args[0]);
    if (url.startsWith(allowedPrefix)) return original(...args);
    externalCallDetected = true;
    throw new Error(`Unexpected real external network call during an offline test: ${url}`);
  };
  try {
    const value = await fn();
    return { value, externalCallDetected };
  } finally {
    global.fetch = original;
  }
}

// --- 1. Route is reachable ---

test("1. POST /api/market-intelligence is a registered route (not 404)", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/market-intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: JSON.stringify({ request: { query: "Assess SPY", asset: "SPY" } }),
    });
    assert.notEqual(res.status, 404);
  });
});

// --- 2. Auth ---

test("2. a missing Authorization header returns 401", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/market-intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: { query: "Assess SPY", asset: "SPY" } }),
    });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Unauthorized" });
  });
});

test("2b. a wrong bearer token returns 401 — identical shape to a missing one", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/market-intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-token" },
      body: JSON.stringify({ request: { query: "Assess SPY", asset: "SPY" } }),
    });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Unauthorized" });
  });
});

// --- 3. Method ---

test("3. GET /api/market-intelligence returns 405", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/market-intelligence`, { headers: AUTH_HEADERS });
    assert.equal(res.status, 405);
    assert.deepEqual(await res.json(), { error: "Method Not Allowed", allowed: ["POST"] });
  });
});

// --- 4. Rate limiting ---

test("4. requests to this route count against the same per-IP limiter as other routes", async () => {
  await withRateLimitEnv({ windowMs: 60_000, maxRequests: 2 }, async () => {
    await withRunningServer(async ({ baseUrl }) => {
      const makeRequest = () =>
        fetch(`${baseUrl}/api/market-intelligence`, {
          method: "POST",
          headers: JSON_AUTH_HEADERS,
          body: JSON.stringify({ request: { query: "Assess SPY", asset: "SPY" } }),
        });
      const first = await makeRequest();
      const second = await makeRequest();
      const third = await makeRequest();
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(third.status, 429);
      assert.deepEqual(await third.json(), { error: "Too Many Requests" });
    });
  });
});

test("4b. a request to /api/intelligence and one to /api/market-intelligence share the same bucket", async () => {
  await withRateLimitEnv({ windowMs: 60_000, maxRequests: 2 }, async () => {
    await withRunningServer(async ({ baseUrl }) => {
      const first = await fetch(`${baseUrl}/api/market-intelligence`, {
        method: "POST",
        headers: JSON_AUTH_HEADERS,
        body: JSON.stringify({ request: { query: "Assess SPY", asset: "SPY" } }),
      });
      const second = await fetch(`${baseUrl}/api/intelligence`, {
        method: "POST",
        headers: JSON_AUTH_HEADERS,
        body: JSON.stringify({ request: { query: "Assess BTC", asset: "BTC" } }),
      });
      const third = await fetch(`${baseUrl}/api/market-intelligence`, {
        method: "POST",
        headers: JSON_AUTH_HEADERS,
        body: JSON.stringify({ request: { query: "Assess SPY", asset: "SPY" } }),
      });
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(third.status, 429);
    });
  });
});

// --- 5. Default-disabled path: no network call, safe degradation ---

test("5. with no options supplied, every provider domain stays disabled — no external network call, pipelineResult still completes", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const { value: res, externalCallDetected } = await withNetworkGuard(baseUrl, () =>
      fetch(`${baseUrl}/api/market-intelligence`, {
        method: "POST",
        headers: JSON_AUTH_HEADERS,
        body: JSON.stringify({ request: { query: "Assess SPY", asset: "SPY" } }),
      })
    );
    assert.equal(externalCallDetected, false);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.pipelineResult.ok, true);
    // runMarketIntelligenceRequest()'s own documented "no domain
    // enabled" branch returns diagnostics: null outright (not an
    // object with null sub-fields) — verified against the real,
    // unmodified function, not assumed.
    assert.equal(body.diagnostics, null);
  });
});

test("5b. explicitly disabled options.{macro,market,news} behave identically to omitting options entirely", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/market-intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: JSON.stringify({
        request: { query: "Assess SPY", asset: "SPY" },
        options: { macro: { enabled: false }, market: { enabled: false }, news: { enabled: false } },
      }),
    });
    const body = await res.json();
    assert.equal(body.pipelineResult.ok, true);
    assert.equal(body.diagnostics, null);
  });
});

// --- 6. Body validation ---

test("6. malformed JSON returns 400", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/market-intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: "{ not valid json",
    });
    assert.equal(res.status, 400);
  });
});

test("6b. a JSON array body returns 400", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/market-intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: JSON.stringify([1, 2, 3]),
    });
    assert.equal(res.status, 400);
  });
});

test('6c. a non-object "request" field returns 400', async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/market-intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: JSON.stringify({ request: "not an object" }),
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: '"request" and "options", if present, must be JSON objects.' });
  });
});

test('6d. a non-object "options" field returns 400', async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/market-intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: JSON.stringify({ request: { query: "x" }, options: "not an object" }),
    });
    assert.equal(res.status, 400);
  });
});

test("6e. an empty body still returns 200 (defaults to {} request/options, same as /api/intelligence)", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/market-intelligence`, { method: "POST", headers: AUTH_HEADERS });
    assert.equal(res.status, 200);
  });
});

// --- 7. Response shape ---

test("7. the response is exactly { pipelineResult, diagnostics } — nothing more, nothing from a different code path", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/market-intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: JSON.stringify({ request: { query: "Assess SPY", asset: "SPY" } }),
    });
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ["diagnostics", "pipelineResult"]);
    // No persistence and no llmAnnotation — runMarketIntelligenceRequest()
    // has neither concept, so none should appear here.
    assert.equal(Object.prototype.hasOwnProperty.call(body, "persistence"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "llmAnnotation"), false);
  });
});

test("7b. no credential of any kind appears anywhere in the response", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/market-intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: JSON.stringify({ request: { query: "Assess SPY", asset: "SPY" } }),
    });
    const text = await res.text();
    assert.ok(!text.includes(TEST_AUTH_TOKEN));
    assert.ok(!/fred_api_key|alphavantage_api_key|anthropic_api_key/i.test(text));
  });
});

// --- 8. Existing routes are provably unaffected ---

test("8. /health is unaffected by this change — still open, no auth required", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });
});

test("8b. /api/intelligence is unaffected by this change — same auth rule, same 200 shape", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const unauthorized = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: { query: "Assess BTC", asset: "BTC" } }),
    });
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: JSON.stringify({ request: { query: "Assess BTC", asset: "BTC" } }),
    });
    assert.equal(authorized.status, 200);
    const body = await authorized.json();
    assert.ok("pipelineResult" in body);
    assert.ok("fredDiagnostics" in body);
    assert.ok("persistence" in body);
    assert.ok("llmAnnotation" in body);
  });
});

// --- 9. No Claude/Anthropic involvement ---

test("9. the new endpoint's own source never references the LLM layer or any Anthropic-related identifier", () => {
  const src = fs.readFileSync(require.resolve("./server.js"), "utf8");
  const handlerSrc = src.slice(src.indexOf("async function handleMarketIntelligence"), src.indexOf("const ROUTES ="));
  assert.ok(!/llm\/|llmAnnotation|Anthropic|ANTHROPIC_API_KEY/i.test(handlerSrc));
});
