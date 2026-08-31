// Reasoning Service — Step 5D. The one module that composes the
// already-built, independently-tested Step 5A/5B/5C pieces into a
// single call: Evidence Package -> Anthropic transport -> output
// validation -> a validated annotation, or a safe non-VALID status on
// any failure. app.js's only job (per LLM_REASONING_LAYER_DESIGN.md's
// proposed wiring point) is to decide WHETHER to call this — via
// options.llm.enabled === true — and to attach whatever it returns as
// a separate, additive `llmAnnotation` field. This module never
// mutates pipelineResult and never returns anything that could replace
// it; it doesn't even import orchestrator/agents/providers/server.js/
// app.js.
//
// Prompt content here is intentionally minimal and unversioned: the
// full prompt-template registry (§4 — llm/promptRegistry.js,
// llm/prompts/reasoning-v1.md) is a disclosed, deliberate gap, out of
// scope for Step 5D (integration wiring only, "no unrelated
// features"). What's here is the smallest system instruction that
// actually communicates the §2 output contract and the §11
// Risk-Manager boundary to a real model — everything else about how
// well a real Anthropic call honors it is verified downstream, by the
// exact same validateClaudeOutput() every candidate output must pass
// regardless of how it was prompted.

const { sendAnthropicMessage } = require("./anthropicLiveSource");
const { buildEvidencePackage } = require("./evidencePackage");
const { validateClaudeOutput } = require("./validateClaudeOutput");

const SYSTEM_PROMPT = [
  "You are a read-only market-intelligence explainer. You are given a single JSON \"Evidence Package\" produced by an existing, already-final deterministic trading-analysis system. Your only job is to explain and contextualize what it already decided.",
  "Rules:",
  "- Reason ONLY over the supplied JSON. Never invent a fact, price, quantity, or number not already present in it.",
  "- The Evidence Package's risk_decision is FINAL and not open for reconsideration. If it is a rejection, explain why — never suggest a way to proceed anyway, work around it, or size around it.",
  "- You have no authority to recommend, execute, or suggest a BUY, SELL, or any other trading action.",
  "- Respond with EXACTLY this JSON shape and nothing else — no prose before or after it: { \"output_schema_version\": \"llm-output-v1\", \"narrative_summary\": string, \"key_factors\": [{ \"factor\": string, \"direction\": \"SUPPORTIVE\"|\"CONTRARY\"|\"NEUTRAL\", \"evidence_ref\": string }], \"risk_commentary\": string, \"uncertainties_acknowledged\": [string], \"caveats\": [string] }",
  "- Every \"evidence_ref\" must be a real JSON-pointer-style path into the Evidence Package you were given (e.g. \"domain_evidence.macro.key_indicators[0]\").",
  "- Every entry in \"uncertainties_acknowledged\" must be drawn from the Evidence Package's own \"uncertainties\"/\"warnings\" arrays.",
].join("\n");

function buildMessages(evidencePackage) {
  return [{ role: "user", content: JSON.stringify(evidencePackage) }];
}

// A non-JSON (or partially-JSON) completion is a malformed response,
// never coerced or guessed into a shape.
function parseCandidateOutput(text) {
  if (typeof text !== "string") return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

// pipelineResult: the already-complete deterministic result — read-
// only, passed straight to buildEvidencePackage() and never touched
// otherwise. request: the original caller request (only .query is
// ever read from it, via buildEvidencePackage). options.runId:
// forwarded to buildEvidencePackage()'s own run_id field.
// options.llmConfig: forwarded verbatim as sendAnthropicMessage()'s
// adapterConfig — test-only override (fetchImpl/timeoutMs), mirroring
// every other live-source's options.adapterConfig convention;
// production callers never set it.
//
// Returns a plain object, never throws:
//   { status: "UNAVAILABLE" | "INVALID_OUTPUT" | "REJECTED" | "VALID",
//     output: <validated §2 object> | null,
//     code: <ERROR_CODES value> | null,     // meaningful only for UNAVAILABLE
//     message: <string> | null,              // meaningful only for UNAVAILABLE
//     errors: [ "string", ... ],
//     evidencePackage: <the Evidence Package actually sent this call> }
async function runReasoningService(pipelineResult, request, options = {}) {
  const evidencePackage = buildEvidencePackage(pipelineResult, request, { runId: options.runId });

  const transportResult = await sendAnthropicMessage(
    { messages: buildMessages(evidencePackage), system: SYSTEM_PROMPT },
    { adapterConfig: options.llmConfig }
  );

  if (!transportResult.ok) {
    return {
      status: "UNAVAILABLE",
      output: null,
      code: transportResult.code,
      message: transportResult.message,
      errors: [],
      evidencePackage,
    };
  }

  const parsed = parseCandidateOutput(transportResult.data.text);
  if (!parsed.ok) {
    return {
      status: "INVALID_OUTPUT",
      output: null,
      code: "MALFORMED_DATA",
      message: "Anthropic response text was not valid JSON.",
      errors: [],
      evidencePackage,
    };
  }

  const validation = validateClaudeOutput(parsed.value, evidencePackage);
  if (validation.status !== "VALID") {
    return { status: validation.status, output: null, code: null, message: null, errors: validation.errors, evidencePackage };
  }

  return {
    status: "VALID",
    output: validation.output,
    code: null,
    message: null,
    errors: [],
    evidencePackage,
    tokenUsage: transportResult.data.usage,
  };
}

module.exports = { runReasoningService, SYSTEM_PROMPT };
