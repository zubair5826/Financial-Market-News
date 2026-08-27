// Alpha Vantage Rate-Limit Protection — extracted from
// marketIntelligenceApplicationService.js in Step 103 so more than one
// module can share the exact same, single fixed gap.
//
// Step 48 discovered, live, that Alpha Vantage's free-tier key enforces
// a real "1 request per second" burst limit. Step 48A froze the fix: any
// two sequential requests against the SAME Alpha Vantage account must be
// separated by this fixed gap — not a retry, not a general-purpose rate
// limiter, not a configurable/public option. 1100ms is a small
// deterministic margin over the provider's documented 1000ms boundary.
//
// Originally this only separated the market and news requests
// (marketIntelligenceApplicationService.js's acquireAlphaVantage()).
// Step 103 needed the identical protection a second place — between
// successive per-timeframe market requests within
// alphaVantageMarketLiveSource.js itself, once that file could request
// more than one timeframe per call — so the single constant and helper
// live here now, imported by both, rather than duplicated (and risking
// the two copies drifting apart).

const ALPHA_VANTAGE_INTER_REQUEST_DELAY_MS = 1100;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { ALPHA_VANTAGE_INTER_REQUEST_DELAY_MS, delay };
