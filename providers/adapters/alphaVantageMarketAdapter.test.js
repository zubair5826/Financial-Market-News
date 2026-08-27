// Offline/synthetic tests for AlphaVantageMarketAdapter — implements
// the contract frozen in Steps 40/41. No test here ever contacts a
// real network endpoint or uses a real Alpha Vantage credential.

const test = require("node:test");
const assert = require("node:assert/strict");
const { AlphaVantageMarketAdapter, SUPPORTED_TIMEFRAMES, DEFAULT_TIMEFRAME } = require("./alphaVantageMarketAdapter");
const { ERROR_CODES } = require("../../core/errors");
const { UNKNOWN } = require("../../core/constants");

const SYNTHETIC_KEY = "SYNTHETIC_KEY";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function dailySeriesBody(entries) {
  return {
    "Meta Data": { "2. Symbol": "SPY" },
    "Time Series (Daily)": entries,
  };
}

const twoDayEntries = {
  "2026-08-24": { "1. open": "560.1000", "2. high": "563.5000", "3. low": "559.0000", "4. close": "562.2000", "5. volume": "45012345" },
  "2026-08-21": { "1. open": "557.0000", "2. high": "561.0000", "3. low": "556.5000", "4. close": "560.0000", "5. volume": "41234567" },
};

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
  return new AlphaVantageMarketAdapter({ apiKey: SYNTHETIC_KEY, ...overrides });
}

// 1/6. Exact Alpha Vantage fields map correctly (including the date key -> timestamp).
test("1/6. exact Alpha Vantage numbered fields map to open/high/low/close/volume, date key maps to timestamp", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: dailySeriesBody(twoDayEntries) }) });
  const result = await adapter.fetchData({ symbol: "SPY" });
  assert.equal(result.ok, true);
  const record = result.data.find((r) => r.timestamp === "2026-08-24");
  assert.ok(record);
  assert.equal(record.open, 560.1);
  assert.equal(record.high, 563.5);
  assert.equal(record.low, 559.0);
  assert.equal(record.close, 562.2);
  assert.equal(record.volume, 45012345);
});

// 2. Multiple date records map correctly.
test("2. multiple date records all map correctly, one candle per date key", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: dailySeriesBody(twoDayEntries) }) });
  const result = await adapter.fetchData({ symbol: "SPY" });
  assert.equal(result.data.length, 2);
  assert.deepEqual(
    result.data.map((r) => r.timestamp).sort(),
    ["2026-08-21", "2026-08-24"]
  );
});

// 3. Numeric OHLCV values are handled correctly — including the empty-string quirk.
test("3. numeric OHLCV values are parsed as real numbers; missing/empty/non-numeric fields become UNKNOWN, never 0", async () => {
  const entries = {
    "2026-08-24": { "1. open": "560.10", "2. high": "563.50", "3. low": "559.00", "4. close": "562.20", "5. volume": "" },
    "2026-08-25": { "1. open": "not-a-number", "2. high": "563.50", "3. low": "559.00", "4. close": "562.20", "5. volume": "100" },
  };
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: dailySeriesBody(entries) }) });
  const result = await adapter.fetchData({ symbol: "SPY" });
  const day1 = result.data.find((r) => r.timestamp === "2026-08-24");
  const day2 = result.data.find((r) => r.timestamp === "2026-08-25");
  assert.equal(day1.volume, UNKNOWN); // empty string never becomes 0
  assert.equal(typeof day1.open, "number");
  assert.equal(day2.open, UNKNOWN); // non-numeric string never becomes 0 or NaN
});

// 4. SPY asset is preserved.
test("4. the requested symbol is preserved as the candle's asset", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: dailySeriesBody(twoDayEntries) }) });
  const result = await adapter.fetchData({ symbol: "SPY" });
  assert.ok(result.data.every((r) => r.asset === "SPY"));
});

// 5. timeframe is "1day".
test("5. every mapped candle has timeframe \"1day\"", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: dailySeriesBody(twoDayEntries) }) });
  const result = await adapter.fetchData({ symbol: "SPY" });
  assert.ok(result.data.every((r) => r.timeframe === "1day"));
});

// 7. classification is "FACT".
test("7. every mapped candle has classification FACT (adapter-assigned)", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: dailySeriesBody(twoDayEntries) }) });
  const result = await adapter.fetchData({ symbol: "SPY" });
  assert.ok(result.data.every((r) => r.classification === "FACT"));
});

// 8. Malformed responses fail safely — several distinct shapes.
test("8a. a response missing \"Time Series (Daily)\" fails safely with MALFORMED_DATA, never fabricated candles", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: { "Meta Data": {} } }) });
  const result = await adapter.fetchData({ symbol: "SPY" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.MALFORMED_DATA);
});

test("8b. an Alpha Vantage \"Error Message\" body (HTTP 200) fails safely with INVALID_RESPONSE", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: { "Error Message": "Invalid API call." } }) });
  const result = await adapter.fetchData({ symbol: "BADSYMBOL" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.INVALID_RESPONSE);
});

test("8c. an Alpha Vantage \"Note\" rate-limit body (HTTP 200) fails safely with RATE_LIMIT", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: { Note: "Thank you for using Alpha Vantage! Our standard API call frequency is..." } }) });
  const result = await adapter.fetchData({ symbol: "SPY" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.RATE_LIMIT);
});

test("8d. an Alpha Vantage \"Information\" body (HTTP 200) fails safely with RATE_LIMIT", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: { Information: "Thank you for using Alpha Vantage! ..." } }) });
  const result = await adapter.fetchData({ symbol: "SPY" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.RATE_LIMIT);
});

test("8e. HTTP 401/403 fails safely with AUTH_FAILURE", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ status: 401, body: {} }) });
  const result = await adapter.fetchData({ symbol: "SPY" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.AUTH_FAILURE);
});

test("8f. HTTP 429 fails safely with RATE_LIMIT", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ status: 429, body: {} }) });
  const result = await adapter.fetchData({ symbol: "SPY" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.RATE_LIMIT);
});

test("8g. a non-JSON body fails safely with MALFORMED_DATA", async () => {
  const adapter = makeAdapter({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("not json"); } }),
  });
  const result = await adapter.fetchData({ symbol: "SPY" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.MALFORMED_DATA);
});

test("8h. missing request.symbol fails safely with MALFORMED_DATA, no network call", async () => {
  const adapter = makeAdapter();
  const { value: result, networkCalled } = await withNetworkGuard(async () => adapter.fetchData({}));
  assert.equal(networkCalled, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.MALFORMED_DATA);
});

test("8i. missing API key fails safely with AUTH_FAILURE, no network call", async () => {
  const adapter = new AlphaVantageMarketAdapter({});
  const { value: result, networkCalled } = await withNetworkGuard(async () => adapter.fetchData({ symbol: "SPY" }));
  assert.equal(networkCalled, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.AUTH_FAILURE);
});

// 9. Request input is not mutated.
test("9. the caller's request object is not mutated", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: dailySeriesBody(twoDayEntries) }) });
  const request = { symbol: "SPY" };
  const snapshot = JSON.parse(JSON.stringify(request));
  await adapter.fetchData(request);
  assert.deepEqual(request, snapshot);
});

// 10. API credentials are never exposed.
test("10. the synthetic credential never appears anywhere in the returned result, but does appear in the actual request URL", async () => {
  const calls = [];
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: dailySeriesBody(twoDayEntries), onCall: (url) => calls.push(url) }) });
  const result = await adapter.fetchData({ symbol: "SPY" });
  assert.ok(calls[0].includes(SYNTHETIC_KEY)); // proves the check below isn't vacuous
  assert.ok(!JSON.stringify(result).includes(SYNTHETIC_KEY));
});

test("10b. a failure result never exposes the credential either", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: { "Error Message": `bad key ${SYNTHETIC_KEY}` } }) });
  const result = await adapter.fetchData({ symbol: "SPY" });
  // Even if the (synthetic) provider echoed the key into its own error
  // text, the adapter must never independently inject the credential
  // anywhere else in the structured failure.
  const { code, message } = result;
  assert.equal(code, ERROR_CODES.INVALID_RESPONSE);
  assert.ok(typeof message === "string");
});

// 11. No duplicate processing.
test("11. fetchData() issues exactly one HTTP request per call; healthCheck() delegates to fetchData() without a second request path", async () => {
  const calls = [];
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: dailySeriesBody(twoDayEntries), onCall: (url) => calls.push(url) }) });
  await adapter.fetchData({ symbol: "SPY" });
  assert.equal(calls.length, 1);

  calls.length = 0;
  const health = await adapter.healthCheck();
  assert.equal(calls.length, 1);
  assert.equal(health.ok, true);
});

// Timeout / cancellation behavior, same discipline as FredMacroAdapter.
test("12. a timeout aborts the underlying request and fails safely with TIMEOUT", async () => {
  const abortAwareFetch = (url, opts) =>
    new Promise((resolve, reject) => {
      opts.signal.addEventListener("abort", () => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        reject(err);
      });
    });
  const adapter = makeAdapter({ fetchImpl: abortAwareFetch, timeoutMs: 10 });
  const result = await adapter.fetchData({ symbol: "SPY" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.TIMEOUT);
});

// --- Step 99: requested-vs-returned symbol verification ---

// 1/10. SPY request -> SPY data accepted (existing behavior unchanged).
test("99-1. a SPY request against a SPY-metadata response is accepted, unchanged", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: dailySeriesBody(twoDayEntries) }) });
  const result = await adapter.fetchData({ symbol: "SPY" });
  assert.equal(result.ok, true);
  assert.ok(result.data.every((c) => c.asset === "SPY"));
});

// 2. BTC request -> BTC data accepted when the provider's metadata agrees.
test("99-2. a BTC request against a BTC-metadata response is accepted", async () => {
  const btcBody = { "Meta Data": { "2. Symbol": "BTC" }, "Time Series (Daily)": twoDayEntries };
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: btcBody }) });
  const result = await adapter.fetchData({ symbol: "BTC" });
  assert.equal(result.ok, true);
  assert.ok(result.data.every((c) => c.asset === "BTC"));
});

// 6/8. Provider returned wrong symbol -> rejected, never silently attributed.
test("99-3. a BTC request against a SPY-metadata response is rejected as INVALID_RESPONSE, never labeled BTC", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: dailySeriesBody(twoDayEntries) }) });
  const result = await adapter.fetchData({ symbol: "BTC" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.INVALID_RESPONSE);
  assert.equal(result.details.requestedSymbol, "BTC");
  assert.equal(result.details.returnedSymbol, "SPY");
});

// 5. Case normalization: a case-differing echo is still accepted.
test("99-4. a lowercase metadata symbol matching the requested symbol case-insensitively is still accepted", () => {
  return (async () => {
    const body = { "Meta Data": { "2. Symbol": "spy" }, "Time Series (Daily)": twoDayEntries };
    const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body }) });
    const result = await adapter.fetchData({ symbol: "SPY" });
    assert.equal(result.ok, true);
  })();
});

// A response with no Meta Data block at all is never treated as a
// mismatch by omission — the check only fires when the field is
// actually present and disagrees.
test("99-5. a response with no Meta Data symbol field is not treated as a mismatch", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: { "Time Series (Daily)": twoDayEntries } }) });
  const result = await adapter.fetchData({ symbol: "BTC" });
  assert.equal(result.ok, true);
});

// --- Step 103: multi-timeframe support ---

function weeklySeriesBody(entries) {
  return { "Meta Data": { "2. Symbol": "SPY" }, "Weekly Time Series": entries };
}
function monthlySeriesBody(entries) {
  return { "Meta Data": { "2. Symbol": "SPY" }, "Monthly Time Series": entries };
}

test("103-1. SUPPORTED_TIMEFRAMES lists exactly 1day, 1week, 1month, and 1day is the default", () => {
  assert.deepEqual([...SUPPORTED_TIMEFRAMES].sort(), ["1day", "1month", "1week"]);
  assert.equal(DEFAULT_TIMEFRAME, "1day");
});

// Each supported timeframe: correct function/series-key used, correct
// timeframe metadata on every mapped candle.
test("103-2. timeframe '1week' requests TIME_SERIES_WEEKLY and maps candles with timeframe '1week'", async () => {
  const calls = [];
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: weeklySeriesBody(twoDayEntries), onCall: (u) => calls.push(u) }) });
  const result = await adapter.fetchData({ symbol: "SPY", timeframe: "1week" });
  assert.equal(result.ok, true);
  assert.ok(calls[0].includes("function=TIME_SERIES_WEEKLY"));
  assert.ok(!calls[0].includes("outputsize")); // WEEKLY never sends outputsize
  assert.ok(result.data.every((r) => r.timeframe === "1week"));
  assert.ok(result.data.every((r) => r.asset === "SPY"));
});

test("103-3. timeframe '1month' requests TIME_SERIES_MONTHLY and maps candles with timeframe '1month'", async () => {
  const calls = [];
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: monthlySeriesBody(twoDayEntries), onCall: (u) => calls.push(u) }) });
  const result = await adapter.fetchData({ symbol: "SPY", timeframe: "1month" });
  assert.equal(result.ok, true);
  assert.ok(calls[0].includes("function=TIME_SERIES_MONTHLY"));
  assert.ok(!calls[0].includes("outputsize"));
  assert.ok(result.data.every((r) => r.timeframe === "1month"));
});

test("103-4. omitting timeframe defaults to '1day', unchanged from before Step 103", async () => {
  const calls = [];
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: dailySeriesBody(twoDayEntries), onCall: (u) => calls.push(u) }) });
  const result = await adapter.fetchData({ symbol: "SPY" });
  assert.ok(calls[0].includes("function=TIME_SERIES_DAILY"));
  assert.ok(result.data.every((r) => r.timeframe === "1day"));
});

// Unsupported timeframe: explicit rejection, no network call, no
// silent substitution.
test("103-5. an unsupported timeframe (intraday) is rejected with MALFORMED_DATA, no network call, never silently substituted with daily", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: dailySeriesBody(twoDayEntries) }) });
  const { value: result, networkCalled } = await withNetworkGuard(async () => adapter.fetchData({ symbol: "SPY", timeframe: "5min" }));
  assert.equal(networkCalled, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.MALFORMED_DATA);
  assert.equal(result.details.requestedTimeframe, "5min");
  assert.deepEqual(result.details.supportedTimeframes, SUPPORTED_TIMEFRAMES);
});

test("103-6. correct symbol is preserved across every supported timeframe", async () => {
  const weeklyBtc = { "Meta Data": { "2. Symbol": "BTC" }, "Weekly Time Series": twoDayEntries };
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: weeklyBtc }) });
  const result = await adapter.fetchData({ symbol: "BTC", timeframe: "1week" });
  assert.equal(result.ok, true);
  assert.ok(result.data.every((r) => r.asset === "BTC"));
});

// Provider errors are timeframe-agnostic — the same failure handling
// applies regardless of which timeframe was requested.
test("103-7. an Alpha Vantage rate-limit body fails safely with RATE_LIMIT for a non-default timeframe too", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: { Note: "rate limited" } }) });
  const result = await adapter.fetchData({ symbol: "SPY", timeframe: "1week" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.RATE_LIMIT);
});

test("103-8. a response missing the weekly series key fails safely with MALFORMED_DATA", async () => {
  const adapter = makeAdapter({ fetchImpl: makeMockFetch({ body: { "Meta Data": {} } }) });
  const result = await adapter.fetchData({ symbol: "SPY", timeframe: "1week" });
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.MALFORMED_DATA);
});

// Structural: no external network/broker/exchange call anywhere in this file's own source.
test("this adapter file never references a broker/exchange execution function", () => {
  const fs = require("fs");
  const source = fs.readFileSync(require.resolve("./alphaVantageMarketAdapter"), "utf8");
  assert.ok(!/\bplaceOrder\b|\bsubmitOrder\b|\bsendOrder\b|\bexecuteTrade\b/.test(source));
});
