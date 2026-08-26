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

const DEFAULT_MACRO_SERIES_IDS = ["GNPCA"];

// Step 48 discovered, live, that Alpha Vantage's free-tier key enforces
// a real "1 request per second" burst limit — launching the market and
// news requests at the same instant (the original Promise.all-of-three
// design) reliably triggers it, since both share one account. Step 48A
// froze the fix: the two Alpha Vantage calls must be sequential, with
// this fixed, single-purpose gap between them — not a retry, not a
// general-purpose rate limiter, not a configurable/public option (see
// module header). 1100ms is a small deterministic margin over the
// provider's documented 1000ms boundary. FRED is unaffected (separate
// account) and is never delayed.
const ALPHA_VANTAGE_INTER_REQUEST_DELAY_MS = 1100;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sequential Alpha Vantage acquisition (Step 48A): market first, then
// — ONLY when both domains are enabled — the fixed gap above, then
// news. A single-domain call never waits at all.
async function acquireAlphaVantage(marketEnabled, newsEnabled, options) {
  const marketResult = marketEnabled ? await loadLiveMarketData({ adapterConfig: options.marketAdapterConfig }) : null;
  if (marketEnabled && newsEnabled) {
    await delay(ALPHA_VANTAGE_INTER_REQUEST_DELAY_MS);
  }
  const newsResult = newsEnabled ? await loadLiveNewsData({ adapterConfig: options.newsAdapterConfig }) : null;
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
    acquireAlphaVantage(marketEnabled, newsEnabled, options),
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
    macro: macroEnabled ? { seriesResults: macroResult.seriesResults, warnings: macroResult.warnings } : null,
    market: marketEnabled ? { providerResult: marketResult.providerResult, warnings: marketResult.warnings } : null,
    news: newsEnabled ? { providerResult: newsResult.providerResult, warnings: newsResult.warnings } : null,
  };

  return { pipelineResult, diagnostics };
}

module.exports = { runMarketIntelligenceRequest };
