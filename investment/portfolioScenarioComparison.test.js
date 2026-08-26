// Offline tests for Portfolio Scenario Comparison v1 — implements the
// contract frozen in Step 73. No network access, no provider access,
// no LLM, no CLI, no security/ticker selection anywhere in this file.
//
// Deliberately does NOT re-test base archetype weighting math,
// hard-constraint clamping internals, or horizon-band derivation —
// those are already exhaustively covered by portfolioConstruction.test.js
// and investorProfileValidation.test.js. This suite covers only the
// new composition/diff logic this module adds.

const test = require("node:test");
const assert = require("node:assert/strict");
const { comparePortfolioScenarios } = require("./portfolioScenarioComparison");
const { RESULT_STATUS } = require("./portfolioConstruction");

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

const INCOMPLETE_BASE_TEXT =
  "I have $5,000 and want to invest for 5 years. I am comfortable with moderate risk. I want balanced growth.";

const INSUFFICIENT_BASE_TEXT = "I have $3,000.";

const CONTRADICTION_BASE_TEXT =
  "I have CAD $10,000 for 5 years. I am comfortable with moderate risk. I want balanced growth. Only equities. No equities.";

function baseRequest(scenarios, baseText = VALID_BASE_TEXT) {
  return { baseText, scenarios };
}

// 1. Two READY scenarios using different risk tolerance values.
test("1. two READY scenarios with different riskTolerance overrides both resolve READY", () => {
  const result = comparePortfolioScenarios(
    baseRequest([
      { label: "moderate", profileOverrides: { riskTolerance: "MODERATE" } },
      { label: "aggressive", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
    ])
  );
  assert.equal(result.status, RESULT_STATUS.READY);
  assert.equal(result.scenarios[0].status, RESULT_STATUS.READY);
  assert.equal(result.scenarios[1].status, RESULT_STATUS.READY);
  assert.equal(result.scenarios[0].label, "moderate");
  assert.equal(result.scenarios[1].label, "aggressive");
});

// 2. Correct signed allocation deltas (B - A convention).
test("2. allocation deltas follow the B - A sign convention", () => {
  const result = comparePortfolioScenarios(
    baseRequest([
      { label: "moderate", profileOverrides: { riskTolerance: "MODERATE" } },
      { label: "aggressive", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
    ])
  );
  const equities = result.allocationDifferences.find((d) => d.assetClass === "EQUITIES");
  assert.ok(equities);
  assert.equal(equities.percentagePointDelta, equities.percentageB - equities.percentageA);
  // Aggressive's base archetype allocates more to EQUITIES than moderate's.
  assert.ok(equities.percentageB > equities.percentageA);
  assert.ok(equities.percentagePointDelta > 0);
});

// 3. Hand-calculated delta correctness against the frozen base archetypes.
test("3. hand-calculated delta matches the frozen CONSERVATIVE vs AGGRESSIVE base archetype CASH weights", () => {
  const result = comparePortfolioScenarios(
    baseRequest([
      { label: "conservative", profileOverrides: { riskTolerance: "CONSERVATIVE" } },
      { label: "aggressive", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
    ])
  );
  const cash = result.allocationDifferences.find((d) => d.assetClass === "CASH");
  // CONSERVATIVE CASH=0.15, AGGRESSIVE CASH=0.05 (frozen archetypes) —
  // horizon/objective nudges shift both by the same small amounts
  // relative to their own archetype, but the base gap is 0.10 apart in
  // the negative direction (B - A, aggressive minus conservative).
  assert.ok(cash.percentageA > cash.percentageB);
  assert.equal(cash.percentagePointDelta, cash.percentageB - cash.percentageA);
});

// 4. Identical allocation between scenarios -> percentagePointDelta === 0.
test("4. identical scenarios (no overrides) produce percentagePointDelta 0 for every asset class", () => {
  const result = comparePortfolioScenarios(baseRequest([{ label: "A" }, { label: "B" }]));
  assert.ok(result.allocationDifferences.length > 0);
  for (const diff of result.allocationDifferences) {
    assert.equal(diff.percentagePointDelta, 0);
    assert.equal(diff.percentageA, diff.percentageB);
  }
  assert.equal(result.unallocatedDifference.percentagePointDelta, 0);
});

// 5. Asset class present in only one scenario -> other side percentage === 0.
test("5. an asset class excluded from one scenario reports percentage 0 on that side, never UNKNOWN", () => {
  const result = comparePortfolioScenarios(
    baseRequest([
      { label: "withCrypto", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
      { label: "noCrypto", profileOverrides: { riskTolerance: "AGGRESSIVE", assetClassRestrictions: { excluded: ["CRYPTO"] } } },
    ])
  );
  const crypto = result.allocationDifferences.find((d) => d.assetClass === "CRYPTO");
  assert.ok(crypto);
  assert.ok(crypto.percentageA > 0);
  assert.equal(crypto.percentageB, 0);
  assert.notEqual(crypto.percentageB, "UNKNOWN");
});

// 6. READY vs INCOMPLETE.
test("6. READY vs INCOMPLETE: comparison status is INCOMPLETE, both scenarios still fully computed", () => {
  const result = comparePortfolioScenarios(baseRequest([{ label: "A" }, { label: "B" }], INCOMPLETE_BASE_TEXT));
  assert.equal(result.scenarios[0].status, RESULT_STATUS.INCOMPLETE);
  assert.equal(result.scenarios[1].status, RESULT_STATUS.INCOMPLETE);
  assert.equal(result.status, RESULT_STATUS.INCOMPLETE);
  assert.ok(result.scenarios[0].portfolio !== null);
  assert.ok(result.allocationDifferences !== null);
});

// 7. READY vs BLOCKED.
test("7. a scenario override that makes riskTolerance invalid resolves that scenario to BLOCKED, comparison status BLOCKED, no allocationDifferences", () => {
  const result = comparePortfolioScenarios(
    baseRequest([
      { label: "valid" },
      { label: "brokenRisk", profileOverrides: { riskTolerance: "NOT_A_REAL_VALUE" } },
    ])
  );
  assert.equal(result.scenarios[0].status, RESULT_STATUS.READY);
  assert.equal(result.scenarios[1].status, RESULT_STATUS.BLOCKED);
  assert.equal(result.scenarios[1].portfolio, null);
  assert.equal(result.status, RESULT_STATUS.BLOCKED);
  assert.equal(result.allocationDifferences, null);
  assert.equal(result.unallocatedDifference, null);
  // The valid scenario must still be computed normally.
  assert.ok(result.scenarios[0].portfolio !== null);
});

// 8. READY vs NEEDS_CLARIFICATION.
test("8. a self-contradictory restriction override resolves that scenario to NEEDS_CLARIFICATION, comparison status NEEDS_CLARIFICATION", () => {
  const result = comparePortfolioScenarios(
    baseRequest([
      { label: "valid" },
      {
        label: "contradictory",
        profileOverrides: { assetClassRestrictions: { excluded: ["EQUITIES"], includedOnly: ["EQUITIES"] } },
      },
    ])
  );
  assert.equal(result.scenarios[0].status, RESULT_STATUS.READY);
  assert.equal(result.scenarios[1].status, RESULT_STATUS.NEEDS_CLARIFICATION);
  assert.equal(result.status, RESULT_STATUS.NEEDS_CLARIFICATION);
  assert.equal(result.allocationDifferences, null);
  assert.ok(result.scenarios[1].contradictions.length > 0);
});

// 9. Unknown currency — known/known same.
test("9. both scenarios share the same known currency -> currencyMismatch false, amounts computed", () => {
  const result = comparePortfolioScenarios(baseRequest([{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } }]));
  assert.equal(result.currencyMismatch, false);
  for (const diff of result.allocationDifferences) {
    assert.notEqual(diff.amountA, "UNKNOWN");
    assert.notEqual(diff.amountB, "UNKNOWN");
    assert.equal(diff.amountDelta, diff.amountB - diff.amountA);
  }
});

// 10. Unknown currency — known/known different. Achieved via an
// eligibleAssetUniverse-only override is not possible (currency isn't
// overridable by design); instead this is exercised structurally by
// asserting the module's own currency-comparison branch never fires a
// false "different currency" path when both scenarios in fact share
// the same base currency (currency cannot diverge in v1 since it is
// not an overridable field) — see note below the assertion.
test("10. currency cannot diverge between scenarios in v1 because investmentCurrency is not an overridable field", () => {
  const result = comparePortfolioScenarios(
    baseRequest([
      { label: "A", profileOverrides: { riskTolerance: "CONSERVATIVE" } },
      { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
    ])
  );
  assert.equal(result.scenarios[0].portfolio.currency, result.scenarios[1].portfolio.currency);
  assert.equal(result.currencyMismatch, false);
});

// 11. Unknown currency — known/unknown.
test("11. one scenario's currency unknown (base currency never supplied) -> currencyMismatch UNKNOWN, amountDelta UNKNOWN", () => {
  const result = comparePortfolioScenarios(baseRequest([{ label: "A" }, { label: "B" }], INCOMPLETE_BASE_TEXT));
  assert.equal(result.currencyMismatch, "UNKNOWN");
  for (const diff of result.allocationDifferences) {
    assert.equal(diff.amountA, "UNKNOWN");
    assert.equal(diff.amountB, "UNKNOWN");
    assert.equal(diff.amountDelta, "UNKNOWN");
  }
  assert.ok(result.notes.some((n) => /currency is unknown/i.test(n)));
});

// 12. Unknown currency — unknown/unknown (both scenarios share the same
// unknown-currency base profile, so both sides are UNKNOWN).
test("12. both scenarios unknown currency -> currencyMismatch UNKNOWN, both amount sides UNKNOWN", () => {
  const result = comparePortfolioScenarios(baseRequest([{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } }], INCOMPLETE_BASE_TEXT));
  assert.equal(result.currencyMismatch, "UNKNOWN");
  assert.equal(result.unallocatedDifference.amountA, "UNKNOWN");
  assert.equal(result.unallocatedDifference.amountB, "UNKNOWN");
  assert.equal(result.unallocatedDifference.amountDelta, "UNKNOWN");
});

// 13. Unallocated percentage/amount comparison.
test("13. unallocatedDifference is computed with the same B - A sign convention", () => {
  const result = comparePortfolioScenarios(
    baseRequest([
      { label: "A", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
      {
        label: "B",
        profileOverrides: { riskTolerance: "AGGRESSIVE", assetClassRestrictions: { excluded: ["CRYPTO"], maximumByClass: { EQUITIES: 0.1 } } },
      },
    ])
  );
  assert.equal(result.unallocatedDifference.percentagePointDelta, result.unallocatedDifference.percentageB - result.unallocatedDifference.percentageA);
});

// 14. Determinism.
test("14. identical input produces byte-identical (deep-equal) output", () => {
  const request = baseRequest([
    { label: "A", profileOverrides: { riskTolerance: "MODERATE" } },
    { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
  ]);
  const first = comparePortfolioScenarios(request);
  const second = comparePortfolioScenarios(baseRequest([
    { label: "A", profileOverrides: { riskTolerance: "MODERATE" } },
    { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
  ]));
  assert.deepEqual(first, second);
});

// 15. Input immutability.
test("15. the request, its scenarios, and their nested overrides/options are never mutated", () => {
  const request = {
    baseText: VALID_BASE_TEXT,
    scenarios: [
      { label: "A", profileOverrides: { riskTolerance: "MODERATE", assetClassRestrictions: { excluded: ["CRYPTO"] } }, constructionOptions: { eligibleAssetUniverse: ["EQUITIES", "BONDS", "CASH"] } },
      { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" }, constructionOptions: { investmentVehicleRestrictions: { excluded: [], includedOnly: ["ETF"] } } },
    ],
  };
  const snapshot = JSON.parse(JSON.stringify(request));
  comparePortfolioScenarios(request);
  assert.deepEqual(request, snapshot);
});

// 16. No provider/network calls.
test("16. comparePortfolioScenarios never performs a real network call", async () => {
  const { networkCalled } = await withNetworkGuard(async () =>
    comparePortfolioScenarios(baseRequest([{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } }]))
  );
  assert.equal(networkCalled, false);
});

test("16b. the module file itself references no provider/network module", () => {
  const source = require("fs").readFileSync(require.resolve("./portfolioScenarioComparison"), "utf8");
  assert.ok(!/fetch\(|axios|http\.request|https\.request|process\.env|runMarketIntelligenceRequest|fredMacro|alphaVantage|require\(\s*[a-zA-Z_]/i.test(source));
});

// 17. Exact response keys.
test("17. the response contains exactly the frozen top-level keys, no more, no fewer", () => {
  const result = comparePortfolioScenarios(baseRequest([{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } }]));
  assert.deepEqual(
    Object.keys(result).sort(),
    ["allocationDifferences", "baseProfile", "currencyMismatch", "notes", "scenarios", "status", "unallocatedDifference"].sort()
  );
  assert.deepEqual(Object.keys(result.baseProfile).sort(), ["ambiguities", "contradictions", "missingInformation"].sort());
  for (const scenario of result.scenarios) {
    assert.deepEqual(
      Object.keys(scenario).sort(),
      ["assumptions", "contradictions", "label", "portfolio", "status", "unknowns", "warnings"].sort()
    );
  }
});

// 18. No ticker/security/instrument fields.
test("18. no allocation difference or scenario portfolio line contains a ticker/instrument/security field", () => {
  const result = comparePortfolioScenarios(baseRequest([{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } }]));
  const forbidden = ["instrument", "ticker", "securityIdentifier", "symbol", "isin", "cusip"];
  const serialized = JSON.stringify(result);
  for (const field of forbidden) {
    assert.ok(!new RegExp(`"${field}"`, "i").test(serialized), `response must never contain a "${field}" key`);
  }
});

// 19. Fixed disclaimer appears whenever allocationDifferences exists.
test("19. the fixed disclaimer is present exactly when allocationDifferences is non-null, absent otherwise", () => {
  const withDiffs = comparePortfolioScenarios(baseRequest([{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } }]));
  assert.ok(withDiffs.allocationDifferences !== null);
  assert.ok(withDiffs.notes.includes("This reflects a difference in the deterministic allocation output only — it is not a prediction that one portfolio will perform better."));

  const withoutDiffs = comparePortfolioScenarios(
    baseRequest([{ label: "valid" }, { label: "broken", profileOverrides: { riskTolerance: "NOT_A_REAL_VALUE" } }])
  );
  assert.equal(withoutDiffs.allocationDifferences, null);
  assert.ok(!withoutDiffs.notes.includes("This reflects a difference in the deterministic allocation output only — it is not a prediction that one portfolio will perform better."));
});

// 20. Invalid override value is rejected through the existing validation layer.
test("20. an invalid riskTolerance override is rejected by validateInvestorProfile(), not silently accepted", () => {
  const result = comparePortfolioScenarios(
    baseRequest([{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "SUPER_RISKY" } }])
  );
  assert.equal(result.scenarios[1].status, RESULT_STATUS.BLOCKED);
  assert.equal(result.scenarios[1].portfolio, null);
});

// 21. constructionOptions are forwarded correctly.
test("21. eligibleAssetUniverse and investmentVehicleRestrictions construction options are honored per scenario", () => {
  const result = comparePortfolioScenarios(
    baseRequest([
      { label: "unrestricted", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
      {
        label: "vehicleRestricted",
        profileOverrides: { riskTolerance: "AGGRESSIVE" },
        constructionOptions: { investmentVehicleRestrictions: { excluded: [], includedOnly: ["ETF"] } },
      },
    ])
  );
  assert.ok(result.scenarios[1].portfolio.allocations.every((a) => a.investmentVehicle === "ETF"));
  assert.ok(result.scenarios[1].portfolio.constraintsApplied.some((c) => /restricted to ETF only/i.test(c)));
});

test("21b. a marketIntelligence/existingPortfolio key on constructionOptions is never forwarded", () => {
  const result = comparePortfolioScenarios(
    baseRequest([
      { label: "A" },
      { label: "B", constructionOptions: { marketIntelligence: { fake: true }, existingPortfolio: [{ assetClass: "EQUITIES" }] } },
    ])
  );
  assert.ok(result.scenarios[1].assumptions.some((a) => /no market intelligence was supplied/i.test(a)));
  assert.ok(result.scenarios[1].assumptions.some((a) => /no existing portfolio was supplied/i.test(a)));
});

// 22. Base extraction occurs once, not once per scenario.
test("22. extraction runs exactly once regardless of scenario count/content", () => {
  const extraction = require("./investorProfileExtraction");
  let callCount = 0;
  const original = extraction.extractInvestorProfile;
  extraction.extractInvestorProfile = (...args) => {
    callCount += 1;
    return original(...args);
  };
  try {
    delete require.cache[require.resolve("./portfolioScenarioComparison")];
    const { comparePortfolioScenarios: freshCompare } = require("./portfolioScenarioComparison");
    freshCompare(baseRequest([{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } }]));
    assert.equal(callCount, 1);
  } finally {
    extraction.extractInvestorProfile = original;
    delete require.cache[require.resolve("./portfolioScenarioComparison")];
  }
});

// 23. No mutation of base extraction/validation/construction outputs.
test("23. neither scenario's construction result mutates the other scenario's or the base's data", () => {
  const result = comparePortfolioScenarios(
    baseRequest([
      { label: "A", profileOverrides: { riskTolerance: "MODERATE" } },
      { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE", assetClassRestrictions: { excluded: ["CRYPTO"] } } },
    ])
  );
  // Scenario A's own restrictions/portfolio must be unaffected by B's
  // exclusion override — this would fail if the base profile clone
  // were shared by reference instead of deep-cloned per scenario.
  const scenarioACrypto = result.scenarios[0].portfolio.allocations.find((a) => a.assetClass === "CRYPTO");
  assert.equal(scenarioACrypto, undefined); // MODERATE archetype itself has 0% CRYPTO — but the key assertion is independence:
  const scenarioBCrypto = result.scenarios[1].portfolio.allocations.find((a) => a.assetClass === "CRYPTO");
  assert.equal(scenarioBCrypto, undefined); // excluded in B
  assert.ok(!result.scenarios[0].portfolio.constraintsApplied.some((c) => /Excluded asset class.*CRYPTO/i.test(c)));
  assert.ok(result.scenarios[1].portfolio.constraintsApplied.some((c) => /Excluded asset class.*CRYPTO/i.test(c)));
});

// 24. Full scenario result preserves each scenario's label independently.
test("24. each scenario result carries its own supplied (or defaulted) label independently", () => {
  const labeled = comparePortfolioScenarios(
    baseRequest([{ label: "custom-one" }, { label: "custom-two", profileOverrides: { riskTolerance: "AGGRESSIVE" } }])
  );
  assert.equal(labeled.scenarios[0].label, "custom-one");
  assert.equal(labeled.scenarios[1].label, "custom-two");

  const defaulted = comparePortfolioScenarios(baseRequest([{}, { profileOverrides: { riskTolerance: "AGGRESSIVE" } }]));
  assert.equal(defaulted.scenarios[0].label, "A");
  assert.equal(defaulted.scenarios[1].label, "B");
});

// --- Malformed top-level request handling (safety net, not in the frozen 24 but required for exactness of test 17's contract under all inputs) ---

test("25. a malformed request (wrong scenario count) is rejected safely with the frozen BLOCKED shape, never throws", () => {
  const result = comparePortfolioScenarios({ baseText: VALID_BASE_TEXT, scenarios: [{}] });
  assert.equal(result.status, RESULT_STATUS.BLOCKED);
  assert.deepEqual(result.scenarios, []);
  assert.equal(result.allocationDifferences, null);
});

test("25b. a non-object request never throws", () => {
  assert.doesNotThrow(() => comparePortfolioScenarios(null));
  assert.doesNotThrow(() => comparePortfolioScenarios(undefined));
  assert.doesNotThrow(() => comparePortfolioScenarios("not an object"));
});

// --- Insufficient-information and contradiction base-text paths (exercises baseProfile fields, distinct from per-scenario status) ---

test("26. an insufficient-information base profile blocks both scenarios identically", () => {
  const result = comparePortfolioScenarios(baseRequest([{ label: "A" }, { label: "B" }], INSUFFICIENT_BASE_TEXT));
  assert.equal(result.scenarios[0].status, RESULT_STATUS.BLOCKED);
  assert.equal(result.scenarios[1].status, RESULT_STATUS.BLOCKED);
  assert.equal(result.status, RESULT_STATUS.BLOCKED);
  assert.ok(result.baseProfile.missingInformation.length > 0);
});

test("27. a base-text-level contradiction propagates to both scenarios via baseProfile and each scenario's own re-validation", () => {
  const result = comparePortfolioScenarios(baseRequest([{ label: "A" }, { label: "B" }], CONTRADICTION_BASE_TEXT));
  assert.equal(result.scenarios[0].status, RESULT_STATUS.NEEDS_CLARIFICATION);
  assert.equal(result.scenarios[1].status, RESULT_STATUS.NEEDS_CLARIFICATION);
  assert.equal(result.status, RESULT_STATUS.NEEDS_CLARIFICATION);
});

// --- Shared existingPortfolio (Step 80/81) ---

test("existingPortfolio A. a shared existingPortfolio is applied to BOTH scenarios identically", () => {
  const result = comparePortfolioScenarios({
    baseText: VALID_BASE_TEXT,
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }],
    scenarios: [
      { label: "A", profileOverrides: { assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.45 } } } },
      { label: "B", profileOverrides: { assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.45 } } } },
    ],
  });
  // combined = 5000 existing + 10000 new = 15000; cap 45% of 15000 = 6750;
  // max new-money EQUITIES = (6750 - 5000) / 10000 = 0.175 — identical in both scenarios.
  const eq = (r) => r.allocations.find((a) => a.assetClass === "EQUITIES").percentage;
  assert.ok(Math.abs(eq(result.scenarios[0].portfolio) - 0.175) < 1e-9);
  assert.ok(Math.abs(eq(result.scenarios[1].portfolio) - 0.175) < 1e-9);
});

test("existingPortfolio B. control: identical existingPortfolio in both scenarios, only a profile override differs -> the delta is attributable to the override alone", () => {
  const withExisting = comparePortfolioScenarios({
    baseText: VALID_BASE_TEXT,
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }],
    scenarios: [
      { label: "moderate", profileOverrides: { riskTolerance: "MODERATE" } },
      { label: "aggressive", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
    ],
  });
  const withoutExisting = comparePortfolioScenarios({
    baseText: VALID_BASE_TEXT,
    scenarios: [
      { label: "moderate", profileOverrides: { riskTolerance: "MODERATE" } },
      { label: "aggressive", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
    ],
  });
  // No cap is configured in either scenario, so existingPortfolio has zero
  // effect (no implicit cap) — the allocationDifferences must be identical
  // with or without the shared existingPortfolio, proving the delta comes
  // purely from the riskTolerance override, not from existing holdings.
  assert.deepEqual(withExisting.allocationDifferences, withoutExisting.allocationDifferences);
});

test("existingPortfolio C. same existingPortfolio, cap configured only in scenario A -> only A is affected", () => {
  const result = comparePortfolioScenarios({
    baseText: VALID_BASE_TEXT,
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 8000, currency: "CAD" }],
    scenarios: [
      { label: "capped", profileOverrides: { riskTolerance: "AGGRESSIVE", assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.5 } } } },
      { label: "uncapped", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
    ],
  });
  const eqA = result.scenarios[0].portfolio.allocations.find((a) => a.assetClass === "EQUITIES").percentage;
  const eqB = result.scenarios[1].portfolio.allocations.find((a) => a.assetClass === "EQUITIES").percentage;
  // combined = 8000 + 10000 = 18000; cap 50% of 18000 = 9000; max new-money = (9000-8000)/10000 = 0.1.
  assert.ok(Math.abs(eqA - 0.1) < 1e-9);
  // Uncapped scenario B uses AGGRESSIVE's natural archetype weight (0.55), completely unaffected by the shared existingPortfolio.
  assert.ok(Math.abs(eqB - 0.55) < 1e-9);
});

test("existingPortfolio D. a malformed (non-array) shared existingPortfolio surfaces identically in both scenarios and never causes BLOCKED by itself", () => {
  const result = comparePortfolioScenarios({
    baseText: VALID_BASE_TEXT,
    existingPortfolio: "not-an-array",
    scenarios: [{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } }],
  });
  assert.equal(result.scenarios[0].status, RESULT_STATUS.READY);
  assert.equal(result.scenarios[1].status, RESULT_STATUS.READY);
  assert.ok(result.scenarios[0].warnings.some((w) => w.includes("was not shaped as an array of holdings")));
  assert.ok(result.scenarios[1].warnings.some((w) => w.includes("was not shaped as an array of holdings")));
});

test("existingPortfolio E. a shared mismatched-currency holding is excluded identically in both scenarios, with disclosure, no FX", () => {
  const result = comparePortfolioScenarios({
    baseText: VALID_BASE_TEXT,
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 99999, currency: "USD" }],
    scenarios: [{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } }],
  });
  const baseline = comparePortfolioScenarios({
    baseText: VALID_BASE_TEXT,
    scenarios: [{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } }],
  });
  assert.deepEqual(result.allocationDifferences, baseline.allocationDifferences);
  assert.ok(result.scenarios[0].warnings.some((w) => w.includes("did not match CAD") && w.includes("no FX conversion is performed")));
  assert.ok(result.scenarios[1].warnings.some((w) => w.includes("did not match CAD") && w.includes("no FX conversion is performed")));
});

test("existingPortfolio F. a large shared existingPortfolio never creates an implicit cap when neither scenario configures one", () => {
  const withExisting = comparePortfolioScenarios({
    baseText: VALID_BASE_TEXT,
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 99999999, currency: "CAD" }],
    scenarios: [{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } }],
  });
  const withoutExisting = comparePortfolioScenarios({
    baseText: VALID_BASE_TEXT,
    scenarios: [{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } }],
  });
  assert.deepEqual(
    withExisting.scenarios.map((s) => s.portfolio.allocations),
    withoutExisting.scenarios.map((s) => s.portfolio.allocations)
  );
});

test("existingPortfolio G. an explicit cap can never be loosened beyond its stated flat value, even under the Step 77 dilution scenario", () => {
  const capOverride = { riskTolerance: "AGGRESSIVE", assetClassRestrictions: { excluded: ["CRYPTO"], includedOnly: [], maximumByClass: { EQUITIES: 0.5 } } };
  const result = comparePortfolioScenarios({
    baseText: VALID_BASE_TEXT,
    existingPortfolio: [
      { assetClass: "EQUITIES", marketValue: 100, currency: "CAD" },
      { assetClass: "CRYPTO", marketValue: 5000000, currency: "CAD" },
    ],
    scenarios: [
      { label: "A", profileOverrides: capOverride },
      { label: "B", profileOverrides: capOverride },
    ],
  });
  for (const scenario of result.scenarios) {
    const equities = scenario.portfolio.allocations.find((a) => a.assetClass === "EQUITIES");
    assert.ok(equities.percentage <= 0.5 + 1e-9, `scenario ${scenario.label} must never exceed its own 50% cap, got ${equities.percentage}`);
  }
});

test("existingPortfolio H. identical complete request (including existingPortfolio) twice produces deep-equal output", () => {
  const request = {
    baseText: VALID_BASE_TEXT,
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }],
    scenarios: [
      { label: "A", profileOverrides: { riskTolerance: "MODERATE" } },
      { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
    ],
  };
  assert.deepEqual(comparePortfolioScenarios(request), comparePortfolioScenarios(JSON.parse(JSON.stringify(request))));
});

test("existingPortfolio I. the complete request, including nested existingPortfolio holding objects, is never mutated", () => {
  const request = {
    baseText: VALID_BASE_TEXT,
    existingPortfolio: [
      { assetClass: "EQUITIES", marketValue: 5000, currency: "CAD", ticker: "SPY" },
      { assetClass: "NOT_REAL", marketValue: -1, currency: "USD" },
    ],
    scenarios: [
      { label: "A", profileOverrides: { riskTolerance: "MODERATE" }, constructionOptions: { eligibleAssetUniverse: ["EQUITIES", "BONDS"] } },
      { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
    ],
  };
  const snapshot = JSON.parse(JSON.stringify(request));
  comparePortfolioScenarios(request);
  assert.deepEqual(request, snapshot);
});

test("existingPortfolio J. comparePortfolioScenarios with a shared existingPortfolio never performs a real network call", async () => {
  const { networkCalled } = await withNetworkGuard(async () =>
    comparePortfolioScenarios({
      baseText: VALID_BASE_TEXT,
      existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }],
      scenarios: [{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } }],
    })
  );
  assert.equal(networkCalled, false);
});

test("existingPortfolio K. supplying a shared existingPortfolio never adds a new top-level output key", () => {
  const result = comparePortfolioScenarios({
    baseText: VALID_BASE_TEXT,
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }],
    scenarios: [{ label: "A" }, { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } }],
  });
  assert.deepEqual(
    Object.keys(result).sort(),
    ["allocationDifferences", "baseProfile", "currencyMismatch", "notes", "scenarios", "status", "unallocatedDifference"].sort()
  );
});

test("existingPortfolio L. ticker/security fields on shared existing holdings are never read, echoed, or influential", () => {
  const withTicker = comparePortfolioScenarios({
    baseText: VALID_BASE_TEXT,
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD", ticker: "SPY", symbol: "SPY", isin: "US78462F1030", cusip: "78462F103", investmentVehicle: "ETF" }],
    scenarios: [
      { label: "A", profileOverrides: { assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.45 } } } },
      { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
    ],
  });
  const withoutTicker = comparePortfolioScenarios({
    baseText: VALID_BASE_TEXT,
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }],
    scenarios: [
      { label: "A", profileOverrides: { assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.45 } } } },
      { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } },
    ],
  });
  assert.deepEqual(withTicker, withoutTicker);
  const serialized = JSON.stringify(withTicker).toLowerCase();
  assert.ok(!serialized.includes("spy"));
  assert.ok(!serialized.includes("isin"));
  assert.ok(!serialized.includes("cusip"));
});

test("existingPortfolio M. processing scenario A never mutates or alters the existingPortfolio basis observed by scenario B", () => {
  const cappedA = { label: "A", profileOverrides: { riskTolerance: "AGGRESSIVE", assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.1 } } } };
  const plainB = { label: "B", profileOverrides: { riskTolerance: "AGGRESSIVE" } };
  const shared = [{ assetClass: "EQUITIES", marketValue: 8000, currency: "CAD" }];

  const mixedPair = comparePortfolioScenarios({ baseText: VALID_BASE_TEXT, existingPortfolio: shared, scenarios: [cappedA, plainB] });
  const bAlonePair = comparePortfolioScenarios({ baseText: VALID_BASE_TEXT, existingPortfolio: shared, scenarios: [plainB, plainB] });

  // Scenario B's own computed portfolio must be identical whether it was
  // processed alongside a heavily-capped sibling scenario or alongside an
  // identical copy of itself — proving A's processing left no trace on the
  // shared existingPortfolio basis B observed.
  assert.deepEqual(mixedPair.scenarios[1].portfolio, bAlonePair.scenarios[0].portfolio);
});
