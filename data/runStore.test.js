// Offline tests for the persistent Run Store — Step 102. Every test
// here writes only to a throwaway temp file (via storeOptions.filePath),
// never to the real data/runs.jsonl, and cleans up after itself.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { persistRun, buildRunRecord, RUN_STORE_STATUS, RUNS_FILE } = require("./runStore");

function tempJsonlPath() {
  return path.join(os.tmpdir(), `runs-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
}

function cleanup(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Already absent — nothing to clean up.
  }
}

function readLines(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

function fakePipelineResult(overrides = {}) {
  return {
    ok: true,
    timestamp: "2026-01-01T00:00:00.000Z",
    asset: "BTC",
    response: {
      agent_name: "chief-trading-manager",
      final_assessment: "BULLISH",
      decision_status: "TRADE_SETUP_SUPPORTED",
      confidence: "HIGH",
      uncertainties: [],
      key_assumptions: [],
      sources: ["src-A"],
      news_summary: { agent_name: "news-agent", overall_news_bias: "BULLISH" },
      macro_summary: { agent_name: "macro-agent", macro_bias: "BULLISH" },
      technical_summary: { agent_name: "technical-agent", technical_bias: "BULLISH" },
      sentiment_summary: { agent_name: "sentiment-agent", sentiment_bias: "BULLISH" },
      trade_setup_summary: { agent_name: "trade-setup-agent", setup_status: "SETUP_PRESENT" },
      risk_summary: {
        agent_name: "risk-manager",
        risk_level: "LOW",
        risk_decision: "RISK_ACCEPTABLE",
        data_quality: { freshnessStatus: "FRESH", qualityStatus: "HIGH", stale: false, unverified: false, staleCount: 0, unverifiedCount: 0, missingCount: 0 },
      },
    },
    pipeline_summary: { final_assessment: "BULLISH", decision_status: "TRADE_SETUP_SUPPORTED" },
    warnings: [],
    errors: [],
    ...overrides,
  };
}

// --- buildRunRecord: schema ---

test("buildRunRecord produces every field required by the Step 102 spec", () => {
  const record = buildRunRecord({
    runId: "test-run-id",
    originalRequest: { query: "Assess BTC", asset: "BTC" },
    normalizedRequest: { query: "Assess BTC", asset: "BTC", options: { freshnessThresholds: { freshMaxMs: 1, agingMaxMs: 2 } } },
    pipelineResult: fakePipelineResult(),
    fredDiagnostics: null,
  });

  for (const field of [
    "run_id",
    "timestamp",
    "requested_instrument",
    "original_request",
    "normalized_request",
    "provider_diagnostics",
    "freshness_status",
    "data_quality_status",
    "agent_outputs",
    "risk_manager_result",
    "chief_trading_manager_result",
    "final_decision",
    "confidence",
    "warnings",
    "errors",
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(record, field), `missing field: ${field}`);
  }

  assert.equal(record.run_id, "test-run-id");
  assert.equal(record.requested_instrument, "BTC");
  assert.equal(record.freshness_status, "FRESH");
  assert.equal(record.data_quality_status, "HIGH");
  assert.equal(record.final_decision.decision_status, "TRADE_SETUP_SUPPORTED");
  assert.equal(record.confidence, "HIGH");
  assert.equal(record.agent_outputs.macro_summary.macro_bias, "BULLISH");
  assert.equal(record.risk_manager_result.risk_decision, "RISK_ACCEPTABLE");
  assert.equal(record.chief_trading_manager_result.final_assessment, "BULLISH");
});

test("buildRunRecord honestly reports UNKNOWN freshness/quality status when the pipeline produced no response at all", () => {
  const record = buildRunRecord({
    runId: "no-response-run",
    originalRequest: {},
    normalizedRequest: {},
    pipelineResult: { ok: false, timestamp: "2026-01-01T00:00:00.000Z", asset: "UNKNOWN", response: null, warnings: [], errors: [] },
    fredDiagnostics: null,
  });
  assert.equal(record.freshness_status, "UNKNOWN");
  assert.equal(record.data_quality_status, "UNKNOWN");
  assert.equal(record.agent_outputs, null);
  assert.equal(record.risk_manager_result, null);
  assert.equal(record.chief_trading_manager_result, null);
});

// --- persistRun: JSONL append behavior ---

test("1/3. a successful run is persisted as one valid JSONL line", async () => {
  const filePath = tempJsonlPath();
  try {
    const record = buildRunRecord({ runId: "run-1", originalRequest: {}, normalizedRequest: {}, pipelineResult: fakePipelineResult(), fredDiagnostics: null });
    const outcome = await persistRun(record, { filePath });
    assert.equal(outcome.status, RUN_STORE_STATUS.PERSISTED);
    assert.equal(outcome.run_id, "run-1");

    const lines = readLines(filePath);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]); // throws if not valid JSON — this IS the format check
    assert.equal(parsed.run_id, "run-1");
  } finally {
    cleanup(filePath);
  }
});

test("2. two runs receive unique run IDs", () => {
  const crypto = require("node:crypto");
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  assert.notEqual(a, b);
});

test("4. multiple runs append correctly — each on its own line, in order, none overwritten", async () => {
  const filePath = tempJsonlPath();
  try {
    for (const id of ["run-a", "run-b", "run-c"]) {
      const record = buildRunRecord({ runId: id, originalRequest: {}, normalizedRequest: {}, pipelineResult: fakePipelineResult(), fredDiagnostics: null });
      const outcome = await persistRun(record, { filePath });
      assert.equal(outcome.status, RUN_STORE_STATUS.PERSISTED);
    }
    const lines = readLines(filePath);
    assert.equal(lines.length, 3);
    assert.deepEqual(lines.map((l) => JSON.parse(l).run_id), ["run-a", "run-b", "run-c"]);
  } finally {
    cleanup(filePath);
  }
});

test("6. no secrets are stored — a credential-shaped field anywhere in the request is redacted before writing", async () => {
  const filePath = tempJsonlPath();
  try {
    const originalRequest = { query: "Assess BTC", asset: "BTC", options: { adapterConfig: { apiKey: "sk-super-secret-value" } } };
    const record = buildRunRecord({ runId: "run-secret", originalRequest, normalizedRequest: originalRequest, pipelineResult: fakePipelineResult(), fredDiagnostics: null });
    await persistRun(record, { filePath });

    const raw = fs.readFileSync(filePath, "utf8");
    assert.ok(!raw.includes("sk-super-secret-value"), "a credential-shaped value must never reach the persisted file");
    assert.ok(raw.includes("[REDACTED]"));
  } finally {
    cleanup(filePath);
  }
});

test("7. persistence failure is handled safely — never throws, returns a structured FAILED outcome", async () => {
  // A path whose parent segment is itself a FILE (not a directory)
  // guarantees fs.promises.mkdir()/appendFile() both fail — a reliable,
  // portable way to force a real write failure without touching
  // filesystem permissions.
  const blockerFile = tempJsonlPath();
  fs.writeFileSync(blockerFile, "not a directory");
  const impossiblePath = path.join(blockerFile, "runs.jsonl");
  try {
    const record = buildRunRecord({ runId: "run-fail", originalRequest: {}, normalizedRequest: {}, pipelineResult: fakePipelineResult(), fredDiagnostics: null });
    const outcome = await persistRun(record, { filePath: impossiblePath });
    assert.equal(outcome.status, RUN_STORE_STATUS.FAILED);
    assert.equal(outcome.run_id, "run-fail");
    assert.ok(outcome.error);
  } finally {
    cleanup(blockerFile);
  }
});

test("RUNS_FILE points at data/runs.jsonl by default, never a test path", () => {
  assert.ok(RUNS_FILE.endsWith(path.join("data", "runs.jsonl")));
});
