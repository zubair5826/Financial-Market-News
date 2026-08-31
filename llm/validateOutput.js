// Claude Output Schema Validator — Step 5C, per
// LLM_REASONING_LAYER_DESIGN.md §2 (LLM Output Schema) and §8 (Schema
// Validation). Purely structural: field presence, types, the closed
// `direction` enum, and array/string length bounds. Content-level
// grounding (evidence references, numeric claims, forbidden vocabulary)
// and the Risk-Manager boundary are deliberately NOT checked here —
// those live in hallucinationGuard.js and assertNoRiskOverride.js
// respectively (§9/§11), which only ever run on output that already
// passed this file's structural check.
//
// STRICT ALLOW-LIST, per §8: a field not on the §2 list is a
// validation failure for the entire output, never ignorable extra
// content. No partial trust (§8): a single failure discards the whole
// output — this file never returns a partially-sanitized object.
//
// This is offline, pure, synchronous validation: no network access, no
// credentials, no import of the orchestrator/any agent/provider
// adapter/server.js/app.js, and no ability to mutate the object it is
// given (every accepted output is deep-copied, never returned by
// reference).

const OUTPUT_SCHEMA_VERSION = "llm-output-v1";

// Exactly the §2 schema's top-level fields — every one of them
// required (the schema has no optional top-level field).
const REQUIRED_TOP_LEVEL_FIELDS = Object.freeze([
  "output_schema_version",
  "narrative_summary",
  "key_factors",
  "risk_commentary",
  "uncertainties_acknowledged",
  "caveats",
]);

const REQUIRED_KEY_FACTOR_FIELDS = Object.freeze(["factor", "direction", "evidence_ref"]);

// §2's closed enum for key_factors[].direction.
const DIRECTION_VALUES = Object.freeze(["SUPPORTIVE", "CONTRARY", "NEUTRAL"]);

// Bounds. Not arbitrary: maxOutputTokens is capped at 600 (§5) so a
// well-behaved real call physically cannot produce much more than
// this; these bounds exist to reject a malformed/adversarial payload
// cheaply and structurally, before any grounding check even runs, and
// to keep a validated package small and reviewable. Deliberately
// generous relative to §5's token cap, never a tight fit to "expected"
// output size.
const MAX_NARRATIVE_SUMMARY_LENGTH = 800; // "<= ~800 chars" per §2, enforced as a hard cap
const MAX_RISK_COMMENTARY_LENGTH = 800; // same order of magnitude as narrative_summary; §2 sets no separate bound
const MAX_KEY_FACTORS = 10;
const MAX_LIST_LENGTH = 10; // uncertainties_acknowledged / caveats

// §2 explicitly requires these fields to never exist anywhere in the
// output — checked both as a top-level field name (structural allow-
// list, above) AND recursively, in case a disallowed field is nested
// inside a key_factors[] entry rather than placed at the top level.
// This list is deliberately broader than the exact §2 wording (adding
// obvious synonyms) as defense-in-depth, matching §10's "layered,
// never relying on a single control" principle — it is not itself the
// authoritative boundary (the allow-list above is), just a second net.
const FORBIDDEN_FIELD_NAMES = Object.freeze([
  "risk_decision",
  "decision_status",
  "recommendation",
  "recommendation_type",
  "override",
  "action",
  "confidence_score",
  "buy",
  "sell",
  "execute",
  "execution",
  "price",
  "quantity",
  "position_size",
  "leverage",
  "target_price",
  "stop_loss",
  "take_profit",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Recursively collects every own key name in a JSON-shaped value —
// used to catch a forbidden field name nested anywhere in the
// structure, not just at the top level.
function collectAllKeyNames(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectAllKeyNames(item, keys);
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      keys.push(key);
      collectAllKeyNames(value[key], keys);
    }
  }
  return keys;
}

function findForbiddenFieldNames(rawOutput) {
  const allKeys = collectAllKeyNames(rawOutput).map((k) => k.toLowerCase());
  return FORBIDDEN_FIELD_NAMES.filter((forbidden) => allKeys.includes(forbidden.toLowerCase()));
}

function validateKeyFactor(entry, index, errors) {
  if (!isPlainObject(entry)) {
    errors.push(`key_factors[${index}] must be an object.`);
    return;
  }
  const extraKeys = Object.keys(entry).filter((k) => !REQUIRED_KEY_FACTOR_FIELDS.includes(k));
  if (extraKeys.length > 0) {
    errors.push(`key_factors[${index}] contains disallowed field(s): ${extraKeys.join(", ")}.`);
  }
  if (!isNonEmptyString(entry.factor)) {
    errors.push(`key_factors[${index}].factor must be a non-empty string.`);
  }
  if (!DIRECTION_VALUES.includes(entry.direction)) {
    errors.push(`key_factors[${index}].direction must be one of ${DIRECTION_VALUES.join("|")}.`);
  }
  if (!isNonEmptyString(entry.evidence_ref)) {
    errors.push(`key_factors[${index}].evidence_ref must be a non-empty string.`);
  }
}

// Validates rawOutput against the exact §2 schema. Returns
// { valid: true, output } with a fresh, deep-copied object (never the
// original reference) on success, or { valid: false, status:
// "INVALID_OUTPUT", errors } — with no `output` field at all — on any
// failure, however small. This function never mutates rawOutput.
function validateOutputSchema(rawOutput) {
  const errors = [];

  if (!isPlainObject(rawOutput)) {
    return { valid: false, status: "INVALID_OUTPUT", errors: ["Output must be a plain object."] };
  }

  const providedKeys = Object.keys(rawOutput);
  const missingKeys = REQUIRED_TOP_LEVEL_FIELDS.filter((k) => !providedKeys.includes(k));
  const extraKeys = providedKeys.filter((k) => !REQUIRED_TOP_LEVEL_FIELDS.includes(k));

  if (missingKeys.length > 0) errors.push(`Missing required field(s): ${missingKeys.join(", ")}.`);
  if (extraKeys.length > 0) errors.push(`Disallowed field(s) present: ${extraKeys.join(", ")}.`);

  const forbidden = findForbiddenFieldNames(rawOutput);
  if (forbidden.length > 0) errors.push(`Forbidden field name(s) present anywhere in output: ${forbidden.join(", ")}.`);

  if (rawOutput.output_schema_version !== OUTPUT_SCHEMA_VERSION) {
    errors.push(`output_schema_version must be exactly "${OUTPUT_SCHEMA_VERSION}".`);
  }

  if (typeof rawOutput.narrative_summary !== "string") {
    errors.push("narrative_summary must be a string.");
  } else if (rawOutput.narrative_summary.length > MAX_NARRATIVE_SUMMARY_LENGTH) {
    errors.push(`narrative_summary exceeds the maximum length of ${MAX_NARRATIVE_SUMMARY_LENGTH} characters.`);
  }

  if (typeof rawOutput.risk_commentary !== "string") {
    errors.push("risk_commentary must be a string.");
  } else if (rawOutput.risk_commentary.length > MAX_RISK_COMMENTARY_LENGTH) {
    errors.push(`risk_commentary exceeds the maximum length of ${MAX_RISK_COMMENTARY_LENGTH} characters.`);
  }

  if (!Array.isArray(rawOutput.key_factors)) {
    errors.push("key_factors must be an array.");
  } else if (rawOutput.key_factors.length > MAX_KEY_FACTORS) {
    errors.push(`key_factors exceeds the maximum length of ${MAX_KEY_FACTORS} entries.`);
  } else {
    rawOutput.key_factors.forEach((entry, index) => validateKeyFactor(entry, index, errors));
  }

  for (const field of ["uncertainties_acknowledged", "caveats"]) {
    const value = rawOutput[field];
    if (!Array.isArray(value)) {
      errors.push(`${field} must be an array.`);
    } else if (value.length > MAX_LIST_LENGTH) {
      errors.push(`${field} exceeds the maximum length of ${MAX_LIST_LENGTH} entries.`);
    } else if (!value.every((item) => typeof item === "string")) {
      errors.push(`${field} must contain only strings.`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, status: "INVALID_OUTPUT", errors };
  }

  // Deep copy via JSON round-trip — safe here because every field just
  // passed a strict string/array-of-strings/plain-object type check
  // above, so nothing non-JSON-serializable (functions, symbols,
  // undefined-in-arrays) can be present.
  const output = JSON.parse(JSON.stringify(rawOutput));
  return { valid: true, output, errors: [] };
}

module.exports = {
  OUTPUT_SCHEMA_VERSION,
  REQUIRED_TOP_LEVEL_FIELDS,
  REQUIRED_KEY_FACTOR_FIELDS,
  DIRECTION_VALUES,
  FORBIDDEN_FIELD_NAMES,
  MAX_NARRATIVE_SUMMARY_LENGTH,
  MAX_RISK_COMMENTARY_LENGTH,
  MAX_KEY_FACTORS,
  MAX_LIST_LENGTH,
  validateOutputSchema,
};
