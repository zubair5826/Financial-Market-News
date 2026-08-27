// Offline tests for the production HTTP API layer — Step 93, hardened
// in Step 105 (authentication + rate limiting). Exercises only the HTTP
// transport (routing, status codes, auth, rate limiting, body parsing,
// error handling, startup/shutdown) — does NOT duplicate the extensive
// domain-level coverage already in app.test.js / portfolioIntelligence.test.js.
// Every request here is a real local HTTP call to an ephemeral port on
// 127.0.0.1 — never an external network call.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Step 102: /api/intelligence now persists a run record per request via
// app.js/data/runStore.js. A single shared throwaway temp path (passed
// as body.options.runStore.filePath — the JSON HTTP request body is the
// only channel available at this layer) keeps these tests from
// appending to the real data/runs.jsonl, cleaned up once after this
// whole file's tests complete. One test below (empty body) cannot
// supply this override at all — see its own comment.
const TEST_RUNS_FILE = path.join(os.tmpdir(), `server-test-runs-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
const RUN_STORE_OPTIONS = { runStore: { filePath: TEST_RUNS_FILE } };

// Step 105: a synthetic bearer token configured for the whole file by
// default (most tests exercise authenticated, successful behavior);
// individual auth/rate-limit tests override process.env directly for
// just their own duration.
const TEST_AUTH_TOKEN = "SYNTHETIC_TEST_AUTH_TOKEN_105";
const AUTH_HEADERS = Object.freeze({ Authorization: `Bearer ${TEST_AUTH_TOKEN}` });
const JSON_AUTH_HEADERS = Object.freeze({ "Content-Type": "application/json", Authorization: `Bearer ${TEST_AUTH_TOKEN}` });

process.env.API_AUTH_TOKEN = TEST_AUTH_TOKEN;

test.after(() => {
  delete process.env.API_AUTH_TOKEN;
  try {
    fs.unlinkSync(TEST_RUNS_FILE);
  } catch {
    // Already absent.
  }
});

async function withEnvVar(name, value, fn) {
  const original = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
}

function freshServerModule() {
  // Only server.js's own cache entry is cleared, so each test gets an
  // independent { server, shutdown } pair AND a fresh in-memory
  // rate-limit map (Step 105) — no test can affect another's counters.
  // app.js is deliberately left alone here — it is a stateless
  // pass-through with nothing to reset between tests, and one test
  // relies on being able to monkey-patch its cached export and have a
  // freshly-required server.js pick that patch up (which would be
  // undone if this helper also cleared app.js).
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

// RATE_LIMIT_WINDOW_MS/RATE_LIMIT_MAX_REQUESTS are read once at
// server.js module load, so a test that needs a different limit must
// set the env var(s) BEFORE the module is (re-)required — i.e. before
// withRunningServer()/freshServerModule() runs.
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

function minimalIntelligenceBody(overrides = {}) {
  return JSON.stringify({ request: { query: "Assess BTC", asset: "BTC" }, options: RUN_STORE_OPTIONS, ...overrides });
}

// --- Health endpoint (never authenticated, never rate-limited) ---

test("1. GET /health returns 200 with { status: 'ok' }, no auth required", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });
});

test("2. POST /health returns 405 (unsupported method), no auth required", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/health`, { method: "POST" });
    assert.equal(res.status, 405);
    const body = await res.json();
    assert.ok(body.error);
  });
});

// 3. Unknown route -> 404.
test("3. an unknown route returns 404", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "Not Found");
  });
});

// --- Step 105: authentication ---

test("105-1. a valid bearer token authorizes POST /api/intelligence", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: minimalIntelligenceBody(),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.pipelineResult.asset, "BTC");
  });
});

test("105-2. a missing Authorization header returns 401 with a generic message, no detail", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: minimalIntelligenceBody(),
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.deepEqual(body, { error: "Unauthorized" });
  });
});

test("105-3. an invalid (wrong-value) bearer token returns 401, identical to a missing token", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer totally-wrong-token" },
      body: minimalIntelligenceBody(),
    });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Unauthorized" });
  });
});

test("105-4. a malformed Authorization header (no Bearer prefix) returns 401, same generic message", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: TEST_AUTH_TOKEN },
      body: minimalIntelligenceBody(),
    });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: "Unauthorized" });
  });
});

test("105-5. an empty Authorization header value returns 401", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " },
      body: minimalIntelligenceBody(),
    });
    assert.equal(res.status, 401);
  });
});

test("105-6. if API_AUTH_TOKEN is not configured at all, every intelligence request fails closed with 401 (never silently open)", async () => {
  await withEnvVar("API_AUTH_TOKEN", undefined, async () => {
    await withRunningServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/intelligence`, {
        method: "POST",
        headers: JSON_AUTH_HEADERS, // even the "correct" token can't match a token that doesn't exist
        body: minimalIntelligenceBody(),
      });
      assert.equal(res.status, 401);
    });
  });
});

test("105-7. auth also protects POST /api/portfolio-intelligence, both missing and valid token", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const unauthorized = await fetch(`${baseUrl}/api/portfolio-intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "I have $1,000." }),
    });
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`${baseUrl}/api/portfolio-intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: JSON.stringify({ text: "I have CAD $10,000 for 5 years. I am comfortable with moderate risk. I want balanced growth." }),
    });
    assert.equal(authorized.status, 200);
  });
});

test("105-8. wrong method (405) takes precedence over auth — GET /api/intelligence is 405 with no Authorization header at all", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`);
    assert.equal(res.status, 405);
  });
});

test("105-9. auth is checked before the body is read — malformed JSON without a token is 401, not 400", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not valid json",
    });
    assert.equal(res.status, 401);
  });
});

// --- Step 105: rate limiting ---

test("105-10. requests under the configured limit all succeed", async () => {
  await withRateLimitEnv({ windowMs: 60_000, maxRequests: 5 }, async () => {
    await withRunningServer(async ({ baseUrl }) => {
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${baseUrl}/api/intelligence`, { method: "POST", headers: JSON_AUTH_HEADERS, body: minimalIntelligenceBody() });
        assert.equal(res.status, 200, `request ${i + 1} of 5 should succeed`);
      }
    });
  });
});

test("105-11. exceeding the configured limit returns 429 with Retry-After, and never crashes the server", async () => {
  await withRateLimitEnv({ windowMs: 60_000, maxRequests: 3 }, async () => {
    await withRunningServer(async ({ baseUrl }) => {
      for (let i = 0; i < 3; i++) {
        const res = await fetch(`${baseUrl}/api/intelligence`, { method: "POST", headers: JSON_AUTH_HEADERS, body: minimalIntelligenceBody() });
        assert.equal(res.status, 200);
      }
      const limited = await fetch(`${baseUrl}/api/intelligence`, { method: "POST", headers: JSON_AUTH_HEADERS, body: minimalIntelligenceBody() });
      assert.equal(limited.status, 429);
      assert.deepEqual(await limited.json(), { error: "Too Many Requests" });
      assert.ok(limited.headers.get("retry-after"));

      // The server must still be alive and healthy afterward.
      const health = await fetch(`${baseUrl}/health`);
      assert.equal(health.status, 200);
    });
  });
});

test("105-12. rate limiting cannot be bypassed by unknown routes, wrong methods, or malformed bodies — all count against the same IP", async () => {
  await withRateLimitEnv({ windowMs: 60_000, maxRequests: 3 }, async () => {
    await withRunningServer(async ({ baseUrl }) => {
      // Three deliberately different, non-2xx requests: unknown route,
      // wrong method, malformed JSON — none of them should let a
      // caller dodge the limiter.
      const first = await fetch(`${baseUrl}/does-not-exist`);
      assert.equal(first.status, 404);
      const second = await fetch(`${baseUrl}/api/intelligence`);
      assert.equal(second.status, 405);
      const third = await fetch(`${baseUrl}/api/intelligence`, {
        method: "POST",
        headers: JSON_AUTH_HEADERS,
        body: "{not valid json",
      });
      assert.equal(third.status, 400);

      // The window is exhausted (3 requests already counted) — even a
      // perfectly valid, authenticated 4th request is now limited.
      const fourth = await fetch(`${baseUrl}/api/intelligence`, {
        method: "POST",
        headers: JSON_AUTH_HEADERS,
        body: minimalIntelligenceBody(),
      });
      assert.equal(fourth.status, 429);
    });
  });
});

test("105-13. /health is never rate-limited, even after the limit is exhausted on other routes", async () => {
  await withRateLimitEnv({ windowMs: 60_000, maxRequests: 1 }, async () => {
    await withRunningServer(async ({ baseUrl }) => {
      const first = await fetch(`${baseUrl}/api/intelligence`, { method: "POST", headers: JSON_AUTH_HEADERS, body: minimalIntelligenceBody() });
      assert.equal(first.status, 200);
      const limited = await fetch(`${baseUrl}/api/intelligence`, { method: "POST", headers: JSON_AUTH_HEADERS, body: minimalIntelligenceBody() });
      assert.equal(limited.status, 429);

      // /health is unaffected regardless of how exhausted the limiter is.
      for (let i = 0; i < 5; i++) {
        const health = await fetch(`${baseUrl}/health`);
        assert.equal(health.status, 200);
      }
    });
  });
});

test("105-14. a fresh window (new server instance) resets the counter — confirms the limit is per-window, not permanent", async () => {
  await withRateLimitEnv({ windowMs: 60_000, maxRequests: 1 }, async () => {
    await withRunningServer(async ({ baseUrl }) => {
      const first = await fetch(`${baseUrl}/api/intelligence`, { method: "POST", headers: JSON_AUTH_HEADERS, body: minimalIntelligenceBody() });
      assert.equal(first.status, 200);
      const limited = await fetch(`${baseUrl}/api/intelligence`, { method: "POST", headers: JSON_AUTH_HEADERS, body: minimalIntelligenceBody() });
      assert.equal(limited.status, 429);
    });
    // A brand-new server instance (fresh module, fresh in-memory map)
    // is not limited by the previous instance's counters.
    await withRunningServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/intelligence`, { method: "POST", headers: JSON_AUTH_HEADERS, body: minimalIntelligenceBody() });
      assert.equal(res.status, 200);
    });
  });
});

// --- Preserved existing behavior (400/404/405/500), now under auth ---

test("4. POST /api/intelligence with a minimal valid body returns 200 with the real pipeline shape", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: minimalIntelligenceBody(),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok("pipelineResult" in body);
    assert.ok("fredDiagnostics" in body);
    assert.ok("persistence" in body); // Step 102
    assert.equal(body.pipelineResult.asset, "BTC");
  });
});

// 4b. FRED is never touched unless the caller explicitly enables it.
test("4b. POST /api/intelligence without options.macro.enabled never enables FRED (fredDiagnostics stays null)", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: JSON.stringify({ request: { query: "Assess BTC" }, options: RUN_STORE_OPTIONS }),
    });
    const body = await res.json();
    assert.equal(body.fredDiagnostics, null);
  });
});

// 5. Empty body on /api/intelligence -> still 200 (defaults to {} request/options).
// NOTE (Step 102): a genuinely empty POST body has no channel to carry
// a runStore override, so this one request is persisted to the real
// data/runs.jsonl (a single harmless, already-redacted line) rather
// than a test temp file — an accepted, documented exception, not an
// oversight; every other test in this file redirects via
// RUN_STORE_OPTIONS.
test("5. POST /api/intelligence with no body at all still returns 200 (empty request degrades safely)", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, { method: "POST", headers: AUTH_HEADERS });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok("pipelineResult" in body);
  });
});

// 6. Wrong method on a known route -> 405.
test("6. GET /api/intelligence returns 405 (unsupported method)", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`);
    assert.equal(res.status, 405);
  });
});

// 7. Malformed JSON -> 400 (when authenticated).
test("7. POST /api/intelligence with malformed JSON returns 400, never crashes the server", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: "{not valid json",
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);

    // The server must still be alive and healthy afterward.
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
  });
});

// 8. Valid JSON but not an object -> 400 (invalid request envelope).
test("8. POST /api/intelligence with a JSON array body returns 400", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: JSON.stringify([1, 2, 3]),
    });
    assert.equal(res.status, 400);
  });
});

// 9. Valid POST /api/portfolio-intelligence -> 200, calls the real existing logic.
test("9. POST /api/portfolio-intelligence with a realistic body returns 200 with the real 8-field shape", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/portfolio-intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: JSON.stringify({ text: "I have CAD $10,000 for 5 years. I am comfortable with moderate risk. I want balanced growth." }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(
      Object.keys(body).sort(),
      ["ambiguities", "assumptions", "contradictions", "missingInformation", "portfolio", "status", "unknowns", "warnings"].sort()
    );
    assert.equal(body.status, "READY");
  });
});

// 10. Portfolio endpoint never touches any provider — no network call possible.
test("10. POST /api/portfolio-intelligence never performs a real network call", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const originalFetch = global.fetch;
    // Guard everything EXCEPT calls back to our own test server itself.
    global.fetch = (...args) => {
      const url = String(args[0]);
      if (url.startsWith(baseUrl)) return originalFetch(...args);
      throw new Error(`Unexpected real network call during an offline test: ${url}`);
    };
    try {
      const res = await global.fetch(`${baseUrl}/api/portfolio-intelligence`, {
        method: "POST",
        headers: JSON_AUTH_HEADERS,
        body: JSON.stringify({ text: "I have CAD $5,000 for 3 years. I am comfortable with high risk. I want capital growth." }),
      });
      assert.equal(res.status, 200);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// 11. Empty body on /api/portfolio-intelligence -> 200, BLOCKED (missing text).
test("11. POST /api/portfolio-intelligence with no body returns 200 with a safe BLOCKED result, never crashes", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/portfolio-intelligence`, { method: "POST", headers: AUTH_HEADERS });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "BLOCKED");
    assert.equal(body.portfolio, null);
  });
});

// 12. Request body exceeding the size limit -> 400.
test("12. a request body larger than the configured limit returns 400", async () => {
  const { MAX_BODY_BYTES } = require("./server");
  await withRunningServer(async ({ baseUrl }) => {
    const oversized = JSON.stringify({ text: "a".repeat(MAX_BODY_BYTES + 1000) });
    const res = await fetch(`${baseUrl}/api/portfolio-intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: oversized,
    });
    assert.equal(res.status, 400);
  });
});

// 13. Internal error handling -> 500, no internal detail leaked.
test("13. an unexpected internal error is reported as a generic 500 with no stack trace or internal detail leaked", async () => {
  const appPath = require.resolve("./app");
  const originalExports = { ...require(appPath) };
  // Monkey-patch the real module's export to throw, then force a fresh
  // require of server.js so it captures the throwing function — the
  // same technique already used elsewhere in this project's test suite
  // to simulate an internal failure without touching production code.
  require.cache[appPath].exports.runApplicationRequest = async () => {
    throw new Error("simulated internal failure — must never reach the client");
  };
  try {
    await withRunningServer(async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/intelligence`, {
        method: "POST",
        headers: JSON_AUTH_HEADERS,
        body: JSON.stringify({ request: { query: "Assess BTC" } }),
      });
      assert.equal(res.status, 500);
      const body = await res.json();
      assert.equal(body.error, "Internal Server Error");
      const serialized = JSON.stringify(body);
      assert.ok(!serialized.includes("simulated internal failure"));
      assert.ok(!serialized.includes("stack"));
    });
  } finally {
    require.cache[appPath].exports.runApplicationRequest = originalExports.runApplicationRequest;
    delete require.cache[require.resolve("./server")];
  }
});

// 13b. Step 102: a real HTTP round trip through /api/intelligence
// actually reaches data/runStore.js and appends a matching record.
test("13b. POST /api/intelligence persists a run record reachable from the HTTP response's own run_id", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: minimalIntelligenceBody(),
    });
    const body = await res.json();
    assert.equal(body.persistence.status, "PERSISTED");
    assert.ok(body.persistence.run_id);

    const lines = fs
      .readFileSync(TEST_RUNS_FILE, "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
    assert.ok(lines.some((l) => l.run_id === body.persistence.run_id));
  });
});

// Step 104: every HTTP request now also produces one operational log
// entry via logs/logger.js's own request-level hook (requestListener's
// logRequestOutcome). logs/logger.js has no injectable path from this
// layer (server.js always uses the real logs/system.log — a deliberate,
// minimal-scope choice; see logger.js's own module comment), so this
// one test reads the real file — a single, harmless, already-redacted
// line, self-capped by Step 104's own rotation, exactly the same
// accepted exception already documented above.
test("13c. a request produces a real operational log entry with route, run_id, and outcome", async () => {
  const { flushLogs, LOG_FILE } = require("./logs/logger");
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: JSON_AUTH_HEADERS,
      body: minimalIntelligenceBody(),
    });
    const body = await res.json();
    await flushLogs();
    const lines = fs
      .readFileSync(LOG_FILE, "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.route, "/api/intelligence");
    assert.equal(last.run_id, body.persistence.run_id);
    assert.equal(last.response_status, "SUCCESS");
    assert.deepEqual(last.errors, []);
  });
});

// 14. Startup/shutdown behavior: after shutdown, the server no longer accepts connections.
test("14. shutdown() closes the server so it no longer accepts new connections", async () => {
  const { server, shutdown } = freshServerModule();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const before = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(before.status, 200);

  await shutdown("TEST_CLEANUP");

  await assert.rejects(() => fetch(`http://127.0.0.1:${port}/health`));
});

// 15. Secrets are never present in any HTTP response.
test("15. no response body ever contains a credential-shaped string", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const responses = await Promise.all([
      fetch(`${baseUrl}/health`),
      fetch(`${baseUrl}/api/intelligence`, {
        method: "POST",
        headers: JSON_AUTH_HEADERS,
        body: minimalIntelligenceBody(),
      }),
      fetch(`${baseUrl}/api/portfolio-intelligence`, { method: "POST", headers: JSON_AUTH_HEADERS, body: JSON.stringify({ text: "I have $1,000." }) }),
    ]);
    for (const res of responses) {
      const text = (await res.text()).toLowerCase();
      assert.ok(!text.includes("apikey"));
      assert.ok(!text.includes("api_key"));
      assert.ok(!text.includes("fred_api_key"));
      assert.ok(!text.includes("alphavantage_api_key"));
    }
  });
});

// --- Step 105: no secret leakage (the auth token itself) ---

test("105-15. the configured API_AUTH_TOKEN value never appears in any response, success or failure", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const responses = await Promise.all([
      fetch(`${baseUrl}/health`),
      fetch(`${baseUrl}/api/intelligence`, { method: "POST", headers: JSON_AUTH_HEADERS, body: minimalIntelligenceBody() }), // 200
      fetch(`${baseUrl}/api/intelligence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: minimalIntelligenceBody() }), // 401
      fetch(`${baseUrl}/api/intelligence`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-token" },
        body: minimalIntelligenceBody(),
      }), // 401
    ]);
    for (const res of responses) {
      const text = await res.text();
      assert.ok(!text.includes(TEST_AUTH_TOKEN));
    }
  });
});

test("105-16. the configured API_AUTH_TOKEN value never appears in the operational log entry for a request", async () => {
  const { flushLogs, LOG_FILE } = require("./logs/logger");
  await withRunningServer(async ({ baseUrl }) => {
    await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-token" },
      body: minimalIntelligenceBody(),
    });
    await flushLogs();
    const lines = fs
      .readFileSync(LOG_FILE, "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.response_status, "CLIENT_ERROR");
    const serialized = JSON.stringify(last);
    assert.ok(!serialized.includes(TEST_AUTH_TOKEN));
    assert.ok(!serialized.includes("wrong-token"));
    assert.ok(!serialized.toLowerCase().includes("bearer"));
  });
});
