// Offline tests for assertNoRiskOverride() — Step 5C. No network
// access. This guard's job is narrow: reject commentary that
// contradicts a REJECTION-type Risk Manager decision; it never judges
// commentary about an acceptable decision.

const test = require("node:test");
const assert = require("node:assert/strict");
const { assertNoRiskOverride } = require("./assertNoRiskOverride");

function output(overrides = {}) {
  return {
    narrative_summary: "The setup shows aligned bullish signals across domains.",
    risk_commentary: "The Risk Manager rejected this setup due to elevated volatility and conflicting signals.",
    ...overrides,
  };
}

// --- 9. Risk-decision override rejected ---

test("9. commentary asserting a rejected setup is 'safe' is rejected", () => {
  const result = assertNoRiskOverride(output({ risk_commentary: "Despite the rejection, the setup is safe to enter." }), "RISK_TOO_HIGH");
  assert.equal(result.ok, false);
  assert.equal(result.status, "REJECTED");
});

test("9. commentary suggesting to proceed anyway is rejected", () => {
  const result = assertNoRiskOverride(output({ risk_commentary: "You could proceed anyway if you accept the volatility." }), "RISK_TOO_HIGH");
  assert.equal(result.ok, false);
});

test("9. commentary suggesting how to work around or size around the risk is rejected", () => {
  assert.equal(assertNoRiskOverride(output({ risk_commentary: "You can work around the risk with a smaller stop." }), "RISK_TOO_HIGH").ok, false);
  assert.equal(assertNoRiskOverride(output({ risk_commentary: "Consider how to size around the risk here." }), "RISK_TOO_HIGH").ok, false);
});

test("9. commentary in narrative_summary (not just risk_commentary) is also checked", () => {
  const result = assertNoRiskOverride(output({ narrative_summary: "Overall, the setup is safe to enter despite the rejection." }), "RISK_TOO_HIGH");
  assert.equal(result.ok, false);
});

test("9. commentary that merely explains the rejection (never contradicting it) is accepted", () => {
  const result = assertNoRiskOverride(
    output({ risk_commentary: "The Risk Manager rejected this setup because volatility and conflicting signals exceeded acceptable thresholds." }),
    "RISK_TOO_HIGH"
  );
  assert.equal(result.ok, true);
});

// --- 11. Deterministic Risk Manager decision remains authoritative ---

test("11. an acceptable risk decision is never flagged, even with strongly positive commentary", () => {
  const result = assertNoRiskOverride(output({ risk_commentary: "The setup is safe to enter given the Risk Manager's acceptable rating." }), "RISK_ACCEPTABLE");
  assert.equal(result.ok, true);
});

test("11. the guard only activates for a genuine rejection-shaped decision value", () => {
  for (const decision of ["RISK_ACCEPTABLE", "LOW", "MEDIUM", undefined, null, "", "UNKNOWN"]) {
    const result = assertNoRiskOverride(output({ risk_commentary: "This is safe to enter." }), decision);
    assert.equal(result.ok, true, `expected decision ${decision} not to trigger the guard`);
  }
});

test("11. the guard activates for both RISK_TOO_HIGH and any decision containing REJECT, case-insensitively", () => {
  for (const decision of ["RISK_TOO_HIGH", "risk_too_high", "REJECTED", "setup_rejected"]) {
    const result = assertNoRiskOverride(output({ risk_commentary: "The setup is safe to enter." }), decision);
    assert.equal(result.ok, false, `expected decision ${decision} to trigger the guard`);
  }
});

test("11. the decision string itself is never altered or returned as a new value — only read", () => {
  const decision = "RISK_TOO_HIGH";
  assertNoRiskOverride(output(), decision);
  assert.equal(decision, "RISK_TOO_HIGH");
});

// --- 13. Never mutates its arguments ---

test("13. assertNoRiskOverride never mutates the output object it is given", () => {
  const o = output({ risk_commentary: "The setup is safe to enter anyway." });
  const before = JSON.parse(JSON.stringify(o));
  assertNoRiskOverride(o, "RISK_TOO_HIGH");
  assert.deepEqual(o, before);
});

// --- 14. Deterministic ---

test("14. assertNoRiskOverride is deterministic across repeated calls", () => {
  const o = output({ risk_commentary: "Safe to enter regardless." });
  assert.deepEqual(assertNoRiskOverride(o, "RISK_TOO_HIGH"), assertNoRiskOverride(o, "RISK_TOO_HIGH"));
});

// --- 15/16/17. No network, no credentials, no production imports ---

test("15/16/17. this module has no network access, no credential reference, and no production-pipeline imports", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("./assertNoRiskOverride.js"), "utf8");
  const codeOnly = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/\bfetch\(/.test(codeOnly));
  assert.ok(!/process\.env/.test(codeOnly));
  assert.ok(!/apiKey/i.test(codeOnly));
  assert.equal((src.match(/require\(/g) || []).length, 0);
});

// Safe handling of missing/malformed fields.
test("missing/non-string narrative_summary or risk_commentary is treated as empty text, never throws", () => {
  assert.doesNotThrow(() => assertNoRiskOverride({}, "RISK_TOO_HIGH"));
  assert.doesNotThrow(() => assertNoRiskOverride({ narrative_summary: 42, risk_commentary: null }, "RISK_TOO_HIGH"));
  const result = assertNoRiskOverride({}, "RISK_TOO_HIGH");
  assert.equal(result.ok, true);
});
