// End-to-end tests for the full orchestrator pipeline
// (processRequest()), exercising all 8 real agents together with
// synthetic/internal fixture data only — no external API, no mocking
// of the agent modules themselves. Numbered comments match the 13
// required scenarios from the Step 12 spec's TESTING section.

const test = require("node:test");
const assert = require("node:assert/strict");
const { processRequest } = require("../orchestrator");

const THRESHOLDS = { freshMaxMs: 3_600_000, agingMaxMs: 86_400_000 }; // test-only values
const FULL_SIZING_PARAMS = { accountBalance: 10000, riskPercentage: 0.01, leverage: 1, entryPrice: 100, stopPrice: 95, contractSize: 1 };

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

// Hand-verified zigzag (same dataset used throughout the Technical
// Agent's own tests): produces real swing highs/lows, so Trade Setup
// Agent gets real (never invented) support/resistance levels to
// reference.
function zigzagCandles(asset = "BTC") {
  const prices = [100, 102, 104, 101, 99, 103, 107, 104, 100, 105, 110];
  return prices.map((p, i) => ({
    asset,
    timeframe: "1h",
    timestamp: iso(-(prices.length - 1 - i) * 3_600_000),
    open: p,
    high: p + 1,
    low: p - 1,
    close: p,
    source: "technical-src-A",
    classification: "FACT",
    verification_status: "VERIFIED_PRIMARY",
  }));
}

function bullishRequest(overrides = {}) {
  return {
    query: "Assess BTC",
    asset: "BTC",
    newsData: [
      {
        asset: "BTC",
        headline: "Regulator signals clearer path for crypto adoption",
        classification: "FACT",
        source: "news-src-A",
        publication_timestamp: iso(),
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
        release_timestamp: iso(),
        impact_direction: "POSITIVE",
        verification_status: "VERIFIED_PRIMARY",
      },
    ],
    technicalCandles: zigzagCandles(),
    sentimentData: [
      {
        asset: "BTC",
        sentiment: "BULLISH",
        classification: "FACT",
        source: "sentiment-src-A",
        timestamp: iso(),
        verification_status: "VERIFIED_PRIMARY",
      },
    ],
    options: {
      freshnessThresholds: THRESHOLDS,
      positionSizingParams: FULL_SIZING_PARAMS,
    },
    ...overrides,
  };
}

// 1. Valid request.
test("1. a valid request runs the full pipeline without error", () => {
  const result = processRequest(bullishRequest());
  assert.equal(result.ok, true);
  assert.equal(result.asset, "BTC");
  assert.equal(result.response.agent_name, "chief-trading-manager");
});

// 2. Missing asset.
test("2. a missing asset degrades gracefully — pipeline still completes, asset reads UNKNOWN, never guessed", () => {
  const request = bullishRequest();
  delete request.asset;
  for (const item of request.newsData) delete item.asset;
  for (const item of request.sentimentData) delete item.asset;
  for (const item of request.technicalCandles) delete item.asset;
  const result = processRequest(request);
  assert.equal(result.ok, true);
  assert.equal(result.asset, "UNKNOWN");
  assert.ok(result.warnings.some((w) => w.includes("No asset could be identified")));
});

// 3. Missing market data.
test("3. no request.marketData means the Data Controller simply does not run — never a hidden shortcut, never a fabricated result", () => {
  const result = processRequest(bullishRequest());
  assert.equal(result.pipeline_summary.data_controller_status, "NOT_RUN");
});

test("3b. request.marketData, when supplied, genuinely runs through the real Data Controller", () => {
  const request = bullishRequest({
    marketData: [{ asset: "BTC", data_type: "price", value: 50000, source: "market-src-A", classification: "FACT" }],
  });
  const result = processRequest(request);
  assert.notEqual(result.pipeline_summary.data_controller_status, "NOT_RUN");
});

// 4. Partial specialist failure.
test("4. one specialist receiving no usable data degrades to UNAVAILABLE without crashing the other 3 or the pipeline", () => {
  const request = bullishRequest({ macroData: [] });
  const result = processRequest(request);
  assert.equal(result.ok, true);
  assert.equal(result.response.macro_summary.bias, "UNKNOWN");
});

test("4b. the three unaffected specialists still contribute real evidence when one is empty", () => {
  const request = bullishRequest({ macroData: [] });
  const result = processRequest(request);
  assert.notEqual(result.response.news_summary.bias, "UNKNOWN");
  assert.notEqual(result.response.sentiment_summary.bias, "UNKNOWN");
});

// 5. Conflicting specialists.
test("5. News POSITIVE vs Macro NEGATIVE produces CONFLICTING_EVIDENCE all the way to the final report", () => {
  const request = bullishRequest();
  request.macroData[0].impact_direction = "NEGATIVE";
  const result = processRequest(request);
  assert.equal(result.response.final_assessment, "CONFLICTING_EVIDENCE");
  assert.ok(result.response.conflicting_evidence.length > 0);
});

// 6. Risk rejection.
test("6. enough simultaneous risk factors push the Risk Manager to RISK_TOO_HIGH, and the Chief Trading Manager must not override it", () => {
  const request = bullishRequest({
    upcomingEvents: [{ event: "CPI Release", scheduled_time: iso(3_600_000), source: "calendar-src-A" }],
  });
  request.macroData[0].impact_direction = "NEGATIVE"; // conflict with news -> CONFLICT_RISK + MARKET_RISK
  delete request.macroData[0].verification_status; // unverified input -> DATA_RISK
  delete request.options.positionSizingParams; // -> EXECUTION_RISK
  request.options.upcomingEventWindowMs = 86_400_000; // -> TIMING_RISK (event is 1h away, well within 24h)

  const result = processRequest(request);
  assert.equal(result.response.risk_summary.risk_decision, "RISK_TOO_HIGH");
  assert.equal(result.response.decision_status, "HIGH_RISK_REVIEW_REQUIRED");
  // The override must not depend on direction — final_assessment can be
  // anything, but decision_status is gated regardless.
});

// 7. Successful full pipeline.
test("7. a clean, fully-specified, agreeing request reaches TRADE_SETUP_SUPPORTED end to end", () => {
  const result = processRequest(bullishRequest());
  assert.equal(result.response.final_assessment, "BULLISH");
  assert.equal(result.response.trade_setup_summary.setup_status, "SETUP_PRESENT");
  assert.equal(result.response.risk_summary.risk_decision, "RISK_ACCEPTABLE");
  assert.equal(result.response.decision_status, "TRADE_SETUP_SUPPORTED");
});

// 8. Empty data.
test("8. a request with no data payloads at all still completes, reporting INSUFFICIENT_DATA rather than guessing", () => {
  const result = processRequest({ query: "Assess BTC", asset: "BTC" });
  assert.equal(result.ok, true);
  assert.equal(result.response.final_assessment, "INSUFFICIENT_DATA");
  assert.ok(result.warnings.some((w) => w.includes("No data payloads")));
});

// 9. Stale data.
test("9. a stale news timestamp is reflected in that specialist's own freshness state, never silently treated as fresh", () => {
  const request = bullishRequest();
  request.newsData[0].publication_timestamp = iso(-100_000_000); // ~27.8h — genuinely beyond the 24h (86_400_000ms) aging threshold
  const result = processRequest(request);
  assert.equal(result.ok, true);
  // Freshness is internal to the News Agent's validated records, not
  // re-exposed on the summary directly — assert no crash and that the
  // News Agent's own warnings (surfaced in the top-level response)
  // mention it.
  assert.ok(result.warnings.some((w) => (typeof w === "string" ? w.includes("STALE") : w.message && w.message.includes("STALE"))));
});

// 10. Unverified data.
test("10. a news item with no source is handled safely (forced UNVERIFIED), never fabricated, never crashes the pipeline", () => {
  const request = bullishRequest();
  delete request.newsData[0].source;
  const result = processRequest(request);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => typeof w === "string" && w.includes("Source not supplied")));
});

// 11. No fabricated fallback.
test("11. missing position-sizing parameters keep position_size as the UNKNOWN sentinel — never a guessed number", () => {
  const request = bullishRequest();
  delete request.options.positionSizingParams;
  const result = processRequest(request);
  assert.equal(result.response.risk_summary.position_size_status.position_size, "UNKNOWN");
});

test("11b. no technical candles keeps potential_levels empty, never an invented price level", () => {
  const request = bullishRequest();
  delete request.technicalCandles;
  const result = processRequest(request);
  assert.deepEqual(result.response.trade_setup_summary.potential_levels, []);
});

// 12. No external API.
test("12. the orchestrator module has no external API/provider integration — every dependency is a local project file", () => {
  const orchestratorSource = require("node:fs").readFileSync(require.resolve("../orchestrator/index.js"), "utf8");
  const requireLines = orchestratorSource.match(/require\("[^"]+"\)/g) || [];
  const external = requireLines.filter((line) => !/require\("(\.\.?\/|node:)/.test(line));
  assert.deepEqual(external, []);
});

// 13. No execution.
test("13. the orchestrator exposes no broker/exchange/order execution capability", () => {
  const orchestrator = require("../orchestrator");
  const exportedNames = Object.keys(orchestrator);
  assert.equal(exportedNames.some((n) => /broker|exchange|execute|placeOrder/i.test(n)), false);
});

test("a malformed (non-object) request is rejected safely, never crashes", () => {
  const result = processRequest("not-an-object");
  assert.equal(result.ok, false);
  assert.equal(result.response, null);
});

test("the full response is scanned for guarantee/execution language and finds none", () => {
  const result = processRequest(bullishRequest());
  const serialized = JSON.stringify(result).toLowerCase();
  assert.ok(!serialized.includes("guarantee"));
  assert.ok(!/"buy"|"sell"|"long"|"short"/.test(serialized));
});
