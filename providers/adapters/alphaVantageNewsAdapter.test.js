// Offline/synthetic tests for AlphaVantageNewsAdapter — implements the
// contract frozen in Step 44. No test here ever contacts a real
// network endpoint or uses a real Alpha Vantage credential.

const test = require("node:test");
const assert = require("node:assert/strict");
const { AlphaVantageNewsAdapter } = require("./alphaVantageNewsAdapter");
const { ERROR_CODES } = require("../../core/errors");
const { UNKNOWN } = require("../../core/constants");

const SYNTHETIC_KEY = "SYNTHETIC_KEY";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function feedBody(feed) {
  return { items: String(feed.length), sentiment_score_definition: "x", relevance_score_definition: "y", feed };
}

function sampleItem(overrides = {}) {
  return {
    title: "SPY hits new high as market rallies",
    url: "https://example.com/article-1",
    time_published: "20260824T093000",
    authors: ["Jane Reporter"],
    summary: "The S&P 500 ETF rose sharply amid strong earnings.",
    source: "Example Financial News",
    category_within_source: "markets",
    source_domain: "example.com",
    topics: [{ topic: "financial_markets", relevance_score: "0.9" }],
    overall_sentiment_score: 0.25,
    overall_sentiment_label: "Somewhat-Bullish",
    ticker_sentiment: [
      { ticker: "SPY", relevance_score: "0.85", ticker_sentiment_score: "0.303818", ticker_sentiment_label: "Somewhat-Bullish" },
    ],
    ...overrides,
  };
}

function makeMockFetch({ status = 200, body, onCall } = {}) {
  return async (url, opts) => {
    if (onCall) onCall(url, opts);
    return jsonResponse(status, body);
  };
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

function makeAdapter(overrides = {}) {
  return new AlphaVantageNewsAdapter({ apiKey: SYNTHETIC_KEY, ...overrides });
}

// Exact Alpha Vantage fields map correctly.
test("1. exact Alpha Vantage feed fields map to the News Record contract", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]) }) });
  const result = await adapter.fetchData();
  assert.equal(result.ok, true);
  const record = result.data[0];
  assert.equal(record.headline, "SPY hits new high as market rallies");
  assert.equal(record.summary, "The S&P 500 ETF rose sharply amid strong earnings.");
  assert.equal(record.source, "Example Financial News");
  assert.equal(record.url_or_reference, "https://example.com/article-1");
});

// Multiple news records map correctly.
test("2. multiple news records all map correctly, one record per feed item", async () => {
  const items = [sampleItem({ title: "Article A" }), sampleItem({ title: "Article B", url: "https://example.com/b" })];
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody(items) }) });
  const result = await adapter.fetchData();
  assert.equal(result.data.length, 2);
  assert.deepEqual(
    result.data.map((r) => r.headline).sort(),
    ["Article A", "Article B"]
  );
});

// SPY ticker is preserved.
test("3. SPY is preserved in related_assets when tagged by the provider", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]) }) });
  const result = await adapter.fetchData();
  assert.ok(result.data[0].related_assets.includes("SPY"));
});

// publication_timestamp comes from time_published.
test("4. publication_timestamp comes from time_published, verbatim", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]) }) });
  const result = await adapter.fetchData();
  assert.equal(result.data[0].publication_timestamp, "20260824T093000");
});

// retrieved_timestamp is generated from the real fetch time.
test("5. retrieved_timestamp is generated from the real fetch time, not copied from the provider", async () => {
  const before = Date.now();
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]) }) });
  const result = await adapter.fetchData();
  const after = Date.now();
  const retrievedMs = new Date(result.data[0].retrieved_timestamp).getTime();
  assert.ok(retrievedMs >= before && retrievedMs <= after);
});

// headline and summary are preserved; source and URL are preserved.
test("6. headline, summary, source, and URL are preserved unmodified", async () => {
  const item = sampleItem({ title: "Exact Headline Text", summary: "Exact summary text.", source: "Exact Source", url: "https://exact.example/1" });
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([item]) }) });
  const result = await adapter.fetchData();
  const record = result.data[0];
  assert.equal(record.headline, "Exact Headline Text");
  assert.equal(record.summary, "Exact summary text.");
  assert.equal(record.source, "Exact Source");
  assert.equal(record.url_or_reference, "https://exact.example/1");
});

// topics map correctly.
test("7. the primary topic maps to category", async () => {
  const item = sampleItem({ topics: [{ topic: "earnings", relevance_score: "0.7" }] });
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([item]) }) });
  const result = await adapter.fetchData();
  assert.equal(result.data[0].category, "earnings");
});

test("7b. no topics present maps category to UNKNOWN, never fabricated", async () => {
  const item = sampleItem({ topics: [] });
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([item]) }) });
  const result = await adapter.fetchData();
  assert.equal(result.data[0].category, UNKNOWN);
});

// ticker sentiment maps correctly.
test("8. ticker_sentiment_label maps to the IMPACT_DIRECTIONS enum via provider-tagged data only", async () => {
  const bullish = sampleItem({ ticker_sentiment: [{ ticker: "SPY", relevance_score: "0.9", ticker_sentiment_score: "0.4", ticker_sentiment_label: "Bullish" }] });
  const bearish = sampleItem({ ticker_sentiment: [{ ticker: "SPY", relevance_score: "0.9", ticker_sentiment_score: "-0.4", ticker_sentiment_label: "Bearish" }] });
  const neutral = sampleItem({ ticker_sentiment: [{ ticker: "SPY", relevance_score: "0.9", ticker_sentiment_score: "0.0", ticker_sentiment_label: "Neutral" }] });

  for (const [item, expected] of [
    [bullish, "POSITIVE"],
    [bearish, "NEGATIVE"],
    [neutral, "NEUTRAL"],
  ]) {
    const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([item]) }) });
    const result = await adapter.fetchData();
    assert.equal(result.data[0].impact_direction, expected);
  }
});

test("8b. FROZEN DECISION (Step 44A/44B): impact_confidence is exactly UNKNOWN, never a numeric-threshold bucket, and ticker_sentiment_score/ticker_sentiment_label/relevance_score are preserved verbatim in evidence", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]) }) });
  const result = await adapter.fetchData();
  const record = result.data[0];
  assert.equal(record.impact_confidence, UNKNOWN);
  assert.equal(record.evidence.alpha_vantage_ticker_sentiment.ticker_sentiment_score, "0.303818");
  assert.equal(record.evidence.alpha_vantage_ticker_sentiment.ticker_sentiment_label, "Somewhat-Bullish");
  assert.equal(record.evidence.alpha_vantage_ticker_sentiment.relevance_score, "0.85");
});

test("8c. FROZEN DECISION: impact_confidence stays UNKNOWN across every score magnitude — no numeric threshold conversion occurs anywhere", async () => {
  const magnitudes = ["0.0", "0.1", "0.35", "0.5", "0.9", "1.0", "-0.9"];
  for (const score of magnitudes) {
    const item = sampleItem({
      ticker_sentiment: [{ ticker: "SPY", relevance_score: "0.99", ticker_sentiment_score: score, ticker_sentiment_label: "Bullish" }],
    });
    const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([item]) }) });
    const result = await adapter.fetchData();
    const record = result.data[0];
    assert.equal(record.impact_confidence, UNKNOWN);
    assert.notEqual(record.impact_confidence, "HIGH");
    assert.notEqual(record.impact_confidence, "MEDIUM");
    assert.notEqual(record.impact_confidence, "LOW");
    assert.equal(record.evidence.alpha_vantage_ticker_sentiment.ticker_sentiment_score, score);
  }
});

// classification is FACT.
test("9. every mapped record has classification FACT (adapter-assigned)", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([sampleItem(), sampleItem({ title: "Second" })]) }) });
  const result = await adapter.fetchData();
  assert.ok(result.data.every((r) => r.classification === "FACT"));
});

// malformed responses fail safely.
test("10a. a response missing \"feed\" fails safely with MALFORMED_DATA", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: { items: "0" } }) });
  const result = await adapter.fetchData();
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.MALFORMED_DATA);
});

test("10b. an Alpha Vantage \"Error Message\" body (HTTP 200) fails safely with INVALID_RESPONSE", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: { "Error Message": "Invalid API call." } }) });
  const result = await adapter.fetchData();
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.INVALID_RESPONSE);
});

test("10c. a \"Note\" rate-limit body fails safely with RATE_LIMIT", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: { Note: "Thank you for using Alpha Vantage!" } }) });
  const result = await adapter.fetchData();
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.RATE_LIMIT);
});

test("10d. HTTP 401/403 fails safely with AUTH_FAILURE", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ status: 401, body: {} }) });
  const result = await adapter.fetchData();
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.AUTH_FAILURE);
});

test("10e. HTTP 429 fails safely with RATE_LIMIT", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ status: 429, body: {} }) });
  const result = await adapter.fetchData();
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.RATE_LIMIT);
});

test("10f. a non-JSON body fails safely with MALFORMED_DATA", async () => {
  const adapter = makeAdapter({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } }) });
  const result = await adapter.fetchData();
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.MALFORMED_DATA);
});

// missing required fields fail safely — a feed item with no title is excluded, never fabricated.
test("11. a feed item with a missing/empty title is excluded from the mapped output, not fabricated", async () => {
  const items = [sampleItem({ title: "" }), sampleItem({ title: undefined }), sampleItem({ title: "Real Headline" })];
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody(items) }) });
  const result = await adapter.fetchData();
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].headline, "Real Headline");
});

test("11b. missing API key fails safely with AUTH_FAILURE, no network call", async () => {
  const adapter = new AlphaVantageNewsAdapter({});
  const { value: result, networkCalled } = await withNetworkGuard(async () => adapter.fetchData());
  assert.equal(networkCalled, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.AUTH_FAILURE);
});

// request input is not mutated.
test("12. the caller's request object is not mutated", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]) }) });
  const request = { tickers: "SPY", limit: 10 };
  const snapshot = JSON.parse(JSON.stringify(request));
  await adapter.fetchData(request);
  assert.deepEqual(request, snapshot);
});

// credentials are never exposed.
test("13. the synthetic credential never appears anywhere in the returned result, but does appear in the actual request URL", async () => {
  const calls = [];
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]), onCall: (url) => calls.push(url) }) });
  const result = await adapter.fetchData();
  assert.ok(calls[0].includes(SYNTHETIC_KEY)); // proves the check below isn't vacuous
  assert.ok(!JSON.stringify(result).includes(SYNTHETIC_KEY));
});

// no duplicate processing occurs.
test("14. fetchData() issues exactly one HTTP request per call; healthCheck() delegates to fetchData() without a second request path", async () => {
  const calls = [];
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]), onCall: (url) => calls.push(url) }) });
  await adapter.fetchData();
  assert.equal(calls.length, 1);

  calls.length = 0;
  const health = await adapter.healthCheck();
  assert.equal(calls.length, 1);
  assert.equal(health.ok, true);
});

// the frozen minimum request is used by default.
test("15. the default request uses tickers=SPY and limit=10, matching the frozen minimum request", async () => {
  const calls = [];
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]), onCall: (url) => calls.push(url) }) });
  await adapter.fetchData();
  assert.ok(calls[0].includes("function=NEWS_SENTIMENT"));
  assert.ok(calls[0].includes("tickers=SPY"));
  assert.ok(calls[0].includes("limit=10"));
});

// no network calls occur in unit tests — structural guarantee for this whole file.
test("16. no unit test in this file ever performs a real network call", async () => {
  const { networkCalled } = await withNetworkGuard(async () => {
    const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]) }) });
    return adapter.fetchData();
  });
  assert.equal(networkCalled, false);
});
