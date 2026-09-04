// Integration-level tests for the News Agent pipeline, numbered to
// match the 18 required test scenarios from the Step 5 spec.

const test = require("node:test");
const assert = require("node:assert/strict");
const newsAgent = require("./index");
const { processNews, runNewsAgent, NEWS_AGENT_STATUS } = newsAgent;

const THRESHOLDS = { freshMaxMs: 60_000, agingMaxMs: 600_000 }; // test-only values

function baseItem(overrides = {}) {
  return {
    headline: "Central bank holds interest rates steady",
    summary: "The central bank announced no change to its policy rate.",
    source: "internal-test-source",
    source_type: "official-statement",
    publication_timestamp: new Date().toISOString(),
    classification: "FACT",
    category: "monetary-policy",
    related_assets: ["USD"],
    ...overrides,
  };
}

// 1. Valid news item accepted.
test("1. a valid news item is accepted and marked SUCCESS", () => {
  const result = processNews([baseItem()], { freshnessThresholds: THRESHOLDS, requestedAsset: "USD" });
  assert.equal(result.agent_status, NEWS_AGENT_STATUS.SUCCESS);
  assert.equal(result.validated_items.length, 1);
});

// 2. Missing headline rejected.
test("2. an item missing a headline is rejected, not silently accepted", () => {
  const item = baseItem();
  delete item.headline;
  const result = processNews([item], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_items.length, 0);
  assert.equal(result.rejected_items.length, 1);
  assert.equal(result.agent_status, NEWS_AGENT_STATUS.FAILED);
});

// 3. Missing source handled safely.
test("3. an item missing its source is still processed, forced to UNVERIFIED, with a warning", () => {
  const item = baseItem();
  delete item.source;
  const result = processNews([item], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_items.length, 1);
  assert.equal(result.validated_items[0].verification_status, "UNVERIFIED");
  assert.ok(result.warnings.some((w) => typeof w === "string" && w.includes("Source not supplied")));
});

// 4. Missing publication timestamp becomes UNKNOWN.
test("4. an item with no publication_timestamp gets freshness_status UNKNOWN, not a guess", () => {
  const item = baseItem();
  delete item.publication_timestamp;
  const result = processNews([item], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_items[0].freshness_status, "UNKNOWN");
});

// 5. Unverified news remains UNVERIFIED.
test("5. a single, uncorroborated news item remains UNVERIFIED", () => {
  const result = processNews([baseItem()], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_items[0].verification_status, "UNVERIFIED");
});

// 6. Forecast remains FORECAST.
test("6. a FORECAST item's classification is never changed", () => {
  const result = processNews([baseItem({ classification: "FORECAST" })], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_items[0].classification, "FORECAST");
});

// 7. Scenario remains SCENARIO.
test("7. a SCENARIO item's classification is never changed", () => {
  const result = processNews([baseItem({ classification: "SCENARIO" })], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_items[0].classification, "SCENARIO");
});

// 8. Market expectation remains MARKET_EXPECTATION.
test("8. a MARKET_EXPECTATION item's classification is never changed", () => {
  const result = processNews([baseItem({ classification: "MARKET_EXPECTATION" })], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_items[0].classification, "MARKET_EXPECTATION");
});

// 9. Conflicting reports are detected.
test("9. two disagreeing reports about a likely-same event are flagged CONFLICTING, both preserved", () => {
  const a = baseItem({
    headline: "Company announces positive earnings",
    source: "source-A",
    category: "earnings",
    related_assets: ["ACME"],
    impact_direction: "POSITIVE",
  });
  const b = baseItem({
    headline: "Company reportedly missed expectations",
    source: "source-B",
    category: "earnings",
    related_assets: ["ACME"],
    impact_direction: "NEGATIVE",
  });
  const result = processNews([a, b], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.agent_status, NEWS_AGENT_STATUS.CONFLICTING);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.validated_items.length, 2);
});

// 10. Duplicate stories are detected without deleting original records.
test("10. likely-duplicate stories are grouped, and both original records are preserved", () => {
  const a = baseItem({ headline: "Fed holds rates steady", source: "source-A" });
  const b = baseItem({ headline: "Fed keeps interest rates unchanged", source: "source-B" });
  const result = processNews([a, b], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.validated_items.length, 2);
});

// 11. Relevant news is identified.
test("11. news directly naming the requested asset is marked DIRECT relevance", () => {
  const result = processNews([baseItem()], { freshnessThresholds: THRESHOLDS, requestedAsset: "USD" });
  assert.equal(result.validated_items[0].relevance, "DIRECT");
});

// 12. Irrelevant news is identified.
test("12. news with no meaningful connection to the requested asset is marked LOW_RELEVANCE", () => {
  const item = baseItem({ related_assets: ["EUR"], category: "sports" });
  const result = processNews([item], { freshnessThresholds: THRESHOLDS, requestedAsset: "USD" });
  assert.equal(result.validated_items[0].relevance, "LOW_RELEVANCE");
});

// 13. Missing news data returns NEWS DATA UNAVAILABLE.
test("13. no input data returns UNAVAILABLE with a NEWS DATA UNAVAILABLE warning", () => {
  const result = processNews([]);
  assert.equal(result.agent_status, NEWS_AGENT_STATUS.UNAVAILABLE);
  assert.ok(result.warnings.some((w) => w.includes("NEWS DATA UNAVAILABLE")));
});

// 14. News Agent never creates a trading recommendation.
test("14. the News Summary has no recommendation_type field at all", () => {
  const { report } = runNewsAgent([baseItem()], { freshnessThresholds: THRESHOLDS, requestedAsset: "USD" });
  assert.equal("recommendation_type" in report, false);
});

// 15. News bias is separated from trading recommendation.
test("15. overall_news_bias is an evidence label, not a trading instruction", () => {
  const { report } = runNewsAgent([baseItem({ impact_direction: "POSITIVE" })], {
    freshnessThresholds: THRESHOLDS,
    requestedAsset: "USD",
  });
  assert.ok(["BULLISH", "BEARISH", "MIXED", "NEUTRAL", "UNKNOWN"].includes(report.overall_news_bias));
  assert.equal("recommendation_type" in report, false);
});

// 16. Missing source is never fabricated.
test("16. an item with no source keeps source as the UNKNOWN sentinel, never a guessed name", () => {
  const item = baseItem();
  delete item.source;
  const result = processNews([item], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_items[0].source, "UNKNOWN");
});

// 17. Missing URL is never fabricated.
test("17. an item with no url_or_reference keeps it as the UNKNOWN sentinel", () => {
  const result = processNews([baseItem()], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_items[0].url_or_reference, "UNKNOWN");
});

// 18. News Agent does not claim live access without a real provider.
test("18. the module exposes no live-fetch / external-access capability to claim", () => {
  const exportedNames = Object.keys(newsAgent).sort();
  assert.deepEqual(exportedNames, ["NEWS_AGENT_STATUS", "processNews", "runNewsAgent"].sort());
});

test("a provider failSafe()-shaped error passed as input is handled, not crashed on", () => {
  const providerError = { ok: false, code: "API_UNAVAILABLE", message: "no provider connected", details: {} };
  const result = processNews(providerError);
  assert.equal(result.agent_status, NEWS_AGENT_STATUS.UNAVAILABLE);
});

test("a non-array top-level input is rejected as FAILED", () => {
  const result = processNews("not-an-array");
  assert.equal(result.agent_status, NEWS_AGENT_STATUS.FAILED);
});

// --- Step 3A: LOW_RELEVANCE items never participate in conflict detection ---

// A. A LOW_RELEVANCE article that would otherwise create a false
// conflict (it shares a tagged asset + category with a genuinely
// relevant article, purely coincidentally) no longer does.
test("A. a LOW_RELEVANCE article that would otherwise create a false conflict does not appear in conflicting_reports", () => {
  const direct = baseItem({
    headline: "Fed signals rate policy shift",
    source: "source-A",
    category: "monetary-policy",
    related_assets: ["USD", "SPYUSDT"],
    impact_direction: "POSITIVE",
  });
  const lowRelevance = baseItem({
    headline: "Crypto pair SPYUSDT sees volatility",
    source: "source-B",
    category: "monetary-policy",
    related_assets: ["SPYUSDT"], // shares "SPYUSDT" + category with `direct`, but never the requested asset
    impact_direction: "NEGATIVE",
  });
  const result = processNews([direct, lowRelevance], { freshnessThresholds: THRESHOLDS, requestedAsset: "USD" });
  assert.equal(result.validated_items.find((i) => i.headline === lowRelevance.headline).relevance, "LOW_RELEVANCE");
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.agent_status, NEWS_AGENT_STATUS.SUCCESS); // never CONFLICTING
});

// B. A genuine conflict between two relevant (DIRECT) articles is
// still detected — the narrowing must never hide a real conflict.
test("B. a genuine conflict between two DIRECT-relevance articles about the requested asset is still detected", () => {
  const a = baseItem({
    headline: "Company announces positive earnings",
    source: "source-A",
    category: "earnings",
    related_assets: ["ACME"],
    impact_direction: "POSITIVE",
  });
  const b = baseItem({
    headline: "Company reportedly missed expectations",
    source: "source-B",
    category: "earnings",
    related_assets: ["ACME"],
    impact_direction: "NEGATIVE",
  });
  const result = processNews([a, b], { freshnessThresholds: THRESHOLDS, requestedAsset: "ACME" });
  assert.equal(result.validated_items[0].relevance, "DIRECT");
  assert.equal(result.validated_items[1].relevance, "DIRECT");
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.agent_status, NEWS_AGENT_STATUS.CONFLICTING);
});

// C. LOW_RELEVANCE articles are never dropped from the underlying data
// — only excluded from conflict-detection participation.
test("C. LOW_RELEVANCE articles remain present in validated_items and the report's news_items, never dropped", () => {
  const direct = baseItem({ related_assets: ["USD"], impact_direction: "POSITIVE" });
  const lowRelevance = baseItem({ headline: "Unrelated sports story", category: "sports", related_assets: ["EUR"] });
  const { result, report } = runNewsAgent([direct, lowRelevance], { freshnessThresholds: THRESHOLDS, requestedAsset: "USD" });
  assert.equal(result.validated_items.length, 2);
  assert.equal(report.news_items.length, 2);
  assert.ok(report.news_items.some((i) => i.relevance === "LOW_RELEVANCE"));
});

// D. Existing behavior for an ordinary, single relevant item is
// completely unchanged by this narrowing.
test("D. existing behavior for a single relevant (DIRECT) item is completely unchanged", () => {
  const result = processNews([baseItem()], { freshnessThresholds: THRESHOLDS, requestedAsset: "USD" });
  assert.equal(result.agent_status, NEWS_AGENT_STATUS.SUCCESS);
  assert.equal(result.validated_items.length, 1);
  assert.equal(result.validated_items[0].relevance, "DIRECT");
  assert.equal(result.conflicts.length, 0);
});
