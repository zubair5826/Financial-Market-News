// Offline/synthetic tests for loadLiveNewsData() — implements the
// design frozen in Step 46A. No test here ever contacts a real network
// endpoint or uses a real Alpha Vantage credential.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadLiveNewsData } = require("./alphaVantageNewsLiveSource");

const SYNTHETIC_KEY = "SYNTHETIC_KEY";
const UNKNOWN = "UNKNOWN";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function feedBody(feed) {
  return { items: String(feed.length), feed };
}

function sampleItem(overrides = {}) {
  return {
    title: "SPY hits new high as market rallies",
    url: "https://example.com/article-1",
    time_published: "20260824T093000",
    summary: "The S&P 500 ETF rose sharply amid strong earnings.",
    source: "Example Financial News",
    topics: [{ topic: "financial_markets", relevance_score: "0.9" }],
    ticker_sentiment: [{ ticker: "SPY", relevance_score: "0.85", ticker_sentiment_score: "0.3", ticker_sentiment_label: "Somewhat-Bullish" }],
    ...overrides,
  };
}

async function withEnvKey(value, fn) {
  const original = process.env.ALPHAVANTAGE_API_KEY;
  if (value === undefined) delete process.env.ALPHAVANTAGE_API_KEY;
  else process.env.ALPHAVANTAGE_API_KEY = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.ALPHAVANTAGE_API_KEY;
    else process.env.ALPHAVANTAGE_API_KEY = original;
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

function makeMockFetch({ status = 200, body, onCall } = {}) {
  return async (url, opts) => {
    if (onCall) onCall(url, opts);
    return jsonResponse(status, body);
  };
}

// 1. Missing credential.
test("1. a missing ALPHAVANTAGE_API_KEY returns an empty result and a clear warning, no network call", async () => {
  await withEnvKey(undefined, async () => {
    const { value: result, networkCalled } = await withNetworkGuard(async () => loadLiveNewsData());
    assert.equal(networkCalled, false);
    assert.deepEqual(result.newsData, []);
    assert.equal(result.providerResult.ok, false);
    assert.deepEqual(result.warnings, ["ALPHAVANTAGE_API_KEY not configured."]);
  });
});

// 2. Correct provider request parameters.
test("2. NEWS_SENTIMENT, tickers=SPY, limit=10 are used in the actual request", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    const result = await loadLiveNewsData({ adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]), onCall: (u) => calls.push(u) }) } });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes("function=NEWS_SENTIMENT"));
    assert.ok(calls[0].includes("tickers=SPY"));
    assert.ok(calls[0].includes("limit=10"));
    assert.equal(result.newsData.length, 1);
  });
});

// 3. newsData returned in the existing frozen contract, confidence rule preserved.
test("3. newsData is returned in the existing News Record contract; impact_confidence stays UNKNOWN; ticker sentiment fields preserved in evidence", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await loadLiveNewsData({ adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]) }) } });
    const record = result.newsData[0];
    assert.equal(record.classification, "FACT");
    assert.equal(record.impact_confidence, UNKNOWN);
    assert.equal(record.evidence.alpha_vantage_ticker_sentiment.ticker_sentiment_score, "0.3");
    assert.equal(record.evidence.alpha_vantage_ticker_sentiment.ticker_sentiment_label, "Somewhat-Bullish");
    assert.equal(record.evidence.alpha_vantage_ticker_sentiment.relevance_score, "0.85");
  });
});

// 4. Provider errors propagate safely.
test("4. a provider failure returns an empty result and a preserved code, never fabricated records", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await loadLiveNewsData({ adapterConfig: { fetchImpl: makeMockFetch({ body: { "Error Message": "Invalid API call." } }) } });
    assert.deepEqual(result.newsData, []);
    assert.equal(result.providerResult.ok, false);
    assert.equal(result.providerResult.code, "INVALID_RESPONSE");
  });
});

// 5. No duplicate provider acquisition.
test("5. exactly one HTTP request occurs per loadLiveNewsData() call", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    await loadLiveNewsData({ adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]), onCall: (u) => calls.push(u) }) } });
    assert.equal(calls.length, 1);
  });
});

// 6. Credential never exposed.
test("6. the synthetic credential never appears anywhere in the returned result", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await loadLiveNewsData({ adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]) }) } });
    assert.ok(!JSON.stringify(result).includes(SYNTHETIC_KEY));
  });
});

// 7. The caller's options object is not mutated.
test("7. the caller's options object is not mutated", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const options = { adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]) }) } };
    const fetchImplRef = options.adapterConfig.fetchImpl;
    await loadLiveNewsData(options);
    assert.equal(options.adapterConfig.fetchImpl, fetchImplRef);
    assert.deepEqual(Object.keys(options), ["adapterConfig"]);
  });
});
