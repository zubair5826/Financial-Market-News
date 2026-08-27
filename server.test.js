// Offline tests for the production HTTP API layer — Step 93. Exercises
// only the HTTP transport (routing, status codes, body parsing, error
// handling, startup/shutdown) — does NOT duplicate the extensive
// domain-level coverage already in app.test.js / portfolioIntelligence.test.js.
// Every request here is a real local HTTP call to an ephemeral port on
// 127.0.0.1 — never an external network call.

const test = require("node:test");
const assert = require("node:assert/strict");

function freshServerModule() {
  // Only server.js's own cache entry is cleared, so each test gets an
  // independent { server, shutdown } pair. app.js is deliberately left
  // alone here — it is a stateless pass-through with nothing to reset
  // between tests, and test 13 relies on being able to monkey-patch its
  // cached export and have a freshly-required server.js pick that patch
  // up (which would be undone if this helper also cleared app.js).
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

// 1. GET /health -> 200 { status: "ok" }.
test("1. GET /health returns 200 with { status: 'ok' }", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  });
});

// 2. Wrong method on /health -> 405.
test("2. POST /health returns 405 (unsupported method)", async () => {
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

// 4. Valid POST /api/intelligence -> 200, calls the real existing pipeline.
test("4. POST /api/intelligence with a minimal valid body returns 200 with the real pipeline shape", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: { query: "Assess BTC", asset: "BTC" } }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok("pipelineResult" in body);
    assert.ok("fredDiagnostics" in body);
    assert.equal(body.pipelineResult.asset, "BTC");
  });
});

// 4b. FRED is never touched unless the caller explicitly enables it.
test("4b. POST /api/intelligence without options.macro.enabled never enables FRED (fredDiagnostics stays null)", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: { query: "Assess BTC" } }),
    });
    const body = await res.json();
    assert.equal(body.fredDiagnostics, null);
  });
});

// 5. Empty body on /api/intelligence -> still 200 (defaults to {} request/options).
test("5. POST /api/intelligence with no body at all still returns 200 (empty request degrades safely)", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, { method: "POST" });
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

// 7. Malformed JSON -> 400.
test("7. POST /api/intelligence with malformed JSON returns 400, never crashes the server", async () => {
  await withRunningServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/intelligence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
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
    const res = await fetch(`${baseUrl}/api/portfolio-intelligence`, { method: "POST" });
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
      headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
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
      fetch(`${baseUrl}/api/intelligence`, { method: "POST", body: JSON.stringify({ request: { query: "Assess BTC" } }) }),
      fetch(`${baseUrl}/api/portfolio-intelligence`, { method: "POST", body: JSON.stringify({ text: "I have $1,000." }) }),
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
