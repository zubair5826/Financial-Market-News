// Offline tests for validateOutputSchema() — Step 5C. Pure structural
// validation, no network, no evidence package involved at all.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateOutputSchema,
  OUTPUT_SCHEMA_VERSION,
  MAX_NARRATIVE_SUMMARY_LENGTH,
  MAX_KEY_FACTORS,
  MAX_LIST_LENGTH,
} = require("./validateOutput");

function validOutput(overrides = {}) {
  return {
    output_schema_version: OUTPUT_SCHEMA_VERSION,
    narrative_summary: "The setup is supported by aligned news and macro signals.",
    key_factors: [{ factor: "Positive CPI surprise", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.macro.key_indicators[0]" }],
    risk_commentary: "Risk Manager assessed this as acceptable given current volatility.",
    uncertainties_acknowledged: ["Some uncertainty."],
    caveats: ["This is not financial advice."],
    ...overrides,
  };
}

// 1. Valid output accepted.
test("1. a fully valid output is accepted", () => {
  const result = validateOutputSchema(validOutput());
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.ok(result.output);
});

// 2. Malformed output rejected.
test("2. a non-object output is rejected", () => {
  for (const bad of [null, undefined, "a string", 42, ["array"], true]) {
    const result = validateOutputSchema(bad);
    assert.equal(result.valid, false);
    assert.equal(result.status, "INVALID_OUTPUT");
  }
});

test("2. key_factors that is not an array is rejected", () => {
  const result = validateOutputSchema(validOutput({ key_factors: "not an array" }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("key_factors must be an array")));
});

test("2. a key_factors entry that is not an object is rejected", () => {
  const result = validateOutputSchema(validOutput({ key_factors: ["not an object"] }));
  assert.equal(result.valid, false);
});

// 3. Missing required fields rejected.
test("3. each individually-missing required field is rejected", () => {
  for (const field of ["output_schema_version", "narrative_summary", "key_factors", "risk_commentary", "uncertainties_acknowledged", "caveats"]) {
    const output = validOutput();
    delete output[field];
    const result = validateOutputSchema(output);
    assert.equal(result.valid, false, `expected ${field} to be required`);
    assert.ok(result.errors.some((e) => e.includes(field)), `expected an error mentioning ${field}`);
  }
});

test("3. an empty object is rejected with every required field listed as missing", () => {
  const result = validateOutputSchema({});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Missing required field(s)")));
});

// 4. Unexpected/forbidden fields rejected.
test("4. an unexpected extra top-level field rejects the whole output", () => {
  const result = validateOutputSchema(validOutput({ extra_field: "should not be allowed" }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Disallowed field")));
});

test("4. each explicitly forbidden field name rejects the output, wherever it appears", () => {
  for (const forbidden of ["risk_decision", "decision_status", "recommendation", "override", "action", "confidence_score"]) {
    const result = validateOutputSchema(validOutput({ [forbidden]: "value" }));
    assert.equal(result.valid, false, `expected ${forbidden} to be rejected`);
  }
});

test("4. forbidden field names nested inside key_factors[] also reject the output", () => {
  const output = validOutput({
    key_factors: [{ factor: "x", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.macro.key_indicators[0]", price: 123 }],
  });
  const result = validateOutputSchema(output);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("disallowed field")));
});

test("4. BUY/SELL/execution-shaped field names are rejected", () => {
  for (const forbidden of ["buy", "sell", "execute", "price", "quantity", "position_size", "leverage"]) {
    const result = validateOutputSchema(validOutput({ [forbidden]: "value" }));
    assert.equal(result.valid, false, `expected ${forbidden} to be rejected`);
  }
});

test("output_schema_version must match exactly", () => {
  const result = validateOutputSchema(validOutput({ output_schema_version: "llm-output-v2" }));
  assert.equal(result.valid, false);
});

test("direction must be one of the closed enum values", () => {
  const result = validateOutputSchema(
    validOutput({ key_factors: [{ factor: "x", direction: "BULLISH", evidence_ref: "domain_evidence.macro.key_indicators[0]" }] })
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("direction")));
});

test("every closed enum direction value is individually accepted", () => {
  for (const direction of ["SUPPORTIVE", "CONTRARY", "NEUTRAL"]) {
    const result = validateOutputSchema(validOutput({ key_factors: [{ factor: "x", direction, evidence_ref: "domain_evidence.macro.key_indicators[0]" }] }));
    assert.equal(result.valid, true, `expected ${direction} to be accepted`);
  }
});

test("narrative_summary exceeding the max length is rejected", () => {
  const result = validateOutputSchema(validOutput({ narrative_summary: "x".repeat(MAX_NARRATIVE_SUMMARY_LENGTH + 1) }));
  assert.equal(result.valid, false);
});

test("narrative_summary at exactly the max length is accepted", () => {
  const result = validateOutputSchema(validOutput({ narrative_summary: "x".repeat(MAX_NARRATIVE_SUMMARY_LENGTH) }));
  assert.equal(result.valid, true);
});

test("key_factors exceeding the max count is rejected", () => {
  const many = Array.from({ length: MAX_KEY_FACTORS + 1 }, (_, i) => ({
    factor: `factor ${i}`,
    direction: "NEUTRAL",
    evidence_ref: "domain_evidence.macro.key_indicators[0]",
  }));
  const result = validateOutputSchema(validOutput({ key_factors: many }));
  assert.equal(result.valid, false);
});

test("uncertainties_acknowledged/caveats exceeding the max length is rejected", () => {
  const many = Array.from({ length: MAX_LIST_LENGTH + 1 }, (_, i) => `item ${i}`);
  assert.equal(validateOutputSchema(validOutput({ uncertainties_acknowledged: many })).valid, false);
  assert.equal(validateOutputSchema(validOutput({ caveats: many })).valid, false);
});

test("uncertainties_acknowledged/caveats containing a non-string entry is rejected", () => {
  assert.equal(validateOutputSchema(validOutput({ uncertainties_acknowledged: [42] })).valid, false);
  assert.equal(validateOutputSchema(validOutput({ caveats: [{ not: "a string" }] })).valid, false);
});

test("empty uncertainties_acknowledged/caveats arrays are valid (nothing to acknowledge is not an error)", () => {
  const result = validateOutputSchema(validOutput({ uncertainties_acknowledged: [], caveats: [] }));
  assert.equal(result.valid, true);
});

// Deterministic / no mutation.
test("validateOutputSchema never mutates the object it is given", () => {
  const output = validOutput();
  const before = JSON.parse(JSON.stringify(output));
  validateOutputSchema(output);
  assert.deepEqual(output, before);
});

test("validateOutputSchema returns a fresh copy, never the original reference", () => {
  const output = validOutput();
  const result = validateOutputSchema(output);
  assert.notEqual(result.output, output);
  assert.notEqual(result.output.key_factors, output.key_factors);
});

test("validateOutputSchema is deterministic across repeated calls with the same input", () => {
  const output = validOutput();
  const result1 = validateOutputSchema(output);
  const result2 = validateOutputSchema(output);
  assert.deepEqual(result1, result2);
});

// Isolation.
test("this module never requires the orchestrator, any agent, a provider adapter, server.js, or app.js", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("./validateOutput.js"), "utf8");
  const requireLines = src.match(/require\("[^"]+"\)/g) || [];
  assert.deepEqual(requireLines.filter((l) => /orchestrator|agents\/|providers\/|server\.js|app\.js/i.test(l)), []);
});

test("this module never references process.env, fetch, or a credential-shaped identifier", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("./validateOutput.js"), "utf8");
  const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/process\.env/.test(codeOnly));
  assert.ok(!/\bfetch\(/.test(codeOnly));
  assert.ok(!/apiKey/i.test(codeOnly));
});
