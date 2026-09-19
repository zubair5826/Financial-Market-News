// End-to-end regression for the data_quality visibility fix.
//
// agents/chief-trading-manager/evidence.js#buildRiskSummary() did not
// copy the Risk Report's data_quality object into risk_summary. Three
// consumers read `response.risk_summary.data_quality` and all three
// therefore always found nothing:
//
//   1. data/runStore.js#buildRunRecord  -> freshness_status and
//      data_quality_status were recorded as "UNKNOWN" on EVERY
//      persisted run, which defeated the run store's own stated
//      purpose of making data quality measurable after the fact.
//   2. llm/evidencePackage.js           -> the Evidence Package handed
//      to the optional Claude layer always claimed UNKNOWN freshness.
//   3. the Chief Trading Manager Report -> the report a user actually
//      reads never surfaced freshness at all.
//
// Unit-level coverage of the copy itself lives in
// agents/chief-trading-manager/chiefTradingManager.test.js. THIS file
// pins the full chain, because the unit test alone would still pass if
// a future change broke the field name a consumer reads.
//
// Every fixture is synthetic and in-memory. No provider domain is
// enabled, so no network call is possible; each run appends only to a
// temp file, never to the real data/runs.jsonl.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runAgentRequest } = require("../agentRequest");
const { buildEvidencePackage } = require("../llm/evidencePackage");

const TEST_RUNS_FILE = path.join(os.tmpdir(), `data-quality-visibility-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
const RUN_STORE = { runStore: { filePath: TEST_RUNS_FILE } };

test.after(() => {
  try {
    fs.unlinkSync(TEST_RUNS_FILE);
  } catch {
    // Already absent.
  }
});

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

const FORTY_DAYS_MS = 40 * 24 * 60 * 60 * 1000;

function candles(ageMs, verification) {
  const prices = [100, 102, 104, 101, 99, 103, 107, 104, 100, 105, 110];
  return prices.map((p, i) => ({
    asset: "BTC",
    timeframe: "1day",
    timestamp: iso(ageMs - (prices.length - 1 - i) * 86_400_000),
    open: p,
    high: p + 1,
    low: p - 1,
    close: p,
    source: "technical-src-A",
    classification: "FACT",
    verification_status: verification,
  }));
}

// A deliberately STALE, UNVERIFIED request. Thresholds are supplied
// explicitly (1s fresh / 2s aging) so the outcome depends only on this
// fixture and never on config/freshness.js's real windows.
function staleRequest() {
  return {
    query: "Assess BTC",
    asset: "BTC",
    newsData: [
      {
        asset: "BTC",
        headline: "An old headline",
        classification: "FACT",
        source: "news-src-A",
        publication_timestamp: iso(-FORTY_DAYS_MS),
        impact_direction: "POSITIVE",
        verification_status: "UNVERIFIED",
      },
    ],
    macroData: [
      {
        indicator: "CPI",
        classification: "FACT",
        country: "US",
        category: "INFLATION",
        source: "macro-src-A",
        release_timestamp: iso(-FORTY_DAYS_MS),
        impact_direction: "POSITIVE",
        verification_status: "UNVERIFIED",
      },
    ],
    technicalCandles: candles(-FORTY_DAYS_MS, "UNVERIFIED"),
    sentimentData: [
      {
        asset: "BTC",
        sentiment: "BULLISH",
        classification: "FACT",
        source: "sentiment-src-A",
        timestamp: iso(-FORTY_DAYS_MS),
        verification_status: "UNVERIFIED",
      },
    ],
    options: { freshnessThresholds: { freshMaxMs: 1000, agingMaxMs: 2000 } },
  };
}

test("chain 1. a genuinely stale run reports STALE on the Chief Trading Manager Report itself", async () => {
  const result = await runAgentRequest(staleRequest(), RUN_STORE);
  const dataQuality = result.pipelineResult.response.risk_summary.data_quality;

  assert.ok(dataQuality, "risk_summary.data_quality must be present");
  assert.equal(dataQuality.freshnessStatus, "STALE");
  assert.equal(dataQuality.qualityStatus, "LOW");
  assert.equal(dataQuality.stale, true);
  assert.equal(dataQuality.unverified, true);
});

test("chain 2. the persisted run record carries the real freshness/data-quality status, not UNKNOWN", async () => {
  const result = await runAgentRequest(staleRequest(), RUN_STORE);
  assert.equal(result.persistence.status, "PERSISTED");

  const lines = fs.readFileSync(TEST_RUNS_FILE, "utf8").trim().split("\n").filter(Boolean);
  const record = JSON.parse(lines[lines.length - 1]);

  assert.equal(record.run_id, result.persistence.run_id);
  // The exact two fields that were always "UNKNOWN" before this fix.
  assert.equal(record.freshness_status, "STALE");
  assert.equal(record.data_quality_status, "LOW");
  // And the risk_manager_result now genuinely carries data_quality.
  assert.ok(record.risk_manager_result.data_quality);
});

test("chain 3. the Evidence Package handed to the optional Claude layer sees the real status", async () => {
  const result = await runAgentRequest(staleRequest(), RUN_STORE);
  const evidencePackage = buildEvidencePackage(result.pipelineResult, { query: "Assess BTC" }, { runId: "synthetic-run-id" });

  assert.equal(evidencePackage.freshness_status, "STALE");
  assert.equal(evidencePackage.data_quality_status, "LOW");
});

test("chain 4. a fresh, verified run is not mislabelled stale — the signal is real, not hard-coded", async () => {
  const request = staleRequest();
  request.newsData[0].publication_timestamp = iso();
  request.newsData[0].verification_status = "VERIFIED_PRIMARY";
  request.macroData[0].release_timestamp = iso();
  request.macroData[0].verification_status = "VERIFIED_PRIMARY";
  request.sentimentData[0].timestamp = iso();
  request.sentimentData[0].verification_status = "VERIFIED_PRIMARY";
  request.technicalCandles = candles(0, "VERIFIED_PRIMARY");
  request.options.freshnessThresholds = { freshMaxMs: 3_600_000, agingMaxMs: 86_400_000 };

  const result = await runAgentRequest(request, RUN_STORE);
  const dataQuality = result.pipelineResult.response.risk_summary.data_quality;

  assert.notEqual(dataQuality.freshnessStatus, "STALE");
  assert.equal(dataQuality.stale, false);
  assert.equal(dataQuality.unverified, false);
});

test("chain 5. the fix is reporting-only — stale data still raises risk exactly as it always did", async () => {
  const result = await runAgentRequest(staleRequest(), RUN_STORE);
  const riskSummary = result.pipelineResult.response.risk_summary;

  // TIMING_RISK comes from riskCategories.js reading the Risk
  // Manager's dataQuality object DIRECTLY — a path that never went
  // through risk_summary and was therefore never broken. This asserts
  // the decision path is unchanged by the reporting fix.
  assert.ok(riskSummary.risk_categories.includes("TIMING_RISK"));
  assert.ok(riskSummary.risk_categories.includes("DATA_RISK"));
});
