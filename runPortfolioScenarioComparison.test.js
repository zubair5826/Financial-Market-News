// Offline tests for the Portfolio Scenario Comparison CLI wrapper —
// Step 89. Focused on the wrapper's own thin logic only (argv
// reconstruction, JSON parsing, pass-through, no reshaping) — does
// NOT duplicate the extensive domain-level coverage already in
// investment/portfolioScenarioComparison.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runFromArgv } = require("./runPortfolioScenarioComparison");
const { comparePortfolioScenarios } = require("./investment/portfolioScenarioComparison");
const { RESULT_STATUS } = require("./investment/portfolioConstruction");

async function withNetworkGuard(fn) {
  const original = global.fetch;
  let called = false;
  global.fetch = (...args) => {
    called = true;
    throw new Error(`Unexpected real network call during an offline test: ${args[0]}`);
  };
  try {
    const value = await fn();
    return { value, networkCalled: called };
  } finally {
    global.fetch = original;
  }
}

const VALID_BASE_TEXT =
  "I have CAD $10,000 and want to invest for 5 years. I am comfortable with moderate risk. I want balanced growth.";

const VALID_REQUEST = {
  baseText: VALID_BASE_TEXT,
  scenarios: [
    { label: "moderate", profileOverrides: { riskTolerance: "MODERATE" } },
    { label: "aggressive", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
  ],
};

function argvFor(request) {
  return ["node", "runPortfolioScenarioComparison.js", JSON.stringify(request)];
}

// A. Valid two-scenario JSON request.
test("A. a valid two-scenario JSON request produces a genuine comparison result", () => {
  const result = runFromArgv(argvFor(VALID_REQUEST));
  assert.equal(result.status, RESULT_STATUS.READY);
  assert.equal(result.scenarios.length, 2);
  assert.equal(result.scenarios[0].label, "moderate");
  assert.equal(result.scenarios[1].label, "aggressive");
});

// B. Result is deep-equal to a direct comparePortfolioScenarios() call.
test("B. the wrapper result is deep-equal to calling comparePortfolioScenarios() directly with the same parsed request", () => {
  const direct = comparePortfolioScenarios(VALID_REQUEST);
  const viaWrapper = runFromArgv(argvFor(VALID_REQUEST));
  assert.deepEqual(viaWrapper, direct);
});

// C. Exact 7-key top-level output contract.
test("C. the response contains exactly the frozen 7 top-level keys", () => {
  const result = runFromArgv(argvFor(VALID_REQUEST));
  assert.deepEqual(
    Object.keys(result).sort(),
    ["allocationDifferences", "baseProfile", "currencyMismatch", "notes", "scenarios", "status", "unallocatedDifference"].sort()
  );
});

// D. Exact scenario-level output contract.
test("D. each scenario result contains exactly the frozen 7 scenario-level keys", () => {
  const result = runFromArgv(argvFor(VALID_REQUEST));
  for (const scenario of result.scenarios) {
    assert.deepEqual(
      Object.keys(scenario).sort(),
      ["assumptions", "contradictions", "label", "portfolio", "status", "unknowns", "warnings"].sort()
    );
  }
});

// E. Malformed JSON handled safely, never crashes.
test("E. malformed JSON input is handled safely with the existing BLOCKED safeFailureResponse shape, never throws", () => {
  const argv = ["node", "runPortfolioScenarioComparison.js", "not-valid-json{"];
  assert.doesNotThrow(() => runFromArgv(argv));
  const result = runFromArgv(argv);
  assert.equal(result.status, RESULT_STATUS.BLOCKED);
  assert.deepEqual(result.scenarios, []);
  assert.equal(result.allocationDifferences, null);
});

// F. Empty/missing CLI input handled safely.
test("F. no CLI argument at all is handled safely, never throws", () => {
  const argv = ["node", "runPortfolioScenarioComparison.js"];
  assert.doesNotThrow(() => runFromArgv(argv));
  const result = runFromArgv(argv);
  assert.equal(result.status, RESULT_STATUS.BLOCKED);
});

// G. argv is never mutated.
test("G. the input argv array is never mutated", () => {
  const argv = argvFor(VALID_REQUEST);
  const snapshot = [...argv];
  runFromArgv(argv);
  assert.deepEqual(argv, snapshot);
});

// H. The JSON text embedded in argv, and by extension any freshly-parsed
// request derived from it, is never altered by processing — no shared
// or cached parse state leaks between invocations.
test("H. the JSON request text is never altered by processing, and repeated parses remain identical", () => {
  const jsonText = JSON.stringify(VALID_REQUEST);
  const argv = ["node", "runPortfolioScenarioComparison.js", jsonText];
  const snapshotBefore = JSON.parse(jsonText);
  runFromArgv(argv);
  const snapshotAfter = JSON.parse(jsonText);
  assert.deepEqual(snapshotAfter, snapshotBefore);
  assert.deepEqual(argv, ["node", "runPortfolioScenarioComparison.js", jsonText]);
});

// I. Determinism.
test("I. identical CLI input produces deterministic, deep-equal output", () => {
  const argv = argvFor(VALID_REQUEST);
  assert.deepEqual(runFromArgv(argv), runFromArgv([...argv]));
});

// J. Shared top-level existingPortfolio passes through correctly.
test("J. a shared top-level existingPortfolio passes through and measurably tightens an explicit cap", () => {
  const request = {
    baseText: VALID_BASE_TEXT,
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }],
    scenarios: [
      { label: "A", profileOverrides: { assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.45 } } } },
      { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
    ],
  };
  const result = runFromArgv(argvFor(request));
  const direct = comparePortfolioScenarios(request);
  assert.deepEqual(result, direct);
  const eq = result.scenarios[0].portfolio.allocations.find((a) => a.assetClass === "EQUITIES").percentage;
  assert.ok(Math.abs(eq - 0.175) < 1e-9);
});

// K. Scenario-level constructionOptions.existingPortfolio remains ignored.
test("K. a scenario-level constructionOptions.existingPortfolio is silently ignored via the CLI, exactly as the underlying module already guarantees", () => {
  const request = {
    baseText: VALID_BASE_TEXT,
    scenarios: [
      { label: "A", constructionOptions: { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 999999999, currency: "CAD" }] } },
      { label: "B" },
    ],
  };
  const result = runFromArgv(argvFor(request));
  assert.deepEqual(result.scenarios[0].portfolio.allocations, result.scenarios[1].portfolio.allocations);
});

// L. No network/provider calls.
test("L. runFromArgv never performs a real network call", async () => {
  const { networkCalled } = await withNetworkGuard(async () => runFromArgv(argvFor(VALID_REQUEST)));
  assert.equal(networkCalled, false);
});

test("L2. the wrapper file itself references no provider/network module", () => {
  const source = require("fs").readFileSync(require.resolve("./runPortfolioScenarioComparison"), "utf8");
  assert.ok(
    !/fetch\(|axios|http\.request|https\.request|process\.env|child_process|eval\(|new Function|require\(\s*[a-zA-Z_$]|fs\.|database|runMarketIntelligenceRequest|fredMacro|alphaVantage|providers\/|orchestrator|agents\//i.test(
      source
    )
  );
});

// M. No ticker/security-field leakage.
test("M. no ticker/security field on a supplied existing holding ever leaks into the response", () => {
  const request = {
    baseText: VALID_BASE_TEXT,
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD", ticker: "SPY", isin: "US78462F1030" }],
    scenarios: [{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } }],
  };
  const result = runFromArgv(argvFor(request));
  const serialized = JSON.stringify(result).toLowerCase();
  assert.ok(!serialized.includes("spy"));
  assert.ok(!serialized.includes("isin"));
});
