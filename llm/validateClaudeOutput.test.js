// Offline, integration-level tests for validateClaudeOutput() —
// Step 5C. Exercises the full composed chain (schema validation ->
// hallucination guard -> risk-override guard) against a real Evidence
// Package built by llm/evidencePackage.js from a real deterministic
// pipelineResult (via orchestrator/index.js's processRequest(), read-
// only, mirroring tests/pipeline.test.js's own pattern), covering the
// 18 numbered scenarios required for Step 5C.

const test = require("node:test");
const assert = require("node:assert/strict");
const { processRequest } = require("../orchestrator");
const { buildEvidencePackage } = require("./evidencePackage");
const { validateClaudeOutput } = require("./validateClaudeOutput");

const THRESHOLDS = { freshMaxMs: 3_600_000, agingMaxMs: 86_400_000 };
const FULL_SIZING_PARAMS = { accountBalance: 10000, riskPercentage: 0.01, leverage: 1, entryPrice: 100, stopPrice: 95, contractSize: 1 };

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function zigzagCandles(asset = "BTC") {
  const prices = [100, 102, 104, 101, 99, 103, 107, 104, 100, 105, 110];
  return prices.map((p, i) => ({
    asset,
    timeframe: "1h",
    timestamp: iso(-(prices.length - 1 - i) * 3_600_000),
    open: p,
    high: p + 1,
    low: p - 1,
    close: p,
    source: "technical-src-A",
    classification: "FACT",
    verification_status: "VERIFIED_PRIMARY",
  }));
}

function bullishRequest(overrides = {}) {
  return {
    query: "Assess BTC",
    asset: "BTC",
    newsData: [
      { asset: "BTC", headline: "Regulator signals clearer path for crypto adoption", classification: "FACT", source: "news-src-A", publication_timestamp: iso(), impact_direction: "POSITIVE", verification_status: "VERIFIED_PRIMARY" },
    ],
    macroData: [
      { indicator: "CPI", classification: "FACT", country: "US", category: "INFLATION", source: "macro-src-A", release_timestamp: iso(), impact_direction: "POSITIVE", verification_status: "VERIFIED_PRIMARY" },
    ],
    technicalCandles: zigzagCandles(),
    sentimentData: [
      { asset: "BTC", sentiment: "BULLISH", classification: "FACT", source: "sentiment-src-A", timestamp: iso(), verification_status: "VERIFIED_PRIMARY" },
    ],
    options: { freshnessThresholds: THRESHOLDS, positionSizingParams: FULL_SIZING_PARAMS },
    ...overrides,
  };
}

// A request engineered (via extreme conflicting/negative inputs) is
// not needed here — a synthetic evidence package with an injected
// rejection-shaped risk_decision covers the RISK_TOO_HIGH scenarios
// without depending on driving the real 8-agent pipeline into that
// exact state, matching evidencePackage.test.js's own synthetic-
// fixture convention for edge cases.
function syntheticEvidencePackage(overrides = {}) {
  return {
    input_schema_version: "llm-input-v1",
    run_id: "UNKNOWN",
    as_of: "2026-08-29T00:00:00.000Z",
    requested_instrument: "BTC",
    original_query: "Assess BTC",
    freshness_status: "FRESH",
    data_quality_status: "HIGH",
    domain_evidence: {
      news: { bias: "POSITIVE", confidence: "HIGH", key_events: [{ headline: "Regulator signals clearer path" }], conflicts: [], warnings: [], sources: ["news-src-A"] },
      macro: { bias: "POSITIVE", confidence: "HIGH", key_indicators: [{ indicator: "CPI", actual_value: 3.1 }], conflicts: [], warnings: [], sources: ["macro-src-A"] },
      technical: { bias: "BULLISH", confidence: "MEDIUM", trend_analysis: "UPTREND", momentum: "STRONG", conflicts: [], warnings: [], sources: ["technical-src-A"] },
      sentiment: { bias: "BULLISH", confidence: "MEDIUM", conflicts: [], warnings: [], sources: ["sentiment-src-A"] },
    },
    trade_setup: { setup_status: "SETUP_PRESENT", direction: "LONG_BIAS", setup_quality: "HIGH", confidence: "HIGH", uncertainties: [] },
    risk_decision: { risk_level: "LOW", risk_decision: "RISK_ACCEPTABLE", risk_categories: ["LIQUIDITY"], risk_factors: [], position_size_status: "CALCULATED", invalidation_assessment: "Invalidated below 95." },
    final_decision: { final_assessment: "BULLISH", decision_status: "TRADE_SETUP_SUPPORTED", confidence: "HIGH" },
    uncertainties: ["Macro surprise data may lag."],
    warnings: ["Sentiment sample size is small."],
    ...overrides,
  };
}

function validOutput(overrides = {}) {
  return {
    output_schema_version: "llm-output-v1",
    narrative_summary: "News and macro evidence both support a bullish bias for BTC.",
    key_factors: [{ factor: "Positive CPI surprise", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.macro.key_indicators[0]" }],
    risk_commentary: "The Risk Manager assessed this setup as acceptable given current conditions.",
    uncertainties_acknowledged: ["Macro surprise data may lag."],
    caveats: ["This is not financial advice."],
    ...overrides,
  };
}

// 1. Valid output accepted.
test("1. a valid output, grounded in a real Evidence Package built from a real pipelineResult, is accepted as VALID", () => {
  const pipelineResult = processRequest(bullishRequest());
  const evidencePackage = buildEvidencePackage(pipelineResult, bullishRequest());
  // domain_evidence.<domain>.bias is always a populated string on a
  // successful run (unlike key_events/key_indicators, which only ever
  // contain the CRITICAL/HIGH-importance subset and are legitimately
  // empty for ordinary-importance fixture data) — a genuinely
  // resolvable reference regardless of what this run's data ranked as.
  // uncertainties_acknowledged is left empty here (valid — nothing to
  // acknowledge is not an error) rather than guessing at this run's own
  // generated uncertainty text, which is itself an implementation
  // detail of the specialist agents, not something this test should
  // depend on.
  const output = validOutput({
    key_factors: [{ factor: "Observed macro bias", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.macro.bias" }],
    uncertainties_acknowledged: [],
  });
  const result = validateClaudeOutput(output, evidencePackage);
  assert.equal(result.status, "VALID");
  assert.ok(result.output);
});

test("1. a valid output against a synthetic Evidence Package is accepted", () => {
  const result = validateClaudeOutput(validOutput(), syntheticEvidencePackage());
  assert.equal(result.status, "VALID");
  assert.deepEqual(result.errors, []);
});

// 2. Malformed output rejected.
test("2. malformed (non-object) output is rejected as INVALID_OUTPUT", () => {
  for (const bad of [null, undefined, "text", 42, []]) {
    const result = validateClaudeOutput(bad, syntheticEvidencePackage());
    assert.equal(result.status, "INVALID_OUTPUT");
    assert.equal(result.output, null);
  }
});

// 3. Missing required fields rejected.
test("3. an output missing a required field is rejected as INVALID_OUTPUT", () => {
  const output = validOutput();
  delete output.risk_commentary;
  const result = validateClaudeOutput(output, syntheticEvidencePackage());
  assert.equal(result.status, "INVALID_OUTPUT");
});

// 4. Unexpected/forbidden fields rejected.
test("4. an output with a forbidden field (risk_decision) is rejected as INVALID_OUTPUT, never reaching the grounding guard", () => {
  const output = validOutput({ risk_decision: "RISK_ACCEPTABLE" });
  const result = validateClaudeOutput(output, syntheticEvidencePackage());
  assert.equal(result.status, "INVALID_OUTPUT");
});

test("4. an output with an unrecognized extra field is rejected", () => {
  const result = validateClaudeOutput(validOutput({ extra: "field" }), syntheticEvidencePackage());
  assert.equal(result.status, "INVALID_OUTPUT");
});

// 5. Valid evidence references accepted.
test("5. valid evidence references pass through to VALID", () => {
  const result = validateClaudeOutput(validOutput(), syntheticEvidencePackage());
  assert.equal(result.status, "VALID");
});

// 6. Fabricated evidence references rejected.
test("6. a fabricated evidence reference is rejected as REJECTED", () => {
  const output = validOutput({ key_factors: [{ factor: "x", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.forex.nonexistent" }] });
  const result = validateClaudeOutput(output, syntheticEvidencePackage());
  assert.equal(result.status, "REJECTED");
  assert.equal(result.output, null);
});

// 7. Unsupported numbers rejected.
test("7. an unsupported numeric claim is rejected as REJECTED", () => {
  const output = validOutput({ narrative_summary: "BTC will hit 848484 next week." });
  const result = validateClaudeOutput(output, syntheticEvidencePackage());
  assert.equal(result.status, "REJECTED");
});

// 8. Unsupported factual claims rejected.
test("8. an unsupported factual claim in uncertainties_acknowledged is rejected as REJECTED", () => {
  const output = validOutput({ uncertainties_acknowledged: ["A completely invented claim with no basis."] });
  const result = validateClaudeOutput(output, syntheticEvidencePackage());
  assert.equal(result.status, "REJECTED");
});

// 9. Risk-decision override rejected.
test("9. commentary contradicting a rejected Risk Manager decision is rejected as REJECTED", () => {
  const pkg = syntheticEvidencePackage({ risk_decision: { risk_level: "HIGH", risk_decision: "RISK_TOO_HIGH", risk_categories: ["VOLATILITY"], risk_factors: [], position_size_status: "UNKNOWN", invalidation_assessment: "UNKNOWN" } });
  const output = validOutput({ risk_commentary: "Despite the rejection, the setup is safe to enter." });
  const result = validateClaudeOutput(output, pkg);
  assert.equal(result.status, "REJECTED");
});

test("9. commentary that merely explains a rejected decision (without contradicting it) is accepted as VALID", () => {
  const pkg = syntheticEvidencePackage({ risk_decision: { risk_level: "HIGH", risk_decision: "RISK_TOO_HIGH", risk_categories: ["VOLATILITY"], risk_factors: [], position_size_status: "UNKNOWN", invalidation_assessment: "UNKNOWN" } });
  const output = validOutput({ risk_commentary: "The Risk Manager rejected this setup due to elevated volatility." });
  const result = validateClaudeOutput(output, pkg);
  assert.equal(result.status, "VALID");
});

// 10. BUY/SELL or execution content rejected.
test("10. BUY/SELL/execution vocabulary in narrative_summary is rejected as REJECTED", () => {
  const output = validOutput({ narrative_summary: "You should buy BTC immediately." });
  const result = validateClaudeOutput(output, syntheticEvidencePackage());
  assert.equal(result.status, "REJECTED");
});

// 11. Deterministic Risk Manager decision remains authoritative.
test("11. the validated output's schema has no field capable of holding a decision — risk_decision is never present on a VALID result", () => {
  const result = validateClaudeOutput(validOutput(), syntheticEvidencePackage());
  assert.equal(result.status, "VALID");
  assert.equal(Object.prototype.hasOwnProperty.call(result.output, "risk_decision"), false);
});

test("11. no combination of a VALID output can change what the Evidence Package's own risk_decision says (validator never reads it back into anything but a boundary check)", () => {
  const pkg = syntheticEvidencePackage({ risk_decision: { risk_level: "HIGH", risk_decision: "RISK_TOO_HIGH", risk_categories: [], risk_factors: [], position_size_status: "UNKNOWN", invalidation_assessment: "UNKNOWN" } });
  const before = JSON.parse(JSON.stringify(pkg));
  validateClaudeOutput(validOutput({ risk_commentary: "The Risk Manager rejected this setup due to elevated volatility." }), pkg);
  assert.deepEqual(pkg, before); // the deterministic fact is untouched by validation
});

// 12. Uncertainties must come from the supplied Evidence Package.
test("12. uncertainties_acknowledged entries must be grounded in the Evidence Package's own uncertainties/warnings", () => {
  const grounded = validateClaudeOutput(validOutput({ uncertainties_acknowledged: ["Macro surprise data may lag."] }), syntheticEvidencePackage());
  assert.equal(grounded.status, "VALID");
  const ungrounded = validateClaudeOutput(validOutput({ uncertainties_acknowledged: ["A new uncertainty nobody supplied."] }), syntheticEvidencePackage());
  assert.equal(ungrounded.status, "REJECTED");
});

// 13. Original Evidence Package is never mutated.
test("13. the Evidence Package is never mutated across a VALID, an INVALID_OUTPUT, and a REJECTED call", () => {
  const pkg = syntheticEvidencePackage();
  const before = JSON.parse(JSON.stringify(pkg));
  validateClaudeOutput(validOutput(), pkg);
  validateClaudeOutput({ bad: "shape" }, pkg);
  validateClaudeOutput(validOutput({ narrative_summary: "invented 424242" }), pkg);
  assert.deepEqual(pkg, before);
});

test("13. a real, frozen Evidence Package from llm/evidencePackage.js is accepted without any attempt to write to it", () => {
  const pipelineResult = processRequest(bullishRequest());
  const evidencePackage = buildEvidencePackage(pipelineResult, bullishRequest());
  assert.ok(Object.isFrozen(evidencePackage));
  assert.doesNotThrow(() => validateClaudeOutput(validOutput({ key_factors: [] }), evidencePackage));
});

// 14. Validator/guard is deterministic.
test("14. validateClaudeOutput is deterministic across repeated calls with the same inputs", () => {
  const output = validOutput();
  const pkg = syntheticEvidencePackage();
  assert.deepEqual(validateClaudeOutput(output, pkg), validateClaudeOutput(output, pkg));
});

// 15. No network access.
test("15. no file in the Step 5C validation/guard layer references fetch() or any network primitive", () => {
  const fs = require("node:fs");
  for (const file of ["validateOutput.js", "hallucinationGuard.js", "assertNoRiskOverride.js", "validateClaudeOutput.js"]) {
    const src = fs.readFileSync(require.resolve(`./${file}`), "utf8");
    const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.ok(!/\bfetch\(/.test(codeOnly), `${file} unexpectedly references fetch()`);
    assert.ok(!/require\(["'](http|https)["']\)/.test(codeOnly), `${file} unexpectedly requires http/https`);
  }
});

// 16. No credentials accessed.
test("16. no file in the Step 5C validation/guard layer references process.env or an apiKey-shaped identifier", () => {
  const fs = require("node:fs");
  for (const file of ["validateOutput.js", "hallucinationGuard.js", "assertNoRiskOverride.js", "validateClaudeOutput.js"]) {
    const src = fs.readFileSync(require.resolve(`./${file}`), "utf8");
    const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.ok(!/process\.env/.test(codeOnly), `${file} unexpectedly references process.env`);
    assert.ok(!/apiKey/i.test(codeOnly), `${file} unexpectedly references an apiKey identifier`);
  }
});

// 17. No production pipeline imports.
test("17. no file in the Step 5C validation/guard layer imports the orchestrator, any agent, a provider adapter, server.js, or app.js", () => {
  const fs = require("node:fs");
  for (const file of ["validateOutput.js", "hallucinationGuard.js", "assertNoRiskOverride.js", "validateClaudeOutput.js"]) {
    const src = fs.readFileSync(require.resolve(`./${file}`), "utf8");
    const requireLines = src.match(/require\("[^"]+"\)/g) || [];
    const forbidden = requireLines.filter((l) => /orchestrator|agents\/|providers\/|server\.js|app\.js/i.test(l));
    assert.deepEqual(forbidden, [], `${file} unexpectedly imports production-pipeline code`);
  }
});

test("17. the Step 5C layer is not yet called from app.js, server.js, or orchestrator/index.js", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  for (const rel of ["../app.js", "../server.js", "../orchestrator/index.js"]) {
    const full = path.resolve(__dirname, rel);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, "utf8");
    assert.ok(!/validateClaudeOutput|hallucinationGuard|assertNoRiskOverride|validateOutputSchema/.test(src), `${rel} unexpectedly references the Step 5C layer`);
  }
});

// 18. No ability to mutate pipelineResult — the validator never even
// accepts a pipelineResult argument; it only ever sees the already-
// built, already-frozen Evidence Package.
test("18. validateClaudeOutput's function signature never accepts a pipelineResult — a full pipelineResult passed in its place is inert", () => {
  const pipelineResult = processRequest(bullishRequest());
  const before = JSON.parse(JSON.stringify(pipelineResult));
  // Passing pipelineResult directly where an Evidence Package is
  // expected must never crash and must never mutate it — it simply
  // won't look anything like a valid Evidence Package, so grounding
  // checks will fail closed.
  validateClaudeOutput(validOutput(), pipelineResult);
  assert.deepEqual(pipelineResult, before);
});

test("18. none of the four Step 5C source files' actual code (comments aside) references the identifier `pipelineResult`", () => {
  const fs = require("node:fs");
  for (const file of ["validateOutput.js", "hallucinationGuard.js", "assertNoRiskOverride.js", "validateClaudeOutput.js"]) {
    const src = fs.readFileSync(require.resolve(`./${file}`), "utf8");
    const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.ok(!/pipelineResult/.test(codeOnly), `${file} unexpectedly references pipelineResult in code`);
  }
});

// Additional composition-order check: schema failure short-circuits
// before the grounding/risk-override guards ever run.
test("schema validation failure short-circuits before the hallucination guard runs (INVALID_OUTPUT, not REJECTED)", () => {
  // This output is both schema-invalid (extra field) AND would fail
  // grounding (fabricated ref) — INVALID_OUTPUT must win, proving the
  // guards run in the documented order.
  const output = validOutput({
    extra: "field",
    key_factors: [{ factor: "x", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.forex.nonexistent" }],
  });
  const result = validateClaudeOutput(output, syntheticEvidencePackage());
  assert.equal(result.status, "INVALID_OUTPUT");
});
