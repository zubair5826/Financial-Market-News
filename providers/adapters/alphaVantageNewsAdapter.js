// Alpha Vantage News Provider Adapter — implements the contract frozen
// in Step 44. This file is NOT connected to Alpha Vantage: it contains
// only the request-construction/response-mapping logic; no network
// call happens unless a caller actually invokes fetchData() with real
// config.
//
// Single-call contract: NEWS_SENTIMENT returns the full article feed
// in one response — same single-call shape as
// alphaVantageMarketAdapter.js, reusing that file's structural
// conventions (AbortController timeout, credential handling, HTTP-200
// soft-error classification).
//
// Data Controller is NOT part of this path — this adapter feeds
// agents/news-agent/ directly (via News-Record-shaped output matching
// agents/news-agent/newsRecord.js's NEWS_RECORD_FIELDS), exactly
// mirroring how the FRED and Alpha Vantage market adapters feed their
// respective agents directly.
//
// FROZEN DECISION (Step 44A/44B — project-owner decided, not an
// adapter-side workaround): newsRecord.js's own structural validation
// (validateNewsRecordStructure) requires impact_confidence to be one
// of core/confidence.js's CONFIDENCE_LEVELS enum (HIGH/MEDIUM/LOW/
// UNKNOWN), a categorical scale. Alpha Vantage supplies a continuous
// numeric ticker_sentiment_score instead, and Step 44A confirmed the
// repository has no existing, approved convention anywhere for
// converting one external provider's own continuous score into that
// categorical scale — every existing CONFIDENCE_LEVELS assignment in
// this project is derived from internal signals (source/agreement
// counts, calculation certainty), never from bucketing a single
// provider's own score. Inventing a numeric threshold here would be a
// new, unauthorized confidence policy. The project owner formally
// froze the resolution instead: impact_confidence permanently stays
// UNKNOWN for Alpha Vantage news data (the honest categorical value,
// never fabricated), while the real ticker_sentiment_score,
// ticker_sentiment_label, and relevance_score are preserved verbatim
// in `evidence` — so no real provider signal is discarded, it simply
// isn't force-fit into a scale it was never expressed in.

const { ProviderAdapter } = require("../ProviderAdapter");
const { createNewsRecord } = require("../../agents/news-agent/newsRecord");
const { UNKNOWN } = require("../../core/constants");
const { INFORMATION_CLASSIFICATIONS } = require("../../core/classification");
const { IMPACT_DIRECTIONS } = require("../../agents/news-agent/impact");
const { failSafe, ERROR_CODES } = require("../../core/errors");

const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_TICKERS = "SPY";
const DEFAULT_LIMIT = 10;

// Alpha Vantage's ticker_sentiment_label vocabulary -> this project's
// IMPACT_DIRECTIONS enum. Provider-tagged data, never inferred from
// headline/summary text (agents/news-agent/impact.js's own rule that
// impact_direction must come from the input data itself).
const SENTIMENT_LABEL_MAP = Object.freeze({
  Bullish: IMPACT_DIRECTIONS.POSITIVE,
  "Somewhat-Bullish": IMPACT_DIRECTIONS.POSITIVE,
  Neutral: IMPACT_DIRECTIONS.NEUTRAL,
  "Somewhat-Bearish": IMPACT_DIRECTIONS.NEGATIVE,
  Bearish: IMPACT_DIRECTIONS.NEGATIVE,
});

class AlphaVantageNewsAdapter extends ProviderAdapter {
  constructor(config = {}) {
    super(config);
    // apiKey is read from caller-supplied config only — this class
    // never reads process.env itself, same rule as every other adapter
    // in this project.
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl || fetch;
    this.timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  // request: { tickers?: string, limit?: number } — defaults to the
  // frozen minimum request (tickers=SPY, limit=10) when not supplied.
  // Resolves to { ok: true, data: NewsRecord[] } or a failSafe()
  // result — never a partial/fabricated record.
  async fetchData(request = {}) {
    if (!this.apiKey) {
      return failSafe(ERROR_CODES.AUTH_FAILURE, "No Alpha Vantage API key configured for this adapter instance.");
    }

    const tickers = typeof request.tickers === "string" && request.tickers.trim() ? request.tickers : DEFAULT_TICKERS;
    const limit = Number.isInteger(request.limit) && request.limit > 0 ? request.limit : DEFAULT_LIMIT;

    const url = this.#buildUrl({ function: "NEWS_SENTIMENT", tickers, limit });
    const response = await this.#request(url, "Alpha Vantage NEWS_SENTIMENT");
    if (!response.ok) return response.failure;

    const parsed = await this.#parseJsonResponse(response.value, "Alpha Vantage NEWS_SENTIMENT");
    if (!parsed.ok) return parsed.failure;

    const body = parsed.body;
    if (!Array.isArray(body.feed)) {
      return failSafe(ERROR_CODES.MALFORMED_DATA, 'Alpha Vantage response did not contain a usable "feed" array.', { tickers });
    }

    const retrievedTimestamp = new Date().toISOString();
    return { ok: true, data: this.#mapToNewsRecords(body.feed, retrievedTimestamp) };
  }

  // Reuses fetchData() itself, same as AlphaVantageMarketAdapter —
  // no second, independent request path. limit:1 keeps the probe as
  // cheap as this endpoint allows while still exercising the real
  // request/parse machinery.
  async healthCheck() {
    if (!this.apiKey) {
      return failSafe(ERROR_CODES.AUTH_FAILURE, "No Alpha Vantage API key configured for this adapter instance.");
    }
    const result = await this.fetchData({ tickers: DEFAULT_TICKERS, limit: 1 });
    if (!result.ok) return result;
    return { ok: true, message: "Alpha Vantage NEWS_SENTIMENT connectivity check succeeded." };
  }

  // Same real-cancellation timeout pattern as every other adapter here.
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
    // instead of a non-2xx status — never treated as usable data. Same
    // handling as alphaVantageMarketAdapter.js.
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

  // Rejects a feed item clearly (by excluding it) rather than
  // fabricating a headline — mirrors the News Agent's own rule that a
  // missing headline leaves nothing to process.
  #mapToNewsRecords(feed, retrievedTimestamp) {
    const records = [];

    for (const item of feed) {
      if (!item || typeof item.title !== "string" || item.title.trim() === "") continue;

      const tickerSentiments = Array.isArray(item.ticker_sentiment) ? item.ticker_sentiment : [];
      const relatedAssets = tickerSentiments.map((t) => t && t.ticker).filter((t) => typeof t === "string" && t.trim());

      const primaryTopic =
        Array.isArray(item.topics) && item.topics.length > 0 && item.topics[0] && typeof item.topics[0].topic === "string"
          ? item.topics[0].topic
          : UNKNOWN;

      // Sentiment specific to the requested ticker if tagged, else the
      // first tagged ticker present — never invented if the array is
      // empty or doesn't include the requested symbol.
      const tickerSentiment = tickerSentiments.find((t) => t && t.ticker === DEFAULT_TICKERS) || tickerSentiments[0];
      const impactDirection =
        tickerSentiment && typeof tickerSentiment.ticker_sentiment_label === "string"
          ? SENTIMENT_LABEL_MAP[tickerSentiment.ticker_sentiment_label] || UNKNOWN
          : UNKNOWN;

      records.push(
        createNewsRecord({
          headline: item.title,
          summary: typeof item.summary === "string" ? item.summary : UNKNOWN,
          source: typeof item.source === "string" ? item.source : UNKNOWN,
          publication_timestamp: typeof item.time_published === "string" ? item.time_published : UNKNOWN,
          retrieved_timestamp: retrievedTimestamp,
          url_or_reference: typeof item.url === "string" ? item.url : UNKNOWN,
          related_assets: relatedAssets.length > 0 ? relatedAssets : UNKNOWN,
          category: primaryTopic,
          classification: INFORMATION_CLASSIFICATIONS.FACT,
          impact_direction: impactDirection,
          // impact_confidence intentionally left UNKNOWN — see module
          // header's disclosed contract gap.
          evidence: {
            alpha_vantage_ticker_sentiment: tickerSentiment
              ? {
                  ticker: tickerSentiment.ticker,
                  relevance_score: tickerSentiment.relevance_score,
                  ticker_sentiment_score: tickerSentiment.ticker_sentiment_score,
                  ticker_sentiment_label: tickerSentiment.ticker_sentiment_label,
                }
              : UNKNOWN,
          },
        })
      );
    }

    return records;
  }

  // Builds the request URL. Never logged or included in any failSafe()
  // message/details — the apikey query parameter must never leak into
  // logs or error output, same rule as every other adapter here.
  #buildUrl(params) {
    const url = new URL(ALPHA_VANTAGE_BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    url.searchParams.set("apikey", this.apiKey);
    return url.toString();
  }
}

module.exports = { AlphaVantageNewsAdapter };
