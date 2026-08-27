// Market Intelligence Application Service — implements the design
// frozen in Step 46A. The single application-level composition
// boundary for the three verified provider domains (FRED macro, Alpha
// Vantage market, Alpha Vantage news). It duplicates no provider
// logic: each domain's own existing live-source function does all the
// real work (credential handling, adapter construction, request
// building) — this file only decides, per options, which of the three
// to await, merges their outputs into ONE request object, and calls
// the existing, unmodified processRequest() exactly once.
//
// This is NOT a replacement for providers/fredMacroApplicationService.js
// — that file (and its own single-domain FRED-only contract) remains
// untouched and independently usable. This file composes multiple
// domains together for a caller that wants more than just FRED, by
// calling the same underlying providers/fredMacroLiveSource.js
// directly (never providers/fredMacroApplicationService.js itself,
// which would call processRequest() a second time).

const { loadLiveMacroData } = require("./fredMacroLiveSource");
const { loadLiveMarketData } = require("./alphaVantageMarketLiveSource");
const { loadLiveNewsData } = require("./alphaVantageNewsLiveSource");
const { processRequest } = require("../orchestrator");
const { failSafe, ERROR_CODES } = require("../core/errors");
const { resolveInstrumentContext, UNKNOWN: INSTRUMENT_UNKNOWN } = require("./instrumentContext");
const { ALPHA_VANTAGE_INTER_REQUEST_DELAY_MS, delay } = require("./alphaVantageRateLimit");

const DEFAULT_MACRO_SERIES_IDS = ["GNPCA"];

// Step 48 discovered, live, that Alpha Vantage's free-tier key enforces
// a real "1 request per second" burst limit — launching the market and
// news requests at the same instant (the original Promise.all-of-three
// design) reliably triggers it, since both share one account. Step 48A
// froze the fix: the two Alpha Vantage calls must be sequential, with a
// fixed, single-purpose gap between them — not a retry, not a
// general-purpose rate limiter, not a configurable/public option.
// ALPHA_VANTAGE_INTER_REQUEST_DELAY_MS/delay() now live in
// providers/alphaVantageRateLimit.js (Step 103) so
// alphaVantageMarketLiveSource.js can share the exact same protection
// between its own successive per-timeframe requests, rather than this
// file duplicating the constant. FRED is unaffected (separate account)
// and is never delayed.

// Sequential Alpha Vantage acquisition (Step 48A): market first
// (itself now potentially more than one sequential, delay-protected
// request per timeframe — see alphaVantageMarketLiveSource.js), then —
// ONLY when both domains are enabled — the fixed gap above, then news.
// A single-domain call never waits at all.
// symbol: the one resolved instrument symbol (Step 99) both Alpha
//   Vantage calls must use — never re-resolved or re-parsed here;
//   undefined lets each live-source fall back to its own frozen SPY
//   default, preserving existing SPY-only workflows unchanged.
async function acquireAlphaVantage(marketEnabled, newsEnabled, options, symbol) {
  const marketResult = marketEnabled
    ? await loadLiveMarketData({ symbol, timeframes: options.marketTimeframes, adapterConfig: options.marketAdapterConfig })
    : null;
  if (marketEnabled && newsEnabled) {
    await delay(ALPHA_VANTAGE_INTER_REQUEST_DELAY_MS);
  }
  const newsResult = newsEnabled ? await loadLiveNewsData({ symbol, adapterConfig: options.newsAdapterConfig }) : null;
  return { marketResult, newsResult };
}

function rejectAmbiguousMerge(fieldName) {
  return failSafe(
    ERROR_CODES.MALFORMED_DATA,
    `${fieldName} was already supplied while its provider domain is enabled — ambiguous merge, refusing to guess which source should win.`
  );
}

// request: the same shape processRequest() already accepts.
// options.macro / options.market / options.news: each { enabled?: boolean }
//   — every domain is disabled unless enabled === true (frozen
//   default, mirrors FRED's own rule, applied independently per
//   domain — Step 46A).
// options.macroSeriesIds / options.macroAdapterConfig / options.macroComposeOptions:
//   forwarded to loadLiveMacroData(), identical to
//   fredMacroApplicationService.js's own options.
// options.marketAdapterConfig / options.newsAdapterConfig: forwarded
//   to the respective new live-source calls — production callers
//   never need these; they exist solely for offline test injection,
//   exactly mirroring every other layer in this project.
// options.marketTimeframes: forwarded verbatim to loadLiveMarketData()
//   (Step 103) — an array of timeframe labels, e.g. ["1day", "1week"].
//   Omitted entirely when not supplied, so loadLiveMarketData() applies
//   its own default (["1day"]) — the exact pre-Step-103 behavior.
async function runMarketIntelligenceRequest(request, options = {}) {
  const macroOptions = (options && options.macro) || {};
  const marketOptions = (options && options.market) || {};
  const newsOptions = (options && options.news) || {};

  const macroEnabled = macroOptions.enabled === true;
  const marketEnabled = marketOptions.enabled === true;
  const newsEnabled = newsOptions.enabled === true;

  // Ambiguous-merge guard (Step 46A, frozen): checked BEFORE any
  // network access, independently for every enabled domain — never a
  // silent overwrite, never a silent merge. loadLiveMacroData()/
  // loadLiveMarketData()/loadLiveNewsData() and processRequest() are
  // all skipped entirely when any of these trigger.
  if (macroEnabled && Array.isArray(request.macroData) && request.macroData.length > 0) {
    return { pipelineResult: rejectAmbiguousMerge("request.macroData"), diagnostics: null };
  }
  if (marketEnabled && Array.isArray(request.technicalCandles) && request.technicalCandles.length > 0) {
    return { pipelineResult: rejectAmbiguousMerge("request.technicalCandles"), diagnostics: null };
  }
  if (newsEnabled && Array.isArray(request.newsData) && request.newsData.length > 0) {
    return { pipelineResult: rejectAmbiguousMerge("request.newsData"), diagnostics: null };
  }

  if (!macroEnabled && !marketEnabled && !newsEnabled) {
    // No domain enabled: identical to calling processRequest() directly
    // — no provider is ever touched, request.* payloads (if any) pass
    // through untouched, same convention as FRED's own disabled path.
    const pipelineResult = processRequest(request);
    return { pipelineResult, diagnostics: null };
  }

  const seriesIds =
    Array.isArray(options.macroSeriesIds) && options.macroSeriesIds.length > 0 ? options.macroSeriesIds : DEFAULT_MACRO_SERIES_IDS;

  // Step 99 fix: resolve the ONE instrument this request is actually
  // about, centrally, once — never re-parsed per provider. macro is
  // never given a symbol at all (FRED's series are whole-economy
  // indicators, not instrument-specific — see fredMacroComposer.js;
  // macro records carry no `asset` field to mislabel). Only Alpha
  // Vantage's two instrument-specific domains (technical candles,
  // news) receive the resolved symbol; when the caller supplied no
  // explicit request.asset, this resolves to UNKNOWN and both
  // live-sources fall back to their own frozen SPY default —
  // preserving every existing SPY-only workflow exactly as before.
  const instrumentContext = resolveInstrumentContext(request);
  const resolvedSymbol = instrumentContext.normalizedSymbol !== INSTRUMENT_UNKNOWN ? instrumentContext.normalizedSymbol : undefined;

  // FRED (a separate provider/account, unaffected by Alpha Vantage's
  // limit) still acquires independently/concurrently. The two Alpha
  // Vantage domains, if both enabled, are acquired sequentially with
  // the fixed gap above (Step 48A) — never simultaneously. Either way,
  // everything enabled is fully resolved before the single
  // processRequest() call below; no race.
  const [macroResult, { marketResult, newsResult }] = await Promise.all([
    macroEnabled
      ? loadLiveMacroData(seriesIds, { adapterConfig: options.macroAdapterConfig, composeOptions: options.macroComposeOptions })
      : Promise.resolve(null),
    acquireAlphaVantage(marketEnabled, newsEnabled, options, resolvedSymbol),
  ]);

  // A fresh object built from the caller's request — the caller's own
  // request object is never mutated. Only enabled domains' keys are
  // set; a disabled domain's own caller-supplied payload (if any)
  // passes through untouched via the spread.
  const mergedRequest = { ...request };
  if (macroEnabled) mergedRequest.macroData = macroResult.macroData;
  if (marketEnabled) mergedRequest.technicalCandles = marketResult.technicalCandles;
  if (newsEnabled) mergedRequest.newsData = newsResult.newsData;

  // Exactly ONE processRequest() call for the whole composed run —
  // never one per provider (Step 46A hard invariant).
  const pipelineResult = processRequest(mergedRequest);

  const diagnostics = {
    // Exposed so a caller can see exactly which instrument context was
    // actually resolved and used for this run (Step 99) — never
    // reconstructed or re-guessed downstream from this diagnostic.
    instrument: instrumentContext,
    macro: macroEnabled ? { seriesResults: macroResult.seriesResults, warnings: macroResult.warnings } : null,
    // timeframeResults (Step 103): every timeframe this run actually
    // requested, each with its own explicit outcome — never collapsed
    // away, so a caller can always see exactly which timeframe(s) were
    // unavailable and why, without guessing from providerResult alone.
    market: marketEnabled
      ? { providerResult: marketResult.providerResult, timeframeResults: marketResult.timeframeResults, warnings: marketResult.warnings }
      : null,
    news: newsEnabled ? { providerResult: newsResult.providerResult, warnings: newsResult.warnings } : null,
  };

  return { pipelineResult, diagnostics };
}

module.exports = { runMarketIntelligenceRequest };
