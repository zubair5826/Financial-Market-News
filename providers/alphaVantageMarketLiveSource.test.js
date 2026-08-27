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

// --- Step 99: requested-symbol pass-through ---

// 1/10. No symbol option -> SPY default preserved (existing behavior unchanged).
test("99-1. omitting options.symbol still requests symbol=SPY, unchanged", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    await loadLiveMarketData({ adapterConfig: { fetchImpl: makeMockFetch({ body: dailySeriesBody(sampleEntries), onCall: (u) => calls.push(u) }) } });
    assert.ok(calls[0].includes("symbol=SPY"));
  });
});

// 2. An explicit symbol flows through to the actual request and the labeled candles.
test("99-2. options.symbol='BTC' requests symbol=BTC, and returned candles are labeled BTC (when the provider agrees)", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    const btcBody = { "Meta Data": { "2. Symbol": "BTC" }, "Time Series (Daily)": sampleEntries };
    const result = await loadLiveMarketData({
      symbol: "BTC",
      adapterConfig: { fetchImpl: makeMockFetch({ body: btcBody, onCall: (u) => calls.push(u) }) },
    });
    assert.ok(calls[0].includes("symbol=BTC"));
    assert.equal(result.technicalCandles[0].asset, "BTC");
  });
});

// 3/6/8. A requested symbol the provider's response disagrees with fails
// safely — never silently substituted with SPY data.
test("99-3. options.symbol='BTC' against a SPY-metadata response fails safely, never returns SPY data labeled BTC", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const result = await loadLiveMarketData({
      symbol: "BTC",
      adapterConfig: { fetchImpl: makeMockFetch({ body: dailySeriesBody(sampleEntries) }) },
    });
    assert.deepEqual(result.technicalCandles, []);
    assert.equal(result.providerResult.ok, false);
    assert.equal(result.providerResult.code, "INVALID_RESPONSE");
  });
});

// --- Step 103: multi-timeframe support ---

function weeklySeriesBody(entries) {
  return { "Meta Data": { "2. Symbol": "SPY" }, "Weekly Time Series": entries };
}

// Fast-timer patch, same technique as marketIntelligenceApplicationService.test.js:
// wraps the real global.setTimeout to record the requested delay while
// firing almost immediately, so the real 1100ms gap is never actually
// waited out in this offline test suite.
function withFastTimers(fn) {
  const originalSetTimeout = global.setTimeout;
  const timeoutCalls = [];
  global.setTimeout = (cb, ms, ...args) =>
    originalSetTimeout(
      () => {
        timeoutCalls.push(ms);
        cb();
      },
      0,
      ...args
    );
  return fn(timeoutCalls).finally(() => {
    global.setTimeout = originalSetTimeout;
  });
}

test("103-1. requesting two supported timeframes makes two sequential calls, one per timeframe, with correct metadata", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    await withFastTimers(async (timeoutCalls) => {
      const calls = [];
      const fetchImpl = async (url) => {
        calls.push(url);
        if (url.includes("TIME_SERIES_WEEKLY")) return jsonResponse(200, weeklySeriesBody(sampleEntries));
        return jsonResponse(200, dailySeriesBody(sampleEntries));
      };
      const result = await loadLiveMarketData({ timeframes: ["1day", "1week"], adapterConfig: { fetchImpl } });
      assert.equal(calls.length, 2);
      assert.ok(calls[0].includes("function=TIME_SERIES_DAILY"));
      assert.ok(calls[1].includes("function=TIME_SERIES_WEEKLY"));
      assert.deepEqual(
        result.technicalCandles.map((c) => c.timeframe).sort(),
        ["1day", "1week"]
      );
      assert.deepEqual(result.timeframeResults.map((r) => ({ timeframe: r.timeframe, ok: r.ok })), [
        { timeframe: "1day", ok: true },
        { timeframe: "1week", ok: true },
      ]);
      // Rate-limit behavior: exactly one delay, between the two real calls.
      assert.deepEqual(timeoutCalls, [1100]);
    });
  });
});

test("103-2. a single (default) timeframe request incurs zero delay — unchanged from before Step 103", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    await withFastTimers(async (timeoutCalls) => {
      await loadLiveMarketData({ adapterConfig: { fetchImpl: makeMockFetch({ body: dailySeriesBody(sampleEntries) }) } });
      assert.deepEqual(timeoutCalls, []);
    });
  });
});

test("103-3. an unsupported timeframe is marked unavailable, explicitly reported, and never contacts the network", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const calls = [];
    const result = await loadLiveMarketData({
      timeframes: ["1day", "5min"],
      adapterConfig: { fetchImpl: makeMockFetch({ body: dailySeriesBody(sampleEntries), onCall: (u) => calls.push(u) }) },
    });
    assert.equal(calls.length, 1); // only the supported "1day" call ever reaches the network
    const unsupported = result.timeframeResults.find((r) => r.timeframe === "5min");
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.code, "UNSUPPORTED_TIMEFRAME");
    assert.ok(result.warnings.some((w) => w.includes("5min") && w.includes("unavailable")));
    // The supported timeframe's own data is never discarded because a
    // sibling request was unsupported.
    assert.equal(result.technicalCandles.length, 1);
  });
});

test("103-4. a request for only unsupported timeframes never contacts the network at all, and providerResult.ok is false", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    const { value: result, networkCalled } = await withNetworkGuard(async () =>
      loadLiveMarketData({ timeframes: ["5min", "15min"] })
    );
    assert.equal(networkCalled, false);
    assert.deepEqual(result.technicalCandles, []);
    assert.equal(result.providerResult.ok, false);
    assert.equal(result.timeframeResults.length, 2);
    assert.ok(result.timeframeResults.every((r) => r.code === "UNSUPPORTED_TIMEFRAME"));
  });
});

test("103-5. a provider error on one timeframe does not prevent a sibling timeframe from succeeding", async () => {
  await withEnvKey(SYNTHETIC_KEY, async () => {
    await withFastTimers(async () => {
      const fetchImpl = async (url) => {
        if (url.includes("TIME_SERIES_WEEKLY")) return jsonResponse(200, { "Error Message": "Invalid API call." });
        return jsonResponse(200, dailySeriesBody(sampleEntries));
      };
      const result = await loadLiveMarketData({ timeframes: ["1day", "1week"], adapterConfig: { fetchImpl } });
      const daily = result.timeframeResults.find((r) => r.timeframe === "1day");
      const weekly = result.timeframeResults.find((r) => r.timeframe === "1week");
      assert.equal(daily.ok, true);
      assert.equal(weekly.ok, false);
      assert.equal(weekly.code, "INVALID_RESPONSE");
      assert.equal(result.providerResult.ok, true); // partial success still reports overall success
      assert.equal(result.technicalCandles.length, 1); // only the daily candle
    });
  });
});
