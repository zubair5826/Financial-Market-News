// Risk-Manager Boundary Guard — Step 5C, per
// LLM_REASONING_LAYER_DESIGN.md §11 ("Explicit boundary guard"). This
// is defense-in-depth: the output schema (§2) already has no field
// capable of representing a different or revised risk decision, so
// this guard exists for the one place the schema genuinely cannot
// protect against misbehavior — free text. It scans
// narrative_summary/risk_commentary for patterns that directly
// contradict the Risk Manager's already-final decision (e.g. calling a
// rejected setup "safe" or telling the reader to proceed anyway).
//
// This is explicitly NOT a semantic understanding of the text — it is
// a pattern sweep, the same "not trusted alone" caveat §10 gives every
// layer below the structural one. A match rejects the output; the
// absence of a match is not proof the commentary is trustworthy, only
// that it didn't contain one of the specific contradiction patterns
// this guard knows to look for.
//
// Read-only: never mutates its arguments. No network access, no
// credentials, no import of the orchestrator/any agent/provider
// adapter/server.js/app.js.

// Decision values the Risk Manager can produce that represent a
// rejection/veto — matching the vocabulary already used throughout
// agents/risk-manager (RISK_TOO_HIGH) and this project's existing
// tests (e.g. tests/pipeline.test.js's "the Chief Trading Manager must
// not override" scenario). Treated case-insensitively so a caller
// passing the exact enum value or a differently-cased copy is handled
// the same way.
const REJECTION_DECISION_PATTERN = /RISK_TOO_HIGH|REJECT/i;

// Patterns that would directly contradict a rejection decision if
// found in the model's own commentary. Deliberately narrow and
// literal (per the module header: this is a pattern sweep, not
// language understanding) — false negatives are expected and accepted
// here because the structural schema (§2) is the primary control;
// this only needs to catch the clear, direct contradictions §11 names
// as its example ("asserting the setup is safe... [or suggesting] how
// to work around it, size around it, or proceed anyway").
const CONTRADICTION_PATTERNS = Object.freeze([
  /\b(the\s+)?(setup|trade|position)\s+is\s+safe\b/i,
  /\bsafe\s+to\s+(buy|enter|trade|proceed)\b/i,
  /\bproceed\s+(anyway|regardless|despite\s+the\s+risk)\b/i,
  /\bignore\s+the\s+risk\b/i,
  /\bwork\s+around\s+the\s+risk\b/i,
  /\bsize\s+around\s+the\s+risk\b/i,
  /\brisk\s+is\s+(actually\s+)?acceptable\b/i,
  /\boverrid(e|ing)\s+the\s+risk\b/i,
]);

// output: an already schema-valid object (narrative_summary/
// risk_commentary are known to be strings). riskDecision: the
// deterministic Risk Manager's own decision string, copied verbatim
// from the Evidence Package (evidencePackage.risk_decision.risk_decision)
// — never recomputed here. Returns { ok: true } or
// { ok: false, status: "REJECTED", errors }.
function assertNoRiskOverride(output, riskDecision) {
  const isRejectionDecision = typeof riskDecision === "string" && REJECTION_DECISION_PATTERN.test(riskDecision);
  if (!isRejectionDecision) {
    return { ok: true, errors: [] };
  }

  const errors = [];
  for (const field of ["narrative_summary", "risk_commentary"]) {
    const text = typeof output[field] === "string" ? output[field] : "";
    for (const pattern of CONTRADICTION_PATTERNS) {
      if (pattern.test(text)) {
        errors.push(
          `${field} contradicts the Risk Manager's ${riskDecision} decision (matched pattern ${pattern}) — commentary may explain a rejection but never contradict or work around it.`
        );
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, status: "REJECTED", errors };
  }
  return { ok: true, errors: [] };
}

module.exports = {
  REJECTION_DECISION_PATTERN,
  CONTRADICTION_PATTERNS,
  assertNoRiskOverride,
};
