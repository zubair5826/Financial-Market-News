// Alpha Vantage Market Live-Source Boundary — implements the design
// frozen in Step 46A. This is the ONLY place
// process.env.ALPHAVANTAGE_API_KEY is read for market data. It
// contains no HTTP/network logic of its own — it constructs the
// existing, unmodified AlphaVantageMarketAdapter and delegates
// entirely to its existing fetchData().
//
// Unlike FRED (which can batch multiple series and therefore needs a
// separate composer layer — see providers/fredMacroComposer.js), this
// domain always makes exactly one fixed request (SPY,
// TIME_SERIES_DAILY, outputsize=compact) — no composer layer is
// needed here, per the Step 46 architecture finding. The per-request
// success/failure bookkeeping a composer would otherwise provide is
// done directly in this file instead, mirroring
// fredMacroComposer.js's own warning/result shape for a single item.
//
// It does NOT call processRequest() and is NOT wired into the
// orchestrator directly — that composition happens one layer up, in
// marketIntelligenceApplicationService.js.

const { AlphaVantageMarketAdapter } = require("./adapters/alphaVantageMarketAdapter");

const MARKET_SYMBOL = "SPY";
const MARKET_OUTPUTSIZE = "compact";

// options.adapterConfig: optional config merged into the adapter's own
//   constructor (e.g. { fetchImpl } for offline testing) — apiKey is
//   always sourced from process.env here, never overridable via this.
// Resolves to { technicalCandles, providerResult, warnings } — never
// throws, never fabricates candles on failure.
async function loadLiveMarketData(options = {}) {
  const apiKey = process.env.ALPHAVANTAGE_API_KEY;

  if (!apiKey) {
    return {
      technicalCandles: [],
      providerResult: { ok: false, code: "AUTH_FAILURE", message: "ALPHAVANTAGE_API_KEY not configured." },
      warnings: ["ALPHAVANTAGE_API_KEY not configured."],
    };
  }

  const adapter = new AlphaVantageMarketAdapter({ ...(options.adapterConfig || {}), apiKey });
  const result = await adapter.fetchData({ symbol: MARKET_SYMBOL, outputsize: MARKET_OUTPUTSIZE });

  if (!result.ok) {
    // Failure: contributes zero candles. The adapter's own code/message
    // are preserved verbatim, never reinterpreted into a different code
    // — same convention as fredMacroComposer.js.
    return {
      technicalCandles: [],
      providerResult: { ok: false, code: result.code, message: result.message },
      warnings: [`Alpha Vantage market data unavailable: ${result.code}`],
    };
  }

  // Preserved exactly as returned — no transformation, no
  // normalization, no field mapping. Empty data is success, not a
  // failure.
  const candles = Array.isArray(result.data) ? result.data : [];
  return {
    technicalCandles: candles,
    providerResult: { ok: true, recordCount: candles.length },
    warnings: [],
  };
}

module.exports = { loadLiveMarketData };
