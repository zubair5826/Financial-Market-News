// Alpha Vantage News Live-Source Boundary — implements the design
// frozen in Step 46A. This is the ONLY place
// process.env.ALPHAVANTAGE_API_KEY is read for news data. It contains
// no HTTP/network logic of its own — it constructs the existing,
// unmodified AlphaVantageNewsAdapter and delegates entirely to its
// existing fetchData().
//
// Same single-fixed-request rationale as alphaVantageMarketLiveSource.js:
// no composer layer is needed (SPY, NEWS_SENTIMENT, limit=10, always).
// The frozen Step 44B confidence decision (impact_confidence stays
// UNKNOWN; ticker_sentiment_score/label/relevance_score preserved in
// evidence) is entirely the adapter's responsibility and is untouched
// here — this file never inspects or reshapes a single news record.
//
// It does NOT call processRequest() and is NOT wired into the
// orchestrator directly — that composition happens one layer up, in
// marketIntelligenceApplicationService.js.

const { AlphaVantageNewsAdapter } = require("./adapters/alphaVantageNewsAdapter");

const NEWS_TICKERS = "SPY";
const NEWS_LIMIT = 10;

// options.adapterConfig: optional config merged into the adapter's own
//   constructor (e.g. { fetchImpl } for offline testing) — apiKey is
//   always sourced from process.env here, never overridable via this.
// Resolves to { newsData, providerResult, warnings } — never throws,
// never fabricates records on failure.
async function loadLiveNewsData(options = {}) {
  const apiKey = process.env.ALPHAVANTAGE_API_KEY;

  if (!apiKey) {
    return {
      newsData: [],
      providerResult: { ok: false, code: "AUTH_FAILURE", message: "ALPHAVANTAGE_API_KEY not configured." },
      warnings: ["ALPHAVANTAGE_API_KEY not configured."],
    };
  }

  const adapter = new AlphaVantageNewsAdapter({ ...(options.adapterConfig || {}), apiKey });
  const result = await adapter.fetchData({ tickers: NEWS_TICKERS, limit: NEWS_LIMIT });

  if (!result.ok) {
    return {
      newsData: [],
      providerResult: { ok: false, code: result.code, message: result.message },
      warnings: [`Alpha Vantage news data unavailable: ${result.code}`],
    };
  }

  const records = Array.isArray(result.data) ? result.data : [];
  return {
    newsData: records,
    providerResult: { ok: true, recordCount: records.length },
    warnings: [],
  };
}

module.exports = { loadLiveNewsData };
