// Integration-level tests for the Sentiment Agent pipeline, numbered to
// match the 20 required test scenarios from the Step 8 spec.

const test = require("node:test");
const assert = require("node:assert/strict");
const sentimentAgent = require("./index");
const { processSentimentData, runSentimentAgent, SENTIMENT_AGENT_STATUS } = sentimentAgent;

const THRESHOLDS = { freshMaxMs: 3_600_000, agingMaxMs: 86_400_000 }; // test-only values

function baseRecord(overrides = {}) {
  return {
    asset: "BTC",
    timestamp: new Date().toISOString(),
    source: "internal-test-source",
    source_type: "SOCIAL_MEDIA",
    sentiment: "BULLISH",
    classification: "FACT",
    ...overrides,
  };
}

// 1. Valid sentiment accepted.
test("1. a valid sentiment record is accepted and marked SUCCESS", () => {
  const result = processSentimentData([baseRecord()], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.agent_status, SENTIMENT_AGENT_STATUS.SUCCESS);
  assert.equal(result.validated_records.length, 1);
});

// 2. Missing asset rejected.
test("2. a record missing its asset is rejected, not silently accepted", () => {
  const record = baseRecord();
  delete record.asset;
  const result = processSentimentData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records.length, 0);
  assert.equal(result.rejected_records.length, 1);
  assert.equal(result.agent_status, SENTIMENT_AGENT_STATUS.FAILED);
});

// 3. Missing source handled safely.
test("3. a record missing its source is still processed, forced to UNVERIFIED, with a warning", () => {
  const record = baseRecord();
  delete record.source;
  const result = processSentimentData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records.length, 1);
  assert.equal(result.validated_records[0].verification_status, "UNVERIFIED");
  assert.ok(result.warnings.some((w) => typeof w === "string" && w.includes("Source not supplied")));
});

// 4. Missing timestamp -> UNKNOWN freshness.
test("4. a record with no timestamp gets freshness_status UNKNOWN, not a guess", () => {
  const record = baseRecord();
  delete record.timestamp;
  const result = processSentimentData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].freshness_status, "UNKNOWN");
});

// 5. Unverified sentiment remains UNVERIFIED.
test("5. a single, uncorroborated sentiment record remains UNVERIFIED", () => {
  const result = processSentimentData([baseRecord()], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].verification_status, "UNVERIFIED");
});

// 6. Forecast remains FORECAST.
test("6. a FORECAST record's classification is never changed", () => {
  const result = processSentimentData([baseRecord({ classification: "FORECAST" })], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].classification, "FORECAST");
});

// 7. Scenario remains SCENARIO.
test("7. a SCENARIO record's classification is never changed", () => {
  const result = processSentimentData([baseRecord({ classification: "SCENARIO" })], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].classification, "SCENARIO");
});

// 8. Market expectation remains MARKET_EXPECTATION.
test("8. a MARKET_EXPECTATION record's classification is never changed", () => {
  const result = processSentimentData([baseRecord({ classification: "MARKET_EXPECTATION" })], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].classification, "MARKET_EXPECTATION");
});

// 9. Conflicting sentiment detected.
test("9. opposing BULLISH/BEARISH sentiment for the same asset is flagged CONFLICTING, both preserved", () => {
  const a = baseRecord({ source: "source-A", sentiment: "BULLISH" });
  const b = baseRecord({ source: "source-B", sentiment: "BEARISH" });
  const result = processSentimentData([a, b], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.agent_status, SENTIMENT_AGENT_STATUS.CONFLICTING);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.validated_records.length, 2);
});

// 10. Bullish aggregation.
test("10. bullish-dominant sentiment aggregates to a BULLISH bias", () => {
  const records = [baseRecord({ source: "A", sentiment: "BULLISH" }), baseRecord({ source: "B", sentiment: "BULLISH" })];
  const { report } = runSentimentAgent(records, { freshnessThresholds: THRESHOLDS });
  assert.equal(report.sentiment_bias, "BULLISH");
  assert.equal(report.sentiment_distribution.bullish_count, 2);
});

// 11. Bearish aggregation.
test("11. bearish-dominant sentiment aggregates to a BEARISH bias", () => {
  const records = [baseRecord({ source: "A", sentiment: "BEARISH" }), baseRecord({ source: "B", sentiment: "BEARISH" })];
  const { report } = runSentimentAgent(records, { freshnessThresholds: THRESHOLDS });
  assert.equal(report.sentiment_bias, "BEARISH");
  assert.equal(report.sentiment_distribution.bearish_count, 2);
});

// 12. Mixed sentiment aggregation.
test("12. evenly opposed sentiment aggregates to a MIXED bias", () => {
  const records = [baseRecord({ source: "A", sentiment: "BULLISH" }), baseRecord({ source: "B", sentiment: "BEARISH" })];
  const { report } = runSentimentAgent(records, { freshnessThresholds: THRESHOLDS });
  assert.equal(report.sentiment_bias, "MIXED");
});

// 13. Insufficient evidence -> UNKNOWN.
test("13. a requested asset with no matching validated sentiment yields UNKNOWN bias, not a guess", () => {
  const records = [baseRecord({ asset: "ETH" })];
  const { report } = runSentimentAgent(records, { freshnessThresholds: THRESHOLDS, requestedAsset: "BTC" });
  assert.equal(report.sentiment_bias, "UNKNOWN");
  assert.equal(report.sentiment_records.length, 0);
});

// 14. Missing sentiment -> SENTIMENT DATA UNAVAILABLE.
test("14. no input data at all returns UNAVAILABLE with a SENTIMENT DATA UNAVAILABLE warning", () => {
  const result = processSentimentData([]);
  assert.equal(result.agent_status, SENTIMENT_AGENT_STATUS.UNAVAILABLE);
  assert.ok(result.warnings.some((w) => w.includes("SENTIMENT DATA UNAVAILABLE")));
});

// 15. No fabricated sentiment.
test("15. a record missing its required sentiment value is rejected, never assigned a guessed sentiment", () => {
  const record = baseRecord();
  delete record.sentiment;
  const result = processSentimentData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records.length, 0);
  assert.equal(result.rejected_records[0].record.sentiment, "UNKNOWN");
});

// 16. No fabricated source.
test("16. a record with no source keeps source as the UNKNOWN sentinel, never a guessed name", () => {
  const record = baseRecord();
  delete record.source;
  const result = processSentimentData([record], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].source, "UNKNOWN");
});

// 17. No fabricated score.
test("17. a record with no sentiment_score keeps it as the UNKNOWN sentinel, never a guessed number", () => {
  const result = processSentimentData([baseRecord()], { freshnessThresholds: THRESHOLDS });
  assert.equal(result.validated_records[0].sentiment_score, "UNKNOWN");
});

// 18. Sentiment bias never becomes BUY/SELL.
test("18. sentiment_bias is always an evidence label, never BUY/SELL/LONG/SHORT", () => {
  const { report } = runSentimentAgent([baseRecord()], { freshnessThresholds: THRESHOLDS });
  assert.ok(["BULLISH", "BEARISH", "MIXED", "NEUTRAL", "UNKNOWN"].includes(report.sentiment_bias));
  assert.equal("recommendation_type" in report, false);
});

// 19. No live API access claim.
test("19. the module exposes no live-fetch / external-access capability to claim", () => {
  const exportedNames = Object.keys(sentimentAgent).sort();
  assert.deepEqual(exportedNames, ["SENTIMENT_AGENT_STATUS", "processSentimentData", "runSentimentAgent"].sort());
});

// 20. No trading recommendation.
test("20. the Sentiment Report never carries a trading recommendation of any kind", () => {
  const { report } = runSentimentAgent([baseRecord()], { freshnessThresholds: THRESHOLDS });
  assert.equal("recommendation_type" in report, false);
  const serialized = JSON.stringify(report);
  assert.ok(!/"BUY"|"SELL"|"LONG"|"SHORT"/.test(serialized));
});

test("a provider failSafe()-shaped error passed as input is handled, not crashed on", () => {
  const providerError = { ok: false, code: "API_UNAVAILABLE", message: "no provider connected", details: {} };
  const result = processSentimentData(providerError);
  assert.equal(result.agent_status, SENTIMENT_AGENT_STATUS.UNAVAILABLE);
});

test("a non-array top-level input is rejected as FAILED", () => {
  const result = processSentimentData("not-an-array");
  assert.equal(result.agent_status, SENTIMENT_AGENT_STATUS.FAILED);
});
