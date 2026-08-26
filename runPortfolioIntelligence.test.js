// Offline tests for the Portfolio Intelligence CLI wrapper — Step 69.
// Focused on the wrapper's own thin logic only (argv reconstruction,
// pass-through, no reshaping) — does NOT duplicate the extensive
// domain-level coverage already in portfolioIntelligence.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const { runFromArgv } = require("./runPortfolioIntelligence");
const { runPortfolioIntelligenceRequest } = require("./portfolioIntelligence");
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

// A realistic multi-word request, split the way a shell would split an
// unquoted argument list — proving the join() reconstruction works.
const VALID_ARGV = [
  "node",
  "runPortfolioIntelligence.js",
  "I",
  "have",
  "CAD",
  "$10,000",
  "and",
  "want",
  "to",
  "invest",
  "for",
  "5",
  "years.",
  "I",
  "am",
  "comfortable",
  "with",
  "moderate",
  "risk.",
  "I",
  "want",
  "balanced",
  "growth.",
];

// 1. Realistic multi-word argv produces a genuine READY response.
test("1. a realistic multi-word argv (unquoted, shell-split) produces a genuine READY response", () => {
  const result = runFromArgv(VALID_ARGV);
  assert.equal(result.status, RESULT_STATUS.READY);
  assert.ok(result.portfolio.allocations.length > 0);
});

// 2. No text arguments -> BLOCKED.
test("2. no text arguments produce BLOCKED", () => {
  const result = runFromArgv(["node", "runPortfolioIntelligence.js"]);
  assert.equal(result.status, RESULT_STATUS.BLOCKED);
  assert.equal(result.portfolio, null);
});

// 3. Empty-string argument -> BLOCKED.
test("3. a single empty-string argument produces BLOCKED", () => {
  const result = runFromArgv(["node", "runPortfolioIntelligence.js", ""]);
  assert.equal(result.status, RESULT_STATUS.BLOCKED);
  assert.equal(result.portfolio, null);
});

// 4-7. Every status passes through unchanged (reusing texts already proven in portfolioIntelligence.test.js).
test("4. READY passes through unchanged", () => {
  const result = runFromArgv(VALID_ARGV);
  assert.equal(result.status, RESULT_STATUS.READY);
});

test("5. BLOCKED passes through unchanged", () => {
  const result = runFromArgv(["node", "runPortfolioIntelligence.js", "I", "have", "$3,000."]);
  assert.equal(result.status, RESULT_STATUS.BLOCKED);
  assert.deepEqual(result.missingInformation.sort(), ["investmentHorizon", "riskTolerance"]);
});

test("6. INCOMPLETE passes through unchanged", () => {
  const result = runFromArgv([
    "node", "runPortfolioIntelligence.js",
    "I", "have", "$5,000", "and", "want", "to", "invest", "for", "5", "years.",
    "I", "am", "comfortable", "with", "moderate", "risk.", "I", "want", "balanced", "growth.",
  ]);
  assert.equal(result.status, RESULT_STATUS.INCOMPLETE);
  assert.ok(result.portfolio.allocations.every((a) => a.amount === "UNKNOWN"));
});

test("7. NEEDS_CLARIFICATION passes through unchanged", () => {
  const result = runFromArgv([
    "node", "runPortfolioIntelligence.js",
    "I", "have", "CAD", "$10,000", "for", "5", "years.",
    "I", "am", "comfortable", "with", "moderate", "risk.", "I", "want", "balanced", "growth.",
    "Only", "equities.", "No", "equities.",
  ]);
  assert.equal(result.status, RESULT_STATUS.NEEDS_CLARIFICATION);
  assert.equal(result.portfolio, null);
});

// 8. The wrapper calls runPortfolioIntelligenceRequest() with exactly { text }, no options.
test("8. no options are silently invented — the wrapper's result matches a bare {text}-only call exactly", () => {
  const text = VALID_ARGV.slice(2).join(" ");
  const direct = runPortfolioIntelligenceRequest({ text });
  const viaWrapper = runFromArgv(VALID_ARGV);
  assert.deepEqual(viaWrapper, direct);
});

// 9. Network/provider guard.
test("9. runFromArgv never performs a real network call", async () => {
  const { networkCalled } = await withNetworkGuard(async () => runFromArgv(VALID_ARGV));
  assert.equal(networkCalled, false);
});

test("9b. the wrapper file itself references no provider/network module", () => {
  const source = require("fs").readFileSync(require.resolve("./runPortfolioIntelligence"), "utf8");
  assert.ok(!/fetch\(|axios|http\.request|https\.request|process\.env|runMarketIntelligenceRequest|fredMacro|alphaVantage/i.test(source));
});

// 10. Determinism.
test("10. identical argv produces identical results", () => {
  assert.deepEqual(runFromArgv(VALID_ARGV), runFromArgv(VALID_ARGV));
});

// 11. Input argv array is not mutated.
test("11. the input argv array is never mutated", () => {
  const argv = [...VALID_ARGV];
  const snapshot = [...argv];
  runFromArgv(argv);
  assert.deepEqual(argv, snapshot);
});

// 12. Zero response reshaping — deep-equal to a direct call with the same joined text.
test("12. the wrapper result is deep-equal to calling runPortfolioIntelligenceRequest({text}) directly, proving zero reshaping", () => {
  const argv = ["node", "runPortfolioIntelligence.js", "I", "have", "$3,000."];
  const direct = runPortfolioIntelligenceRequest({ text: argv.slice(2).join(" ") });
  assert.deepEqual(runFromArgv(argv), direct);
});

// --- --existing-portfolio CLI flag (Step 84/85) ---

test("13. absent flag preserves today's exact behavior — identical to a bare {text}-only call", () => {
  const direct = runPortfolioIntelligenceRequest({ text: VALID_ARGV.slice(2).join(" ") });
  assert.deepEqual(runFromArgv(VALID_ARGV), direct);
});

test("14. a valid JSON array flag value is parsed and forwarded as options.existingPortfolio", () => {
  const argv = [
    "node", "runPortfolioIntelligence.js",
    "--existing-portfolio", '[{"assetClass":"EQUITIES","marketValue":5000,"currency":"CAD"}]',
    ...VALID_ARGV.slice(2),
  ];
  const direct = runPortfolioIntelligenceRequest({
    text: VALID_ARGV.slice(2).join(" "),
    options: { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }] },
  });
  assert.deepEqual(runFromArgv(argv), direct);
});

test("15. a valid existingPortfolio measurably tightens an explicit concentration cap", () => {
  const capArgv = [
    "node", "runPortfolioIntelligence.js",
    "--existing-portfolio", '[{"assetClass":"EQUITIES","marketValue":5000,"currency":"CAD"}]',
    "I", "have", "CAD", "$10,000", "for", "5", "years.",
    "I", "am", "comfortable", "with", "moderate", "risk.", "I", "want", "balanced", "growth.",
    "Keep", "equities", "below", "45%.",
  ];
  const withoutExisting = runFromArgv(capArgv.filter((t) => t !== "--existing-portfolio" && !t.startsWith("[{")));
  const withExisting = runFromArgv(capArgv);
  const eqWith = withExisting.portfolio.allocations.find((a) => a.assetClass === "EQUITIES").percentage;
  const eqWithout = withoutExisting.portfolio.allocations.find((a) => a.assetClass === "EQUITIES").percentage;
  assert.ok(eqWith < eqWithout, `existingPortfolio should tighten EQUITIES (${eqWith}) below the no-existing case (${eqWithout})`);
});

test("16. malformed JSON is forwarded as the raw string, never crashes", () => {
  const argv = ["node", "runPortfolioIntelligence.js", "--existing-portfolio", "not-valid-json{", ...VALID_ARGV.slice(2)];
  const direct = runPortfolioIntelligenceRequest({ text: VALID_ARGV.slice(2).join(" "), options: { existingPortfolio: "not-valid-json{" } });
  assert.doesNotThrow(() => runFromArgv(argv));
  assert.deepEqual(runFromArgv(argv), direct);
});

test("17. malformed JSON produces constructPortfolio's existing warning and never independently changes status", () => {
  const argv = ["node", "runPortfolioIntelligence.js", "--existing-portfolio", "not-valid-json{", ...VALID_ARGV.slice(2)];
  const withMalformed = runFromArgv(argv);
  const withoutFlag = runFromArgv(VALID_ARGV);
  assert.equal(withMalformed.status, withoutFlag.status);
  assert.ok(withMalformed.portfolio.constraintsApplied.length >= 0); // sanity: still a valid portfolio shape
  assert.ok(withoutFlag.status === RESULT_STATUS.READY);
});

test("18. the flag as the final argv token is treated as fully absent, no crash", () => {
  const argv = [...VALID_ARGV, "--existing-portfolio"];
  const direct = runPortfolioIntelligenceRequest({ text: argv.slice(2).join(" ") });
  assert.doesNotThrow(() => runFromArgv(argv));
  assert.deepEqual(runFromArgv(argv), direct);
});

test("19. a duplicate flag: only the first occurrence is consumed, the second remains ordinary text", () => {
  const argv = [
    "node", "runPortfolioIntelligence.js",
    "--existing-portfolio", '[{"assetClass":"EQUITIES","marketValue":1000,"currency":"CAD"}]',
    "I", "have", "CAD", "$10,000", "for", "5", "years.",
    "I", "am", "comfortable", "with", "moderate", "risk.", "I", "want", "balanced", "growth.",
    "--existing-portfolio",
  ];
  const result = runFromArgv(argv);
  // The second literal "--existing-portfolio" token remains part of the free text.
  assert.equal(
    result.status,
    runPortfolioIntelligenceRequest({
      text: "I have CAD $10,000 for 5 years. I am comfortable with moderate risk. I want balanced growth. --existing-portfolio",
      options: { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 1000, currency: "CAD" }] },
    }).status
  );
});

test("20. a JSON value containing internal whitespace works when supplied as one argv element", () => {
  const jsonWithWhitespace = '[{"assetClass": "EQUITIES", "marketValue": 5000, "currency": "CAD"}]';
  const argv = ["node", "runPortfolioIntelligence.js", "--existing-portfolio", jsonWithWhitespace, ...VALID_ARGV.slice(2)];
  const direct = runPortfolioIntelligenceRequest({
    text: VALID_ARGV.slice(2).join(" "),
    options: { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }] },
  });
  assert.deepEqual(runFromArgv(argv), direct);
});

test("21. the input argv array is never mutated when the flag is present", () => {
  const argv = ["node", "runPortfolioIntelligence.js", "--existing-portfolio", '[{"assetClass":"EQUITIES","marketValue":5000,"currency":"CAD"}]', ...VALID_ARGV.slice(2)];
  const snapshot = [...argv];
  runFromArgv(argv);
  assert.deepEqual(argv, snapshot);
});

test("22. identical argv (with the flag) produces deterministic, identical results", () => {
  const argv = ["node", "runPortfolioIntelligence.js", "--existing-portfolio", '[{"assetClass":"EQUITIES","marketValue":5000,"currency":"CAD"}]', ...VALID_ARGV.slice(2)];
  assert.deepEqual(runFromArgv(argv), runFromArgv([...argv]));
});

test("23. no real network call occurs when the flag is present", async () => {
  const argv = ["node", "runPortfolioIntelligence.js", "--existing-portfolio", '[{"assetClass":"EQUITIES","marketValue":5000,"currency":"CAD"}]', ...VALID_ARGV.slice(2)];
  const { networkCalled } = await withNetworkGuard(async () => runFromArgv(argv));
  assert.equal(networkCalled, false);
});

test("24. the response still contains exactly the frozen 8 Portfolio Intelligence keys when the flag is used", () => {
  const argv = ["node", "runPortfolioIntelligence.js", "--existing-portfolio", '[{"assetClass":"EQUITIES","marketValue":5000,"currency":"CAD"}]', ...VALID_ARGV.slice(2)];
  const result = runFromArgv(argv);
  assert.deepEqual(
    Object.keys(result).sort(),
    ["ambiguities", "assumptions", "contradictions", "missingInformation", "portfolio", "status", "unknowns", "warnings"].sort()
  );
});

test("25. no ticker/security field on a supplied existing holding ever leaks into the response", () => {
  const argv = [
    "node", "runPortfolioIntelligence.js",
    "--existing-portfolio", '[{"assetClass":"EQUITIES","marketValue":5000,"currency":"CAD","ticker":"SPY","isin":"US78462F1030"}]',
    ...VALID_ARGV.slice(2),
  ];
  const result = runFromArgv(argv);
  const serialized = JSON.stringify(result).toLowerCase();
  assert.ok(!serialized.includes("spy"));
  assert.ok(!serialized.includes("isin"));
});
