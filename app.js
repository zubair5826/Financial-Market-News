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
//
// Step 5D: this is also the exact wiring point
// LLM_REASONING_LAYER_DESIGN.md §0 proposes for the isolated Claude
// reasoning layer — "one more optional post-processing call, in the
// same place and style as Step 102's persistence hook — after
// runFredAwareRequest() resolves, before the response is returned."
// Disabled unless the caller's own options.llm.enabled === true
// (mirroring options.macro.enabled exactly, same frozen non-negotiable
// default). When run, it operates ONLY on the already-complete
// pipelineResult — it runs strictly after processRequest()/the Risk
// Manager/the Chief Trading Manager have already produced their final
// result, never influences any of them, and can never mutate
// pipelineResult (llm/reasoningService.js takes it read-only and
// llm/evidencePackage.js's own output is deep-frozen). Any failure —
// network, timeout, auth, rate limit, malformed response, schema
// validation, grounding/hallucination, or a risk-override attempt —
// is reported only via the additive `llmAnnotation` field below;
// pipelineResult is returned byte-for-byte identical either way, the
// same non-negotiable guarantee Step 102 already established for
// persistence failures. Persistence (data/runStore.js) is
// deliberately NOT modified by this step — §12's run-record
// llm_annotation field is a separate, not-yet-authorized extension of
// persistence, out of scope for this integration-wiring step.
const { runFredAwareRequest } = require("./providers/fredMacroApplicationService");
const { getFreshnessThresholds, getFreshnessThresholdsByPipelineDomain } = require("./config/freshness");
const { persistRun, buildRunRecord } = require("./data/runStore");
const { runReasoningService } = require("./llm/reasoningService");
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
// data/runs.jsonl; production callers never set it.
// options.llm: { enabled?: boolean, adapterConfig?: object } — the
// Claude reasoning layer is disabled unless enabled === true (frozen,
// non-negotiable default, exactly like options.macro). adapterConfig
// exists solely for offline test injection (a synthetic fetchImpl/
// timeoutMs), mirroring options.adapterConfig's existing FRED
// convention; production callers never set it. Returns
// { pipelineResult, fredDiagnostics, persistence, llmAnnotation } —
// the first three fields unchanged from before Step 5D;
// `llmAnnotation` is new (see module comment above) and is `null`
// whenever the LLM layer wasn't enabled for this run — indistinguishable
// from "not yet built" for any existing caller that doesn't look at
// it, the same additive-field precedent `persistence` and
// `fredDiagnostics` already set. Never mutates the caller's request or
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

  const runId = crypto.randomUUID();
  const runRecord = buildRunRecord({
    runId,
    originalRequest: request,
    normalizedRequest: requestWithFreshness,
    pipelineResult,
    fredDiagnostics,
  });
  const persistence = await persistRun(runRecord, options.runStore || {});

  // Step 5D: strictly after the deterministic pipeline result above
  // already exists and has already been queued for persistence. On
  // any failure inside runReasoningService() (network, timeout, auth,
  // rate limit, malformed response, schema validation, grounding, or a
  // risk-override attempt), llmAnnotation reports a non-VALID status —
  // pipelineResult itself is never touched, above or below this line.
  const llmOptions = (options && options.llm) || {};
  let llmAnnotation = null;
  if (llmOptions.enabled === true) {
    // Hardening (post-Step-5D audit finding): runReasoningService()
    // already reports every KNOWN failure mode (network/timeout/auth/
    // rate-limit/5xx/malformed-response/schema/grounding/risk-override)
    // as a structured, non-throwing result. This try/catch exists
    // ONLY for an UNEXPECTED exception outside that contract — a bug,
    // not a documented failure mode — so it can never reject this
    // function and take the already-complete pipelineResult down with
    // it. Mirrors orchestrator/index.js's dispatchSpecialists(), which
    // guards each specialist call the same way and for the same
    // reason. err itself (message/stack) is deliberately NEVER read
    // into llmAnnotation — only a fixed, generic string is ever
    // surfaced, so there is no path by which a credential or secret
    // that happened to be interpolated deep in a thrown error could
    // leak out through this boundary.
    try {
      const reasoningResult = await runReasoningService(pipelineResult, request, {
        runId,
        llmConfig: llmOptions.adapterConfig,
      });
      llmAnnotation = {
        status: reasoningResult.status,
        output: reasoningResult.output,
        code: reasoningResult.code,
        message: reasoningResult.message,
        errors: reasoningResult.errors,
      };
    } catch {
      llmAnnotation = {
        status: "UNAVAILABLE",
        output: null,
        code: "API_UNAVAILABLE",
        message: "The LLM reasoning layer failed unexpectedly.",
        errors: [],
      };
    }
  }

  return { pipelineResult, fredDiagnostics, persistence, llmAnnotation };
}

module.exports = { runApplicationRequest };
