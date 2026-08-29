// Application Entrypoint — Step 35, extended in Step 100 and Step 102.
// The minimal, thin boundary a caller uses to invoke the existing
// intelligence pipeline. It duplicates nothing: it calls the existing,
// unmodified runFredAwareRequest() (Step 32), which itself calls the
// existing, unmodified processRequest() and, only when explicitly
// enabled via options.macro.enabled === true, the existing
// loadLiveMacroData() FRED boundary (Step 27).
//
// Step 100 fix: before this, request.options.freshnessThresholds was
// left entirely to the caller — orchestrator/index.js's processRequest()
// reads per-agent config (freshnessThresholds, positionSizingParams,
// etc.) from request.options specifically, NOT from this function's own
// second `options` parameter (that parameter controls only THIS
// entrypoint's own FRED-wiring: options.macro.enabled,
// options.adapterConfig — a separate concept). Every real production
// caller through this file supplied no request.options.freshnessThresholds
// at all, so every record's freshness silently stayed UNKNOWN
// (core/freshness.js's own documented behavior for a missing
// threshold), and stale-data risk could never be detected. This file
// now fills that ONE gap — and only when the caller didn't already
// supply their own value on request.options — from the centralized
// policy in config/freshness.js, defaulting to its "macro" entry (the
// only domain this entrypoint's own FRED integration actually drives).
//
// Step 102: this is also the one place every production caller
// (server.js's /api/intelligence, runIntelligence.js) already funnels
// through — exactly why Step 100 anchored its own fix here — so it's
// the correct single point to persist a record of every completed run
// (data/runStore.js) without duplicating that call in every caller.
// Persistence happens AFTER the pipeline result already exists and
// NEVER changes it: pipelineResult/fredDiagnostics below are returned
// byte-for-byte identical whether the write to data/runs.jsonl
// succeeds or fails. Its outcome is reported back only as a new,
// additive `persistence` field — see data/runStore.js for exactly why
// a persistence failure never fails the request.
const { runFredAwareRequest } = require("./providers/fredMacroApplicationService");
const { getFreshnessThresholds, getFreshnessThresholdsByPipelineDomain } = require("./config/freshness");
const { persistRun, buildRunRecord } = require("./data/runStore");
const crypto = require("crypto");

// request: the same shape processRequest() already accepts (see
// README.md's "Data Flow" section) — { query, asset?, marketData?,
// newsData?, macroData?, technicalCandles?, sentimentData?, options?,
// ... }. request.options.freshnessThresholds defaults to the
// centralized macro policy when the caller didn't supply one on
// request.options — an explicit caller value there is never
// overridden, and no other request/request.options field is altered.
// options (the second parameter): forwarded to runFredAwareRequest()
// completely unchanged — FRED stays disabled unless
// options.macro.enabled === true (existing default).
// options.runStore, if present, is forwarded only to persistRun() (see
// data/runStore.js) — its one field, filePath, exists solely for
// offline test injection so tests never append to the real
// data/runs.jsonl; production callers never set it. Returns
// { pipelineResult, fredDiagnostics, persistence } — the first two
// fields unchanged from before Step 102; `persistence` is new (see
// module comment above). Never mutates the caller's request or
// options.
async function runApplicationRequest(request, options = {}) {
  const requestOptions = (request && request.options) || {};

  // Step 106: an explicit caller-supplied freshnessThresholds is still
  // preserved exactly as-is and is never joined by a per-domain map —
  // an explicit value must stay the single authority for that run
  // (Step 100's own rule, unchanged). Only when the caller supplied
  // nothing do we fill in BOTH:
  //   - freshnessThresholds: the macro window, unchanged from Step 100,
  //     so any consumer reading this one flat field (and any domain
  //     the map below deliberately leaves out) behaves as before; and
  //   - freshnessThresholdsByDomain: the correct per-domain windows,
  //     which orchestrator/index.js's optionsForDomain() applies to
  //     each specialist individually. Without this, a news headline
  //     travelling through this entrypoint was measured against the
  //     30-day MACRO window and reported FRESH when it was weeks old.
  const callerSuppliedThresholds = requestOptions.freshnessThresholds;
  const resolvedOptions = callerSuppliedThresholds
    ? { ...requestOptions }
    : {
        ...requestOptions,
        freshnessThresholds: getFreshnessThresholds("macro"),
        freshnessThresholdsByDomain: getFreshnessThresholdsByPipelineDomain(),
      };
  const requestWithFreshness = { ...request, options: resolvedOptions };

  const { pipelineResult, fredDiagnostics } = await runFredAwareRequest(requestWithFreshness, options);

  const runRecord = buildRunRecord({
    runId: crypto.randomUUID(),
    originalRequest: request,
    normalizedRequest: requestWithFreshness,
    pipelineResult,
    fredDiagnostics,
  });
  const persistence = await persistRun(runRecord, options.runStore || {});

  return { pipelineResult, fredDiagnostics, persistence };
}

module.exports = { runApplicationRequest };
