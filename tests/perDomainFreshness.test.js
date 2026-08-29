// Step 106 — per-domain freshness thresholds.
//
// Before this step every specialist in a run shared ONE
// { freshMaxMs, agingMaxMs } pair, because orchestrator/index.js hands
// all four the same options object. app.js filled that single pair
// from the MACRO policy (30 days fresh / 120 days aging), which is
// correct for a FRED release and badly wrong for a news headline: a
// three-week-old article was reported FRESH. config/freshness.js
// already defined the right window per domain — nothing carried it to
// the right agent.
//
// Every test here is synthetic and offline: no provider, no network,
// no credentials.

const test = require("node:test");
const assert = require("node:assert/strict");

const { optionsForDomain, processRequest } = require("../orchestrator");
const { FRESHNESS_POLICY, getFreshnessThresholdsByPipelineDomain } = require("../config/freshness");
const { ERROR_CODES } = require("../core/errors");
const { FRESHNESS_STATES } = require("../core/freshness");

const DAY_MS = 24 * 60 * 60 * 1000;
const THREE_WEEKS_AGO = () => new Date(Date.now() - 21 * DAY_MS).toISOString();

function staleNewsRequest(options) {
  return {
    query: "Assess BTC",
    asset: "BTC",
    newsData: [
      {
        asset: "BTC",
        headline: "Three-week-old headline",
        classification: "FACT",
        source: "news-src-A",
        publication_timestamp: THREE_WEEKS_AGO(),
        impact_direction: "POSITIVE",
        verification_status: "VERIFIED_PRIMARY",
      },
    ],
    macroData: [
      {
        indicator: "CPI",
        classification: "FACT",
        country: "US",
        category: "INFLATION",
        source: "macro-src-A",
        release_timestamp: THREE_WEEKS_AGO(),
        impact_direction: "POSITIVE",
        verification_status: "VERIFIED_PRIMARY",
      },
    ],
    options,
  };
}

function staleWarningsFor(result) {
  return result.warnings.filter((w) => w && typeof w === "object" && w.code === ERROR_CODES.STALE_DATA);
}

// --- optionsForDomain(), in isolation ---

test("106-5. with no per-domain map, the shared options object is passed through completely untouched", () => {
  const shared = { freshnessThresholds: { freshMaxMs: 10, agingMaxMs: 20 }, positionSizingParams: {} };
  assert.equal(optionsForDomain(shared, "news"), shared);
});

test("106-6. a domain present in the map receives exactly that domain's window", () => {
  const shared = { freshnessThresholdsByDomain: getFreshnessThresholdsByPipelineDomain() };
  assert.equal(optionsForDomain(shared, "news").freshnessThresholds, FRESHNESS_POLICY.news);
  assert.equal(optionsForDomain(shared, "macro").freshnessThresholds, FRESHNESS_POLICY.macro);
  assert.equal(optionsForDomain(shared, "technical").freshnessThresholds, FRESHNESS_POLICY.market);
});

test("106-7. a domain absent from the map gets undefined (honest UNKNOWN), never another domain's window", () => {
  const shared = {
    freshnessThresholds: FRESHNESS_POLICY.macro,
    freshnessThresholdsByDomain: getFreshnessThresholdsByPipelineDomain(),
  };
  assert.equal(optionsForDomain(shared, "sentiment").freshnessThresholds, undefined);
  assert.equal(optionsForDomain(shared, "marketData").freshnessThresholds, undefined);
});

test("106-8. optionsForDomain never mutates the options object it is given", () => {
  const shared = Object.freeze({ freshnessThresholdsByDomain: getFreshnessThresholdsByPipelineDomain(), other: 1 });
  const derived = optionsForDomain(shared, "news");
  assert.notEqual(derived, shared);
  assert.equal(shared.freshnessThresholds, undefined);
  assert.equal(derived.other, 1);
});

// --- End to end through the real pipeline ---

// The exact defect, reproduced: one shared macro-sized window makes a
// three-week-old headline look FRESH.
test("106-9. a single shared macro window wrongly reports a three-week-old headline as FRESH", () => {
  const result = processRequest(staleNewsRequest({ freshnessThresholds: FRESHNESS_POLICY.macro }));
  assert.equal(result.ok, true);
  assert.equal(staleWarningsFor(result).length, 0, "reproduces the pre-Step-106 behavior");
});

test("106-10. with per-domain windows, the same three-week-old headline is STALE while the macro release stays FRESH", () => {
  const result = processRequest(
    staleNewsRequest({
      freshnessThresholds: FRESHNESS_POLICY.macro,
      freshnessThresholdsByDomain: getFreshnessThresholdsByPipelineDomain(),
    })
  );

  assert.equal(result.ok, true);

  const stale = staleWarningsFor(result);
  assert.equal(stale.length, 1, "exactly the news record is stale");
  assert.match(stale[0].message, /Three-week-old headline/);

  // The macro record, measured against its own 30-day window, is
  // correctly still FRESH — the fix must not simply make everything
  // stale.
  const macroSummary = result.response.macro_summary;
  assert.ok(macroSummary, "macro report present");
  assert.equal(
    result.warnings.some((w) => w && typeof w === "object" && String(w.message || "").includes("CPI")),
    false,
    "the macro release must not be flagged stale under its own window"
  );
});

test("106-11. a domain with no policy entry reports UNKNOWN freshness rather than borrowing another domain's window", () => {
  const request = {
    query: "Assess BTC",
    asset: "BTC",
    sentimentData: [
      {
        asset: "BTC",
        sentiment: "BULLISH",
        classification: "FACT",
        source: "sentiment-src-A",
        timestamp: THREE_WEEKS_AGO(),
        verification_status: "VERIFIED_PRIMARY",
      },
    ],
    options: {
      freshnessThresholds: FRESHNESS_POLICY.macro,
      freshnessThresholdsByDomain: getFreshnessThresholdsByPipelineDomain(),
    },
  };

  const result = processRequest(request);
  assert.equal(result.ok, true);
  assert.equal(staleWarningsFor(result).length, 0);
  assert.equal(
    result.warnings.some((w) => typeof w === "string" && w.toUpperCase().includes(FRESHNESS_STATES.UNKNOWN)),
    true,
    "an unconfigured domain surfaces an explicit UNKNOWN-freshness warning"
  );
});
