// Hallucination / Grounding Guard — Step 5C, per
// LLM_REASONING_LAYER_DESIGN.md §9 (Evidence Validation) and part of
// §10's code-level defense-in-depth layer. Runs ONLY on output that
// already passed llm/validateOutput.js's structural check — this file
// assumes its `output` argument is already schema-valid and does not
// re-check field presence/types.
//
// Three checks, exactly as §9 specifies, plus one defense-in-depth
// content sweep (see below):
//   1. every key_factors[].evidence_ref must resolve to a real path
//      inside the Evidence Package actually supplied for this call —
//      an unresolvable reference rejects the WHOLE output (never just
//      that one factor, per §9's explicit "safest default").
//   2. every uncertainties_acknowledged[] entry must string-match (or
//      fuzzy-subset-match) an entry already present in the Evidence
//      Package's own uncertainties/warnings arrays.
//   3. every numeric token found in narrative_summary/risk_commentary
//      must also appear somewhere in the serialized Evidence Package —
//      a number that doesn't is treated as a suspected fabrication.
//
// Read-only: never mutates `output` or `evidencePackage`. No network
// access, no credentials, no import of the orchestrator/any agent/
// provider adapter/server.js/app.js.

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Resolves a JSON-pointer-style dotted/bracket path (e.g.
// "domain_evidence.macro.key_indicators[0]") against evidencePackage.
// Deliberately defensive against prototype-chain traversal: a path
// segment of "__proto__"/"prototype"/"constructor" is never followed,
// and only the object's OWN properties are ever read — so a crafted
// evidence_ref can never "resolve" via inherited Object.prototype
// members, which would otherwise let a fabricated reference look
// grounded when it names nothing this Evidence Package actually
// contains.
const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function resolveEvidencePath(evidencePackage, path) {
  if (typeof path !== "string" || path.trim() === "") return { resolved: false };

  const tokens = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((t) => t.length > 0);

  let current = evidencePackage;
  for (const token of tokens) {
    if (UNSAFE_PATH_SEGMENTS.has(token)) return { resolved: false };
    if (current === null || typeof current !== "object") return { resolved: false };
    if (!Object.prototype.hasOwnProperty.call(current, token)) return { resolved: false };
    current = current[token];
  }
  return { resolved: true, value: current };
}

function checkEvidenceReferences(output, evidencePackage, errors) {
  for (const [index, factor] of output.key_factors.entries()) {
    const { resolved } = resolveEvidencePath(evidencePackage, factor.evidence_ref);
    if (!resolved) {
      errors.push(`key_factors[${index}].evidence_ref "${factor.evidence_ref}" does not resolve to any fact in the supplied Evidence Package.`);
    }
  }
}

function normalizeForComparison(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

// "String-match (or fuzzy-subset-match)" per §9: the model may select
// and paraphrase an existing uncertainty, so an exact match is not
// required — but one string must genuinely contain the other. This
// still rejects a wholly new uncertainty the input never mentioned.
function isGroundedInList(acknowledged, sourceList) {
  const normalizedAck = normalizeForComparison(acknowledged);
  if (normalizedAck === "") return false;
  return sourceList.some((entry) => {
    const normalizedEntry = normalizeForComparison(entry);
    if (normalizedEntry === "") return false;
    return normalizedEntry.includes(normalizedAck) || normalizedAck.includes(normalizedEntry);
  });
}

function checkUncertaintiesAcknowledged(output, evidencePackage, errors) {
  const sourceList = [...(Array.isArray(evidencePackage.uncertainties) ? evidencePackage.uncertainties : []), ...(Array.isArray(evidencePackage.warnings) ? evidencePackage.warnings : [])];

  output.uncertainties_acknowledged.forEach((acknowledged, index) => {
    if (!isGroundedInList(acknowledged, sourceList)) {
      errors.push(`uncertainties_acknowledged[${index}] "${acknowledged}" has no basis in the Evidence Package's own uncertainties/warnings.`);
    }
  });
}

// Every number in the given text must also appear, as a literal
// substring, somewhere in the serialized Evidence Package. This is
// deliberately the simple, literal sweep §9 describes — not a smarter
// context-aware check — and inherits the known limitation that a
// trivially common digit (e.g. "1") will often appear incidentally
// somewhere in the serialized JSON regardless of whether it is
// genuinely grounded. §9 accepts that trade-off explicitly ("a number
// that doesn't [appear] is treated as a suspected fabrication") in
// exchange for a mechanical, auditable rule with no invented judgment
// calls about which numbers "count."
function extractNumericTokens(text) {
  if (typeof text !== "string") return [];
  return text.match(/-?\d+(?:\.\d+)?/g) || [];
}

function checkNumericGrounding(output, serializedEvidence, errors) {
  for (const field of ["narrative_summary", "risk_commentary"]) {
    for (const token of extractNumericTokens(output[field])) {
      if (!serializedEvidence.includes(token)) {
        errors.push(`${field} contains a numeric claim ("${token}") not found anywhere in the supplied Evidence Package.`);
      }
    }
  }
}

// Defense-in-depth content sweep (§10 layer 4), independent of the §2
// structural allow-list: even though the output schema has no *field*
// that could hold a BUY/SELL/execution instruction, narrative_summary
// and risk_commentary are free text, and free text is not structurally
// incapable of containing that vocabulary. This is a second net, not
// the primary control.
const FORBIDDEN_CONTENT_PATTERNS = Object.freeze([
  /\bbuy(?:ing|s)?\b/i,
  /\bsell(?:ing|s)?\b/i,
  /\bbought\b/i,
  /\bsold\b/i,
  /\bgo\s+long\b/i,
  /\bgo\s+short\b/i,
  /\bexecut(?:e|ing|ed)\b/i,
  /\bplace\s+(a\s+|an\s+)?order\b/i,
  /\benter\s+(a\s+|the\s+)?(trade|position)\b/i,
  /\bclose\s+(the\s+)?position\b/i,
]);

function checkForbiddenContent(output, errors) {
  for (const field of ["narrative_summary", "risk_commentary"]) {
    const text = typeof output[field] === "string" ? output[field] : "";
    for (const pattern of FORBIDDEN_CONTENT_PATTERNS) {
      if (pattern.test(text)) {
        errors.push(`${field} contains forbidden execution/decision vocabulary matching ${pattern}.`);
      }
    }
  }
}

// output: an already schema-valid object (validateOutput.js's
// `.output`). evidencePackage: the exact, immutable Evidence Package
// (llm/evidencePackage.js's output) that was actually sent for this
// call — never a re-fetched or reconstructed copy. Returns
// { ok: true } or { ok: false, status: "REJECTED", errors }. Never
// mutates either argument.
function runHallucinationGuard(output, evidencePackage) {
  const errors = [];
  const safeEvidencePackage = isPlainObject(evidencePackage) ? evidencePackage : {};
  const serializedEvidence = JSON.stringify(safeEvidencePackage);

  checkEvidenceReferences(output, safeEvidencePackage, errors);
  checkUncertaintiesAcknowledged(output, safeEvidencePackage, errors);
  checkNumericGrounding(output, serializedEvidence, errors);
  checkForbiddenContent(output, errors);

  if (errors.length > 0) {
    return { ok: false, status: "REJECTED", errors };
  }
  return { ok: true, errors: [] };
}

module.exports = {
  resolveEvidencePath,
  runHallucinationGuard,
};
