// Offline tests for the Investor Profile contract — implements the
// design frozen in Step 51/52. No network access, no provider data,
// no natural-language parsing, no portfolio logic anywhere in this
// file. Every test uses structured input only.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createInvestorProfile, PROVENANCE_STATES } = require("./investorProfile");
const { validateInvestorProfile, VALIDATION_STATUS } = require("./investorProfileValidation");
const { UNKNOWN } = require("../core/constants");

const PROVIDED = PROVENANCE_STATES.PROVIDED;
const INFERRED = PROVENANCE_STATES.INFERRED;
const INVALID = PROVENANCE_STATES.INVALID;

function completeValidInput(overrides = {}) {
  return {
    investmentAmount: { value: 3000, provenance: PROVIDED },
    investmentCurrency: { value: "CAD", provenance: PROVIDED },
    investmentHorizon: { minimumYears: 5, maximumYears: 5, provenance: PROVIDED },
    riskTolerance: { value: "MODERATE", provenance: PROVIDED },
    investmentObjective: { value: "BALANCED_GROWTH", provenance: PROVIDED },
    ...overrides,
  };
}

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

// 1. Complete valid profile.
test("1. a complete, fully valid profile produces VALID", () => {
  const profile = createInvestorProfile(completeValidInput());
  const result = validateInvestorProfile(profile);
  assert.equal(result.status, VALIDATION_STATUS.VALID);
  assert.deepEqual(result.missingRequiredFields, []);
  assert.deepEqual(result.invalidFields, []);
  assert.deepEqual(result.contradictions, []);
});

// 2. Missing investment amount.
test("2. missing investmentAmount produces INSUFFICIENT_INFORMATION", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentAmount: undefined }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.status, VALIDATION_STATUS.INSUFFICIENT_INFORMATION);
  assert.ok(result.missingRequiredFields.includes("investmentAmount"));
  assert.equal(result.profile.investmentAmount.value, UNKNOWN);
  assert.equal(result.profile.investmentAmount.provenance, UNKNOWN);
});

// 3. Zero investment amount.
test("3. zero investmentAmount is INVALID, never treated as a real amount", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentAmount: { value: 0, provenance: PROVIDED } }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentAmount.provenance, INVALID);
  assert.ok(result.invalidFields.includes("investmentAmount"));
  assert.equal(result.status, VALIDATION_STATUS.INSUFFICIENT_INFORMATION);
});

// 4. Negative investment amount.
test("4. a negative investmentAmount is INVALID", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentAmount: { value: -500, provenance: PROVIDED } }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentAmount.provenance, INVALID);
});

// 5. Invalid investment amount (NaN, Infinity, non-numeric, empty string).
test("5. NaN, Infinity, non-numeric, and empty-string amounts are all INVALID", () => {
  for (const badValue of [NaN, Infinity, "3000", "", null]) {
    const profile = createInvestorProfile(completeValidInput({ investmentAmount: { value: badValue, provenance: PROVIDED } }));
    const result = validateInvestorProfile(profile);
    assert.equal(result.profile.investmentAmount.provenance, INVALID, `expected INVALID for value ${String(badValue)}`);
  }
});

// 6. Valid CAD currency.
test("6. CAD is a valid, supported currency", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentCurrency: { value: "CAD", provenance: PROVIDED } }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentCurrency.provenance, PROVIDED);
  assert.equal(result.profile.investmentCurrency.value, "CAD");
});

// 7. Valid USD currency.
test("7. USD is a valid, supported currency", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentCurrency: { value: "USD", provenance: PROVIDED } }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentCurrency.provenance, PROVIDED);
});

// 8. Unsupported currency.
test("8. an unsupported currency code is INVALID", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentCurrency: { value: "JPY", provenance: PROVIDED } }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentCurrency.provenance, INVALID);
  assert.ok(result.invalidFields.includes("investmentCurrency"));
});

// 9. Bare/unknown currency.
test("9. a bare/unspecified currency stays UNKNOWN, never guessed", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentCurrency: undefined }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentCurrency.provenance, UNKNOWN);
  assert.equal(result.profile.investmentCurrency.value, UNKNOWN);
  assert.equal(result.status, VALIDATION_STATUS.INCOMPLETE);
});

// 10. Numeric horizon.
test("10. a numeric 5-year horizon is derived as MEDIUM_TERM", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentHorizon: { minimumYears: 5, maximumYears: 5, provenance: PROVIDED } }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentHorizon.band, "MEDIUM_TERM");
  assert.equal(result.profile.investmentHorizon.provenance, PROVIDED);
});

test("10b. a numeric 15-year horizon is derived as LONG_TERM regardless of an open maximumYears", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentHorizon: { minimumYears: 15, provenance: PROVIDED } }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentHorizon.band, "LONG_TERM");
});

test("10c. exactly 10 years (min=10, max=10) is MEDIUM_TERM, per the frozen boundary rule", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentHorizon: { minimumYears: 10, maximumYears: 10, provenance: PROVIDED } }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentHorizon.band, "MEDIUM_TERM");
});

// 11. Qualitative horizon.
test("11. a qualitative-only horizon (\"long term\") keeps numeric fields UNKNOWN, never fabricates years", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentHorizon: { band: "LONG_TERM", provenance: PROVIDED } }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentHorizon.band, "LONG_TERM");
  assert.equal(result.profile.investmentHorizon.provenance, PROVIDED);
  assert.equal(result.profile.investmentHorizon.minimumYears, UNKNOWN);
  assert.equal(result.profile.investmentHorizon.maximumYears, UNKNOWN);
});

// 12. Invalid horizon.
test("12. an unsupported band value or a negative minimumYears is INVALID", () => {
  const badBand = createInvestorProfile(completeValidInput({ investmentHorizon: { band: "FOREVER", provenance: PROVIDED } }));
  assert.equal(validateInvestorProfile(badBand).profile.investmentHorizon.provenance, INVALID);

  const negativeMin = createInvestorProfile(completeValidInput({ investmentHorizon: { minimumYears: -1, provenance: PROVIDED } }));
  assert.equal(validateInvestorProfile(negativeMin).profile.investmentHorizon.provenance, INVALID);
});

// 13. Reversed horizon range.
test("13. minimumYears greater than maximumYears is INVALID (reversed range)", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentHorizon: { minimumYears: 8, maximumYears: 3, provenance: PROVIDED } }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentHorizon.provenance, INVALID);
});

// 14/15/16. Risk tolerance categories.
test("14/15/16. CONSERVATIVE, MODERATE, and AGGRESSIVE are all valid risk tolerances", () => {
  for (const value of ["CONSERVATIVE", "MODERATE", "AGGRESSIVE"]) {
    const profile = createInvestorProfile(completeValidInput({ riskTolerance: { value, provenance: PROVIDED } }));
    const result = validateInvestorProfile(profile);
    assert.equal(result.profile.riskTolerance.provenance, PROVIDED);
    assert.equal(result.profile.riskTolerance.value, value);
  }
});

// 17. Invalid risk.
test("17. an unsupported risk tolerance value is INVALID; VERY_CONSERVATIVE is not a recognized category", () => {
  const profile = createInvestorProfile(completeValidInput({ riskTolerance: { value: "VERY_CONSERVATIVE", provenance: PROVIDED } }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.riskTolerance.provenance, INVALID);
});

// 18. Missing risk.
test("18. missing riskTolerance produces INSUFFICIENT_INFORMATION", () => {
  const profile = createInvestorProfile(completeValidInput({ riskTolerance: undefined }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.status, VALIDATION_STATUS.INSUFFICIENT_INFORMATION);
  assert.ok(result.missingRequiredFields.includes("riskTolerance"));
});

// 19. Valid objective.
test("19. a supported investmentObjective value is valid", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentObjective: { value: "CAPITAL_GROWTH", provenance: PROVIDED } }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentObjective.provenance, PROVIDED);
});

// 20. Invalid objective.
test("20. an unsupported investmentObjective value is INVALID", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentObjective: { value: "GET_RICH_QUICK", provenance: PROVIDED } }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentObjective.provenance, INVALID);
});

// 21. Missing objective produces INCOMPLETE, not failure.
test("21. a missing investmentObjective (all required fields present) produces INCOMPLETE, not a failure", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentObjective: undefined }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.status, VALIDATION_STATUS.INCOMPLETE);
  assert.deepEqual(result.missingRequiredFields, []);
  assert.ok(result.warnings.some((w) => w.includes("investmentObjective")));
});

// 22. Missing currency produces INCOMPLETE, not failure.
test("22. a missing investmentCurrency (all required fields present) produces INCOMPLETE, not a failure", () => {
  const profile = createInvestorProfile(completeValidInput({ investmentCurrency: undefined }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.status, VALIDATION_STATUS.INCOMPLETE);
  assert.ok(result.warnings.some((w) => w.includes("investmentCurrency")));
});

// 23. Missing required fields produces INSUFFICIENT_INFORMATION.
test("23. multiple missing required fields all appear in missingRequiredFields, status is INSUFFICIENT_INFORMATION", () => {
  const profile = createInvestorProfile({ investmentAmount: { value: 3000, provenance: PROVIDED } });
  const result = validateInvestorProfile(profile);
  assert.equal(result.status, VALIDATION_STATUS.INSUFFICIENT_INFORMATION);
  assert.deepEqual(result.missingRequiredFields.sort(), ["investmentHorizon", "riskTolerance"]);
});

// 24. Maximum concentration validation.
test("24. maximumConcentration accepts fractions in (0,1] and rejects 0, negative, and >1", () => {
  const valid = createInvestorProfile(completeValidInput({ maximumConcentration: { value: 0.25, provenance: PROVIDED } }));
  assert.equal(validateInvestorProfile(valid).profile.maximumConcentration.provenance, PROVIDED);

  for (const bad of [0, -0.1, 1.5]) {
    const profile = createInvestorProfile(completeValidInput({ maximumConcentration: { value: bad, provenance: PROVIDED } }));
    assert.equal(validateInvestorProfile(profile).profile.maximumConcentration.provenance, INVALID, `expected INVALID for ${bad}`);
  }
});

// 25. Asset restrictions validation.
test("25. assetClassRestrictions accepts a well-formed structure and flags malformed entries", () => {
  const valid = createInvestorProfile(
    completeValidInput({ assetClassRestrictions: { excluded: ["CRYPTO"], includedOnly: [], maximumByClass: { CRYPTO: 0.05 } } })
  );
  const validResult = validateInvestorProfile(valid);
  assert.deepEqual(validResult.invalidFields, []);
  assert.deepEqual(validResult.profile.assetClassRestrictions.excluded, ["CRYPTO"]);
  assert.equal(validResult.profile.assetClassRestrictions.maximumByClass.CRYPTO, 0.05);

  const malformed = createInvestorProfile(
    completeValidInput({ assetClassRestrictions: { excluded: [""], maximumByClass: { CRYPTO: 1.5, BONDS: -0.1 } } })
  );
  const malformedResult = validateInvestorProfile(malformed);
  assert.ok(malformedResult.invalidFields.some((e) => e.includes("excluded[0]")));
  assert.ok(malformedResult.invalidFields.some((e) => e.includes("maximumByClass.CRYPTO")));
  assert.ok(malformedResult.invalidFields.some((e) => e.includes("maximumByClass.BONDS")));
});

// 26. Liquidity requirement validation.
test("26. liquidityRequirement accepts UNKNOWN/IMMEDIATE/SHORT_TERM/FLEXIBLE and rejects anything else", () => {
  for (const value of ["UNKNOWN", "IMMEDIATE", "SHORT_TERM", "FLEXIBLE"]) {
    const profile = createInvestorProfile(completeValidInput({ liquidityRequirement: { value, provenance: PROVIDED } }));
    assert.equal(validateInvestorProfile(profile).profile.liquidityRequirement.provenance, PROVIDED, `expected valid for ${value}`);
  }
  const bad = createInvestorProfile(completeValidInput({ liquidityRequirement: { value: "SOMEDAY", provenance: PROVIDED } }));
  assert.equal(validateInvestorProfile(bad).profile.liquidityRequirement.provenance, INVALID);
});

// 27. Emergency cash validation.
test("27. emergencyCashRequirement accepts a positive amount with a supported currency and rejects invalid amounts/currencies", () => {
  const valid = createInvestorProfile(completeValidInput({ emergencyCashRequirement: { value: 1000, currency: "USD", provenance: PROVIDED } }));
  assert.equal(validateInvestorProfile(valid).profile.emergencyCashRequirement.provenance, PROVIDED);

  const badAmount = createInvestorProfile(completeValidInput({ emergencyCashRequirement: { value: -1, currency: "USD", provenance: PROVIDED } }));
  assert.equal(validateInvestorProfile(badAmount).profile.emergencyCashRequirement.provenance, INVALID);

  const badCurrency = createInvestorProfile(completeValidInput({ emergencyCashRequirement: { value: 500, currency: "JPY", provenance: PROVIDED } }));
  assert.equal(validateInvestorProfile(badCurrency).profile.emergencyCashRequirement.provenance, INVALID);
});

// 28. Contradiction detection.
test("28. a band that disagrees with the given numeric range is detected as a contradiction, status NEEDS_CLARIFICATION", () => {
  const profile = createInvestorProfile(
    completeValidInput({ investmentHorizon: { minimumYears: 0.25, maximumYears: 0.25, band: "LONG_TERM", provenance: PROVIDED } })
  );
  const result = validateInvestorProfile(profile);
  assert.equal(result.status, VALIDATION_STATUS.NEEDS_CLARIFICATION);
  assert.equal(result.contradictions.length, 1);
  assert.deepEqual(result.contradictions[0].fields, ["investmentHorizon"]);
  assert.ok(result.contradictions[0].reason.length > 0);
});

// 29. Contradictions are preserved (neither side discarded).
test("29. a detected contradiction preserves both the original band and the original numeric range, never picks a winner", () => {
  const profile = createInvestorProfile(
    completeValidInput({ investmentHorizon: { minimumYears: 0.25, maximumYears: 0.25, band: "LONG_TERM", provenance: PROVIDED } })
  );
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentHorizon.band, "LONG_TERM");
  assert.equal(result.profile.investmentHorizon.minimumYears, 0.25);
  assert.equal(result.profile.investmentHorizon.maximumYears, 0.25);
});

// 30. Original input remains unchanged.
test("30. neither createInvestorProfile() nor validateInvestorProfile() mutates the caller's input", () => {
  const input = completeValidInput();
  const inputSnapshot = JSON.parse(JSON.stringify(input));
  const profile = createInvestorProfile(input);
  assert.deepEqual(input, inputSnapshot);

  const profileSnapshot = JSON.parse(JSON.stringify(profile));
  validateInvestorProfile(profile);
  assert.deepEqual(profile, profileSnapshot);
});

// 31. Same input produces identical output (determinism).
test("31. the same input produces an identical normalized profile and validation result every time", () => {
  const input = completeValidInput();
  const resultA = validateInvestorProfile(createInvestorProfile(input));
  const resultB = validateInvestorProfile(createInvestorProfile(input));
  assert.deepEqual(resultA, resultB);
});

// 32. No fabricated values.
test("32. a missing investmentAmount never defaults to any numeric value, only the UNKNOWN sentinel", () => {
  const profile = createInvestorProfile({});
  assert.equal(profile.investmentAmount.value, UNKNOWN);
  assert.notEqual(typeof profile.investmentAmount.value, "number");
});

// 33. No provider credentials.
test("33. no provider credential field exists anywhere in the profile or validation result", () => {
  const result = validateInvestorProfile(createInvestorProfile(completeValidInput()));
  const serialized = JSON.stringify(result).toLowerCase();
  assert.ok(!serialized.includes("apikey"));
  assert.ok(!serialized.includes("api_key"));
  assert.ok(!serialized.includes("credential"));
});

// 34. No provider-specific data.
test("34. no provider-specific field (FRED/Alpha Vantage shaped) exists anywhere in the profile or result", () => {
  const result = validateInvestorProfile(createInvestorProfile(completeValidInput()));
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("fred_series_id"));
  assert.ok(!serialized.includes("ticker_sentiment"));
  assert.ok(!serialized.includes("Time Series"));
});

// 35. No market recommendations.
test("35. the validation result never contains an allocation or recommendation field", () => {
  const result = validateInvestorProfile(createInvestorProfile(completeValidInput()));
  assert.equal(result.allocation, undefined);
  assert.equal(result.recommendation, undefined);
  assert.equal(result.portfolio, undefined);
});

// 36. No network access.
test("36. validating a profile never performs a real network call", async () => {
  const { networkCalled } = await withNetworkGuard(async () => validateInvestorProfile(createInvestorProfile(completeValidInput())));
  assert.equal(networkCalled, false);
});

// 37. All profile fields are serializable.
test("37. the full validation result survives a JSON round-trip unchanged", () => {
  const result = validateInvestorProfile(createInvestorProfile(completeValidInput()));
  const roundTripped = JSON.parse(JSON.stringify(result));
  assert.deepEqual(roundTripped, result);
});

// 38. INFERRED provenance is explicit.
test("38. an INFERRED field is never silently treated as user-provided, and its reason is preserved", () => {
  const profile = createInvestorProfile(
    completeValidInput({ investmentObjective: { value: "BALANCED_GROWTH", provenance: INFERRED, reason: "Inferred from stated risk tolerance and horizon; not explicitly stated by the user." } })
  );
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentObjective.provenance, INFERRED);
  assert.notEqual(result.profile.investmentObjective.provenance, PROVIDED);
  assert.ok(result.profile.investmentObjective.reason.length > 0);
});

// 39. INVALID provenance is explicit.
test("39. an INVALID field always carries a specific, non-empty reason", () => {
  const profile = createInvestorProfile(completeValidInput({ riskTolerance: { value: "SUPER_RISKY", provenance: PROVIDED } }));
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.riskTolerance.provenance, INVALID);
  assert.notEqual(result.profile.riskTolerance.reason, UNKNOWN);
  assert.ok(result.profile.riskTolerance.reason.length > 0);
});

// 40. UNKNOWN provenance is explicit.
test("40. a completely unset field is explicitly UNKNOWN across value, provenance, and reason — never omitted", () => {
  const profile = createInvestorProfile({});
  assert.equal(profile.riskTolerance.value, UNKNOWN);
  assert.equal(profile.riskTolerance.provenance, UNKNOWN);
  assert.equal(profile.riskTolerance.reason, UNKNOWN);
  assert.ok("riskTolerance" in profile); // never omitted from the shape
});
