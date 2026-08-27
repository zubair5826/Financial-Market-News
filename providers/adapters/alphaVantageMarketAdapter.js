// Alpha Vantage Market Data Provider Adapter — implements the contract
// frozen in Steps 40/41, extended in Step 103 to support more than one
// timeframe. This file is NOT connected to Alpha Vantage: it contains
// only the request-construction/response-mapping logic; no network
// call happens unless a caller actually invokes fetchData()/
// healthCheck() with real config, which nothing in this repository
// does automatically.
//
// Single-call contract per timeframe: each supported Alpha Vantage
// TIME_SERIES_* function returns both a metadata wrapper and its full
// series in one response — unlike FRED's two-endpoint design
// (fredMacroAdapter.js), there is no second call to keep atomic; this
// adapter mirrors that file's structure everywhere else
// (AbortController-based timeout, credential handling, error
// classification) so the two providers stay consistent.
//
// Step 103 — which timeframes this integration supports, and why:
// the Technical Agent itself (agents/technical-agent/index.js) imposes
// no fixed timeframe vocabulary at all — it groups whatever
// `candle.timeframe` labels are actually present in its input and
// analyzes each independently (see its own README.md's "Timeframe
// Handling" section and conflicts.js's TIMEFRAME_CONFLICT, whose own
// spec example uses "1H"/"4H"-style labels). So "which timeframes are
// required" reduces to: which genuinely distinct, reliably-obtainable
// Alpha Vantage series can this integration honestly supply, so
// multi-timeframe conflict detection has more than one real timeframe
// to compare on live data. TIMEFRAME_CONFIG below lists exactly the
// three that qualify — TIME_SERIES_DAILY (existing, unchanged),
// TIME_SERIES_WEEKLY, and TIME_SERIES_MONTHLY. All three are simple,
// symbol-only, single-call, free-tier-documented endpoints with no
// extra required parameter. TIME_SERIES_INTRADAY is deliberately
// EXCLUDED: it requires an additional `interval` parameter this
// integration has never modeled, and Alpha Vantage's own documentation
// describes its historical intraday coverage as more restricted than
// daily/weekly/monthly — it cannot honestly be called "reliably
// obtainable" under the current integration. A caller requesting an
// unsupported timeframe (intraday or anything else) gets an explicit
// MALFORMED_DATA failure naming exactly what is/isn't supported —
// never a silent fallback to daily, and never a fabricated/relabeled
// series.
//
// Data Controller is NOT part of this path — this adapter feeds
// agents/technical-agent/ directly (via candle-shaped output matching
// agents/technical-agent/technicalRecord.js's CANDLE_FIELDS), exactly
// mirroring how the FRED adapter feeds the Macro Agent directly.

const { ProviderAdapter } = require("../ProviderAdapter");
const { createCandle } = require("../../agents/technical-agent/technicalRecord");
const { UNKNOWN } = require("../../core/constants");
const { INFORMATION_CLASSIFICATIONS } = require("../../core/classification");
const { failSafe, ERROR_CODES } = require("../../core/errors");
const { symbolsMatch } = require("../instrumentContext");

const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";
const ALPHA_VANTAGE_SOURCE_NAME = "Alpha Vantage";
const DEFAULT_TIMEOUT_MS = 10_000;

// Every genuinely distinct, reliably-obtainable timeframe this
// integration supports, and exactly how to fetch/parse each — see the
// module comment above for why these three and no others. `outputsize`
// is an Alpha Vantage TIME_SERIES_DAILY-only parameter; WEEKLY/MONTHLY
// always return their full available history regardless, so it's never
// sent for those two (an unsupported/ignored parameter would be
// harmless, but omitting it is the more honest, minimal request).
const TIMEFRAME_CONFIG = Object.freeze({
  "1day": Object.freeze({ function: "TIME_SERIES_DAILY", seriesKey: "Time Series (Daily)", supportsOutputSize: true }),
  "1week": Object.freeze({ function: "TIME_SERIES_WEEKLY", seriesKey: "Weekly Time Series", supportsOutputSize: false }),
  "1month": Object.freeze({ function: "TIME_SERIES_MONTHLY", seriesKey: "Monthly Time Series", supportsOutputSize: false }),
});
const SUPPORTED_TIMEFRAMES = Object.freeze(Object.keys(TIMEFRAME_CONFIG));
const DEFAULT_TIMEFRAME = "1day";

class AlphaVantageMarketAdapter extends ProviderAdapter {
  constructor(config = {}) {
    super(config);
    // apiKey is read from caller-supplied config only — this class never
    // reads process.env itself; a real deployment's integration point is
    // responsible for sourcing it from the environment, same rule as
    // FredMacroAdapter.
    this.apiKey = config.apiKey;
    // fetchImpl defaults to the global fetch (Node 18+) but can be
    // injected for offline/synthetic testing — no mocking library or
    // new dependency required.
    this.fetchImpl = config.fetchImpl || fetch;
    this.timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  // request: { symbol: string, timeframe?: "1day" | "1week" | "1month",
  //   outputsize?: "compact" | "full" }. timeframe defaults to "1day"
  //   (DEFAULT_TIMEFRAME) when omitted — every pre-Step-103 caller is
  //   completely unaffected. Resolves to { ok: true, data: Candle[] }
  //   (agents/technical-agent shape) or a failSafe() result — never a
  //   partial/fabricated candle, and never a candle mislabeled with a
  //   timeframe other than the one actually requested and confirmed.
  async fetchData(request) {
    if (!request || typeof request !== "object" || !request.symbol || typeof request.symbol !== "string") {
      return failSafe(ERROR_CODES.MALFORMED_DATA, "AlphaVantageMarketAdapter.fetchData requires request.symbol (string).");
    }
    if (!this.apiKey) {
      return failSafe(ERROR_CODES.AUTH_FAILURE, "No Alpha Vantage API key configured for this adapter instance.");
    }

    const timeframe = request.timeframe === undefined ? DEFAULT_TIMEFRAME : request.timeframe;
    const timeframeConfig = TIMEFRAME_CONFIG[timeframe];
    if (!timeframeConfig) {
      // Never a silent fallback to daily, never a guess — an explicit,
      // structured rejection naming both what was requested and what
      // this integration actually supports. No network call is made.
      return failSafe(
        ERROR_CODES.MALFORMED_DATA,
        `Unsupported timeframe "${timeframe}" — this integration supports: ${SUPPORTED_TIMEFRAMES.join(", ")}.`,
        { requestedTimeframe: timeframe, supportedTimeframes: SUPPORTED_TIMEFRAMES }
      );
    }

    const symbol = request.symbol;
    const outputsize = request.outputsize === "full" ? "full" : "compact";

    const urlParams = { function: timeframeConfig.function, symbol };
    if (timeframeConfig.supportsOutputSize) urlParams.outputsize = outputsize;

    const url = this.#buildUrl(urlParams);
    const response = await this.#request(url, `Alpha Vantage ${timeframeConfig.function}`);
    if (!response.ok) return response.failure;

    const parsed = await this.#parseJsonResponse(response.value, `Alpha Vantage ${timeframeConfig.function}`);
    if (!parsed.ok) return parsed.failure;

    const body = parsed.body;
    const series = body[timeframeConfig.seriesKey];
    if (!series || typeof series !== "object" || Array.isArray(series)) {
      return failSafe(
        ERROR_CODES.MALFORMED_DATA,
        `Alpha Vantage response did not contain a usable "${timeframeConfig.seriesKey}" object.`,
        { symbol, timeframe }
      );
    }

    // Step 99 fix: Alpha Vantage's own "Meta Data" block echoes which
    // symbol its response is actually for. If present and it disagrees
    // with what was requested, this response can never be attributed
    // to the requested symbol — reject it rather than labeling
    // mismatched data with the caller's requested symbol. Only checked
    // when the field is actually present, so a minimal/synthetic
    // response with no Meta Data block is unaffected (never treated as
    // a mismatch by omission — absence of proof is not proof of a
    // mismatch).
    const metaSymbol = body["Meta Data"] && body["Meta Data"]["2. Symbol"];
    if (typeof metaSymbol === "string" && metaSymbol.trim() && !symbolsMatch(symbol, metaSymbol)) {
      return failSafe(
        ERROR_CODES.INVALID_RESPONSE,
        `Alpha Vantage returned data for "${metaSymbol}" but "${symbol}" was requested — refusing to attribute this data to the requested symbol.`,
        { requestedSymbol: symbol, returnedSymbol: metaSymbol }
      );
    }

    return { ok: true, data: this.#mapToCandles(symbol, timeframe, series) };
  }

  // Reuses fetchData() itself rather than a second, independent request
  // path — SPY is the only symbol this integration's frozen scope
  // covers (Step 40/42), so a real connectivity probe against it is the
  // most honest signal this adapter can give, unlike FRED's healthCheck
  // which deliberately used a synthetic placeholder series to avoid
  // asserting any particular real series resolves. Note: unlike a
  // placeholder-based probe, calling this consumes one real unit of
  // Alpha Vantage's free-tier daily quota (25 requests/day, Step 41).
  async healthCheck() {
    if (!this.apiKey) {
      return failSafe(ERROR_CODES.AUTH_FAILURE, "No Alpha Vantage API key configured for this adapter instance.");
    }

    const result = await this.fetchData({ symbol: "SPY" });
    if (!result.ok) return result;

    return { ok: true, message: "Alpha Vantage connectivity check succeeded." };
  }

  // Same real-cancellation timeout pattern as FredMacroAdapter#request.
  async #request(url, context) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      return { ok: true, value: response };
    } catch (err) {
      if (err && err.name === "AbortError") {
        return { ok: false, failure: failSafe(ERROR_CODES.TIMEOUT, `${context} request timed out.`) };
      }
      return { ok: false, failure: failSafe(ERROR_CODES.API_UNAVAILABLE, `${context} request failed: network error.`) };
    } finally {
      clearTimeout(timer);
    }
  }

  async #parseJsonResponse(response, context) {
    if (response.status === 401 || response.status === 403) {
      return { ok: false, failure: failSafe(ERROR_CODES.AUTH_FAILURE, `${context} request was rejected: authentication failed.`) };
    }
    if (response.status === 429) {
      return { ok: false, failure: failSafe(ERROR_CODES.RATE_LIMIT, `${context} request was rejected: rate limit exceeded.`) };
    }
    if (!response.ok) {
      return {
        ok: false,
        failure: failSafe(ERROR_CODES.API_UNAVAILABLE, `${context} request failed with HTTP ${response.status}.`),
      };
    }

    let body;
    try {
      body = await response.json();
    } catch (err) {
      return { ok: false, failure: failSafe(ERROR_CODES.MALFORMED_DATA, `${context} response was not valid JSON.`) };
    }

    // Alpha Vantage reports errors with HTTP 200 and one of these keys
    // instead of a non-2xx status — never treated as usable data.
    if (body && typeof body === "object") {
      if (typeof body["Error Message"] === "string") {
        return { ok: false, failure: failSafe(ERROR_CODES.INVALID_RESPONSE, `${context}: ${body["Error Message"]}`) };
      }
      if (typeof body["Note"] === "string") {
        return { ok: false, failure: failSafe(ERROR_CODES.RATE_LIMIT, `${context}: ${body["Note"]}`) };
      }
      if (typeof body["Information"] === "string") {
        return { ok: false, failure: failSafe(ERROR_CODES.RATE_LIMIT, `${context}: ${body["Information"]}`) };
      }
    }

    return { ok: true, body };
  }

  // Frozen contract: "1. open".."5. volume" are numeric strings. Never
  // fabricates a 0 for a missing/malformed value — same empty-string
  // guard as FredMacroAdapter#parseObservationValue (Number("") === 0
  // is a real JS quirk this must not fall into).
  #parseNumericField(rawValue) {
    if (rawValue === undefined || rawValue === null) return UNKNOWN;
    if (typeof rawValue === "string" && rawValue.trim() === "") return UNKNOWN;
    const num = Number(rawValue);
    return Number.isFinite(num) ? num : UNKNOWN;
  }

  #mapToCandles(symbol, timeframe, series) {
    return Object.entries(series).map(([date, entry]) =>
      createCandle({
        asset: symbol,
        timeframe,
        timestamp: date,
        open: this.#parseNumericField(entry && entry["1. open"]),
        high: this.#parseNumericField(entry && entry["2. high"]),
        low: this.#parseNumericField(entry && entry["3. low"]),
        close: this.#parseNumericField(entry && entry["4. close"]),
        volume: this.#parseNumericField(entry && entry["5. volume"]),
        source: ALPHA_VANTAGE_SOURCE_NAME,
        classification: INFORMATION_CLASSIFICATIONS.FACT,
      })
    );
  }

  // Builds the request URL. Never logged or included in any failSafe()
  // message/details — the apikey query parameter must never leak into
  // logs or error output (same rule as FredMacroAdapter#buildUrl).
  #buildUrl(params) {
    const url = new URL(ALPHA_VANTAGE_BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    url.searchParams.set("apikey", this.apiKey);
    return url.toString();
  }
}

module.exports = { AlphaVantageMarketAdapter, SUPPORTED_TIMEFRAMES, DEFAULT_TIMEFRAME };
