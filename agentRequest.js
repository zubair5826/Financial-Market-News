// Unified Agent Composition — the single entry point for a complete,
// multi-domain market-analysis run.
//
// It introduces NO new intelligence logic, NO new request schema, and
// NO second architecture. It is exactly the composition app.js already
// performs (pipeline -> persistence -> optional isolated Claude
// annotation), pointed at the MULTI-DOMAIN composition root
// (providers/marketIntelligenceApplicationService.js's
// runMarketIntelligenceRequest) instead of the FRED-only one
// (providers/fredMacroApplicationService.js's runFredAwareRequest).
//
// WHY THIS FILE EXISTS. Before it, the project had two composition
// roots with opposite strengths, and no caller could get both:
//
//   app.js / runApplicationRequest()
//     macro (FRED) only  +  run persistence  +  LLM hook
//   providers/marketIntelligenceApplicationService.js
//     macro + technical + news + derived sentiment,
//     but NO persistence and NO LLM hook
//
// So the only path that gathered real cross-domain evidence left no
// audit trail (server.js's own handleMarketIntelligence comment said
// as much), while the only path with an audit trail saw one specialist
// out of four. This file closes that gap by REUSING both halves
// verbatim — it calls runMarketIntelligenceRequest(), buildRunRecord()/
// persistRun() and runReasoningService() exactly as they already exist,
// and reimplements none of them.
//
// app.js is deliberately NOT modified or replaced. Its own FRED-only
// contract, and the /api/intelligence endpoint and runIntelligence.js
// built on it, stay byte-for-byte as they were.
//
// DETERMINISM / CLAUDE ISOLATION (non-negotiable, unchanged from
// app.js's Step 5D wiring): the deterministic pipeline is the sole
// decision authority. runReasoningService() is invoked strictly AFTER
// pipelineResult already exists, is handed that result read-only
// through a deep-frozen Evidence Package, and cannot reach back into
// it. risk_decision, decision_status and final_assessment are computed
// entirely by the deterministic agents and are never read from, or
// influenced by, llmAnnotation. Any LLM failure — network, timeout,
// auth, rate limit, malformed response, schema, grounding, or a
// risk-override attempt — surfaces ONLY in the additive llmAnnotation
// field; pipelineResult is returned identical either way.
//
// There is no broker connection, exchange connection, order path, or
// trade execution in this file or in anything it calls.

const { runMarketIntelligenceRequest } = require("./providers/marketIntelligenceApplicationService");
const { persistRun, buildRunRecord } = require("./data/runStore");
const { runReasoningService } = require("./llm/reasoningService");
const crypto = require("crypto");

// request: the same shape processRequest()/runMarketIntelligenceRequest()
//   already accept — { query, asset?, marketData?, newsData?,
//   macroData?, technicalCandles?, sentimentData?, options?, ... }.
//   Per-agent configuration lives on request.options exactly as it
//   already does, including options.positionSizingParams, which flows
//   untouched through runMarketIntelligenceRequest()'s merged request
//   into orchestrator/index.js and on to the Risk Manager. This file
//   neither validates, defaults, nor completes those sizing
//   parameters — agents/risk-manager/positionSizing.js's existing
//   all-six-or-nothing rule remains the only authority, and a partial
//   or absent set still yields POSITION SIZE: DATA_UNAVAILABLE.
//
// options: forwarded to runMarketIntelligenceRequest() unchanged
//   EXCEPT for the two composition-only keys below, which are consumed
//   here and never passed into the pipeline (exactly how app.js treats
//   its own options.runStore/options.llm):
//     options.runStore — forwarded only to persistRun(); its one field,
//       filePath, exists for offline test injection and for pointing
//       run records at a mounted volume.
//     options.llm — { enabled?: boolean, adapterConfig?: object }. The
//       Claude layer stays disabled unless enabled === true (frozen,
//       non-negotiable default, mirroring options.macro.enabled).
//       adapterConfig exists solely for offline test injection.
//   Every provider domain remains disabled unless its own
//   options.{macro,market,news}.enabled === true. This function
//   deliberately enables NOTHING by default, so /api/market-intelligence
//   keeps its exact existing semantics; the "all domains on" default
//   belongs to the personal CLI (runAgent.js), not here.
//
// Returns { pipelineResult, diagnostics, persistence, llmAnnotation }.
//   pipelineResult and diagnostics are returned exactly as
//   runMarketIntelligenceRequest() produced them; persistence and
//   llmAnnotation are additive fields, the same precedent app.js
//   already set. Never mutates the caller's request or options.
async function runAgentRequest(request, options = {}) {
  const { runStore: runStoreOptions, llm: llmOptions, ...providerOptions } = options || {};

  // Freshness policy is NOT applied here: runMarketIntelligenceRequest()
  // already calls its own withFreshnessPolicy() internally (Step 106),
  // and duplicating that decision in a second place is exactly how the
  // two copies would drift apart.
  const { pipelineResult, diagnostics } = await runMarketIntelligenceRequest(request, providerOptions);

  const runId = crypto.randomUUID();
  const runRecord = buildRunRecord({
    runId,
    originalRequest: request,
    // The multi-domain merged request is deliberately NOT recorded.
    // runMarketIntelligenceRequest() builds it internally and does not
    // return it, and capturing it would mean embedding every fetched
    // candle and news article into every run record — duplicating the
    // provider payload the record already summarizes, for no added
    // measurability. An honest null beats a bloated half-truth; the
    // FRED-only path (app.js) still records its own normalized request
    // exactly as before.
    normalizedRequest: null,
    pipelineResult,
    // buildRunRecord()'s parameter is named fredDiagnostics for
    // historical reasons; the field it populates is the general
    // `provider_diagnostics`. Passing this path's multi-domain
    // diagnostics object ({ instrument, macro, market, news }) is
    // therefore correct and needs no change to the run store. It is
    // redacted at write time by persistRun(), same as every other
    // field.
    fredDiagnostics: diagnostics,
  });
  const persistence = await persistRun(runRecord, runStoreOptions || {});

  // Strictly after the deterministic result above already exists and
  // has already been queued for persistence.
  let llmAnnotation = null;
  if (llmOptions && llmOptions.enabled === true) {
    // runReasoningService() reports every KNOWN failure mode as a
    // structured, non-throwing result. This try/catch exists ONLY for
    // an UNEXPECTED exception outside that contract — a bug, not a
    // documented failure mode — so it can never reject this function
    // and take the already-complete pipelineResult down with it.
    // Identical to app.js's own guard, and for the identical reason.
    // err itself (message/stack) is deliberately NEVER read into
    // llmAnnotation, so a credential interpolated deep in a thrown
    // error has no path out through this boundary.
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

  return { pipelineResult, diagnostics, persistence, llmAnnotation };
}

module.exports = { runAgentRequest };
