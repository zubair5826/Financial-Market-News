// Alpha Vantage News Live-Source Boundary — implements the design
// frozen in Step 46A. This is the ONLY place
// process.env.ALPHAVANTAGE_API_KEY is read for news data. It contains
// no HTTP/network logic of its own — it constructs the existing,
// unmodified AlphaVantageNewsAdapter and delegates entirely to its
// existing fetchData().
//
// Same single-fixed-request rationale as alphaVantageMarketLiveSource.js:
// no composer layer is needed (NEWS_SENTIMENT, limit=10, always, for
// one resolved ticker). The frozen Step 44B confidence decision
// (impact_confidence stays UNKNOWN; ticker_sentiment_score/label/
// relevance_score preserved in evidence) is entirely the adapter's
// responsibility and is untouched here.
//
// It does NOT call processRequest() and is NOT wired into the
// orchestrator directly — that composition happens one layer up, in
// marketIntelligenceApplicationService.js.
//
// Step 99 fix: this file previously hard-coded NEWS_TICKERS = "SPY"
// regardless of what instrument a caller actually requested. The
// ticker is now an explicit caller-supplied parameter — resolved
// centrally by providers/instrumentContext.js, never re-parsed here —
// with "SPY" remaining only as the frozen default when no symbol is
// resolved at all. This file also verifies relevance after the fact:
// unlike a single-symbol candle response, a news feed has no one
// embedded "this is for ticker X" field, so instead it checks the
// requested ticker actually appears in at least one returned record's
// own (already-adapter-mapped) related_assets tagging whenever tagging
// information is present at all — never rejecting on the mere absence
// of tagging, since an untagged/legitimately-quiet news day is normal,
// not a provider defect.

const { AlphaVantageNewsAdapter } = require("./adapters/alphaVantageNewsAdapter");
const { symbolsMatch } = require("./instrumentContext");

const DEFAULT_NEWS_TICKERS = "SPY";
const NEWS_LIMIT = 10;

// options.symbol: the resolved instrument symbol to request (e.g. from
//   providers/instrumentContext.js's resolveInstrumentContext()) —
//   defaults to DEFAULT_NEWS_TICKERS only when omitted, never guessed
//   or substituted otherwise.
// options.adapterConfig: optional config merged into the adapter's own
//   constructor (e.g. { fetchImpl } for offline testing) — apiKey is
//   always sourced from process.env here, never overridable via this.
// Resolves to { newsData, providerResult, warnings } — never throws,
// never fabricates records on failure, and never returns records under
// a symbol other than the one actually requested when the provider's
// own tagging data disagrees.
async function loadLiveNewsData(options = {}) {
  const apiKey = process.env.ALPHAVANTAGE_API_KEY;
  const tickers = typeof options.symbol === "string" && options.symbol.trim() ? options.symbol.trim() : DEFAULT_NEWS_TICKERS;

  if (!apiKey) {
    return {
      newsData: [],
      providerResult: { ok: false, code: "AUTH_FAILURE", message: "ALPHAVANTAGE_API_KEY not configured." },
      warnings: ["ALPHAVANTAGE_API_KEY not configured."],
    };
  }

  const adapter = new AlphaVantageNewsAdapter({ ...(options.adapterConfig || {}), apiKey });
  const result = await adapter.fetchData({ tickers, limit: NEWS_LIMIT });

  if (!result.ok) {
    return {
      newsData: [],
      providerResult: { ok: false, code: result.code, message: result.message },
      warnings: [`Alpha Vantage news data unavailable: ${result.code}`],
    };
  }

  const records = Array.isArray(result.data) ? result.data : [];

  // Relevance check: among records that DO carry tagging
  // (related_assets !== "UNKNOWN"), does at least one actually tag the
  // requested ticker? If tagging is present everywhere it was checked
  // but none of it agrees with what was requested, this feed cannot be
  // trusted to be about the requested instrument — reject the whole
  // domain rather than silently attributing an unrelated feed to it.
  const taggedRecords = records.filter((record) => Array.isArray(record.related_assets));
  const requestedTickerConfirmed = taggedRecords.some((record) => record.related_assets.some((asset) => symbolsMatch(tickers, asset)));

  if (taggedRecords.length > 0 && !requestedTickerConfirmed) {
    return {
      newsData: [],
      providerResult: {
        ok: false,
        code: "INVALID_RESPONSE",
        message: `Alpha Vantage news response was tagged for other instruments, never "${tickers}" — refusing to attribute this feed to the requested symbol.`,
      },
      warnings: [`Alpha Vantage news data rejected: returned feed did not confirm relevance to the requested symbol "${tickers}".`],
    };
  }

  return {
    newsData: records,
    providerResult: { ok: true, recordCount: records.length },
    warnings: [],
  };
}

module.exports = { loadLiveNewsData };
