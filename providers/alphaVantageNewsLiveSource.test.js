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

// --- Step 99: requested-symbol pass-through and relevance verification ---

// 1/10. No symbol option -> SPY default preserved (existing behavior unchanged).
test("99-1. omitting options.symbol still requests tickers=SPY, unchanged", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    await loadLiveNewsData({ adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]), onCall: (u) => calls.push(u) }) } });
    assert.ok(calls[0].includes("tickers=SPY"));
  });
});

// 2. An explicit symbol flows through to the actual request.
test("99-2. options.symbol='BTC' requests tickers=BTC, not SPY", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    const btcItem = sampleItem({
      title: "BTC rallies on ETF inflows",
      ticker_sentiment: [{ ticker: "BTC", relevance_score: "0.9", ticker_sentiment_score: "0.4", ticker_sentiment_label: "Bullish" }],
    });
    await loadLiveNewsData({
      symbol: "BTC",
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([btcItem]), onCall: (u) => calls.push(u) }) },
    });
    assert.ok(calls[0].includes("tickers=BTC"));
  });
});

// 7. News symbol mismatch -> rejected, never silently attributed to the requested symbol.
test("99-3. a feed tagged entirely for a different ticker than requested is rejected, never returned as BTC data", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const spyOnlyItem = sampleItem(); // tagged SPY only
    const result = await loadLiveNewsData({
      symbol: "BTC",
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([spyOnlyItem]) }) },
    });
    assert.deepEqual(result.newsData, []);
    assert.equal(result.providerResult.ok, false);
    assert.equal(result.providerResult.code, "INVALID_RESPONSE");
  });
});

// Untagged records (no ticker_sentiment at all) are never treated as a
// mismatch by omission — a legitimately quiet/untagged feed is not an error.
test("99-4. a feed with no ticker_sentiment tagging at all is accepted, not treated as a mismatch", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const untaggedItem = sampleItem({ ticker_sentiment: [] });
    const result = await loadLiveNewsData({
      symbol: "BTC",
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([untaggedItem]) }) },
    });
    assert.equal(result.providerResult.ok, true);
    assert.equal(result.newsData.length, 1);
  });
});

// --- Step 107: provider-scored relevance filter ---
//
// Regression tests for the filter that excludes clearly low-relevance
// Alpha Vantage records using the provider's OWN ticker relevance_score,
// before anything downstream sees them. No test here asserts on headline
// wording — the filter reads only the provider's numeric score.

const { MIN_TICKER_RELEVANCE_SCORE } = require("./alphaVantageNewsLiveSource");

// Builds an item tagged for `ticker` at an explicit provider relevance score.
function scoredItem(ticker, relevanceScore, overrides = {}) {
  return sampleItem({
    ticker_sentiment: [
      { ticker, relevance_score: String(relevanceScore), ticker_sentiment_score: "0.3", ticker_sentiment_label: "Somewhat-Bullish" },
    ],
    ...overrides,
  });
}

// The threshold is an explicit, inspectable constant, not a magic number
// buried in a comparison.
test("107-1. the relevance threshold is exported as an explicit constant in the 0-1 provider range", () => {
  assert.equal(typeof MIN_TICKER_RELEVANCE_SCORE, "number");
  assert.ok(MIN_TICKER_RELEVANCE_SCORE > 0 && MIN_TICKER_RELEVANCE_SCORE < 1);
});

// A clearly low-relevance record — the tokenized/currency/holdings-page
// class Alpha Vantage tags with SPY — is excluded before downstream.
test("107-2. a record scored below the threshold is excluded from newsData", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const lowItem = scoredItem("SPY", 0.02, { title: "SPY to EUR currency conversion rates" });
    const result = await loadLiveNewsData({
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([lowItem]) }) },
    });
    assert.deepEqual(result.newsData, []);
    assert.equal(result.providerResult.ok, true);
    assert.equal(result.providerResult.recordCount, 0);
  });
});

// A sufficiently relevant record is retained, byte-for-byte.
test("107-3. a record scored at or above the threshold is retained unchanged", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const highItem = scoredItem("SPY", 0.85);
    const result = await loadLiveNewsData({
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([highItem]) }) },
    });
    assert.equal(result.newsData.length, 1);
    assert.equal(result.newsData[0].headline, highItem.title);
    assert.equal(result.newsData[0].evidence.alpha_vantage_ticker_sentiment.relevance_score, "0.85");
    assert.deepEqual(result.warnings, []);
  });
});

// A record scored exactly AT the threshold is kept — the rule is
// "below the threshold", never "at or below".
test("107-4. a record scored exactly at the threshold is retained, not filtered", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const boundaryItem = scoredItem("SPY", MIN_TICKER_RELEVANCE_SCORE);
    const result = await loadLiveNewsData({
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([boundaryItem]) }) },
    });
    assert.equal(result.newsData.length, 1);
  });
});

// Filtering is never silent: a count reaches warnings (which
// marketIntelligenceApplicationService.js surfaces as
// diagnostics.news.warnings) and the additive relevanceFilter field.
test("107-5. the number of filtered records is reported in warnings and in relevanceFilter", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const feed = [
      scoredItem("SPY", 0.9, { title: "SPY closes higher on strong jobs data" }),
      scoredItem("SPY", 0.03, { title: "Tokenized SPY product listing" }),
      scoredItem("SPY", 0.01, { title: "Fund holdings history: SPY" }),
    ];
    const result = await loadLiveNewsData({
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody(feed) }) },
    });

    assert.equal(result.newsData.length, 1);
    assert.equal(result.providerResult.recordCount, 1);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0].includes("2 of 3"));
    assert.ok(result.warnings[0].includes(String(MIN_TICKER_RELEVANCE_SCORE)));
    assert.deepEqual(result.relevanceFilter, {
      threshold: MIN_TICKER_RELEVANCE_SCORE,
      examined: 3,
      filtered: 2,
      retained: 1,
    });
  });
});

// Anti-fabrication preserved: no score is not the same as a low score.
// An untagged/unscored record is never dropped by this filter.
test("107-6. a record carrying no usable relevance_score is never filtered", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const untagged = sampleItem({ ticker_sentiment: [] });
    const blankScore = sampleItem({
      title: "SPY story with a blank provider score",
      ticker_sentiment: [{ ticker: "SPY", relevance_score: "", ticker_sentiment_score: "0.1", ticker_sentiment_label: "Neutral" }],
    });
    const nonNumeric = sampleItem({
      title: "SPY story with a non-numeric provider score",
      ticker_sentiment: [{ ticker: "SPY", relevance_score: "n/a", ticker_sentiment_score: "0.1", ticker_sentiment_label: "Neutral" }],
    });
    const result = await loadLiveNewsData({
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([untagged, blankScore, nonNumeric]) }) },
    });
    assert.equal(result.newsData.length, 3);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.relevanceFilter.filtered, 0);
  });
});

// Existing SPY behavior remains valid: the default request shape, the
// frozen UNKNOWN confidence decision, and the preserved evidence fields
// all survive the filter.
test("107-7. existing SPY behavior remains valid — request shape, evidence and impact_confidence unchanged", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    const result = await loadLiveNewsData({
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([sampleItem()]), onCall: (u) => calls.push(u) }) },
    });
    assert.ok(calls[0].includes("function=NEWS_SENTIMENT"));
    assert.ok(calls[0].includes("tickers=SPY"));
    assert.ok(calls[0].includes("limit=10"));
    assert.equal(result.newsData.length, 1);
    assert.equal(result.newsData[0].impact_confidence, UNKNOWN);
    assert.equal(result.newsData[0].evidence.alpha_vantage_ticker_sentiment.ticker_sentiment_label, "Somewhat-Bullish");
  });
});

// A non-SPY request is filtered on ITS OWN ticker's score, not SPY's.
test("107-8. a non-SPY request filters on the requested ticker's own relevance_score", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const item = sampleItem({
      title: "Broad market note that barely mentions MSFT",
      ticker_sentiment: [
        { ticker: "SPY", relevance_score: "0.95", ticker_sentiment_score: "0.3", ticker_sentiment_label: "Somewhat-Bullish" },
        { ticker: "MSFT", relevance_score: "0.02", ticker_sentiment_score: "0.1", ticker_sentiment_label: "Neutral" },
      ],
    });
    const result = await loadLiveNewsData({
      symbol: "MSFT",
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([item]) }) },
    });
    // SPY's high score must not rescue an article that is only barely
    // about the instrument actually requested.
    assert.deepEqual(result.newsData, []);
    assert.equal(result.relevanceFilter.filtered, 1);
  });
});

// The filter runs AFTER the pre-existing requested-ticker confirmation,
// so that guard still sees the whole feed and its behavior is unchanged.
test("107-9. the pre-existing wrong-instrument rejection still fires ahead of the filter", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const spyOnly = scoredItem("SPY", 0.9);
    const result = await loadLiveNewsData({
      symbol: "BTC",
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([spyOnly]) }) },
    });
    assert.deepEqual(result.newsData, []);
    assert.equal(result.providerResult.ok, false);
    assert.equal(result.providerResult.code, "INVALID_RESPONSE");
  });
});
