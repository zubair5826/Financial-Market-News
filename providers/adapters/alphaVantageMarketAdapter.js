// Alpha Vantage Market Data Provider Adapter — implements the contract
// frozen in Steps 40/41. This file is NOT connected to Alpha Vantage:
// it contains only the request-construction/response-mapping logic; no
// network call happens unless a caller actually invokes fetchData()/
// healthCheck() with real config, which nothing in this repository
// does automatically.
//
// Single-call contract: TIME_SERIES_DAILY returns both the metadata
// wrapper and the full daily series in one response — unlike FRED's
// two-endpoint design (fredMacroAdapter.js), there is no second call to
// keep atomic; this adapter mirrors that file's structure everywhere
// else (AbortController-based timeout, credential handling, error
// classification) so the two providers stay consistent.
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

const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";
const ALPHA_VANTAGE_SOURCE_NAME = "Alpha Vantage";
const DEFAULT_TIMEOUT_MS = 10_000;
const TIME_SERIES_KEY = "Time Series (Daily)";

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

  // request: { symbol: string, outputsize?: "compact" | "full" }
  // Resolves to { ok: true, data: Candle[] } (agents/technical-agent
  // shape) or a failSafe() result — never a partial/fabricated candle.
  async fetchData(request) {
    if (!request || typeof request !== "object" || !request.symbol || typeof request.symbol !== "string") {
      return failSafe(ERROR_CODES.MALFORMED_DATA, "AlphaVantageMarketAdapter.fetchData requires request.symbol (string).");
    }
    if (!this.apiKey) {
      return failSafe(ERROR_CODES.AUTH_FAILURE, "No Alpha Vantage API key configured for this adapter instance.");
    }

    const symbol = request.symbol;
    const outputsize = request.outputsize === "full" ? "full" : "compact";

    const url = this.#buildUrl({ function: "TIME_SERIES_DAILY", symbol, outputsize });
    const response = await this.#request(url, "Alpha Vantage TIME_SERIES_DAILY");
    if (!response.ok) return response.failure;

    const parsed = await this.#parseJsonResponse(response.value, "Alpha Vantage TIME_SERIES_DAILY");
    if (!parsed.ok) return parsed.failure;

    const body = parsed.body;
    const series = body[TIME_SERIES_KEY];
    if (!series || typeof series !== "object" || Array.isArray(series)) {
      return failSafe(
        ERROR_CODES.MALFORMED_DATA,
        `Alpha Vantage response did not contain a usable "${TIME_SERIES_KEY}" object.`,
        { symbol }
      );
    }

    return { ok: true, data: this.#mapToCandles(symbol, series) };
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

  #mapToCandles(symbol, series) {
    return Object.entries(series).map(([date, entry]) =>
      createCandle({
        asset: symbol,
        timeframe: "1day",
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

module.exports = { AlphaVantageMarketAdapter };
