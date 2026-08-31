// Offline tests for runHallucinationGuard() / resolveEvidencePath() —
// Step 5C. No network access. Operates on already schema-valid output
// objects (mirroring what validateClaudeOutput.js actually feeds this
// module) and a synthetic Evidence Package fixture shaped like
// llm/evidencePackage.js's real output.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runHallucinationGuard, resolveEvidencePath } = require("./hallucinationGuard");

function evidencePackage(overrides = {}) {
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
    risk_decision: {
      risk_level: "LOW",
      risk_decision: "RISK_ACCEPTABLE",
      risk_categories: ["LIQUIDITY"],
      risk_factors: [],
      position_size_status: "CALCULATED",
      invalidation_assessment: "Invalidated below 95.",
    },
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

// --- resolveEvidencePath ---

test("resolveEvidencePath resolves a real dotted+bracket path", () => {
  const pkg = evidencePackage();
  const result = resolveEvidencePath(pkg, "domain_evidence.macro.key_indicators[0]");
  assert.equal(result.resolved, true);
  assert.deepEqual(result.value, { indicator: "CPI", actual_value: 3.1 });
});

test("resolveEvidencePath fails for a path that does not exist", () => {
  const result = resolveEvidencePath(evidencePackage(), "domain_evidence.macro.key_indicators[5]");
  assert.equal(result.resolved, false);
});

test("resolveEvidencePath fails for a completely fabricated top-level path", () => {
  const result = resolveEvidencePath(evidencePackage(), "domain_evidence.forex.bias");
  assert.equal(result.resolved, false);
});

test("resolveEvidencePath refuses to traverse __proto__/constructor/prototype (prototype-pollution guard)", () => {
  assert.equal(resolveEvidencePath(evidencePackage(), "__proto__.polluted").resolved, false);
  assert.equal(resolveEvidencePath(evidencePackage(), "constructor.name").resolved, false);
  assert.equal(resolveEvidencePath(evidencePackage(), "domain_evidence.__proto__.toString").resolved, false);
});

test("resolveEvidencePath never resolves via an inherited (non-own) property", () => {
  const result = resolveEvidencePath(evidencePackage(), "domain_evidence.macro.toString");
  assert.equal(result.resolved, false);
});

test("resolveEvidencePath rejects an empty or non-string path", () => {
  assert.equal(resolveEvidencePath(evidencePackage(), "").resolved, false);
  assert.equal(resolveEvidencePath(evidencePackage(), undefined).resolved, false);
  assert.equal(resolveEvidencePath(evidencePackage(), 42).resolved, false);
});

// --- 5. Valid evidence references accepted ---

test("5. a valid evidence reference is accepted end to end", () => {
  const result = runHallucinationGuard(validOutput(), evidencePackage());
  assert.equal(result.ok, true);
});

test("5. multiple valid references across different domains are all accepted", () => {
  const output = validOutput({
    key_factors: [
      { factor: "CPI surprise", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.macro.key_indicators[0]" },
      { factor: "Regulatory clarity", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.news.key_events[0]" },
      { factor: "Uptrend", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.technical.trend_analysis" },
    ],
  });
  assert.equal(runHallucinationGuard(output, evidencePackage()).ok, true);
});

// --- 6. Fabricated evidence references rejected ---

test("6. a fabricated evidence reference rejects the whole output", () => {
  const output = validOutput({ key_factors: [{ factor: "Invented factor", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.macro.key_indicators[99]" }] });
  const result = runHallucinationGuard(output, evidencePackage());
  assert.equal(result.ok, false);
  assert.equal(result.status, "REJECTED");
  assert.ok(result.errors.some((e) => e.includes("does not resolve")));
});

test("6. one fabricated reference among several valid ones still rejects the WHOLE output (never silently drops just that factor)", () => {
  const output = validOutput({
    key_factors: [
      { factor: "Real", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.macro.key_indicators[0]" },
      { factor: "Fabricated", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.forex.nonexistent" },
    ],
  });
  const result = runHallucinationGuard(output, evidencePackage());
  assert.equal(result.ok, false);
});

// --- 7. Unsupported numbers rejected ---

test("7. a numeric claim not present anywhere in the Evidence Package is rejected", () => {
  const output = validOutput({ narrative_summary: "BTC is expected to reach 999999 soon." });
  const result = runHallucinationGuard(output, evidencePackage());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("numeric claim")));
});

test("7. a numeric claim that IS present in the Evidence Package is accepted", () => {
  const output = validOutput({ risk_commentary: "The CPI reading of 3.1 supports this assessment." });
  const result = runHallucinationGuard(output, evidencePackage());
  assert.equal(result.ok, true);
});

// --- 8. Unsupported factual claims rejected ---

test("8. an uncertainties_acknowledged entry with no basis in the Evidence Package is rejected", () => {
  const output = validOutput({ uncertainties_acknowledged: ["The Fed will cut rates next week."] });
  const result = runHallucinationGuard(output, evidencePackage());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("no basis")));
});

test("8. an uncertainties_acknowledged entry that paraphrases (fuzzy-subset-matches) a real one is accepted", () => {
  const output = validOutput({ uncertainties_acknowledged: ["Macro surprise data"] });
  const result = runHallucinationGuard(output, evidencePackage());
  assert.equal(result.ok, true);
});

test("8. an uncertainties_acknowledged entry grounded in `warnings` (not just `uncertainties`) is accepted", () => {
  const output = validOutput({ uncertainties_acknowledged: ["Sentiment sample size is small."] });
  const result = runHallucinationGuard(output, evidencePackage());
  assert.equal(result.ok, true);
});

// --- 10. BUY/SELL or execution content rejected ---

test("10. narrative_summary containing BUY/SELL vocabulary is rejected", () => {
  for (const phrase of ["You should buy BTC now.", "Consider selling before the close.", "Go long here.", "Go short into resistance."]) {
    const result = runHallucinationGuard(validOutput({ narrative_summary: phrase }), evidencePackage());
    assert.equal(result.ok, false, `expected "${phrase}" to be rejected`);
  }
});

test("10. risk_commentary containing execution vocabulary is rejected", () => {
  const result = runHallucinationGuard(validOutput({ risk_commentary: "Execute the trade despite the warning." }), evidencePackage());
  assert.equal(result.ok, false);
});

test("plain risk/market vocabulary that is not an execution instruction is accepted (no false positive)", () => {
  const output = validOutput({ narrative_summary: "The Risk Manager's decision reflects elevated volatility in the current setup." });
  assert.equal(runHallucinationGuard(output, evidencePackage()).ok, true);
});

// --- 13. Original Evidence Package is never mutated ---

test("13. runHallucinationGuard never mutates the Evidence Package it is given", () => {
  const pkg = evidencePackage();
  const before = JSON.parse(JSON.stringify(pkg));
  runHallucinationGuard(validOutput(), pkg);
  runHallucinationGuard(validOutput({ narrative_summary: "invented 555555 numbers" }), pkg);
  assert.deepEqual(pkg, before);
});

test("13. runHallucinationGuard never mutates the output it is given", () => {
  const output = validOutput();
  const before = JSON.parse(JSON.stringify(output));
  runHallucinationGuard(output, evidencePackage());
  assert.deepEqual(output, before);
});

// --- 14. Guard is deterministic ---

test("14. runHallucinationGuard is deterministic across repeated calls with the same inputs", () => {
  const output = validOutput();
  const pkg = evidencePackage();
  assert.deepEqual(runHallucinationGuard(output, pkg), runHallucinationGuard(output, pkg));
});

// --- 15/16/17. No network, no credentials, no production imports ---

test("15/16/17. this module has no network access, no credential reference, and no production-pipeline imports", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("./hallucinationGuard.js"), "utf8");
  const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/\bfetch\(/.test(codeOnly));
  assert.ok(!/process\.env/.test(codeOnly));
  assert.ok(!/apiKey/i.test(codeOnly));
  const requireLines = src.match(/require\("[^"]+"\)/g) || [];
  assert.deepEqual(requireLines.filter((l) => /orchestrator|agents\/|providers\/|server\.js|app\.js/i.test(l)), []);
});

// --- Malformed / missing evidence package handling ---

test("a missing/malformed evidencePackage is handled safely (treated as empty), never throws", () => {
  for (const bad of [undefined, null, "not an object", 42]) {
    assert.doesNotThrow(() => runHallucinationGuard(validOutput({ key_factors: [] }), bad));
  }
});

test("an evidence_ref is rejected (not accepted vacuously) when the Evidence Package is empty", () => {
  const result = runHallucinationGuard(validOutput(), {});
  assert.equal(result.ok, false);
});
