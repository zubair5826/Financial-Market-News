// Offline tests for Portfolio Construction v1 — implements the
// contract frozen in Step 56/57. No network access, no provider
// access, no LLM, no credentials, no security/ticker selection
// anywhere in this file.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createInvestorProfile } = require("./investorProfile");
const { validateInvestorProfile, VALIDATION_STATUS } = require("./investorProfileValidation");
const { constructPortfolio, RESULT_STATUS, ASSET_CLASSES } = require("./portfolioConstruction");
const { validatePortfolioConstructionResult } = require("./portfolioConstructionValidation");

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

function validInput(overrides = {}) {
  return {
    investmentAmount: { value: 10000, provenance: "PROVIDED" },
    investmentCurrency: { value: "CAD", provenance: "PROVIDED" },
    investmentHorizon: { minimumYears: 5, maximumYears: 5, provenance: "PROVIDED" },
    riskTolerance: { value: "MODERATE", provenance: "PROVIDED" },
    investmentObjective: { value: "BALANCED_GROWTH", provenance: "PROVIDED" },
    ...overrides,
  };
}

function buildValidated(overrides = {}) {
  return validateInvestorProfile(createInvestorProfile(validInput(overrides)));
}

function sumPercentages(result) {
  const allocSum = result.allocations.reduce((s, a) => s + a.percentage, 0);
  const unallocated = result.unallocatedPercentage === "UNKNOWN" ? 0 : result.unallocatedPercentage;
  return allocSum + unallocated;
}

// --- Four profile/result status paths ---

test("1. a VALID profile produces status READY", () => {
  const validated = buildValidated();
  assert.equal(validated.status, "VALID");
  const result = constructPortfolio(validated);
  assert.equal(result.status, RESULT_STATUS.READY);
  assert.ok(result.allocations.length > 0);
});

test("2. an INCOMPLETE profile (missing recommended currency) produces result status INCOMPLETE, percentage-only", () => {
  const validated = buildValidated({ investmentCurrency: undefined });
  assert.equal(validated.status, "INCOMPLETE");
  const result = constructPortfolio(validated);
  assert.equal(result.status, RESULT_STATUS.INCOMPLETE);
  assert.ok(result.allocations.length > 0);
  assert.ok(result.allocations.every((a) => a.amount === "UNKNOWN"));
  assert.equal(result.currency, "UNKNOWN");
});

test("3. an INSUFFICIENT_INFORMATION profile produces result status BLOCKED, no allocations", () => {
  const validated = buildValidated({ riskTolerance: undefined });
  assert.equal(validated.status, "INSUFFICIENT_INFORMATION");
  const result = constructPortfolio(validated);
  assert.equal(result.status, RESULT_STATUS.BLOCKED);
  assert.deepEqual(result.allocations, []);
});

test("4. a NEEDS_CLARIFICATION profile produces result status NEEDS_CLARIFICATION, no allocations, conflicts preserved", () => {
  const validated = buildValidated({ investmentHorizon: { minimumYears: 1, maximumYears: 1, band: "LONG_TERM", provenance: "PROVIDED" } });
  assert.equal(validated.status, "NEEDS_CLARIFICATION");
  const result = constructPortfolio(validated);
  assert.equal(result.status, RESULT_STATUS.NEEDS_CLARIFICATION);
  assert.deepEqual(result.allocations, []);
  assert.ok(result.conflicts.length > 0);
});

// --- Risk tolerance handling ---

test("5. conservative risk biases toward CASH/BONDS over CRYPTO", () => {
  const result = constructPortfolio(buildValidated({ riskTolerance: { value: "CONSERVATIVE", provenance: "PROVIDED" } }));
  const bonds = result.allocations.find((a) => a.assetClass === "BONDS");
  const crypto = result.allocations.find((a) => a.assetClass === "CRYPTO");
  assert.ok(bonds.percentage > 0);
  assert.ok(!crypto || crypto.percentage === 0 || crypto === undefined);
});

test("6. moderate risk produces a balanced mix including some equities and bonds", () => {
  const result = constructPortfolio(buildValidated({ riskTolerance: { value: "MODERATE", provenance: "PROVIDED" } }));
  assert.ok(result.allocations.find((a) => a.assetClass === "EQUITIES").percentage > 0);
  assert.ok(result.allocations.find((a) => a.assetClass === "BONDS").percentage > 0);
});

test("7. aggressive risk biases toward EQUITIES/CRYPTO over BONDS", () => {
  const conservative = constructPortfolio(buildValidated({ riskTolerance: { value: "CONSERVATIVE", provenance: "PROVIDED" } }));
  const aggressive = constructPortfolio(buildValidated({ riskTolerance: { value: "AGGRESSIVE", provenance: "PROVIDED" } }));
  const eqShare = (r) => (r.allocations.find((a) => a.assetClass === "EQUITIES") || { percentage: 0 }).percentage;
  assert.ok(eqShare(aggressive) > eqShare(conservative));
});

// --- Investment objectives ---

test("8-12. every objective shifts weighting without ever producing an all-or-nothing allocation", () => {
  for (const objective of ["CAPITAL_PRESERVATION", "INCOME", "BALANCED_GROWTH", "CAPITAL_GROWTH", "SPECULATION"]) {
    const result = constructPortfolio(buildValidated({ investmentObjective: { value: objective, provenance: "PROVIDED" } }));
    assert.equal(result.status, RESULT_STATUS.READY);
    // No single line ever consumes the entire portfolio merely due to objective.
    assert.ok(result.allocations.every((a) => a.percentage < 1), `objective ${objective} must never produce a 100% single-class allocation`);
  }
});

test("13. SPECULATION never produces an all-crypto portfolio", () => {
  const result = constructPortfolio(buildValidated({ riskTolerance: { value: "AGGRESSIVE", provenance: "PROVIDED" }, investmentObjective: { value: "SPECULATION", provenance: "PROVIDED" } }));
  const crypto = result.allocations.find((a) => a.assetClass === "CRYPTO");
  assert.ok(crypto.percentage < 0.5, "SPECULATION must not dominate the allocation by itself");
});

// --- Horizons ---

test("14. short-term horizon shifts weight toward CASH/BONDS relative to long-term", () => {
  const short = constructPortfolio(buildValidated({ investmentHorizon: { band: "SHORT_TERM", provenance: "PROVIDED" } }));
  const long = constructPortfolio(buildValidated({ investmentHorizon: { minimumYears: 15, provenance: "PROVIDED" } }));
  const cashBonds = (r) => r.allocations.filter((a) => a.assetClass === "CASH" || a.assetClass === "BONDS").reduce((s, a) => s + a.percentage, 0);
  assert.ok(cashBonds(short) > cashBonds(long));
});

test("15. medium-term horizon (10 years) is accepted without triggering a contradiction", () => {
  const validated = buildValidated({ investmentHorizon: { minimumYears: 10, maximumYears: 10, provenance: "PROVIDED" } });
  assert.equal(validated.status, "VALID");
  const result = constructPortfolio(validated);
  assert.equal(result.status, RESULT_STATUS.READY);
});

test("16. combinations of risk/objective/horizon all still validate structurally", () => {
  for (const risk of ["CONSERVATIVE", "MODERATE", "AGGRESSIVE"]) {
    for (const objective of ["CAPITAL_PRESERVATION", "CAPITAL_GROWTH"]) {
      const result = constructPortfolio(
        buildValidated({ riskTolerance: { value: risk, provenance: "PROVIDED" }, investmentObjective: { value: objective, provenance: "PROVIDED" } })
      );
      const check = validatePortfolioConstructionResult(result, { investmentAmount: 10000 });
      assert.deepEqual(check.errors, [], `risk=${risk} objective=${objective}`);
    }
  }
});

// --- Restrictions ---

test("17. an excluded asset class never appears in allocations", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ riskTolerance: { value: "AGGRESSIVE", provenance: "PROVIDED" }, assetClassRestrictions: { excluded: ["CRYPTO"], includedOnly: [], maximumByClass: {} } }))
  );
  const result = constructPortfolio(validated);
  assert.ok(!result.allocations.find((a) => a.assetClass === "CRYPTO"));
});

test("18. an includedOnly restriction limits allocations to exactly the listed classes", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ assetClassRestrictions: { excluded: [], includedOnly: ["EQUITIES", "BONDS"], maximumByClass: {} } }))
  );
  const result = constructPortfolio(validated);
  assert.ok(result.allocations.every((a) => ["EQUITIES", "BONDS"].includes(a.assetClass)));
  assert.ok(Math.abs(sumPercentages(result) - 1) < 1e-6);
});

test("19. a vehicle restriction (ETF only) labels every allocation line with that vehicle", () => {
  const validated = buildValidated();
  const result = constructPortfolio(validated, { investmentVehicleRestrictions: { excluded: [], includedOnly: ["ETF"] } });
  assert.ok(result.allocations.every((a) => a.investmentVehicle === "ETF"));
});

test("20. a named asset-class concentration limit is never exceeded", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ riskTolerance: { value: "AGGRESSIVE", provenance: "PROVIDED" }, assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { CRYPTO: 0.05 } } }))
  );
  const result = constructPortfolio(validated);
  const crypto = result.allocations.find((a) => a.assetClass === "CRYPTO");
  assert.ok(!crypto || crypto.percentage <= 0.05 + 1e-9);
});

test("21. a portfolio-wide maximumConcentration caps every single line", () => {
  const validated = validateInvestorProfile(createInvestorProfile(validInput({ maximumConcentration: { value: 0.2, provenance: "PROVIDED" } })));
  const result = constructPortfolio(validated);
  assert.ok(result.allocations.every((a) => a.percentage <= 0.2 + 1e-9));
});

// --- Impossible/conflicting constraints ---

test("22. an excluded class that is also includedOnly is a self-contradiction: NEEDS_CLARIFICATION", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ assetClassRestrictions: { excluded: ["CRYPTO"], includedOnly: ["CRYPTO"], maximumByClass: {} } }))
  );
  const result = constructPortfolio(validated);
  assert.equal(result.status, RESULT_STATUS.NEEDS_CLARIFICATION);
  assert.deepEqual(result.allocations, []);
});

test("23. includedOnly and excluded together leaving zero eligible classes: NEEDS_CLARIFICATION", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ assetClassRestrictions: { excluded: ["EQUITIES"], includedOnly: ["EQUITIES"], maximumByClass: {} } }))
  );
  const result = constructPortfolio(validated);
  assert.equal(result.status, RESULT_STATUS.NEEDS_CLARIFICATION);
});

// --- Liquidity ---

test("24. an IMMEDIATE liquidity requirement increases CASH weighting", () => {
  const withImmediate = constructPortfolio(buildValidated({ liquidityRequirement: { value: "IMMEDIATE", provenance: "PROVIDED" } }));
  const withoutLiquidity = constructPortfolio(buildValidated());
  const cashShare = (r) => (r.allocations.find((a) => a.assetClass === "CASH") || { percentage: 0 }).percentage;
  assert.ok(cashShare(withImmediate) > cashShare(withoutLiquidity));
});

// --- Emergency cash ---

test("25b. a provided emergencyCashRequirement is disclosed via assumptions (Step 58 review finding)", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ emergencyCashRequirement: { value: 2000, currency: "CAD", provenance: "PROVIDED" } }))
  );
  const result = constructPortfolio(validated);
  assert.ok(result.assumptions.some((a) => a.includes("emergency cash reserve") && a.includes("2000") && a.includes("CAD")));
});

test("29b. a nonzero unallocatedPercentage always carries its own warning explanation (Step 58 review finding)", () => {
  const validated = validateInvestorProfile(createInvestorProfile(validInput({ maximumConcentration: { value: 0.05, provenance: "PROVIDED" } })));
  const result = constructPortfolio(validated);
  assert.ok(result.unallocatedPercentage > 0);
  assert.ok(result.warnings.some((w) => w.includes("unallocated")));
});

test("25. emergencyCashRequirement never becomes its own allocation line and never changes investmentAmount used for computation", () => {
  const withEmergency = validateInvestorProfile(
    createInvestorProfile(validInput({ emergencyCashRequirement: { value: 2000, currency: "CAD", provenance: "PROVIDED" } }))
  );
  const withoutEmergency = buildValidated();
  const resultWith = constructPortfolio(withEmergency);
  const resultWithout = constructPortfolio(withoutEmergency);
  assert.ok(!resultWith.allocations.some((a) => a.reason.toLowerCase().includes("emergency")));
  // Same investmentAmount (10000) used in both cases -> same absolute amounts for the same percentages.
  assert.deepEqual(
    resultWith.allocations.map((a) => a.amount),
    resultWithout.allocations.map((a) => a.amount)
  );
});

// --- Unknown currency ---

test("26. unknown investmentCurrency yields percentage-only allocations and INCOMPLETE status", () => {
  const validated = buildValidated({ investmentCurrency: undefined });
  const result = constructPortfolio(validated);
  assert.equal(result.status, RESULT_STATUS.INCOMPLETE);
  assert.ok(result.allocations.every((a) => a.amount === "UNKNOWN" && a.currency === "UNKNOWN"));
  assert.ok(result.unknowns.some((u) => u.includes("investmentCurrency")));
});

// --- Unknown objective/liquidity ---

test("27. unknown objective and unknown liquidity do not block construction and are disclosed, not defaulted", () => {
  const validated = buildValidated({ investmentObjective: undefined });
  const result = constructPortfolio(validated);
  // objective missing makes the underlying profile INCOMPLETE -> result INCOMPLETE, but still produces allocations.
  assert.ok(result.allocations.length > 0);
  assert.ok(result.unknowns.some((u) => u.includes("liquidityRequirement")));
});

// --- Missing eligible universe / existing portfolio / market intelligence ---

test("28. missing eligibleAssetUniverse, existingPortfolio, and marketIntelligence are disclosed as assumptions, never silently assumed", () => {
  const result = constructPortfolio(buildValidated());
  assert.ok(result.assumptions.some((a) => a.includes("eligible asset universe")));
  assert.ok(result.assumptions.some((a) => a.includes("market intelligence")));
  assert.ok(result.assumptions.some((a) => a.includes("existing portfolio")));
});

// --- CASH vs unallocated capital ---

test("29. CASH allocation and unallocated capital are structurally distinct concepts", () => {
  const validated = validateInvestorProfile(createInvestorProfile(validInput({ maximumConcentration: { value: 0.05, provenance: "PROVIDED" } })));
  const result = constructPortfolio(validated);
  const cash = result.allocations.find((a) => a.assetClass === "CASH");
  assert.ok(cash); // CASH is present as its own explicit line
  assert.ok(result.unallocatedPercentage > 0); // AND some capital is separately unallocated due to the tight cap
  assert.notEqual(cash.percentage, result.unallocatedPercentage);
});

// --- Percentage/amount invariants ---

test("30. allocations plus unallocated always sum to 1 for a READY/INCOMPLETE result", () => {
  const result = constructPortfolio(buildValidated());
  assert.ok(Math.abs(sumPercentages(result) - 1) < 1e-6);
});

test("31. the validation module confirms all structural invariants for a healthy result", () => {
  const result = constructPortfolio(buildValidated());
  const check = validatePortfolioConstructionResult(result, { investmentAmount: 10000 });
  assert.deepEqual(check.errors, []);
  assert.equal(check.valid, true);
});

test("32. the validation module rejects a forbidden security-shaped field", () => {
  const result = constructPortfolio(buildValidated());
  const corrupted = { ...result, allocations: [{ ...result.allocations[0], ticker: "SPY" }, ...result.allocations.slice(1)] };
  const check = validatePortfolioConstructionResult(corrupted, { investmentAmount: 10000 });
  assert.equal(check.valid, false);
  assert.ok(check.errors.some((e) => e.includes("ticker")));
});

test("32b. the validation module rejects a negative or over-100% percentage", () => {
  const result = constructPortfolio(buildValidated());
  const negative = { ...result, allocations: [{ ...result.allocations[0], percentage: -0.1 }, ...result.allocations.slice(1)] };
  assert.equal(validatePortfolioConstructionResult(negative, { investmentAmount: 10000 }).valid, false);

  const over = { ...result, allocations: [{ ...result.allocations[0], percentage: 1.5 }, ...result.allocations.slice(1)] };
  assert.equal(validatePortfolioConstructionResult(over, { investmentAmount: 10000 }).valid, false);
});

test("32c. the validation module rejects an amount exceeding the investment amount", () => {
  const result = constructPortfolio(buildValidated());
  const tooLarge = { ...result, allocations: [{ ...result.allocations[0], amount: 999999 }, ...result.allocations.slice(1)] };
  const check = validatePortfolioConstructionResult(tooLarge, { investmentAmount: 10000 });
  assert.equal(check.valid, false);
});

// --- Determinism ---

test("33. the same validated profile always produces an identical PortfolioConstructionResult", () => {
  const validated = buildValidated();
  assert.deepEqual(constructPortfolio(validated), constructPortfolio(validated));
});

// --- Immutability ---

test("34. constructPortfolio never mutates its inputs", () => {
  const validated = buildValidated();
  const snapshot = JSON.parse(JSON.stringify(validated));
  const options = { investmentVehicleRestrictions: { excluded: [], includedOnly: ["ETF"] } };
  const optionsSnapshot = JSON.parse(JSON.stringify(options));
  constructPortfolio(validated, options);
  assert.deepEqual(validated, snapshot);
  assert.deepEqual(options, optionsSnapshot);
});

test("34b. eligibleAssetUniverse, marketIntelligence, and existingPortfolio are never mutated, even though they are unused in v1 (Step 61 audit)", () => {
  const validated = buildValidated();
  const options = {
    eligibleAssetUniverse: ["EQUITIES", "BONDS"],
    marketIntelligence: { pipelineResult: { ok: true }, note: "deferred, unused in v1" },
    existingPortfolio: [{ assetClass: "EQUITIES", investmentVehicle: "ETF", value: 1000, currency: "CAD" }],
  };
  const optionsSnapshot = JSON.parse(JSON.stringify(options));
  constructPortfolio(validated, options);
  assert.deepEqual(options, optionsSnapshot);
});

// --- existingPortfolio (Step 75/76): concentration-cap participation only ---

test("existingPortfolio A. behavior is unchanged when existingPortfolio is omitted", () => {
  const validated = buildValidated();
  const withOption = constructPortfolio(validated, {});
  const without = constructPortfolio(validated);
  assert.deepEqual(withOption.allocations, without.allocations);
  assert.equal(withOption.status, without.status);
  assert.ok(without.assumptions.some((a) => a.includes("No existing portfolio was supplied")));
});

test("existingPortfolio B. a valid same-currency existing portfolio tightens a cap that a new-money-only check would not have triggered", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.45 } } }))
  );
  const withoutExisting = constructPortfolio(validated);
  const equitiesWithout = withoutExisting.allocations.find((a) => a.assetClass === "EQUITIES");
  assert.ok(equitiesWithout.percentage <= 0.45 + 1e-9);
  assert.ok(equitiesWithout.percentage > 0.17); // the flat 0.45 cap does not bind on new money alone (default MODERATE EQUITIES weight is 0.4)

  const withExisting = constructPortfolio(validated, {
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }],
  });
  const equitiesWith = withExisting.allocations.find((a) => a.assetClass === "EQUITIES");
  // combined = (5000 existing + 10000 new) = 15000; cap 45% of 15000 = 6750;
  // max new-money EQUITIES = (6750 - 5000) / 10000 = 0.175
  assert.ok(Math.abs(equitiesWith.percentage - 0.175) < 1e-9);
  assert.ok(withExisting.constraintsApplied.some((c) => c.includes("combined portfolio")));
});

test("existingPortfolio C. concrete before/after: a large existing concentration can reduce new-money allocation to that class to zero", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.5 } } }))
  );
  const before = constructPortfolio(validated);
  const equitiesBefore = before.allocations.find((a) => a.assetClass === "EQUITIES");
  assert.ok(equitiesBefore && equitiesBefore.percentage > 0); // unaffected: 0.4 default weight is under the 0.5 cap

  const after = constructPortfolio(validated, {
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 40000, currency: "CAD" }],
  });
  // combined = 50000; cap 50% of 50000 = 25000; existing alone (40000) already exceeds it ->
  // max new-money weight clamps to 0.
  const equitiesAfter = after.allocations.find((a) => a.assetClass === "EQUITIES");
  assert.equal(equitiesAfter, undefined);
  assert.ok(Math.abs(sumPercentages(after) - 1) < 1e-6); // freed capacity fully redistributed, never dropped
});

test("existingPortfolio D. does NOT create an implicit cap when no explicit cap is configured", () => {
  const validated = buildValidated();
  const without = constructPortfolio(validated);
  const withLargeExisting = constructPortfolio(validated, {
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 1000000, currency: "CAD" }],
  });
  assert.deepEqual(withLargeExisting.allocations, without.allocations);
  assert.equal(withLargeExisting.unallocatedPercentage, without.unallocatedPercentage);
});

test("existingPortfolio E. multi-line same-class aggregation sums marketValue before applying the cap", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.45 } } }))
  );
  const singleLine = constructPortfolio(validated, { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }] });
  const twoLines = constructPortfolio(validated, {
    existingPortfolio: [
      { assetClass: "EQUITIES", marketValue: 3000, currency: "CAD" },
      { assetClass: "EQUITIES", marketValue: 2000, currency: "CAD" },
    ],
  });
  assert.deepEqual(twoLines.allocations, singleLine.allocations);
});

test("existingPortfolio F. an empty array is disclosed distinctly from absent, while remaining mathematically identical", () => {
  const validated = buildValidated();
  const absent = constructPortfolio(validated);
  const empty = constructPortfolio(validated, { existingPortfolio: [] });
  assert.deepEqual(empty.allocations, absent.allocations);
  assert.ok(absent.assumptions.some((a) => a.includes("No existing portfolio was supplied")));
  assert.ok(empty.assumptions.some((a) => a.includes("confirming no current holdings")));
  assert.ok(!empty.assumptions.some((a) => a.includes("No existing portfolio was supplied")));
});

test("existingPortfolio G. a non-array existingPortfolio is safely treated as absent, with a warning, never a crash", () => {
  const validated = buildValidated();
  const absent = constructPortfolio(validated);
  assert.doesNotThrow(() => constructPortfolio(validated, { existingPortfolio: "not-an-array" }));
  const malformed = constructPortfolio(validated, { existingPortfolio: "not-an-array" });
  assert.deepEqual(malformed.allocations, absent.allocations);
  assert.ok(malformed.warnings.some((w) => w.includes("was not shaped as an array of holdings")));
});

test("existingPortfolio H. a line missing assetClass is excluded individually", () => {
  const validated = buildValidated();
  const result = constructPortfolio(validated, { existingPortfolio: [{ marketValue: 1000, currency: "CAD" }] });
  assert.ok(result.warnings.some((w) => w.includes("1 existing holding line(s) were excluded")));
});

test("existingPortfolio I. a line missing marketValue is excluded individually", () => {
  const validated = buildValidated();
  const result = constructPortfolio(validated, { existingPortfolio: [{ assetClass: "EQUITIES", currency: "CAD" }] });
  assert.ok(result.warnings.some((w) => w.includes("1 existing holding line(s) were excluded")));
});

test("existingPortfolio J. an unrecognized assetClass is excluded individually", () => {
  const validated = buildValidated();
  const result = constructPortfolio(validated, { existingPortfolio: [{ assetClass: "NOT_A_REAL_CLASS", marketValue: 1000, currency: "CAD" }] });
  assert.ok(result.warnings.some((w) => w.includes("1 existing holding line(s) were excluded")));
});

test("existingPortfolio K. a negative marketValue is excluded individually", () => {
  const validated = buildValidated();
  const result = constructPortfolio(validated, { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: -500, currency: "CAD" }] });
  assert.ok(result.warnings.some((w) => w.includes("1 existing holding line(s) were excluded")));
});

test("existingPortfolio L. invalid lines are excluded individually while valid lines continue contributing", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.45 } } }))
  );
  const result = constructPortfolio(validated, {
    existingPortfolio: [
      { assetClass: "NOT_REAL", marketValue: 9999, currency: "CAD" },
      { assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" },
    ],
  });
  assert.ok(result.warnings.some((w) => w.includes("1 existing holding line(s) were excluded")));
  const equities = result.allocations.find((a) => a.assetClass === "EQUITIES");
  assert.ok(Math.abs(equities.percentage - 0.175) < 1e-9); // matches existingPortfolio B's single-valid-line math exactly
});

test("existingPortfolio M. missing/UNKNOWN line currency is excluded from combined math (not treated as a malformed line)", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.45 } } }))
  );
  const noCurrency = constructPortfolio(validated, { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000 }] });
  const unknownCurrency = constructPortfolio(validated, { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "UNKNOWN" }] });
  const baseline = constructPortfolio(validated); // no existingPortfolio at all
  assert.ok(!noCurrency.warnings.some((w) => w.includes("were excluded because they were missing"))); // not a structural-malformation warning
  assert.ok(noCurrency.warnings.some((w) => w.includes("could be matched to the investment currency")));
  const equitiesNoCurrency = noCurrency.allocations.find((a) => a.assetClass === "EQUITIES");
  const equitiesBaseline = baseline.allocations.find((a) => a.assetClass === "EQUITIES");
  assert.equal(equitiesNoCurrency.percentage, equitiesBaseline.percentage);
  assert.deepEqual(unknownCurrency.allocations, noCurrency.allocations);
});

test("existingPortfolio N. a different currency is excluded from combined math and no FX conversion occurs", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.45 } } }))
  );
  const usdLine = constructPortfolio(validated, { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "USD" }] });
  const baseline = constructPortfolio(validated);
  const equitiesUsd = usdLine.allocations.find((a) => a.assetClass === "EQUITIES");
  const equitiesBaseline = baseline.allocations.find((a) => a.assetClass === "EQUITIES");
  assert.equal(equitiesUsd.percentage, equitiesBaseline.percentage); // USD line never participates against a CAD investment
  assert.ok(usdLine.warnings.some((w) => w.includes("did not match CAD") && w.includes("no FX conversion is performed")));
});

test("existingPortfolio O. mixed currencies: only the matching line participates", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.45 } } }))
  );
  const mixed = constructPortfolio(validated, {
    existingPortfolio: [
      { assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" },
      { assetClass: "EQUITIES", marketValue: 999999, currency: "USD" },
    ],
  });
  const cadOnly = constructPortfolio(validated, { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }] });
  assert.deepEqual(mixed.allocations, cadOnly.allocations);
  assert.ok(mixed.warnings.some((w) => w.includes("did not match CAD")));
});

test("existingPortfolio P. an UNKNOWN investmentCurrency makes existingPortfolio completely inert", () => {
  const validated = buildValidated({ investmentCurrency: undefined });
  assert.equal(validated.status, "INCOMPLETE");
  const withExisting = constructPortfolio(validated, { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 999999, currency: "UNKNOWN" }] });
  const without = constructPortfolio(validated);
  assert.deepEqual(withExisting.allocations, without.allocations);
  assert.equal(withExisting.status, RESULT_STATUS.INCOMPLETE); // unchanged — driven by currency unknown, not by existingPortfolio
  assert.ok(withExisting.assumptions.some((a) => a.includes("investmentCurrency is unknown; the supplied existingPortfolio could not be used")));
});

test("existingPortfolio Q. when all lines are excluded, the system falls back to new-money-only cap behavior, never blocks", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.45 } } }))
  );
  const allExcluded = constructPortfolio(validated, {
    existingPortfolio: [
      { assetClass: "NOT_REAL", marketValue: 1000, currency: "CAD" },
      { assetClass: "EQUITIES", marketValue: 1000, currency: "USD" },
    ],
  });
  const baseline = constructPortfolio(validated);
  assert.deepEqual(allExcluded.allocations, baseline.allocations);
  assert.equal(allExcluded.status, RESULT_STATUS.READY);
  assert.ok(allExcluded.warnings.some((w) => w.includes("could be matched to the investment currency")));
});

test("existingPortfolio R. excluded/includedOnly restrictions remain unaffected by existingPortfolio", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ riskTolerance: { value: "AGGRESSIVE", provenance: "PROVIDED" }, assetClassRestrictions: { excluded: ["CRYPTO"], includedOnly: [], maximumByClass: {} } }))
  );
  const result = constructPortfolio(validated, { existingPortfolio: [{ assetClass: "CRYPTO", marketValue: 50000, currency: "CAD" }] });
  assert.ok(!result.allocations.find((a) => a.assetClass === "CRYPTO"));
});

test("existingPortfolio S. eligibleAssetUniverse disclosure is unaffected by existingPortfolio", () => {
  const validated = buildValidated();
  const result = constructPortfolio(validated, {
    eligibleAssetUniverse: ["EQUITIES", "BONDS"],
    existingPortfolio: [{ assetClass: "GOLD", marketValue: 50000, currency: "CAD" }],
  });
  assert.ok(result.constraintsApplied.some((c) => c.includes("eligible asset universe")));
});

test("existingPortfolio T. investmentVehicleRestrictions remains unaffected by existingPortfolio", () => {
  const validated = buildValidated();
  const result = constructPortfolio(validated, {
    investmentVehicleRestrictions: { excluded: [], includedOnly: ["ETF"] },
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 50000, currency: "CAD" }],
  });
  assert.ok(result.allocations.every((a) => a.investmentVehicle === "ETF"));
});

test("existingPortfolio U. existingPortfolio alone never changes RESULT_STATUS", () => {
  const validated = buildValidated();
  assert.equal(validated.status, "VALID");
  const variants = [
    { existingPortfolio: undefined },
    { existingPortfolio: [] },
    { existingPortfolio: "not-an-array" },
    { existingPortfolio: [{ assetClass: "NOT_REAL", marketValue: 1 }] },
    { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 1000, currency: "USD" }] },
    { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 1000, currency: "CAD" }] },
  ];
  for (const options of variants) {
    assert.equal(constructPortfolio(validated, options).status, RESULT_STATUS.READY);
  }
});

test("existingPortfolio V. full nested immutability: options, existingPortfolio, and every line are never mutated", () => {
  const validated = buildValidated();
  const options = {
    existingPortfolio: [
      { assetClass: "EQUITIES", marketValue: 5000, currency: "CAD", ticker: "SPY", investmentVehicle: "ETF" },
      { assetClass: "NOT_REAL", marketValue: -1, currency: "USD", symbol: "XYZ" },
      {},
    ],
  };
  const snapshot = JSON.parse(JSON.stringify(options));
  constructPortfolio(validated, options);
  assert.deepEqual(options, snapshot);
});

test("existingPortfolio W. identical existingPortfolio input produces byte-identical (deep-equal) output", () => {
  const validated = buildValidated();
  const options = { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }] };
  assert.deepEqual(constructPortfolio(validated, options), constructPortfolio(validated, { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }] }));
});

test("existingPortfolio X. constructPortfolio with existingPortfolio never performs a real network call", async () => {
  const validated = buildValidated();
  const { networkCalled } = await withNetworkGuard(async () =>
    constructPortfolio(validated, { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }] })
  );
  assert.equal(networkCalled, false);
});

test("existingPortfolio Y. supplying existingPortfolio never adds a new top-level result field", () => {
  const validated = buildValidated();
  const baseline = constructPortfolio(validated);
  const withExisting = constructPortfolio(validated, { existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }] });
  assert.deepEqual(Object.keys(withExisting).sort(), Object.keys(baseline).sort());
});

test("existingPortfolio Z. ticker/security/instrument/vehicle fields on existing holdings are never read or echoed, and never affect the calculation", () => {
  const validated = validateInvestorProfile(
    createInvestorProfile(validInput({ assetClassRestrictions: { excluded: [], includedOnly: [], maximumByClass: { EQUITIES: 0.45 } } }))
  );
  const withSecurityFields = constructPortfolio(validated, {
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD", ticker: "SPY", symbol: "SPY", isin: "US78462F1030", cusip: "78462F103", investmentVehicle: "ETF" }],
  });
  const withoutSecurityFields = constructPortfolio(validated, {
    existingPortfolio: [{ assetClass: "EQUITIES", marketValue: 5000, currency: "CAD" }],
  });
  assert.deepEqual(withSecurityFields.allocations, withoutSecurityFields.allocations);
  const serialized = JSON.stringify(withSecurityFields).toLowerCase();
  assert.ok(!serialized.includes("spy"));
  assert.ok(!serialized.includes("isin"));
  assert.ok(!serialized.includes("cusip"));
  assert.ok(!serialized.includes('"symbol"'));
});

test("existingPortfolio AA. a large existing holding in an unrelated (even excluded) class can never loosen an explicit cap beyond its stated flat value (Step 77 audit finding)", () => {
  // AGGRESSIVE's natural EQUITIES archetype weight (0.55) exceeds the
  // investor's own explicit 50% cap. A huge existing CRYPTO holding
  // (excluded from new money entirely) inflates the existing+new
  // combined total; combined with a small existing EQUITIES exposure,
  // this used to make the combined-cap math return an effective cap
  // ABOVE 0.5 — silently permitting more EQUITIES than the investor
  // explicitly capped. The stated flat cap must always win.
  const validated = validateInvestorProfile(
    createInvestorProfile(
      validInput({
        riskTolerance: { value: "AGGRESSIVE", provenance: "PROVIDED" },
        assetClassRestrictions: { excluded: ["CRYPTO"], includedOnly: [], maximumByClass: { EQUITIES: 0.5 } },
      })
    )
  );
  const result = constructPortfolio(validated, {
    existingPortfolio: [
      { assetClass: "EQUITIES", marketValue: 100, currency: "CAD" },
      { assetClass: "CRYPTO", marketValue: 5000000, currency: "CAD" },
    ],
  });
  const equities = result.allocations.find((a) => a.assetClass === "EQUITIES");
  assert.ok(equities.percentage <= 0.5 + 1e-9, `EQUITIES must never exceed the stated 50% cap, got ${equities.percentage}`);
  assert.ok(Math.abs(sumPercentages(result) - 1) < 1e-6);
});

// --- No provider/network/credentials ---

test("35. constructPortfolio never performs a real network call", async () => {
  const validated = buildValidated();
  const { networkCalled } = await withNetworkGuard(async () => constructPortfolio(validated));
  assert.equal(networkCalled, false);
});

test("36. no credential-shaped field or provider-specific data appears anywhere in the result", () => {
  const result = constructPortfolio(buildValidated());
  const serialized = JSON.stringify(result).toLowerCase();
  assert.ok(!serialized.includes("apikey"));
  assert.ok(!serialized.includes("credential"));
  assert.ok(!serialized.includes("fred_series_id"));
  assert.ok(!serialized.includes("ticker_sentiment"));
});

// --- No security/ticker selection, no fabricated market claims ---

test("37. no allocation ever contains a ticker/instrument/security identifier", () => {
  const result = constructPortfolio(buildValidated());
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('"ticker"'));
  assert.ok(!serialized.includes('"instrument"'));
  assert.ok(!serialized.includes('"securityIdentifier"'));
});

test("38. reasons never contain a fabricated market claim, forecast, or guarantee", () => {
  const result = constructPortfolio(buildValidated());
  for (const allocation of result.allocations) {
    const lower = allocation.reason.toLowerCase();
    assert.ok(!lower.includes("guaranteed"));
    assert.ok(!lower.includes("will rise"));
    assert.ok(!lower.includes("expected return"));
  }
});

test("39. asset-class and investment-vehicle vocabularies are never extended beyond the Step 54 frozen lists", () => {
  const result = constructPortfolio(buildValidated());
  for (const allocation of result.allocations) {
    assert.ok(ASSET_CLASSES.includes(allocation.assetClass));
  }
});

test("41. constructPortfolio's status handling is coupled to the real VALIDATION_STATUS constant, not a hardcoded string guess (Step 59 audit finding)", () => {
  // Directly exercises every VALIDATION_STATUS value via the actual
  // exported constant, so a future rename/value change in
  // investorProfileValidation.js would break this test immediately
  // rather than silently desyncing from portfolioConstruction.js's
  // own status checks.
  const insufficient = { status: VALIDATION_STATUS.INSUFFICIENT_INFORMATION, missingRequiredFields: ["riskTolerance"], contradictions: [] };
  assert.equal(constructPortfolio(insufficient).status, RESULT_STATUS.BLOCKED);

  const needsClarification = { status: VALIDATION_STATUS.NEEDS_CLARIFICATION, missingRequiredFields: [], contradictions: [{ fields: ["riskTolerance"], reason: "conflict" }] };
  assert.equal(constructPortfolio(needsClarification).status, RESULT_STATUS.NEEDS_CLARIFICATION);

  const incomplete = buildValidated({ investmentCurrency: undefined });
  assert.equal(incomplete.status, VALIDATION_STATUS.INCOMPLETE);
  assert.equal(constructPortfolio(incomplete).status, RESULT_STATUS.INCOMPLETE);

  const valid = buildValidated();
  assert.equal(valid.status, VALIDATION_STATUS.VALID);
  assert.equal(constructPortfolio(valid).status, RESULT_STATUS.READY);
});

test("40. a fully invalid/malformed result is reported as invalid, never throws", () => {
  assert.doesNotThrow(() => validatePortfolioConstructionResult(null));
  assert.doesNotThrow(() => validatePortfolioConstructionResult({}));
  assert.equal(validatePortfolioConstructionResult(null).valid, false);
});
