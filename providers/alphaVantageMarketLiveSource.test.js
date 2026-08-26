// Offline/synthetic tests for loadLiveMarketData() — implements the
// design frozen in Step 46A. No test here ever contacts a real network
// endpoint or uses a real Alpha Vantage credential.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadLiveMarketData } = require("./alphaVantageMarketLiveSource");

const SYNTHETIC_KEY = "SYNTHETIC_KEY";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function dailySeriesBody(entries) {
  return { "Meta Data": { "2. Symbol": "SPY" }, "Time Series (Daily)": entries };
}

const sampleEntries = {
  "2026-08-24": { "1. open": "560.10", "2. high": "563.50", "3. low": "559.00", "4. close": "562.20", "5. volume": "45012345" },
};

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

// 1. Missing credential — no adapter construction network reachable, safe empty result.
test("1. a missing ALPHAVANTAGE_API_KEY returns an empty result and a clear warning, no network call", async () => {
  await withEnvKey(undefined, async () => {
    const { value: result, networkCalled } = await withNetworkGuard(async () => loadLiveMarketData());
    assert.equal(networkCalled, false);
    assert.deepEqual(result.technicalCandles, []);
    assert.equal(result.providerResult.ok, false);
    assert.deepEqual(result.warnings, ["ALPHAVANTAGE_API_KEY not configured."]);
  });
});

// 2. The adapter is constructed correctly and the correct provider request parameters are used.
test("2. symbol=SPY, TIME_SERIES_DAILY, outputsize=compact are used in the actual request", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    const result = await loadLiveMarketData({ adapterConfig: { fetchImpl: makeMockFetch({ body: dailySeriesBody(sampleEntries), onCall: (u) => calls.push(u) }) } });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes("function=TIME_SERIES_DAILY"));
    assert.ok(calls[0].includes("symbol=SPY"));
    assert.ok(calls[0].includes("outputsize=compact"));
    assert.equal(result.technicalCandles.length, 1);
  });
});

// 3. technicalCandles returned in the existing frozen contract.
test("3. technicalCandles are returned in the existing candle contract, unmodified", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await loadLiveMarketData({ adapterConfig: { fetchImpl: makeMockFetch({ body: dailySeriesBody(sampleEntries) }) } });
    const candle = result.technicalCandles[0];
    assert.equal(candle.asset, "SPY");
    assert.equal(candle.timeframe, "1day");
    assert.equal(candle.classification, "FACT");
    assert.equal(typeof candle.open, "number");
  });
});

// 4. Provider errors propagate safely — never fabricated candles.
test("4. a provider failure returns an empty result and a preserved code, never fabricated candles", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await loadLiveMarketData({ adapterConfig: { fetchImpl: makeMockFetch({ body: { "Error Message": "Invalid API call." } }) } });
    assert.deepEqual(result.technicalCandles, []);
    assert.equal(result.providerResult.ok, false);
    assert.equal(result.providerResult.code, "INVALID_RESPONSE");
    assert.ok(result.warnings[0].includes("INVALID_RESPONSE"));
  });
});

// 5. No duplicate provider acquisition — exactly one HTTP request per call.
test("5. exactly one HTTP request occurs per loadLiveMarketData() call", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    await loadLiveMarketData({ adapterConfig: { fetchImpl: makeMockFetch({ body: dailySeriesBody(sampleEntries), onCall: (u) => calls.push(u) }) } });
    assert.equal(calls.length, 1);
  });
});

// 6. Credential is never exposed in the returned result.
test("6. the synthetic credential never appears anywhere in the returned result", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await loadLiveMarketData({ adapterConfig: { fetchImpl: makeMockFetch({ body: dailySeriesBody(sampleEntries) }) } });
    assert.ok(!JSON.stringify(result).includes(SYNTHETIC_KEY));
  });
});

// 7. No unrelated input to mutate — options object itself is not mutated.
test("7. the caller's options object is not mutated", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const options = { adapterConfig: { fetchImpl: makeMockFetch({ body: dailySeriesBody(sampleEntries) }) } };
    const fetchImplRef = options.adapterConfig.fetchImpl;
    await loadLiveMarketData(options);
    assert.equal(options.adapterConfig.fetchImpl, fetchImplRef);
    assert.deepEqual(Object.keys(options), ["adapterConfig"]);
  });
});
