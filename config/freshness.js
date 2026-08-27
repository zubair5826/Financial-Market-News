// Centralized Freshness Policy — Step 100. The ONE authoritative source
// for the { freshMaxMs, agingMaxMs } thresholds core/freshness.js's
// computeFreshness() needs. Before this file existed, only runDemo.js
// (illustrative, synthetic-data-only) supplied any threshold at all —
// every real production entrypoint ran with no threshold configured,
// so freshness silently stayed UNKNOWN and stale-data risk could never
// be detected. Every production entrypoint must source its
// options.freshnessThresholds from here — never invent or duplicate a
// threshold value elsewhere.
//
// Values below were chosen only after inspecting this repository's
// ACTUAL provider timestamp fields and data-frequency — never invented
// arbitrarily:
//
//   - market (Alpha Vantage TIME_SERIES_DAILY -> candle.timestamp, a
//     date string; providers/adapters/alphaVantageMarketAdapter.js
//     produces exactly one new value per trading day). fresh = within
//     the current trading day (24h); aging = up to 4 days, covering a
//     weekend/holiday gap without falsely calling Friday's still-latest
//     close "stale" on Monday morning; stale = beyond that.
//
//   - news (Alpha Vantage NEWS_SENTIMENT -> publication_timestamp, a
//     real per-article publish datetime;
//     providers/adapters/alphaVantageNewsAdapter.js maps Alpha
//     Vantage's own time_published field directly, never a fabricated
//     one). News for trading purposes ages fast: fresh = within 1
//     hour; aging = up to 24 hours; stale = beyond that.
//
//   - macro (FRED -> release_timestamp): FRED supplies NO genuine
//     publication timestamp at all. providers/adapters/fredMacroAdapter.js
//     deliberately, permanently leaves release_timestamp UNKNOWN
//     (frozen: Step 16C, reaffirmed Step 18) rather than derive one
//     from realtime_start/realtime_end/period/retrieved_timestamp —
//     doing so would be exactly the kind of fabrication this project
//     refuses to do. A threshold is still defined here for the general
//     macro-domain contract (any macro record that DOES carry a real
//     release_timestamp — a future provider, or a test fixture built
//     with one), but IT CAN NEVER MAKE FRED'S OWN LIVE DATA SHOW
//     ANYTHING BUT UNKNOWN FRESHNESS. That is correct, honest, frozen
//     behavior — not a gap this file is able to close, and not
//     something a future change should try to work around by inventing
//     a timestamp FRED never provided. The macro default series in
//     this system (GNPCA) is released on a slow, non-daily cadence, so
//     a much longer window than market/news is used here: fresh =
//     within 30 days; aging = up to 120 days.
//
// These are disclosed, reasoned defaults — not empirically calibrated
// against real production traffic (see README.md's Known Limitations)
// — and may be revised if real usage shows they need adjustment.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const FRESHNESS_POLICY = Object.freeze({
  market: Object.freeze({ freshMaxMs: DAY_MS, agingMaxMs: 4 * DAY_MS }),
  news: Object.freeze({ freshMaxMs: HOUR_MS, agingMaxMs: DAY_MS }),
  macro: Object.freeze({ freshMaxMs: 30 * DAY_MS, agingMaxMs: 120 * DAY_MS }),
});

// domain: "market" | "news" | "macro". Returns the frozen thresholds
// for that domain, or undefined for any other value — never a guessed
// fallback for a domain this policy doesn't explicitly define.
function getFreshnessThresholds(domain) {
  return FRESHNESS_POLICY[domain];
}

module.exports = { FRESHNESS_POLICY, getFreshnessThresholds };
