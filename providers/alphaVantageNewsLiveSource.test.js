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

// --- Steps 107/108: the two-stage provider relevance filter ---
//
// Stage 1 (Step 108) excludes non-news PAGE TYPES by title/URL/source shape.
// Stage 2 (Step 107) excludes records whose provider ticker relevance_score
// is below MIN_TICKER_RELEVANCE_SCORE.
//
// No test here asserts that a filter read an article's meaning, tone or
// subject — only its provider score and its page-type shape.

const {
  MIN_TICKER_RELEVANCE_SCORE,
  NON_NEWS_PATTERNS,
  matchNonNewsPattern,
} = require("./alphaVantageNewsLiveSource");

// Builds an item tagged for `ticker` at an explicit provider relevance score.
function scoredItem(ticker, relevanceScore, overrides = {}) {
  return sampleItem({
    ticker_sentiment: [
      { ticker, relevance_score: String(relevanceScore), ticker_sentiment_score: "0.3", ticker_sentiment_label: "Somewhat-Bullish" },
    ],
    ...overrides,
  });
}

// ---------- Stage 2: numeric threshold ----------

test("107-1. the relevance threshold is an explicit exported constant, currently 0.3", () => {
  assert.equal(typeof MIN_TICKER_RELEVANCE_SCORE, "number");
  assert.equal(MIN_TICKER_RELEVANCE_SCORE, 0.3);
  assert.ok(MIN_TICKER_RELEVANCE_SCORE > 0 && MIN_TICKER_RELEVANCE_SCORE < 1);
});

test("107-2. a record scored below the threshold is excluded from newsData", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    // A plain market headline — no page-type pattern involved, so this
    // isolates the numeric threshold on its own.
    const lowItem = scoredItem("SPY", 0.05, { title: "Market wrap: equities drift into the close" });
    const result = await loadLiveNewsData({
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([lowItem]) }) },
    });
    assert.deepEqual(result.newsData, []);
    assert.equal(result.providerResult.ok, true);
    assert.equal(result.providerResult.recordCount, 0);
    assert.equal(result.relevanceFilter.filteredByThreshold, 1);
    assert.equal(result.relevanceFilter.filteredByPattern, 0);
  });
});

test("107-3. a record in the old 0.1-0.3 band is now excluded by the raised threshold", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const midItem = scoredItem("SPY", 0.2, { title: "Broad market note mentioning the index in passing" });
    const result = await loadLiveNewsData({
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([midItem]) }) },
    });
    assert.deepEqual(result.newsData, []);
    assert.equal(result.relevanceFilter.filteredByThreshold, 1);
  });
});

test("107-4. a record scored at or above the threshold is retained unchanged", async () => {
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

test("107-5. a record scored exactly at the threshold is retained, not filtered", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const boundaryItem = scoredItem("SPY", MIN_TICKER_RELEVANCE_SCORE);
    const result = await loadLiveNewsData({
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([boundaryItem]) }) },
    });
    assert.equal(result.newsData.length, 1);
    assert.equal(result.relevanceFilter.filtered, 0);
  });
});

test("107-6. a record carrying no usable relevance_score is never filtered by score", async () => {
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
    // SPY's high score must not rescue an article that is only barely about
    // the instrument actually requested.
    assert.deepEqual(result.newsData, []);
    assert.equal(result.relevanceFilter.filteredByThreshold, 1);
  });
});

test("107-9. the pre-existing wrong-instrument rejection still fires ahead of both filter stages", async () => {
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

// ---------- Stage 1: non-news page-type exclusions ----------

test("108-1. every configured pattern has a name and a RegExp", () => {
  assert.ok(NON_NEWS_PATTERNS.length >= 5);
  const names = NON_NEWS_PATTERNS.map((p) => p.name);
  for (const expected of [
    "currency_conversion",
    "tokenized_product",
    "holdings_history",
    "price_prediction",
    "backpack_securities",
  ]) {
    assert.ok(names.includes(expected), `missing pattern: ${expected}`);
  }
  for (const { pattern } of NON_NEWS_PATTERNS) assert.ok(pattern instanceof RegExp);
});

// The five categories observed in the live production SPY response. These are
// representative titles/URLs for each category, not verbatim provider strings.
test("108-2. each observed non-news page type is matched and attributed to its own pattern", () => {
  const cases = [
    ["1 SPY to USD", "https://example.com/a", "Example", "currency_conversion"],
    ["SPY to EUR currency conversion rates today", "https://example.com/convert/spy-eur", "Example", "currency_conversion"],
    ["Tokenized SPY shares begin trading", "https://example.com/a", "Example", "tokenized_product"],
    ["Wrapped SPY ETF launches on-chain", "https://example.com/a", "Example", "tokenized_product"],
    ["SPY holdings history and portfolio changes", "https://example.com/holdings/spy", "Example", "holdings_history"],
    ["SPY stock price prediction 2027", "https://example.com/price-prediction/spy", "Example", "price_prediction"],
    ["SPY stock forecast and analyst outlook", "https://example.com/a", "Example", "price_prediction"],
    ["SPDR S&P 500 ETF Trust", "https://backpack.exchange/trade/SPY", "Backpack Securities", "backpack_securities"],
  ];
  for (const [headline, url, source, expected] of cases) {
    assert.equal(
      matchNonNewsPattern({ headline, url_or_reference: url, source }),
      expected,
      `expected ${expected} for: ${headline}`
    );
  }
});

// Genuine market coverage must survive every pattern — this is the guard
// against the page-type rules quietly becoming an editorial filter.
test("108-3. genuine news headlines are never matched by any page-type pattern", () => {
  const genuine = [
    ["SPY hits new high as market rallies", "https://ex.com/a", "Reuters"],
    ["S&P 500 climbs on strong jobs data", "https://ex.com/b", "AP"],
    ["Analysts raise price target on Microsoft after earnings", "https://ex.com/c", "Reuters"],
    ["Fed holds rates steady, signals patience", "https://ex.com/d", "Bloomberg"],
    ["ETF inflows accelerate as volatility eases", "https://ex.com/e", "CNBC"],
    ["Treasury yields fall after inflation report", "https://ex.com/f", "WSJ"],
  ];
  for (const [headline, url, source] of genuine) {
    assert.equal(matchNonNewsPattern({ headline, url_or_reference: url, source }), null, `false exclusion: ${headline}`);
  }
});

// A page-type exclusion applies at ANY score, including a high one — a
// currency-conversion page is not news however the provider scored it.
test("108-4. a non-news page type is excluded even with a high relevance_score", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const item = scoredItem("SPY", 0.99, { title: "1 SPY to USD conversion rate" });
    const result = await loadLiveNewsData({
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([item]) }) },
    });
    assert.deepEqual(result.newsData, []);
    assert.equal(result.relevanceFilter.filteredByPattern, 1);
    assert.equal(result.relevanceFilter.filteredByThreshold, 0);
  });
});

// Requirement 4: an unscored record is normally kept, but an unscored record
// that IS a non-news page type is still excluded.
test("108-5. an unscored record is kept unless it matches an explicit non-news exclusion", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const unscoredNews = sampleItem({ title: "Equities rise at the open", ticker_sentiment: [] });
    const unscoredPage = sampleItem({ title: "SPY holdings history", ticker_sentiment: [] });
    const result = await loadLiveNewsData({
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([unscoredNews, unscoredPage]) }) },
    });
    assert.equal(result.newsData.length, 1);
    assert.equal(result.newsData[0].headline, "Equities rise at the open");
    assert.equal(result.relevanceFilter.filteredByPattern, 1);
    assert.equal(result.relevanceFilter.filteredByThreshold, 0);
  });
});

// ---------- Combined diagnostics ----------

test("108-6. relevanceFilter reports threshold-filtered and pattern-filtered counts separately", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const feed = [
      scoredItem("SPY", 0.9, { title: "SPY closes higher on strong jobs data" }), // retained
      scoredItem("SPY", 0.05, { title: "Market wrap: quiet session" }), // threshold
      scoredItem("SPY", 0.04, { title: "Another passing mention of the index" }), // threshold
      scoredItem("SPY", 0.95, { title: "1 SPY to USD" }), // pattern: currency
      scoredItem("SPY", 0.95, { title: "Tokenized SPY listing goes live" }), // pattern: tokenized
      scoredItem("SPY", 0.95, { title: "SPY holdings history" }), // pattern: holdings
    ];
    const result = await loadLiveNewsData({
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody(feed) }) },
    });

    assert.equal(result.newsData.length, 1);
    assert.equal(result.providerResult.recordCount, 1);
    assert.deepEqual(result.relevanceFilter, {
      threshold: MIN_TICKER_RELEVANCE_SCORE,
      examined: 6,
      filtered: 5,
      filteredByThreshold: 2,
      filteredByPattern: 3,
      patternCounts: { currency_conversion: 1, tokenized_product: 1, holdings_history: 1 },
      retained: 1,
    });
  });
});

test("108-7. both filter stages report their own warning, never silently", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const feed = [
      scoredItem("SPY", 0.9, { title: "SPY closes higher" }),
      scoredItem("SPY", 0.05, { title: "Market wrap: quiet session" }),
      scoredItem("SPY", 0.95, { title: "1 SPY to USD" }),
    ];
    const result = await loadLiveNewsData({
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody(feed) }) },
    });

    assert.equal(result.warnings.length, 2);
    const thresholdWarning = result.warnings.find((w) => w.includes("relevance filter"));
    const patternWarning = result.warnings.find((w) => w.includes("page-type filter"));
    assert.ok(thresholdWarning.includes("1 of 3"));
    assert.ok(thresholdWarning.includes(String(MIN_TICKER_RELEVANCE_SCORE)));
    assert.ok(patternWarning.includes("1 of 3"));
    assert.ok(patternWarning.includes("currency_conversion=1"));
  });
});

test("108-8. a clean feed produces no filter warnings and an all-zero filter report", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await loadLiveNewsData({
      adapterConfig: { fetchImpl: makeMockFetch({ body: feedBody([scoredItem("SPY", 0.8), scoredItem("SPY", 0.6)]) }) },
    });
    assert.equal(result.newsData.length, 2);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.relevanceFilter.filtered, 0);
    assert.deepEqual(result.relevanceFilter.patternCounts, {});
  });
});
