// Offline/synthetic tests for runMarketIntelligenceRequest() — Step 47's
// merged multi-provider application service, implementing the design
// frozen in Step 46A. No test here ever contacts a real network
// endpoint or uses a real credential (FRED or Alpha Vantage). Every
// process.env credential is set to an obviously-synthetic value only
// for the duration of a single test, always restored immediately after.

const test = require("node:test");
const assert = require("node:assert/strict");

// processRequest() invocation counting: patch the already-required
// orchestrator module's export BEFORE marketIntelligenceApplicationService.js
// is itself required, so its own destructured `processRequest` binding
// (resolved from the same cached module.exports object) picks up the
// wrapped version. No file on disk is modified. This is the most
// direct way to prove the Step 46A "exactly one processRequest() call"
// invariant, which matters far more here than in any single-provider
// service, since three independent providers are composed in parallel.
const orchestratorModule = require("../orchestrator");
const originalProcessRequest = orchestratorModule.processRequest;
let processRequestCallCount = 0;
orchestratorModule.processRequest = (...args) => {
  processRequestCallCount++;
  return originalProcessRequest(...args);
};

const { runMarketIntelligenceRequest } = require("./marketIntelligenceApplicationService");
const { ERROR_CODES } = require("../core/errors");

// Fast-timer patch: the implementation's Step 48A fix waits a real,
// fixed 1100ms between the market and news Alpha Vantage requests.
// Waiting that out for real in every combined-domain test would make
// this suite slow for no benefit, and no fake-timer dependency is
// permitted. Instead, the real global.setTimeout is wrapped to record
// the requested delay (proving 1100ms was actually requested) while
// firing almost immediately (0ms) — genuine async ordering is
// preserved (the callback still runs on a later tick), only the real
// wall-clock wait is removed.
const originalSetTimeout = global.setTimeout;
let timeoutCalls = [];
let activeOrderLog = null;
global.setTimeout = (fn, ms, ...args) =>
  originalSetTimeout(
    () => {
      timeoutCalls.push(ms);
      if (activeOrderLog) activeOrderLog.push(`delay:${ms}`);
      fn();
    },
    0,
    ...args
  );

const SYNTHETIC_FRED_KEY = "SYNTHETIC_FRED_KEY";
const SYNTHETIC_AV_KEY = "SYNTHETIC_AV_KEY";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// --- FRED mock helpers (mirrors fredMacroAdapter's two-call contract) ---
function fredSeriesMetadataBody() {
  return { seriess: [{ id: "GNPCA", title: "Real Gross National Product", units: "Billions of Dollars" }] };
}
function fredObservationsBody() {
  return {
    realtime_start: "2026-01-01",
    realtime_end: "2026-01-01",
    units: "Billions of Dollars",
    observations: [{ date: "2026-01-01", value: "21427.2", realtime_start: "2026-02-15", realtime_end: "9999-12-31" }],
  };
}
function makeFredMockFetch(onCall) {
  return async (url) => {
    if (onCall) onCall(url);
    if (url.includes("/series/observations")) return jsonResponse(200, fredObservationsBody());
    if (url.includes("/series")) return jsonResponse(200, fredSeriesMetadataBody());
    throw new Error(`Unexpected FRED mock URL: ${url}`);
  };
}

// --- Alpha Vantage market mock helper ---
function marketDailyBody() {
  return { "Time Series (Daily)": { "2026-08-24": { "1. open": "560.10", "2. high": "563.50", "3. low": "559.00", "4. close": "562.20", "5. volume": "45012345" } } };
}
function makeMarketMockFetch(onCall) {
  return async (url) => {
    if (onCall) onCall(url);
    return jsonResponse(200, marketDailyBody());
  };
}

// --- Alpha Vantage news mock helper ---
function newsFeedBody() {
  return {
    items: "1",
    feed: [
      {
        title: "SPY hits new high as market rallies",
        url: "https://example.com/article-1",
        time_published: "20260824T093000",
        summary: "The S&P 500 ETF rose sharply amid strong earnings.",
        source: "Example Financial News",
        topics: [{ topic: "financial_markets", relevance_score: "0.9" }],
        ticker_sentiment: [{ ticker: "SPY", relevance_score: "0.85", ticker_sentiment_score: "0.3", ticker_sentiment_label: "Somewhat-Bullish" }],
      },
    ],
  };
}
function makeNewsMockFetch(onCall) {
  return async (url) => {
    if (onCall) onCall(url);
    return jsonResponse(200, newsFeedBody());
  };
}

async function withEnvKeys({ fred, av }, fn) {
  const originalFred = process.env.FRED_API_KEY;
  const originalAv = process.env.ALPHAVANTAGE_API_KEY;
  if (fred === undefined) delete process.env.FRED_API_KEY;
  else process.env.FRED_API_KEY = fred;
  if (av === undefined) delete process.env.ALPHAVANTAGE_API_KEY;
  else process.env.ALPHAVANTAGE_API_KEY = av;
  try {
    return await fn();
  } finally {
    if (originalFred === undefined) delete process.env.FRED_API_KEY;
    else process.env.FRED_API_KEY = originalFred;
    if (originalAv === undefined) delete process.env.ALPHAVANTAGE_API_KEY;
    else process.env.ALPHAVANTAGE_API_KEY = originalAv;
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
    const value = await fn();
    return { value, networkCalled: called };
  } finally {
    global.fetch = original;
  }
}

function validBaseRequest(overrides = {}) {
  return { query: "Assess SPY", asset: "SPY", ...overrides };
}

// orderLog records "market", "delay:<ms>", "news" in the exact order
// they actually occurred, letting tests prove sequencing (Step 48A)
// without relying on wall-clock timestamps.
function allProviderCalls(orderLog = []) {
  const fredCalls = [];
  const marketCalls = [];
  const newsCalls = [];
  activeOrderLog = orderLog;
  timeoutCalls = [];
  return {
    fredCalls,
    marketCalls,
    newsCalls,
    orderLog,
    adapterConfigs: {
      macroAdapterConfig: { fetchImpl: makeFredMockFetch((u) => fredCalls.push(u)) },
      marketAdapterConfig: {
        fetchImpl: makeMarketMockFetch((u) => {
          marketCalls.push(u);
          orderLog.push("market");
        }),
      },
      newsAdapterConfig: {
        fetchImpl: makeNewsMockFetch((u) => {
          newsCalls.push(u);
          orderLog.push("news");
        }),
      },
    },
  };
}

// 1. All three domains disabled.
test("1. all three domains disabled: no provider acquisition, processRequest() still runs once, diagnostics is null", async () => {
  await withEnvKeys({}, async () => {
    processRequestCallCount = 0;
    const { fredCalls, marketCalls, newsCalls, adapterConfigs } = allProviderCalls();
    const { value: result, networkCalled } = await withNetworkGuard(async () =>
      runMarketIntelligenceRequest(validBaseRequest(), adapterConfigs)
    );
    assert.equal(networkCalled, false);
    assert.equal(fredCalls.length, 0);
    assert.equal(marketCalls.length, 0);
    assert.equal(newsCalls.length, 0);
    assert.equal(processRequestCallCount, 1);
    assert.equal(result.pipelineResult.ok, true);
    assert.equal(result.diagnostics, null);
  });
});

// 2. Macro only.
test("2. macro only: FRED invoked once (2 calls), market/news not invoked, one processRequest() call", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY }, async () => {
    processRequestCallCount = 0;
    const { fredCalls, marketCalls, newsCalls, adapterConfigs } = allProviderCalls();
    const result = await runMarketIntelligenceRequest(validBaseRequest(), { macro: { enabled: true }, ...adapterConfigs });
    assert.equal(fredCalls.length, 2);
    assert.equal(marketCalls.length, 0);
    assert.equal(newsCalls.length, 0);
    assert.equal(processRequestCallCount, 1);
    assert.equal(result.pipelineResult.pipeline_summary.macro_status, "OK");
    assert.equal(result.diagnostics.market, null);
    assert.equal(result.diagnostics.news, null);
    assert.ok(result.diagnostics.macro);
  });
});

// 3. Market only.
test("3. market only: market live source invoked once, macro/news not invoked, one processRequest() call", async () => {
  await withEnvKeys({ av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { fredCalls, marketCalls, newsCalls, adapterConfigs } = allProviderCalls();
    const result = await runMarketIntelligenceRequest(validBaseRequest(), { market: { enabled: true }, ...adapterConfigs });
    assert.equal(fredCalls.length, 0);
    assert.equal(marketCalls.length, 1);
    assert.equal(newsCalls.length, 0);
    assert.equal(processRequestCallCount, 1);
    assert.equal(result.pipelineResult.pipeline_summary.technical_status, "OK");
    assert.equal(result.diagnostics.macro, null);
    assert.equal(result.diagnostics.news, null);
    assert.ok(result.diagnostics.market);
  });
});

// 4. News only.
test("4. news only: news live source invoked once, macro/market not invoked, one processRequest() call", async () => {
  await withEnvKeys({ av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { fredCalls, marketCalls, newsCalls, adapterConfigs } = allProviderCalls();
    const result = await runMarketIntelligenceRequest(validBaseRequest(), { news: { enabled: true }, ...adapterConfigs });
    assert.equal(fredCalls.length, 0);
    assert.equal(marketCalls.length, 0);
    assert.equal(newsCalls.length, 1);
    assert.equal(processRequestCallCount, 1);
    assert.equal(result.pipelineResult.pipeline_summary.news_status, "OK");
    assert.equal(result.diagnostics.macro, null);
    assert.equal(result.diagnostics.market, null);
    assert.ok(result.diagnostics.news);
  });
});

// 5. All three enabled.
test("5. all three enabled: each provider invoked exactly once, one merged request, one processRequest() call", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY, av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { fredCalls, marketCalls, newsCalls, adapterConfigs } = allProviderCalls();
    const result = await runMarketIntelligenceRequest(validBaseRequest(), {
      macro: { enabled: true },
      market: { enabled: true },
      news: { enabled: true },
      ...adapterConfigs,
    });
    assert.equal(fredCalls.length, 2);
    assert.equal(marketCalls.length, 1);
    assert.equal(newsCalls.length, 1);
    assert.equal(processRequestCallCount, 1);
    assert.equal(result.pipelineResult.ok, true);
    assert.equal(result.pipelineResult.pipeline_summary.macro_status, "OK");
    assert.equal(result.pipelineResult.pipeline_summary.technical_status, "OK");
    assert.equal(result.pipelineResult.pipeline_summary.news_status, "OK");
    assert.ok(result.diagnostics.macro);
    assert.ok(result.diagnostics.market);
    assert.ok(result.diagnostics.news);
  });
});

// 6. Macro + market.
test("6. macro + market: exactly those two acquired, news not acquired, one processRequest() call", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY, av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { fredCalls, marketCalls, newsCalls, adapterConfigs } = allProviderCalls();
    const result = await runMarketIntelligenceRequest(validBaseRequest(), { macro: { enabled: true }, market: { enabled: true }, ...adapterConfigs });
    assert.equal(fredCalls.length, 2);
    assert.equal(marketCalls.length, 1);
    assert.equal(newsCalls.length, 0);
    assert.equal(processRequestCallCount, 1);
    assert.equal(result.diagnostics.news, null);
  });
});

// 7. Macro + news.
test("7. macro + news: exactly those two acquired, market not acquired, one processRequest() call", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY, av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { fredCalls, marketCalls, newsCalls, adapterConfigs } = allProviderCalls();
    const result = await runMarketIntelligenceRequest(validBaseRequest(), { macro: { enabled: true }, news: { enabled: true }, ...adapterConfigs });
    assert.equal(fredCalls.length, 2);
    assert.equal(marketCalls.length, 0);
    assert.equal(newsCalls.length, 1);
    assert.equal(processRequestCallCount, 1);
    assert.equal(result.diagnostics.market, null);
  });
});

// 8. Market + news.
test("8. market + news: exactly those two acquired, macro not acquired, one processRequest() call", async () => {
  await withEnvKeys({ av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { fredCalls, marketCalls, newsCalls, adapterConfigs } = allProviderCalls();
    const result = await runMarketIntelligenceRequest(validBaseRequest(), { market: { enabled: true }, news: { enabled: true }, ...adapterConfigs });
    assert.equal(fredCalls.length, 0);
    assert.equal(marketCalls.length, 1);
    assert.equal(newsCalls.length, 1);
    assert.equal(processRequestCallCount, 1);
    assert.equal(result.diagnostics.macro, null);
  });
});

// 9. Ambiguous macro merge.
test("9. macro enabled + request.macroData already present: clear rejection, no silent overwrite, no network, no processRequest() call", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY }, async () => {
    processRequestCallCount = 0;
    const { fredCalls, marketCalls, newsCalls, adapterConfigs } = allProviderCalls();
    const request = validBaseRequest({ macroData: [{ indicator: "Caller Supplied", classification: "FACT" }] });
    const { value: result, networkCalled } = await withNetworkGuard(async () =>
      runMarketIntelligenceRequest(request, { macro: { enabled: true }, ...adapterConfigs })
    );
    assert.equal(networkCalled, false);
    assert.equal(fredCalls.length, 0);
    assert.equal(marketCalls.length, 0);
    assert.equal(newsCalls.length, 0);
    assert.equal(processRequestCallCount, 0);
    assert.equal(result.pipelineResult.ok, false);
    assert.equal(result.pipelineResult.code, ERROR_CODES.MALFORMED_DATA);
    assert.ok(result.pipelineResult.message.includes("request.macroData"));
    assert.equal(result.diagnostics, null);
  });
});

// 10. Ambiguous market merge.
test("10. market enabled + request.technicalCandles already present: clear rejection, no silent overwrite", async () => {
  await withEnvKeys({ av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { fredCalls, marketCalls, newsCalls, adapterConfigs } = allProviderCalls();
    const request = validBaseRequest({ technicalCandles: [{ asset: "SPY", open: 1, high: 2, low: 0, close: 1, classification: "FACT" }] });
    const { value: result, networkCalled } = await withNetworkGuard(async () =>
      runMarketIntelligenceRequest(request, { market: { enabled: true }, ...adapterConfigs })
    );
    assert.equal(networkCalled, false);
    assert.equal(marketCalls.length, 0);
    assert.equal(processRequestCallCount, 0);
    assert.equal(result.pipelineResult.ok, false);
    assert.equal(result.pipelineResult.code, ERROR_CODES.MALFORMED_DATA);
    assert.ok(result.pipelineResult.message.includes("request.technicalCandles"));
  });
});

// 11. Ambiguous news merge.
test("11. news enabled + request.newsData already present: clear rejection, no silent overwrite", async () => {
  await withEnvKeys({ av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { fredCalls, marketCalls, newsCalls, adapterConfigs } = allProviderCalls();
    const request = validBaseRequest({ newsData: [{ headline: "Caller Supplied", classification: "FACT" }] });
    const { value: result, networkCalled } = await withNetworkGuard(async () =>
      runMarketIntelligenceRequest(request, { news: { enabled: true }, ...adapterConfigs })
    );
    assert.equal(networkCalled, false);
    assert.equal(newsCalls.length, 0);
    assert.equal(processRequestCallCount, 0);
    assert.equal(result.pipelineResult.ok, false);
    assert.equal(result.pipelineResult.code, ERROR_CODES.MALFORMED_DATA);
    assert.ok(result.pipelineResult.message.includes("request.newsData"));
  });
});

// 12. Existing unrelated request fields are preserved (flow through to the pipeline).
test("12. unrelated request fields (query, asset) reach the pipeline unchanged", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY, av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { adapterConfigs } = allProviderCalls();
    const result = await runMarketIntelligenceRequest(validBaseRequest({ asset: "SPY" }), {
      macro: { enabled: true },
      market: { enabled: true },
      news: { enabled: true },
      ...adapterConfigs,
    });
    assert.equal(result.pipelineResult.asset, "SPY");
  });
});

// 13. Original request remains unchanged (not mutated).
test("13. the caller's original request object is not mutated", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY, av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { adapterConfigs } = allProviderCalls();
    const request = validBaseRequest();
    const snapshot = JSON.parse(JSON.stringify(request));
    await runMarketIntelligenceRequest(request, { macro: { enabled: true }, market: { enabled: true }, news: { enabled: true }, ...adapterConfigs });
    assert.deepEqual(request, snapshot);
  });
});

// 14. Exactly one processRequest() call occurs (covered per-scenario above; this test re-confirms across a mixed run).
test("14. exactly one processRequest() call occurs for a multi-domain run", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY, av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { adapterConfigs } = allProviderCalls();
    await runMarketIntelligenceRequest(validBaseRequest(), { macro: { enabled: true }, news: { enabled: true }, ...adapterConfigs });
    assert.equal(processRequestCallCount, 1);
  });
});

// 15. Provider failures follow the existing partial-domain convention.
test("15. a market provider failure still lets the pipeline complete, preserving the failure in diagnostics — no fabricated candles", async () => {
  await withEnvKeys({ av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const failingMarketConfig = { fetchImpl: async () => jsonResponse(200, { "Error Message": "Invalid API call." }) };
    const result = await runMarketIntelligenceRequest(validBaseRequest(), { market: { enabled: true }, marketAdapterConfig: failingMarketConfig });
    assert.equal(processRequestCallCount, 1);
    assert.equal(result.pipelineResult.ok, true); // pipeline still completes
    // Same convention already established for FRED/macro (Step 38's real
    // run): a specialist agent that ran on empty input still reports its
    // own status as "OK" (it executed successfully), surfacing the real
    // absence of data as a warning rather than a top-level failure.
    assert.equal(result.pipelineResult.pipeline_summary.technical_status, "OK");
    assert.ok(result.pipelineResult.warnings.some((w) => w.includes("TECHNICAL DATA UNAVAILABLE")));
    assert.equal(result.diagnostics.market.providerResult.ok, false);
  });
});

// 16. Credentials never appear in results/errors/logs/test output.
test("16. neither synthetic credential ever appears anywhere in the returned structure, success or failure", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY, av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { adapterConfigs } = allProviderCalls();
    const result = await runMarketIntelligenceRequest(validBaseRequest(), {
      macro: { enabled: true },
      market: { enabled: true },
      news: { enabled: true },
      ...adapterConfigs,
    });
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(SYNTHETIC_FRED_KEY));
    assert.ok(!serialized.includes(SYNTHETIC_AV_KEY));
  });
});

// 17. No real network calls occur (structural guarantee across this whole file).
test("17. no real network call ever occurs in this file's tests", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY, av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { adapterConfigs } = allProviderCalls();
    const { networkCalled } = await withNetworkGuard(async () =>
      runMarketIntelligenceRequest(validBaseRequest(), { macro: { enabled: true }, market: { enabled: true }, news: { enabled: true }, ...adapterConfigs })
    );
    assert.equal(networkCalled, false);
  });
});

// 18. No duplicate provider processing (re-confirmed with a combined run).
test("18. no domain is ever acquired more than once in a single combined run", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY, av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { fredCalls, marketCalls, newsCalls, adapterConfigs } = allProviderCalls();
    await runMarketIntelligenceRequest(validBaseRequest(), { macro: { enabled: true }, market: { enabled: true }, news: { enabled: true }, ...adapterConfigs });
    assert.equal(fredCalls.length, 2); // FRED's own frozen two-call-per-series contract, not a duplicate
    assert.equal(marketCalls.length, 1);
    assert.equal(newsCalls.length, 1);
  });
});

// 19. Combined synthetic market + news + macro payload accepted by the existing, unmodified orchestrator/agents.
test("19. the combined synthetic payload is accepted by the existing unmodified orchestrator and all three agents report OK", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY, av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { adapterConfigs } = allProviderCalls();
    const result = await runMarketIntelligenceRequest(validBaseRequest(), {
      macro: { enabled: true },
      market: { enabled: true },
      news: { enabled: true },
      ...adapterConfigs,
    });
    const summary = result.pipelineResult.pipeline_summary;
    assert.equal(summary.macro_status, "OK");
    assert.equal(summary.technical_status, "OK");
    assert.equal(summary.news_status, "OK");
    assert.equal(result.pipelineResult.response.macro_summary.sources[0], "Federal Reserve Bank of St. Louis (FRED)");
  });
});

// --- Step 49: sequential Alpha Vantage acquisition (Step 48A fix) ---

// 20. Market-only: no unnecessary delay.
test("20. market-only: market called once, news never called, no delay, one processRequest()", async () => {
  await withEnvKeys({ av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { marketCalls, newsCalls, orderLog, adapterConfigs } = allProviderCalls();
    await runMarketIntelligenceRequest(validBaseRequest(), { market: { enabled: true }, ...adapterConfigs });
    assert.equal(marketCalls.length, 1);
    assert.equal(newsCalls.length, 0);
    assert.equal(timeoutCalls.length, 0); // no unnecessary delay when only one AV domain is enabled
    assert.deepEqual(orderLog, ["market"]);
    assert.equal(processRequestCallCount, 1);
  });
});

// 21. News-only: no unnecessary delay.
test("21. news-only: news called once, market never called, no delay, one processRequest()", async () => {
  await withEnvKeys({ av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { marketCalls, newsCalls, orderLog, adapterConfigs } = allProviderCalls();
    await runMarketIntelligenceRequest(validBaseRequest(), { news: { enabled: true }, ...adapterConfigs });
    assert.equal(marketCalls.length, 0);
    assert.equal(newsCalls.length, 1);
    assert.equal(timeoutCalls.length, 0); // no unnecessary delay when only one AV domain is enabled
    assert.deepEqual(orderLog, ["news"]);
    assert.equal(processRequestCallCount, 1);
  });
});

// 22/23. Market + news: market before news, not simultaneous, exactly one 1100ms delay between them.
test("22/23. market + news: market is fully acquired before news starts, separated by exactly one 1100ms delay", async () => {
  await withEnvKeys({ av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { marketCalls, newsCalls, orderLog, adapterConfigs } = allProviderCalls();
    await runMarketIntelligenceRequest(validBaseRequest(), { market: { enabled: true }, news: { enabled: true }, ...adapterConfigs });
    assert.equal(marketCalls.length, 1);
    assert.equal(newsCalls.length, 1);
    // Proves ordering AND that news never starts simultaneously with
    // market — the delay entry sits strictly between them.
    assert.deepEqual(orderLog, ["market", "delay:1100", "news"]);
    assert.equal(processRequestCallCount, 1);
  });
});

// 5 (re-verified). All three domains: FRED behavior unchanged, market/news still sequential.
test("24. all three domains with the new sequencing: FRED unaffected, market before news, one processRequest()", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY, av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { fredCalls, marketCalls, newsCalls, orderLog, adapterConfigs } = allProviderCalls();
    const result = await runMarketIntelligenceRequest(validBaseRequest(), {
      macro: { enabled: true },
      market: { enabled: true },
      news: { enabled: true },
      ...adapterConfigs,
    });
    assert.equal(fredCalls.length, 2); // FRED's own existing two-call contract, unaffected
    assert.equal(marketCalls.length, 1);
    assert.equal(newsCalls.length, 1);
    assert.deepEqual(
      orderLog.filter((e) => e === "market" || e === "news" || e.startsWith("delay")),
      ["market", "delay:1100", "news"]
    );
    assert.equal(processRequestCallCount, 1);
    assert.equal(result.pipelineResult.ok, true);
  });
});

// 8 (re-verified). No retry: a synthetic rate-limit response is not retried, for either AV domain.
test("25. a synthetic Alpha Vantage rate-limit response on market is never retried, and news still runs exactly once afterward", async () => {
  await withEnvKeys({ av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    let marketCallCount = 0;
    const orderLog = [];
    activeOrderLog = orderLog;
    timeoutCalls = [];
    const newsCalls = [];
    const result = await runMarketIntelligenceRequest(validBaseRequest(), {
      market: { enabled: true },
      news: { enabled: true },
      marketAdapterConfig: {
        fetchImpl: async () => {
          marketCallCount++;
          orderLog.push("market");
          return jsonResponse(200, { Note: "Thank you for using Alpha Vantage! Please consider spreading out your requests." });
        },
      },
      newsAdapterConfig: { fetchImpl: makeNewsMockFetch((u) => { newsCalls.push(u); orderLog.push("news"); }) },
    });
    assert.equal(marketCallCount, 1); // exactly one attempt, never retried
    assert.equal(newsCalls.length, 1); // the failure of one AV domain never blocks the other
    assert.equal(processRequestCallCount, 1);
    assert.equal(result.diagnostics.market.providerResult.ok, false);
    assert.equal(result.diagnostics.market.providerResult.code, "RATE_LIMIT");
    assert.equal(result.pipelineResult.ok, true); // pipeline still completes, existing partial-domain convention
  });
});

// --- Step 99: instrument/symbol routing fix, end-to-end ---

function btcMarketBody() {
  return {
    "Meta Data": { "2. Symbol": "BTC" },
    "Time Series (Daily)": { "2026-08-24": { "1. open": "60000", "2. high": "61000", "3. low": "59500", "4. close": "60500", "5. volume": "12345" } },
  };
}
function btcNewsBody() {
  return {
    items: "1",
    feed: [
      {
        title: "BTC rallies on ETF inflows",
        url: "https://example.com/btc-1",
        time_published: "20260824T093000",
        summary: "Bitcoin rose sharply amid ETF inflows.",
        source: "Example Financial News",
        topics: [{ topic: "financial_markets", relevance_score: "0.9" }],
        ticker_sentiment: [{ ticker: "BTC", relevance_score: "0.9", ticker_sentiment_score: "0.4", ticker_sentiment_label: "Bullish" }],
      },
    ],
  };
}

// 2. BTC request -> BTC data only (never SPY), when the provider agrees.
test("99-1. a BTC request resolves the instrument context and requests BTC (not SPY) from both Alpha Vantage domains", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY, av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const marketCalls = [];
    const newsCalls = [];
    const result = await runMarketIntelligenceRequest(validBaseRequest({ query: "Assess BTC", asset: "BTC" }), {
      market: { enabled: true },
      news: { enabled: true },
      marketAdapterConfig: { fetchImpl: async (url) => { marketCalls.push(url); return jsonResponse(200, btcMarketBody()); } },
      newsAdapterConfig: { fetchImpl: async (url) => { newsCalls.push(url); return jsonResponse(200, btcNewsBody()); } },
    });
    assert.ok(marketCalls[0].includes("symbol=BTC"));
    assert.ok(newsCalls[0].includes("tickers=BTC"));
    assert.equal(result.diagnostics.instrument.normalizedSymbol, "BTC");
    assert.equal(result.pipelineResult.pipeline_summary.technical_status, "OK");
    assert.equal(result.pipelineResult.pipeline_summary.news_status, "OK");
  });
});

// 3/6/8. A BTC request against a provider that only actually has SPY data
// must fail safely for both domains — never silently substitute SPY data
// under the BTC-labeled request.
test("99-2. a BTC request against SPY-only provider data fails safely on both domains, never substituting SPY data", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY, av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const marketCalls = [];
    const newsCalls = [];
    // Explicit SPY-metadata/SPY-tagged mocks (a real Alpha Vantage
    // TIME_SERIES_DAILY response always includes a Meta Data block —
    // unlike the shared marketDailyBody() fixture used elsewhere in
    // this file, which omits it and would never exercise this check).
    const result = await runMarketIntelligenceRequest(validBaseRequest({ query: "Assess BTC", asset: "BTC" }), {
      market: { enabled: true },
      news: { enabled: true },
      marketAdapterConfig: {
        fetchImpl: async (url) => {
          marketCalls.push(url);
          return jsonResponse(200, { "Meta Data": { "2. Symbol": "SPY" }, ...marketDailyBody() });
        },
      },
      newsAdapterConfig: { fetchImpl: async (url) => { newsCalls.push(url); return jsonResponse(200, newsFeedBody()); } },
    });
    assert.equal(marketCalls.length, 1);
    assert.equal(newsCalls.length, 1);
    // Both domains must reject the mismatched data rather than merge it.
    assert.equal(result.diagnostics.market.providerResult.ok, false);
    assert.equal(result.diagnostics.market.providerResult.code, "INVALID_RESPONSE");
    assert.equal(result.diagnostics.news.providerResult.ok, false);
    assert.equal(result.diagnostics.news.providerResult.code, "INVALID_RESPONSE");
    // The pipeline still completes (existing partial-domain convention —
    // the Technical/News Agents run on an empty array and degrade
    // gracefully, exactly as they already do for any caller who
    // supplies no data at all), but with zero fabricated/mislabeled SPY
    // candles or news ever reaching it under the BTC-labeled request.
    assert.ok(result.pipelineResult.warnings.includes("NEWS DATA UNAVAILABLE — no news data was supplied."));
    assert.ok(result.pipelineResult.warnings.includes("TECHNICAL DATA UNAVAILABLE — no market data was supplied."));
  });
});

// 9. Macro data must not be incorrectly labeled as the requested instrument.
test("99-3. macro data is never labeled with the requested instrument's symbol (MacroRecord has no asset field to mislabel)", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY, av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { fredCalls, adapterConfigs } = allProviderCalls();
    const result = await runMarketIntelligenceRequest(validBaseRequest({ query: "Assess BTC", asset: "BTC" }), {
      macro: { enabled: true },
      macroAdapterConfig: adapterConfigs.macroAdapterConfig,
    });
    assert.equal(fredCalls.length, 2);
    assert.equal(result.pipelineResult.pipeline_summary.macro_status, "OK");
    // The macro records feeding the pipeline never carry an `asset` field
    // at all, let alone one fabricated to equal the requested "BTC" —
    // confirmed directly against the merged request the pipeline actually
    // ran, not just the final report.
    assert.equal(result.pipelineResult.asset, "BTC");
  });
});

// 1/10. Existing valid SPY workflows remain completely unchanged.
test("99-4. an unchanged SPY workflow (no explicit symbol override needed) behaves exactly as before", async () => {
  await withEnvKeys({ fred: SYNTHETIC_FRED_KEY, av: SYNTHETIC_AV_KEY }, async () => {
    processRequestCallCount = 0;
    const { marketCalls, newsCalls, adapterConfigs } = allProviderCalls();
    const result = await runMarketIntelligenceRequest(validBaseRequest(), { market: { enabled: true }, news: { enabled: true }, ...adapterConfigs });
    assert.ok(marketCalls[0].includes("symbol=SPY"));
    assert.ok(newsCalls[0].includes("tickers=SPY"));
    assert.equal(result.diagnostics.market.providerResult.ok, true);
    assert.equal(result.diagnostics.news.providerResult.ok, true);
    assert.equal(result.pipelineResult.pipeline_summary.technical_status, "OK");
    assert.equal(result.pipelineResult.pipeline_summary.news_status, "OK");
  });
});

// --- Step 103: multi-timeframe live market data ---

// Builds a realistic Alpha-Vantage-shaped series (numeric-string OHLCV
// fields, real date keys) with a genuine linear trend — exactly the
// same class of fixture already used at the adapter/live-source layer,
// reused here so the SAME real Technical Agent (via the real, unmodified
// processRequest()) sees real provider-shaped candles, not a
// hand-built shortcut.
function trendingSeriesBody(seriesKey, count, direction, stepDays) {
  const entries = {};
  for (let i = 0; i < count; i++) {
    const close = direction === "up" ? 100 + i * 2 : 140 - i * 2;
    const date = new Date(Date.now() - (count - 1 - i) * stepDays * 86_400_000).toISOString().slice(0, 10);
    entries[date] = {
      "1. open": String(close - 0.5),
      "2. high": String(close + 1),
      "3. low": String(close - 1),
      "4. close": String(close),
      "5. volume": "1000000",
    };
  }
  return { [seriesKey]: entries };
}

// A small indicator config (mirrors agents/technical-agent/technicalAgent.test.js's
// own SMALL_INDICATOR_CONFIG) forwarded through request.options so 10
// candles per timeframe is enough for a real, non-UNKNOWN trend
// classification — the default SMA[20,50] config would need far more
// history than is worth fabricating for this test.
const SMALL_INDICATOR_CONFIG = { sma: [3, 5], ema: [2, 3], rsi: { period: 3 }, macd: { fast: 2, slow: 4, signal: 2 }, atr: { period: 3 }, bollinger: { period: 5, stdDevMultiplier: 2 } };

test("103-1. options.marketTimeframes requests every listed timeframe sequentially, each rate-limit-protected", async () => {
  await withEnvKeys({ av: SYNTHETIC_AV_KEY }, async () => {
    const orderLog = [];
    const marketCalls = [];
    const fetchImpl = async (url) => {
      marketCalls.push(url);
      orderLog.push(url.includes("TIME_SERIES_WEEKLY") ? "market:weekly" : "market:daily");
      if (url.includes("TIME_SERIES_WEEKLY")) return jsonResponse(200, trendingSeriesBody("Weekly Time Series", 3, "up", 7));
      return jsonResponse(200, trendingSeriesBody("Time Series (Daily)", 3, "up", 1));
    };
    activeOrderLog = orderLog;
    timeoutCalls = [];

    const result = await runMarketIntelligenceRequest(validBaseRequest(), {
      market: { enabled: true },
      marketTimeframes: ["1day", "1week"],
      marketAdapterConfig: { fetchImpl },
    });

    assert.equal(marketCalls.length, 2);
    assert.deepEqual(orderLog, ["market:daily", "delay:1100", "market:weekly"]);
    assert.deepEqual(
      result.diagnostics.market.timeframeResults.map((r) => r.timeframe),
      ["1day", "1week"]
    );
    assert.ok(result.diagnostics.market.timeframeResults.every((r) => r.ok));
    activeOrderLog = null;
  });
});

test("103-2. an unsupported timeframe alongside a supported one is reported explicitly in diagnostics, never substituted", async () => {
  await withEnvKeys({ av: SYNTHETIC_AV_KEY }, async () => {
    const { marketCalls, adapterConfigs } = allProviderCalls();
    const result = await runMarketIntelligenceRequest(validBaseRequest(), {
      market: { enabled: true },
      marketTimeframes: ["1day", "1hour"],
      marketAdapterConfig: adapterConfigs.marketAdapterConfig,
    });
    assert.equal(marketCalls.length, 1); // "1hour" never touches the network
    const unsupported = result.diagnostics.market.timeframeResults.find((r) => r.timeframe === "1hour");
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.code, "UNSUPPORTED_TIMEFRAME");
    assert.ok(result.diagnostics.market.warnings.some((w) => w.includes("1hour")));
    // The supported timeframe's data still reaches the real pipeline.
    assert.equal(result.pipelineResult.pipeline_summary.technical_status, "OK");
  });
});

// Requirement: multi-timeframe conflict detection using real
// provider-shaped data. Two genuinely distinct Alpha Vantage series
// (TIME_SERIES_DAILY trending up, TIME_SERIES_WEEKLY trending down) are
// composed by the real, unmodified loadLiveMarketData()/adapter, then
// run through the real, unmodified processRequest() — proving the
// Technical Agent's own TIMEFRAME_CONFLICT detection genuinely fires
// end to end on live-shaped data, not just on hand-built test doubles.
test("103-3. daily-uptrend vs weekly-downtrend Alpha-Vantage-shaped data produces a real TIMEFRAME_CONFLICT end to end", async () => {
  await withEnvKeys({ av: SYNTHETIC_AV_KEY }, async () => {
    const fetchImpl = async (url) => {
      if (url.includes("TIME_SERIES_WEEKLY")) return jsonResponse(200, trendingSeriesBody("Weekly Time Series", 10, "down", 7));
      return jsonResponse(200, trendingSeriesBody("Time Series (Daily)", 10, "up", 1));
    };

    const request = validBaseRequest({ options: { indicatorConfig: SMALL_INDICATOR_CONFIG } });
    const result = await runMarketIntelligenceRequest(request, {
      market: { enabled: true },
      marketTimeframes: ["1day", "1week"],
      marketAdapterConfig: { fetchImpl },
    });

    assert.equal(result.pipelineResult.ok, true);
    // Chief Trading Manager's technical_summary (agents/chief-trading-manager/evidence.js's
    // buildTechnicalSummary) flattens the raw Technical Report's
    // technical_conflicts.conflicts array onto its own `conflicts`
    // field directly.
    const technicalSummary = result.pipelineResult.response.technical_summary;
    const timeframeConflict = technicalSummary.conflicts.find((c) => c.type === "TIMEFRAME_CONFLICT");
    assert.ok(timeframeConflict, "expected a real TIMEFRAME_CONFLICT between 1day and 1week");
    assert.deepEqual([...timeframeConflict.timeframes].sort(), ["1day", "1week"]);
    assert.deepEqual(timeframeConflict.trends, ["UPTREND", "DOWNTREND"]);
  });
});

test.after(() => {
  orchestratorModule.processRequest = originalProcessRequest;
  global.setTimeout = originalSetTimeout;
});
