// Claude Output Validation Entry Point — Step 5C. Composes the three
// independent guards below, in the exact order
// LLM_REASONING_LAYER_DESIGN.md requires:
//   1. llm/validateOutput.js    — structural schema check (§8)
//   2. llm/hallucinationGuard.js — evidence grounding check (§9)
//   3. llm/assertNoRiskOverride.js — Risk-Manager boundary check (§11)
//
// Each stage only runs once the previous stage has already passed
// (§9's own header: grounding checks "run only on output that already
// passed schema validation"). No partial trust anywhere in this chain
// (§8): the first failing stage stops the pipeline and the whole
// output is discarded — never a partially-validated result.
//
// This module takes an Evidence Package (llm/evidencePackage.js's
// output) and a raw candidate output — never a pipelineResult, never
// an orchestrator/agent object, never a credential. It has no way to
// mutate anything it is given, and no way to reach the deterministic
// pipeline even if it wanted to: there is no `require` anywhere in
// this file (or the three it composes) pointing at orchestrator/,
// agents/, providers/, server.js, or app.js.
//
// Return shape: { status: "VALID" | "INVALID_OUTPUT" | "REJECTED",
// output: <validated object> | null, errors: [ "string", ... ] }.
// "VALID" is this validation layer's own pass status — distinct from
// §12's later persistence-status enum (PERSISTED/UNAVAILABLE/...),
// which only applies once a not-yet-built persistence step actually
// stores this result; that wiring is explicitly out of scope for Step
// 5C.

const { validateOutputSchema } = require("./validateOutput");
const { runHallucinationGuard } = require("./hallucinationGuard");
const { assertNoRiskOverride } = require("./assertNoRiskOverride");

function validateClaudeOutput(rawOutput, evidencePackage) {
  const schemaResult = validateOutputSchema(rawOutput);
  if (!schemaResult.valid) {
    return { status: "INVALID_OUTPUT", output: null, errors: schemaResult.errors };
  }

  const safeEvidencePackage = evidencePackage && typeof evidencePackage === "object" ? evidencePackage : {};

  const groundingResult = runHallucinationGuard(schemaResult.output, safeEvidencePackage);
  if (!groundingResult.ok) {
    return { status: "REJECTED", output: null, errors: groundingResult.errors };
  }

  const riskDecision =
    safeEvidencePackage.risk_decision && typeof safeEvidencePackage.risk_decision === "object"
      ? safeEvidencePackage.risk_decision.risk_decision
      : undefined;
  const riskGuardResult = assertNoRiskOverride(schemaResult.output, riskDecision);
  if (!riskGuardResult.ok) {
    return { status: "REJECTED", output: null, errors: riskGuardResult.errors };
  }

  return { status: "VALID", output: schemaResult.output, errors: [] };
}

module.exports = { validateClaudeOutput };
