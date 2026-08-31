// Evidence Package Layer — Step 5B. Builds the single, versioned
// "Evidence Package" that is the ONLY input the (not-yet-built) Claude
// reasoning layer will ever see, per LLM_REASONING_LAYER_DESIGN.md §1.
//
// This is a pure, read-only transformation: buildEvidencePackage() never
// mutates its inputs, never calls any agent/orchestrator/provider code,
// never reads process.env, and never fabricates a value the
// deterministic pipeline didn't already compute. Every field is copied
// verbatim from an already-validated report field — the Chief Trading
// Manager's own final report, at `pipelineResult.response` — never
// recomputed, reformatted, or summarized here. A field the pipeline
// didn't compute is represented as the project's own UNKNOWN sentinel
// or an empty list — never guessed, and never left as `undefined`
// (which JSON.stringify would silently drop, hiding the gap rather
// than disclosing it).
//
// Deliberately excluded, by construction (never read from anywhere in
// this file): API keys/credentials, raw provider payloads (Alpha
// Vantage/FRED JSON, raw candle/record arrays), internal diagnostics
// (fredDiagnostics, timeframeResults, adapter internals), and
// persistence internals (data/runStore.js's write path/run record
// shape) — a `run_id` may only be supplied by the caller via
// `options.runId`; this module never reaches into a `persistence`
// object to find one itself.
//
// Structural safety, matching the Risk-Manager boundary this design
// document requires (§11): this file has no code path that could set
// or alter `risk_decision` — it only ever COPIES the deterministic
// value the Risk Manager already produced (by way of the Chief Trading
// Manager's own risk_summary), and the returned package is deep-frozen
// so nothing downstream (including a future prompt-construction step)
// can mutate it into a different fact.
//
// Not wired into app.js, server.js, the orchestrator, or any agent —
// nothing calls this file yet.

const { UNKNOWN } = require("../core/constants");

const INPUT_SCHEMA_VERSION = "llm-input-v1";

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze(value[key]);
  }
  return Object.freeze(value);
}

// Never returns the original array reference — always a fresh copy —
// so freezing the Evidence Package can never freeze (or otherwise
// affect) an array still owned by pipelineResult.
function copyList(list) {
  return Array.isArray(list) ? [...list] : [];
}

// domain_evidence — exactly the fields LLM_REASONING_LAYER_DESIGN.md §1
// lists per domain, nothing more (a field not on this list is scope
// creep, not a harmless extra — the same allow-list discipline every
// agent report in this codebase already applies to itself).
function buildDomainEvidence(response) {
  const news = response && response.news_summary;
  const macro = response && response.macro_summary;
  const technical = response && response.technical_summary;
  const sentiment = response && response.sentiment_summary;

  return {
    news: {
      bias: (news && news.bias) || UNKNOWN,
      confidence: (news && news.confidence) || UNKNOWN,
      key_events: copyList(news && news.key_events),
      conflicts: copyList(news && news.conflicts),
      warnings: copyList(news && news.warnings),
      sources: copyList(news && news.sources),
    },
    macro: {
      bias: (macro && macro.bias) || UNKNOWN,
      confidence: (macro && macro.confidence) || UNKNOWN,
      key_indicators: copyList(macro && macro.key_indicators),
      conflicts: copyList(macro && macro.conflicts),
      warnings: copyList(macro && macro.warnings),
      sources: copyList(macro && macro.sources),
    },
    technical: {
      bias: (technical && technical.bias) || UNKNOWN,
      confidence: (technical && technical.confidence) || UNKNOWN,
      trend_analysis: (technical && technical.trend_analysis) || UNKNOWN,
      momentum: (technical && technical.momentum) || UNKNOWN,
      conflicts: copyList(technical && technical.conflicts),
      warnings: copyList(technical && technical.warnings),
      sources: copyList(technical && technical.sources),
    },
    sentiment: {
      bias: (sentiment && sentiment.bias) || UNKNOWN,
      confidence: (sentiment && sentiment.confidence) || UNKNOWN,
      conflicts: copyList(sentiment && sentiment.conflicts),
      warnings: copyList(sentiment && sentiment.warnings),
      sources: copyList(sentiment && sentiment.sources),
    },
  };
}

// trade_setup — exactly the 5 fields the design lists; conflicts/
// warnings/sources are deliberately not duplicated here a second time
// (they already appear inside domain_evidence and would just be a
// second copy of the same facts reformatted differently — the design's
// "single source per fact" rule, §3).
function buildTradeSetup(response) {
  const tradeSetup = response && response.trade_setup_summary;
  return {
    setup_status: (tradeSetup && tradeSetup.setup_status) || UNKNOWN,
    direction: (tradeSetup && tradeSetup.direction) || UNKNOWN,
    setup_quality: (tradeSetup && tradeSetup.setup_quality) || UNKNOWN,
    confidence: (tradeSetup && tradeSetup.confidence) || UNKNOWN,
    uncertainties: copyList(tradeSetup && tradeSetup.uncertainties),
  };
}

// The single most safety-critical block in this file (design §11): a
// verbatim copy of a decision the Risk Manager already made, never a
// question, never a field this module could compute or influence.
// Every value here is read, never written, from the deterministic
// result already produced upstream.
function buildRiskDecision(response) {
  const riskSummary = response && response.risk_summary;
  return {
    risk_level: (riskSummary && riskSummary.risk_level) || UNKNOWN,
    risk_decision: (riskSummary && riskSummary.risk_decision) || UNKNOWN,
    risk_categories: copyList(riskSummary && riskSummary.risk_categories),
    // Not present on the Chief Trading Manager's own risk_summary today
    // (see agents/chief-trading-manager/evidence.js#buildRiskSummary) —
    // an honest empty list when absent, never a guessed value.
    risk_factors: copyList(riskSummary && riskSummary.risk_factors),
    position_size_status: (riskSummary && riskSummary.position_size_status) || UNKNOWN,
    invalidation_assessment: (riskSummary && riskSummary.invalidation_assessment) || UNKNOWN,
  };
}

function buildFinalDecision(response) {
  return {
    final_assessment: (response && response.final_assessment) || UNKNOWN,
    decision_status: (response && response.decision_status) || UNKNOWN,
    confidence: (response && response.confidence) || UNKNOWN,
  };
}

// pipelineResult: the exact object orchestrator/index.js's
// processRequest() returns — { ok, timestamp, asset, response,
// pipeline_summary, warnings, errors } — read-only, never mutated.
// request: the original caller request — only request.query is ever
// read from it (context only, never a data source, per design §1).
// options.runId: an optional caller-supplied run identifier (e.g. from
// Step 102's run store). This module never reaches into a
// `pipelineResult.persistence`-shaped object itself — persistence
// internals are out of scope by design.
function buildEvidencePackage(pipelineResult, request = {}, options = {}) {
  const safeResult = pipelineResult && typeof pipelineResult === "object" ? pipelineResult : {};
  const safeRequest = request && typeof request === "object" ? request : {};
  const safeOptions = options && typeof options === "object" ? options : {};

  const response = safeResult.response && typeof safeResult.response === "object" ? safeResult.response : null;
  const dataQuality = response && response.risk_summary && response.risk_summary.data_quality;

  const evidencePackage = {
    input_schema_version: INPUT_SCHEMA_VERSION,
    run_id: (typeof safeOptions.runId === "string" && safeOptions.runId.trim()) || UNKNOWN,
    as_of: safeResult.timestamp || UNKNOWN,
    requested_instrument: safeResult.asset || UNKNOWN,
    original_query: (typeof safeRequest.query === "string" && safeRequest.query) || UNKNOWN,

    freshness_status: (dataQuality && dataQuality.freshnessStatus) || UNKNOWN,
    data_quality_status: (dataQuality && dataQuality.qualityStatus) || UNKNOWN,

    domain_evidence: buildDomainEvidence(response),
    trade_setup: buildTradeSetup(response),
    risk_decision: buildRiskDecision(response),
    final_decision: buildFinalDecision(response),

    uncertainties: copyList(response && response.uncertainties),
    warnings: copyList(response && response.warnings),
  };

  return deepFreeze(evidencePackage);
}

module.exports = { buildEvidencePackage, INPUT_SCHEMA_VERSION };
