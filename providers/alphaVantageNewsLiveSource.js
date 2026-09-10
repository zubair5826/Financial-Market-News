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

// --- Step 107: provider-scored relevance filter ---
//
// Alpha Vantage tags an article with a ticker whenever that ticker is
// mentioned at all. In production this returned, for a SPY request,
// tokenized-SPY product listings, currency-conversion pages,
// fund-holdings-history pages and unrelated SPY derivatives — every one
// of them tagged "SPY", and therefore every one of them scored DIRECT
// relevance by agents/news-agent/relevance.js, whose only test is
// whether related_assets names the requested asset.
//
// The provider already publishes its own answer to "how much is this
// article actually about this ticker": ticker_sentiment[].relevance_score,
// a 0.0-1.0 value the adapter already preserves verbatim at
// evidence.alpha_vantage_ticker_sentiment.relevance_score. Until now
// nothing read it back. This filter reads it — and nothing else. No
// keyword list, no headline-text rule, no NLP judgment is introduced
// here; that would be exactly the kind of invented rule this project
// refuses to make (see agents/news-agent/duplicates.js's own reasoning).
//
// THRESHOLD: 0.3, raised from the initial conservative 0.1 by project-owner
// decision after the first live production run. 0.1 removed only the
// clearly-irrelevant tail; 0.3 also removes the weak-mention band, where an
// article names the ticker without being about it. This is a deliberate
// trade: it discards more genuine but marginal broad-market coverage in
// exchange for a cleaner feed. See the module note below on what that costs.
//
// A record with NO usable relevance_score is never filtered BY SCORE.
// Absence of provider tagging is not evidence of irrelevance, the same rule
// the requested-ticker confirmation below already follows. Such a record can
// still be excluded by the explicit page-type patterns (Step 108).
const MIN_TICKER_RELEVANCE_SCORE = 0.3;

// Returns the provider's numeric relevance score for a mapped record, or
// null when the record carries no usable score. Never coerces a missing,
// blank or non-numeric value into 0 — that would silently turn "unknown"
// into "irrelevant" and drop the record.
function readTickerRelevanceScore(record) {
  const sentiment = record && record.evidence && record.evidence.alpha_vantage_ticker_sentiment;
  if (!sentiment || typeof sentiment !== "object") return null;
  const raw = sentiment.relevance_score;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

// --- Step 108: explicit non-news page-type exclusions ---
//
// A SECOND, NARROWER filter, added by project-owner decision after the first
// live production run showed that Alpha Vantage's NEWS_SENTIMENT feed carries
// entries that are not news articles at all — they are reference/utility
// pages that merely mention the ticker: currency-conversion tables, tokenized
// -product listings, fund holdings-history pages, price-prediction pages, and
// pages from venues that publish these in bulk.
//
// SCOPE, deliberately narrow. Each pattern below identifies a PAGE TYPE by
// its title/URL/source shape. None of them reads an article's meaning, tone,
// sentiment or subject matter — that judgment stays exactly where it already
// lives (the provider's own tagging), and this project still never infers
// impact or relevance from headline wording. This is closer to a robots/
// content-type filter than to an editorial one.
//
// KNOWN COST, accepted with the decision: a title-shaped rule cannot
// distinguish a price-prediction PAGE from a genuine article that happens to
// discuss a price forecast. Every pattern here can produce a false exclusion.
// That is why each match is counted and attributed by name in
// relevanceFilter.patternCounts below — so a pattern that starts eating real
// coverage is visible in diagnostics rather than silently discarding it.
//
// Patterns are matched case-insensitively against the record's headline, URL
// and source combined. Anchored to distinctive multi-word/structural shapes
// rather than bare keywords, so a normal news headline that merely uses one
// of these words is not caught.
const NON_NEWS_PATTERNS = Object.freeze([
  // "SPY to USD", "Convert 1 SPY to EUR", "... currency conversion rates",
  // and /convert/ URL paths. Requires the ticker-to-currency shape or an
  // explicit conversion phrase — never a bare currency code.
  {
    name: "currency_conversion",
    pattern:
      /(currency[- ]conversion|conversion rate|exchange rate calculator|\bconvert\s+[\w.$]{1,12}\s+to\b|\b[\w.$]{1,8}\s+to\s+(usd|eur|gbp|jpy|inr|cad|aud|chf|cny|brl|mxn|krw|sgd|hkd)\b|\/convert\/|\/currency-conver)/,
  },
  // Tokenized / wrapped equity products tracking the ticker.
  {
    name: "tokenized_product",
    // The optional {0,2} word gap lets a ticker sit between the qualifier and
    // the instrument word ("wrapped SPY ETF"), without letting the two halves
    // drift arbitrarily far apart in an unrelated sentence.
    pattern:
      /(tokeni[sz](e|ed|es|ing|ation)|security token|\b(wrapped|on-chain)\s+([\w.$]{1,8}\s+){0,2}(stocks?|equit(y|ies)|shares?|etfs?)\b)/,
  },
  // Fund/institutional holdings-history reference pages.
  {
    name: "holdings_history",
    pattern: /(holdings?[- ]history|history of holdings|\bportfolio holdings\b|\/holdings[-\/]|position history)/,
  },
  // Price-prediction / forecast-for-YEAR pages.
  {
    name: "price_prediction",
    pattern: /(price prediction|price forecast|stock forecast|\b(prediction|forecast)s?\s+(for\s+)?20\d\d\b|\bwhere will .+ be in 20\d\d|\/price-prediction)/,
  },
  // Backpack Securities / Backpack Exchange listing pages.
  {
    name: "backpack_securities",
    pattern: /(backpack\s+(securities|exchange)|\bbackpack\.exchange\b|\/backpack[-\/])/,
  },
]);

// The text a page-type pattern is matched against: headline, URL and source
// together, lowercased. Source is included because some exclusions
// (backpack_securities) are venue-level rather than title-level. UNKNOWN
// placeholders contribute nothing.
function nonNewsHaystack(record) {
  if (!record || typeof record !== "object") return "";
  return [record.headline, record.url_or_reference, record.source]
    .filter((value) => typeof value === "string" && value && value !== "UNKNOWN")
    .join(" \n ")
    .toLowerCase();
}

// Returns the NAME of the first matching non-news page-type pattern, or null
// when the record does not look like one of those page types. Returning the
// name (never just a boolean) is what lets diagnostics attribute every
// pattern exclusion to the specific rule that caused it.
function matchNonNewsPattern(record) {
  const haystack = nonNewsHaystack(record);
  if (!haystack) return null;
  for (const { name, pattern } of NON_NEWS_PATTERNS) {
    if (pattern.test(haystack)) return name;
  }
  return null;
}

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

  // Steps 107/108: the two-stage relevance filter, applied AFTER the
  // requested-ticker confirmation above so that check still sees the whole
  // feed exactly as before, and BEFORE anything downstream sees a record.
  // Nothing is rewritten, rescored or merged — a record is either passed
  // through byte-for-byte or excluded, counted, and attributed.
  //
  // ORDER: page-type patterns run FIRST, and apply to every record whether or
  // not it carries a usable relevance_score — a currency-conversion page is
  // not news at any score. The numeric threshold runs SECOND and, as before,
  // only ever excludes a record that actually has a score to judge.
  const retained = [];
  const patternCounts = {};
  let filteredByPattern = 0;
  let filteredByThreshold = 0;

  for (const record of records) {
    const patternName = matchNonNewsPattern(record);
    if (patternName) {
      filteredByPattern += 1;
      patternCounts[patternName] = (patternCounts[patternName] || 0) + 1;
      continue;
    }

    const score = readTickerRelevanceScore(record);
    if (score !== null && score < MIN_TICKER_RELEVANCE_SCORE) {
      filteredByThreshold += 1;
      continue;
    }

    retained.push(record);
  }

  const filteredCount = filteredByPattern + filteredByThreshold;

  // Never silent: every exclusion is reported as a count in warnings (which
  // marketIntelligenceApplicationService.js already surfaces as
  // diagnostics.news.warnings) and in the relevanceFilter field below, with
  // the two stages reported separately so it is always clear WHICH rule
  // removed a record. Headlines are deliberately not listed — the counts are
  // the operational fact; the full feed is one provider call away if an
  // operator needs to inspect it.
  const warnings = [];
  if (filteredByThreshold > 0) {
    warnings.push(
      `Alpha Vantage news relevance filter: ${filteredByThreshold} of ${records.length} record(s) excluded for "${tickers}" — provider ticker relevance_score below ${MIN_TICKER_RELEVANCE_SCORE}.`
    );
  }
  if (filteredByPattern > 0) {
    const breakdown = Object.keys(patternCounts)
      .sort()
      .map((name) => `${name}=${patternCounts[name]}`)
      .join(", ");
    warnings.push(
      `Alpha Vantage news page-type filter: ${filteredByPattern} of ${records.length} record(s) excluded for "${tickers}" — non-news page types (${breakdown}).`
    );
  }

  return {
    newsData: retained,
    providerResult: { ok: true, recordCount: retained.length },
    warnings,
    // Additive diagnostic field — no existing caller reads it, and every
    // pre-existing field above keeps its exact shape. `filtered` remains the
    // combined total; the per-stage counts are additive alongside it.
    relevanceFilter: {
      threshold: MIN_TICKER_RELEVANCE_SCORE,
      examined: records.length,
      filtered: filteredCount,
      filteredByThreshold,
      filteredByPattern,
      patternCounts,
      retained: retained.length,
    },
  };
}

module.exports = {
  loadLiveNewsData,
  MIN_TICKER_RELEVANCE_SCORE,
  readTickerRelevanceScore,
  NON_NEWS_PATTERNS,
  matchNonNewsPattern,
};
