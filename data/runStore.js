// Persistent Run Store — Step 102. The smallest safe layer that makes
// every completed intelligence run measurable and reviewable later,
// without introducing a database. Appends one JSON object per line to
// data/runs.jsonl (JSONL — "JSON Lines": one complete, independently
// parseable JSON document per line, newline-delimited, growing
// append-only). No schema migration machinery, no query engine, no new
// dependency — this mirrors the exact append-only, fail-safe pattern
// logs/logger.js already established for logs/system.log, reusing its
// own redact() rather than duplicating redaction logic.
//
// Why async (not appendFileSync, unlike logs/logger.js): every agent
// call already writes a small log line synchronously today, but a run
// record is a much larger structured payload (full agent outputs,
// request/response), written once per completed run rather than once
// per agent call. A synchronous write of that size on every request
// would block Node's single event loop for every OTHER concurrent
// request for the duration of the disk write — an unbounded-under-load
// bottleneck sitting directly in the HTTP request path. Using
// fs.promises.appendFile() instead performs the write off the main
// thread via libuv; other requests keep being served while it
// completes. This project is async/await throughout its I/O boundaries
// already (see providers/fredMacroLiveSource.js), so this is not a new
// pattern, just applied here too.
//
// Why persistence failure never fails the request (see app.js's call
// site): logs/logger.js's own logEvent() already establishes this
// precedent project-wide — "Logging must never crash the system it's
// observing" — and a failed disk write (full disk, permissions, a
// missing volume) is an observability problem, not a defect in the
// trading intelligence computation that already completed correctly.
// Failing the request would turn an unrelated storage outage into a
// false trading-analysis failure. Instead, persistRun() catches every
// error internally and returns a structured { status, error } outcome;
// the caller (app.js) surfaces that as a `persistence` field alongside
// the unmodified pipeline result — never as a warning injected into
// pipelineResult.warnings, which is documented (README.md) as
// specifically "every warning from every pipeline STAGE" and must stay
// exactly that.

const fs = require("fs");
const path = require("path");
const { redact } = require("../logs/logger");

const DATA_DIR = __dirname;
const RUNS_FILE = path.join(DATA_DIR, "runs.jsonl");

const RUN_STORE_STATUS = Object.freeze({
  PERSISTED: "PERSISTED",
  FAILED: "FAILED",
});

// Builds one structured run record — the schema this step's spec asks
// for, and nothing more. Every field is read from data the pipeline
// already produced; nothing here is invented. `originalRequest` and
// `normalizedRequest` are passed through redact() (below, at write
// time) precisely because a caller-supplied request/options object is
// the one place an API key could theoretically end up (e.g. a
// misconfigured options.adapterConfig) — the wrapper's own `options`
// argument (FRED enablement, adapterConfig) is deliberately NOT
// captured here at all, since that is exactly where test/production
// credentials are threaded through elsewhere in this codebase, and it
// carries no information about the request or its outcome anyway.
function buildRunRecord({ runId, originalRequest, normalizedRequest, pipelineResult, fredDiagnostics }) {
  const response = (pipelineResult && pipelineResult.response) || null;
  const riskSummary = (response && response.risk_summary) || null;
  const dataQuality = (riskSummary && riskSummary.data_quality) || null;

  return {
    run_id: runId,
    timestamp: (pipelineResult && pipelineResult.timestamp) || new Date().toISOString(),
    requested_instrument: (originalRequest && originalRequest.asset) || (pipelineResult && pipelineResult.asset) || "UNKNOWN",
    ok: pipelineResult ? pipelineResult.ok : false,
    original_request: originalRequest || null,
    normalized_request: normalizedRequest || null,
    // "provider/data timestamps where available" — FRED diagnostics
    // (per-series composition results, each carrying that series' own
    // real timestamps) when FRED was enabled for this run; null
    // otherwise. Honest UNKNOWN-shaped absence, never fabricated.
    provider_diagnostics: fredDiagnostics || null,
    freshness_status: (dataQuality && dataQuality.freshnessStatus) || "UNKNOWN",
    data_quality_status: (dataQuality && dataQuality.qualityStatus) || "UNKNOWN",
    agent_outputs: response
      ? {
          news_summary: response.news_summary,
          macro_summary: response.macro_summary,
          technical_summary: response.technical_summary,
          sentiment_summary: response.sentiment_summary,
          trade_setup_summary: response.trade_setup_summary,
        }
      : null,
    risk_manager_result: riskSummary,
    chief_trading_manager_result: response
      ? {
          final_assessment: response.final_assessment,
          decision_status: response.decision_status,
          confidence: response.confidence,
          asset: response.asset,
          uncertainties: response.uncertainties,
          key_assumptions: response.key_assumptions,
          sources: response.sources,
        }
      : null,
    final_decision: response ? { final_assessment: response.final_assessment, decision_status: response.decision_status } : "UNKNOWN",
    confidence: response ? response.confidence : "UNKNOWN",
    warnings: (pipelineResult && pipelineResult.warnings) || [],
    errors: (pipelineResult && pipelineResult.errors) || [],
  };
}

// Appends one redacted run record as a single JSONL line. Creates the
// target directory if it doesn't already exist (data/ does today, but
// this makes no assumption about that). Never throws — every failure
// is caught and returned as a structured { status: FAILED, error }
// outcome, exactly mirroring logs/logger.js's own logEvent() fail-safe
// contract.
//
// storeOptions.filePath: overrides the real data/runs.jsonl path —
// exists solely for offline test injection (so tests never append to
// the real production run store), mirroring how every provider adapter
// in this project already accepts an injectable adapterConfig for the
// same reason. Production callers never set this.
async function persistRun(runRecord, storeOptions = {}) {
  const filePath = storeOptions.filePath || RUNS_FILE;
  const dir = path.dirname(filePath);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const line = JSON.stringify(redact(runRecord)) + "\n";
    await fs.promises.appendFile(filePath, line, "utf8");
    return { status: RUN_STORE_STATUS.PERSISTED, run_id: runRecord.run_id, error: null };
  } catch (err) {
    console.error("Failed to persist run record:", err.message);
    return { status: RUN_STORE_STATUS.FAILED, run_id: runRecord.run_id, error: err.message };
  }
}

module.exports = { persistRun, buildRunRecord, RUN_STORE_STATUS, RUNS_FILE };
