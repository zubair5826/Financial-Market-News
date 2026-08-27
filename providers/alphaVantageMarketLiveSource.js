// Alpha Vantage Market Live-Source Boundary — implements the design
// frozen in Step 46A, extended in Step 103 to request more than one
// timeframe. This is the ONLY place process.env.ALPHAVANTAGE_API_KEY
// is read for market data. It contains no HTTP/network logic of its
// own — it constructs the existing AlphaVantageMarketAdapter and
// delegates entirely to its existing fetchData(), once per requested
// timeframe.
//
// Unlike FRED (which can batch multiple series and therefore needs a
// separate composer layer — see providers/fredMacroComposer.js), this
// file still needs no separate composer module: the per-timeframe
// success/failure bookkeeping a composer would otherwise provide is
// done directly here, mirroring fredMacroComposer.js's own
// warning/result shape but SEQUENTIALLY rather than concurrently (see
// below).
//
// It does NOT call processRequest() and is NOT wired into the
// orchestrator directly — that composition happens one layer up, in
// marketIntelligenceApplicationService.js.
//
// Step 99 fix (preserved): this file previously hard-coded
// MARKET_SYMBOL = "SPY" regardless of what instrument a caller
// actually requested. The symbol is an explicit caller-supplied
// parameter — resolved centrally by providers/instrumentContext.js,
// never re-parsed here — with "SPY" remaining only as the frozen
// default when no symbol is resolved at all.
//
// Step 103: options.timeframes lets a caller request more than the
// original single "1day" timeframe. Every requested timeframe not in
// the adapter's own SUPPORTED_TIMEFRAMES is marked unavailable in
// timeframeResults/warnings WITHOUT ever contacting Alpha Vantage for
// it — never substituted with a different timeframe. Requests for
// SUPPORTED timeframes are made ONE AT A TIME (never
// Promise.all/allSettled) and — critically — separated by the same
// fixed ALPHA_VANTAGE_INTER_REQUEST_DELAY_MS gap
// marketIntelligenceApplicationService.js already uses between the
// market and news requests (Step 48A), now shared via
// providers/alphaVantageRateLimit.js: every one of these calls shares
// the SAME Alpha Vantage account, so the same "1 request per second"
// burst limit applies between them too, not just at the market/news
// boundary. Requesting the default single timeframe incurs zero delay,
// exactly as before Step 103.

const { AlphaVantageMarketAdapter, SUPPORTED_TIMEFRAMES, DEFAULT_TIMEFRAME } = require("./adapters/alphaVantageMarketAdapter");
const { ALPHA_VANTAGE_INTER_REQUEST_DELAY_MS, delay } = require("./alphaVantageRateLimit");

const DEFAULT_MARKET_SYMBOL = "SPY";
const MARKET_OUTPUTSIZE = "compact";
const DEFAULT_TIMEFRAMES = Object.freeze([DEFAULT_TIMEFRAME]);

// options.symbol: the resolved instrument symbol to request (e.g. from
//   providers/instrumentContext.js's resolveInstrumentContext()) —
//   defaults to DEFAULT_MARKET_SYMBOL only when omitted, never guessed
//   or substituted otherwise.
// options.timeframes: array of timeframe labels to request — defaults
//   to ["1day"] (this integration's original, single-request behavior)
//   when omitted, so every pre-Step-103 caller/test is unaffected.
// options.adapterConfig: optional config merged into the adapter's own
//   constructor (e.g. { fetchImpl } for offline testing) — apiKey is
//   always sourced from process.env here, never overridable via this.
// Resolves to { technicalCandles, providerResult, timeframeResults,
//   warnings } — never throws, never fabricates candles on failure,
//   never returns data under a symbol other than the one actually
//   requested (enforced by the adapter's own Meta-Data-symbol check),
//   and never substitutes an unsupported timeframe with a different
//   one. timeframeResults reports every requested timeframe's own
//   outcome explicitly, in the order requested.
async function loadLiveMarketData(options = {}) {
  const apiKey = process.env.ALPHAVANTAGE_API_KEY;
  const symbol = typeof options.symbol === "string" && options.symbol.trim() ? options.symbol.trim() : DEFAULT_MARKET_SYMBOL;
  const requestedTimeframes =
    Array.isArray(options.timeframes) && options.timeframes.length > 0 ? options.timeframes : DEFAULT_TIMEFRAMES;

  if (!apiKey) {
    return {
      technicalCandles: [],
      providerResult: { ok: false, code: "AUTH_FAILURE", message: "ALPHAVANTAGE_API_KEY not configured." },
      timeframeResults: requestedTimeframes.map((timeframe) => ({
        timeframe,
        ok: false,
        code: "AUTH_FAILURE",
        message: "ALPHAVANTAGE_API_KEY not configured.",
      })),
      warnings: ["ALPHAVANTAGE_API_KEY not configured."],
    };
  }

  const adapter = new AlphaVantageMarketAdapter({ ...(options.adapterConfig || {}), apiKey });

  const technicalCandles = [];
  const timeframeResults = [];
  const warnings = [];
  let madeRealRequest = false;

  for (const timeframe of requestedTimeframes) {
    if (!SUPPORTED_TIMEFRAMES.includes(timeframe)) {
      // Marked unavailable explicitly — never contacted, never
      // substituted with a supported timeframe instead.
      timeframeResults.push({
        timeframe,
        ok: false,
        code: "UNSUPPORTED_TIMEFRAME",
        message: `Timeframe "${timeframe}" is not supported by this provider integration.`,
      });
      warnings.push(`Alpha Vantage timeframe "${timeframe}" is unavailable under this integration — marked unavailable, no substitution made.`);
      continue;
    }

    // Respect Alpha Vantage's 1-request-per-second burst limit (Step
    // 48A) between every successive REAL call this loop makes — never
    // before the first one, and never for a timeframe that was
    // short-circuited above without touching the network.
    if (madeRealRequest) {
      await delay(ALPHA_VANTAGE_INTER_REQUEST_DELAY_MS);
    }

    const result = await adapter.fetchData({ symbol, timeframe, outputsize: MARKET_OUTPUTSIZE });
    madeRealRequest = true;

    if (!result.ok) {
      // Failure: contributes zero candles for this timeframe. The
      // adapter's own code/message are preserved verbatim, never
      // reinterpreted into a different code — same convention as
      // fredMacroComposer.js.
      timeframeResults.push({ timeframe, ok: false, code: result.code, message: result.message });
      warnings.push(`Alpha Vantage market data unavailable for timeframe "${timeframe}": ${result.code}`);
      continue;
    }

    // Preserved exactly as returned — no transformation, no
    // normalization, no field mapping. Empty data is success, not a
    // failure.
    const candles = Array.isArray(result.data) ? result.data : [];
    technicalCandles.push(...candles);
    timeframeResults.push({ timeframe, ok: true, recordCount: candles.length });
  }

  // providerResult keeps the EXACT pre-Step-103 shape
  // ({ ok:true, recordCount } / { ok:false, code, message }) regardless
  // of how many timeframes were requested — a single default-timeframe
  // request (every caller before Step 103) is completely unaffected.
  // When every requested timeframe failed, the first failure's
  // code/message is used as the representative top-level summary; the
  // full, honest per-timeframe detail is always available via
  // timeframeResults, never hidden.
  const anySucceeded = timeframeResults.some((r) => r.ok);
  const providerResult = anySucceeded
    ? { ok: true, recordCount: technicalCandles.length }
    : {
        ok: false,
        code: (timeframeResults[0] && timeframeResults[0].code) || "API_UNAVAILABLE",
        message: (timeframeResults[0] && timeframeResults[0].message) || "No requested timeframe could be acquired.",
      };

  return { technicalCandles, providerResult, timeframeResults, warnings };
}

module.exports = { loadLiveMarketData };
