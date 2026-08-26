// Offline tests for the deterministic Investor Profile Extraction
// layer — implements the design frozen in Step 53/54/55. No network
// access, no provider access, no LLM, no credentials, no portfolio
// logic anywhere in this file.

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractInvestorProfile } = require("./investorProfileExtraction");
const { validateInvestorProfile } = require("./investorProfileValidation");

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

// 1-4. Currency + amount by code.
test("1. CAD amount", () => {
  const { profile } = extractInvestorProfile("I have CAD $3,000 to invest.");
  assert.equal(profile.investmentAmount.value, 3000);
  assert.equal(profile.investmentAmount.provenance, "PROVIDED");
  assert.equal(profile.investmentCurrency.value, "CAD");
});

test("2. USD amount", () => {
  const { profile } = extractInvestorProfile("I have USD $5,000 to invest.");
  assert.equal(profile.investmentAmount.value, 5000);
  assert.equal(profile.investmentCurrency.value, "USD");
});

test("3. EUR amount", () => {
  const { profile } = extractInvestorProfile("I have 4,000 euros to invest.");
  assert.equal(profile.investmentAmount.value, 4000);
  assert.equal(profile.investmentCurrency.value, "EUR");
});

test("4. GBP amount", () => {
  const { profile } = extractInvestorProfile("I have 2,500 British pounds to invest.");
  assert.equal(profile.investmentAmount.value, 2500);
  assert.equal(profile.investmentCurrency.value, "GBP");
});

// 5. Bare dollar sign.
test("5. a bare dollar sign leaves currency UNKNOWN, never guessed", () => {
  const { profile } = extractInvestorProfile("I have $3,000 to invest.");
  assert.equal(profile.investmentAmount.value, 3000);
  assert.equal(profile.investmentCurrency.value, "UNKNOWN");
  assert.equal(profile.investmentCurrency.provenance, "UNKNOWN");
});

// 6. Amount with comma.
test("6. an amount with thousands separators parses correctly", () => {
  const { profile } = extractInvestorProfile("I have $12,345 to invest.");
  assert.equal(profile.investmentAmount.value, 12345);
});

// 7. Decimal amount.
test("7. a decimal amount preserves precision", () => {
  const { profile } = extractInvestorProfile("I have $3000.50 to invest.");
  assert.equal(profile.investmentAmount.value, 3000.5);
});

// 8. Approximate amount.
test("8. an approximate amount stays PROVIDED with the qualifier preserved in reason", () => {
  const { profile } = extractInvestorProfile("I have about $3,000 to invest.");
  assert.equal(profile.investmentAmount.value, 3000);
  assert.equal(profile.investmentAmount.provenance, "PROVIDED");
  assert.ok(profile.investmentAmount.reason.toLowerCase().includes("approximate"));
});

// 9. Word-number amount.
test("9. a word-form amount (\"three thousand dollars\") is parsed deterministically", () => {
  const { profile } = extractInvestorProfile("I can invest three thousand dollars.");
  assert.equal(profile.investmentAmount.value, 3000);
  assert.equal(profile.investmentAmount.provenance, "PROVIDED");
});

// 10. Multiple amounts.
test("10. multiple distinct amounts: the first present amount is primary, the rest are recorded as an ambiguity, never summed", () => {
  const { profile, ambiguities } = extractInvestorProfile("I have $3,000 now and another $2,000 next month.");
  assert.equal(profile.investmentAmount.value, 3000);
  assert.notEqual(profile.investmentAmount.value, 5000);
  const amountAmbiguity = ambiguities.find((a) => a.field === "investmentAmount");
  assert.ok(amountAmbiguity);
  assert.ok(amountAmbiguity.candidates.includes(2000));
});

// 11. Amount range.
test("11. an amount range is never averaged or bounded, investmentAmount stays UNKNOWN", () => {
  const { profile, ambiguities } = extractInvestorProfile("I have between $3,000 and $5,000 to invest.");
  assert.equal(profile.investmentAmount.value, "UNKNOWN");
  const rangeAmbiguity = ambiguities.find((a) => a.field === "investmentAmount");
  assert.ok(rangeAmbiguity);
  assert.deepEqual(rangeAmbiguity.candidates.sort(), [3000, 5000]);
});

test("11b. a bare number elsewhere in the sentence (e.g. \"5\" in \"5 years\") is never treated as a competing amount candidate (Step 70 finding)", () => {
  const { profile, ambiguities } = extractInvestorProfile(
    "I have CAD $10,000 and want to invest for 5 years. I am comfortable with moderate risk. I want balanced growth."
  );
  assert.equal(profile.investmentAmount.value, 10000);
  assert.equal(profile.investmentAmount.provenance, "PROVIDED");
  assert.deepEqual(
    ambiguities.filter((a) => a.field === "investmentAmount"),
    []
  );
});

// 12-16. Numeric horizons.
test("12. six-month horizon converts to 0.5 years", () => {
  const { profile } = extractInvestorProfile("I want to invest for 6 months.");
  assert.equal(profile.investmentHorizon.minimumYears, 0.5);
  assert.equal(profile.investmentHorizon.maximumYears, 0.5);
  assert.equal(profile.investmentHorizon.provenance, "PROVIDED");
});

test("13. one-year horizon", () => {
  const { profile } = extractInvestorProfile("I want to invest for one year.");
  assert.equal(profile.investmentHorizon.minimumYears, 1);
  assert.equal(profile.investmentHorizon.maximumYears, 1);
});

test("14. five-year horizon", () => {
  const { profile } = extractInvestorProfile("I want to invest for five years.");
  assert.equal(profile.investmentHorizon.minimumYears, 5);
  assert.equal(profile.investmentHorizon.maximumYears, 5);
});

test("15. ten-year horizon is a closed point (MEDIUM_TERM per Step 52's own boundary once validated)", () => {
  const { profile } = extractInvestorProfile("I want to invest for 10 years.");
  assert.equal(profile.investmentHorizon.minimumYears, 10);
  assert.equal(profile.investmentHorizon.maximumYears, 10);
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentHorizon.band, "MEDIUM_TERM");
});

test("16. fifteen-year horizon", () => {
  const { profile } = extractInvestorProfile("I want to invest for 15 years.");
  assert.equal(profile.investmentHorizon.minimumYears, 15);
  const result = validateInvestorProfile(profile);
  assert.equal(result.profile.investmentHorizon.band, "LONG_TERM");
});

// 17/18. Qualitative horizons.
test("17. short-term qualitative horizon sets only the band", () => {
  const { profile } = extractInvestorProfile("I want a short-term investment.");
  assert.equal(profile.investmentHorizon.band, "SHORT_TERM");
  assert.equal(profile.investmentHorizon.minimumYears, "UNKNOWN");
  assert.equal(profile.investmentHorizon.provenance, "PROVIDED");
});

test("18. long-term qualitative horizon sets only the band", () => {
  const { profile } = extractInvestorProfile("This is a long term investment.");
  assert.equal(profile.investmentHorizon.band, "LONG_TERM");
  assert.equal(profile.investmentHorizon.minimumYears, "UNKNOWN");
  assert.equal(profile.investmentHorizon.maximumYears, "UNKNOWN");
});

// 19. More than ten years.
test("19. \"more than 10 years\" sets band=LONG_TERM directly, never a fabricated numeric minimum", () => {
  const a = extractInvestorProfile("I plan to invest for more than 10 years.").profile;
  assert.equal(a.investmentHorizon.band, "LONG_TERM");
  assert.equal(a.investmentHorizon.minimumYears, "UNKNOWN");
  assert.equal(a.investmentHorizon.maximumYears, "UNKNOWN");

  const b = extractInvestorProfile("I plan to invest for 10+ years.").profile;
  assert.equal(b.investmentHorizon.band, "LONG_TERM");
  assert.equal(b.investmentHorizon.minimumYears, "UNKNOWN");
});

// 20. Vague horizon.
test("20. \"several years\" stays fully UNKNOWN; \"a few months\" is safely INFERRED as SHORT_TERM", () => {
  const vague = extractInvestorProfile("I want to invest for several years.").profile;
  assert.equal(vague.investmentHorizon.band, "UNKNOWN");
  assert.equal(vague.investmentHorizon.provenance, "UNKNOWN");

  const fewMonths = extractInvestorProfile("I want to invest for a few months.").profile;
  assert.equal(fewMonths.investmentHorizon.band, "SHORT_TERM");
  assert.equal(fewMonths.investmentHorizon.provenance, "INFERRED");
  assert.ok(fewMonths.investmentHorizon.reason.length > 0);
});

// 21-23. Risk tolerance.
test("21. conservative risk", () => {
  const { profile } = extractInvestorProfile("I am conservative and don't want much risk.");
  assert.equal(profile.riskTolerance.value, "CONSERVATIVE");
  assert.equal(profile.riskTolerance.provenance, "PROVIDED");
});

test("22. moderate risk", () => {
  const { profile } = extractInvestorProfile("I am comfortable with moderate risk.");
  assert.equal(profile.riskTolerance.value, "MODERATE");
});

test("23. aggressive risk", () => {
  const { profile } = extractInvestorProfile("I am comfortable taking high risk.");
  assert.equal(profile.riskTolerance.value, "AGGRESSIVE");
});

// 24. Missing risk.
test("24. missing risk tolerance stays UNKNOWN", () => {
  const { profile } = extractInvestorProfile("I have $3,000 to invest for 5 years.");
  assert.equal(profile.riskTolerance.value, "UNKNOWN");
  assert.equal(profile.riskTolerance.provenance, "UNKNOWN");
});

// 25. Contradictory risk.
test("25. contradictory risk language is preserved as a contradiction, never resolved to a side", () => {
  const { profile, contradictions } = extractInvestorProfile("I don't want to lose money but I want very high returns with high risk.");
  assert.equal(profile.riskTolerance.value, "UNKNOWN");
  assert.ok(contradictions.some((c) => c.fields.includes("riskTolerance")));
});

// 26-30. Objective.
test("26. capital preservation objective", () => {
  const { profile } = extractInvestorProfile("I want to protect my money.");
  assert.equal(profile.investmentObjective.value, "CAPITAL_PRESERVATION");
});

test("27. income objective", () => {
  const { profile } = extractInvestorProfile("I want to generate regular income.");
  assert.equal(profile.investmentObjective.value, "INCOME");
});

test("28. balanced growth objective", () => {
  const { profile } = extractInvestorProfile("I want balanced growth.");
  assert.equal(profile.investmentObjective.value, "BALANCED_GROWTH");
});

test("29. capital growth objective", () => {
  const { profile } = extractInvestorProfile("I want my money to grow.");
  assert.equal(profile.investmentObjective.value, "CAPITAL_GROWTH");
});

test("30. speculation objective", () => {
  const { profile } = extractInvestorProfile("I want to speculate.");
  assert.equal(profile.investmentObjective.value, "SPECULATION");
});

// 31. Ambiguous objective.
test("31. ambiguous objective language stays UNKNOWN, never forced into a category", () => {
  for (const text of ["I want good returns.", "I want to make money.", "I want safe growth."]) {
    const { profile } = extractInvestorProfile(text);
    assert.equal(profile.investmentObjective.value, "UNKNOWN", `expected UNKNOWN for: ${text}`);
  }
});

// 32. Bitcoin does not imply speculation.
test("32. mentioning Bitcoin never by itself sets investmentObjective to SPECULATION", () => {
  const { profile } = extractInvestorProfile("I want to buy Bitcoin.");
  assert.notEqual(profile.investmentObjective.value, "SPECULATION");
  assert.equal(profile.investmentObjective.value, "UNKNOWN");
});

// 33. Liquidity extraction.
test("33. liquidity extraction maps to the frozen enum only", () => {
  assert.equal(extractInvestorProfile("I may need the money immediately.").profile.liquidityRequirement.value, "IMMEDIATE");
  assert.equal(extractInvestorProfile("I don't need the money soon; I can leave it invested.").profile.liquidityRequirement.value, "FLEXIBLE");
  assert.equal(extractInvestorProfile("This has nothing to do with liquidity at all.").profile.liquidityRequirement.value, "UNKNOWN");
});

// 34/35. Emergency cash.
test("34. emergency cash extraction requires both the emergency keyword and an explicit amount", () => {
  const { profile } = extractInvestorProfile("I need $2,000 kept aside for emergencies.");
  assert.equal(profile.emergencyCashRequirement.value, 2000);
  assert.equal(profile.emergencyCashRequirement.provenance, "PROVIDED");
});

test("35. explicit emergency-cash currency is captured only from its own clause, never inherited", () => {
  const { profile } = extractInvestorProfile("I have CAD $5,000 to invest and need USD $2,000 for emergencies.");
  assert.equal(profile.investmentCurrency.value, "CAD");
  assert.equal(profile.emergencyCashRequirement.value, 2000);
  assert.equal(profile.emergencyCashRequirement.currency, "USD");
});

test("35b. emergency cash currency stays UNKNOWN when not stated in its own clause, even if the main amount has a currency", () => {
  const { profile } = extractInvestorProfile("I have CAD $5,000 to invest and need $2,000 for emergencies.");
  assert.equal(profile.investmentCurrency.value, "CAD");
  assert.equal(profile.emergencyCashRequirement.currency, "UNKNOWN");
});

// 36/37. Asset restrictions.
test("36. \"no crypto\" excludes CRYPTO", () => {
  const { profile } = extractInvestorProfile("No crypto, please.");
  assert.deepEqual(profile.assetClassRestrictions.excluded, ["CRYPTO"]);
});

test("37. \"no gold\" excludes GOLD", () => {
  const { profile } = extractInvestorProfile("Do not invest in gold.");
  assert.deepEqual(profile.assetClassRestrictions.excluded, ["GOLD"]);
});

// 38. Only supported asset class.
test("38. \"only bonds\" populates includedOnly with the canonical class", () => {
  const { profile } = extractInvestorProfile("Only bonds, nothing else.");
  assert.deepEqual(profile.assetClassRestrictions.includedOnly, ["BONDS"]);
});

// 39. Crypto maximum 5%.
test("39. \"keep crypto below 5%\" populates maximumByClass", () => {
  const { profile } = extractInvestorProfile("Keep crypto below 5%.");
  assert.equal(profile.assetClassRestrictions.maximumByClass.CRYPTO, 0.05);
});

// 40. Maximum concentration.
test("40. a portfolio-wide single-position cap populates maximumConcentration", () => {
  const { profile } = extractInvestorProfile("Never put more than 25% in one position.");
  assert.equal(profile.maximumConcentration.value, 0.25);
  assert.equal(profile.maximumConcentration.provenance, "PROVIDED");
});

// 41. Unsupported concentration statement becomes ambiguity.
test("41. an unnamed per-asset-class concentration statement is not forced into maximumConcentration", () => {
  const { profile, ambiguities } = extractInvestorProfile("I don't want more than half my money in one asset class.");
  assert.equal(profile.maximumConcentration.value, "UNKNOWN");
  assert.ok(ambiguities.some((a) => a.field === "maximumConcentration"));
});

// 42. Multiple restrictions.
test("42. multiple restriction statements in one message are all captured", () => {
  const { profile } = extractInvestorProfile("No crypto. Keep gold below 10%. Only equities.");
  assert.deepEqual(profile.assetClassRestrictions.excluded, ["CRYPTO"]);
  assert.equal(profile.assetClassRestrictions.maximumByClass.GOLD, 0.1);
  assert.deepEqual(profile.assetClassRestrictions.includedOnly, ["EQUITIES"]);
});

// 43. Asset restriction contradiction.
test("43. an only-ETF restriction alongside a stated desire for Bitcoin is preserved as a contradiction", () => {
  const { investmentVehicleRestrictions, contradictions } = extractInvestorProfile("Only ETFs, but I also want Bitcoin.");
  assert.deepEqual(investmentVehicleRestrictions.includedOnly, ["ETF"]);
  assert.ok(contradictions.some((c) => c.fields.includes("investmentVehicleRestrictions")));
});

test("43b. excluding a class and separately capping it is NOT a contradiction (Step 60 review finding): 0% always satisfies any non-negative cap", () => {
  const { profile, contradictions } = extractInvestorProfile("No crypto. Keep crypto below 5%.");
  assert.deepEqual(profile.assetClassRestrictions.excluded, ["CRYPTO"]);
  assert.equal(profile.assetClassRestrictions.maximumByClass.CRYPTO, 0.05);
  assert.deepEqual(contradictions, []);
});

test("43c. excluding a class that is also listed as included-only remains a genuine contradiction", () => {
  const { contradictions } = extractInvestorProfile("Only equities. No equities.");
  assert.ok(contradictions.some((c) => c.fields.includes("assetClassRestrictions")));
});

// 44-47. Explicit provenance states.
test("44. explicit PROVIDED provenance", () => {
  assert.equal(extractInvestorProfile("I have $3,000.").profile.investmentAmount.provenance, "PROVIDED");
});

test("45. explicit INFERRED provenance carries a reason", () => {
  const field = extractInvestorProfile("I want to invest for a few months.").profile.investmentHorizon;
  assert.equal(field.provenance, "INFERRED");
  assert.ok(field.reason.length > 0);
});

test("46. explicit UNKNOWN provenance for an unaddressed field", () => {
  const field = extractInvestorProfile("Hello there.").profile.riskTolerance;
  assert.equal(field.provenance, "UNKNOWN");
  assert.equal(field.value, "UNKNOWN");
});

test("47. explicit INVALID provenance where applicable (a stated non-positive amount)", () => {
  const field = extractInvestorProfile("I have -$500 to invest.").profile.investmentAmount;
  assert.equal(field.provenance, "INVALID");
});

// 48-51. Absolute non-inference rules.
test("48. no currency inference from country/city names", () => {
  const { profile } = extractInvestorProfile("I live in Toronto, Canada, and have $3,000 to invest.");
  assert.equal(profile.investmentCurrency.value, "UNKNOWN");
});

test("49. no risk-tolerance inference from age or occupation", () => {
  const { profile } = extractInvestorProfile("I am a 70-year-old retired teacher with $3,000 to invest.");
  assert.equal(profile.riskTolerance.value, "UNKNOWN");
});

test("50. no objective inference merely from naming a specific asset", () => {
  const { profile } = extractInvestorProfile("I want to invest in Bitcoin and gold.");
  assert.equal(profile.investmentObjective.value, "UNKNOWN");
});

test("51. no emergency-cash calculation from income or expenses", () => {
  const { profile } = extractInvestorProfile("I earn $5,000 a month and spend $3,000 a month.");
  assert.equal(profile.emergencyCashRequirement.value, "UNKNOWN");
});

// 52-54. No network/provider/credential access.
test("52. extraction never performs a real network call", async () => {
  const { networkCalled } = await withNetworkGuard(async () => extractInvestorProfile("I have $3,000 for 5 years, moderate risk."));
  assert.equal(networkCalled, false);
});

test("53. no provider-specific data or module is referenced anywhere in the extraction result", () => {
  const result = extractInvestorProfile("I have $3,000 for 5 years, moderate risk.");
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("fred_series_id"));
  assert.ok(!serialized.includes("ticker_sentiment"));
});

test("54. no credential-shaped field exists anywhere in the extraction result", () => {
  const result = extractInvestorProfile("I have $3,000 for 5 years, moderate risk.");
  const serialized = JSON.stringify(result).toLowerCase();
  assert.ok(!serialized.includes("apikey"));
  assert.ok(!serialized.includes("credential"));
});

// 55. Deterministic repeated extraction.
test("55. the same input text produces an identical extraction result every time", () => {
  const text = "I have CAD $3,000 and want to invest for 5 years. I am comfortable with moderate risk.";
  assert.deepEqual(extractInvestorProfile(text), extractInvestorProfile(text));
});

// 56. Privacy / sourceText filtering.
test("56. sourceText/reason fields never leak unrelated content from the same message", () => {
  const { profile } = extractInvestorProfile("My SSN is 123-45-6789 but I have $3,000 to invest for 5 years.");
  const serialized = JSON.stringify(profile);
  assert.ok(!serialized.includes("123-45-6789"));
});

// 57/58. Invalid/empty input handling.
test("57. non-string input is rejected safely, never thrown, producing a fully-UNKNOWN profile", () => {
  for (const badInput of [undefined, null, 42, {}, [], true]) {
    const result = extractInvestorProfile(badInput);
    assert.equal(result.profile.investmentAmount.value, "UNKNOWN");
    assert.deepEqual(result.ambiguities, []);
    assert.deepEqual(result.contradictions, []);
  }
});

test("58. empty/whitespace-only string input produces a fully-UNKNOWN profile, never throws", () => {
  for (const empty of ["", "   ", "\n\t"]) {
    const result = extractInvestorProfile(empty);
    assert.equal(result.profile.riskTolerance.value, "UNKNOWN");
  }
});

// 59/60. No portfolio logic, no market data.
test("59. the extraction result never contains an allocation, recommendation, or portfolio field", () => {
  const result = extractInvestorProfile("I have $3,000 for 5 years, moderate risk.");
  assert.equal(result.allocation, undefined);
  assert.equal(result.recommendation, undefined);
  assert.equal(result.portfolio, undefined);
});

test("60. the extraction result never contains market/price/news data", () => {
  const result = extractInvestorProfile("I have $3,000 for 5 years, moderate risk.");
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("Time Series"));
  assert.ok(!serialized.includes("overall_sentiment"));
});

// --- Integration with validateInvestorProfile() (extraction must not duplicate it) ---
test("61. a fully-specified extracted profile validates as VALID through the unmodified validator", () => {
  const { profile } = extractInvestorProfile("I have CAD $3,000 and want to invest for 5 years. I am comfortable with moderate risk. I want balanced growth.");
  const result = validateInvestorProfile(profile);
  assert.equal(result.status, "VALID");
});

test("62. a partially-specified extracted profile validates as INSUFFICIENT_INFORMATION through the unmodified validator", () => {
  const { profile } = extractInvestorProfile("I have $3,000.");
  const result = validateInvestorProfile(profile);
  assert.equal(result.status, "INSUFFICIENT_INFORMATION");
  assert.deepEqual(result.missingRequiredFields.sort(), ["investmentHorizon", "riskTolerance"]);
});

// --- Immutability ---
test("63. extraction does not mutate its own internal vocabulary tables across calls", () => {
  const first = extractInvestorProfile("No crypto.");
  const second = extractInvestorProfile("Only bonds.");
  assert.deepEqual(first.profile.assetClassRestrictions.excluded, ["CRYPTO"]);
  assert.deepEqual(second.profile.assetClassRestrictions.excluded, []);
  assert.deepEqual(second.profile.assetClassRestrictions.includedOnly, ["BONDS"]);
});

// --- Adversarial: attempts to trick the extractor into guessing ---
test("64. adversarial — a growth-only or high-return-only statement never sets risk tolerance", () => {
  assert.equal(extractInvestorProfile("I want high returns.").profile.riskTolerance.value, "UNKNOWN");
  assert.equal(extractInvestorProfile("I want long term growth.").profile.riskTolerance.value, "UNKNOWN");
});

test("65. adversarial — multiple conflicting risk statements in one message never resolve to a single winner", () => {
  const { profile } = extractInvestorProfile("I am comfortable with moderate or aggressive risk.");
  assert.equal(profile.riskTolerance.value, "UNKNOWN");
});

test("66. adversarial — a fully nonsensical, unrelated message extracts nothing", () => {
  const { profile, ambiguities, contradictions } = extractInvestorProfile("The weather today is pleasant and I enjoy long walks.");
  assert.equal(profile.investmentAmount.value, "UNKNOWN");
  assert.equal(profile.riskTolerance.value, "UNKNOWN");
  assert.deepEqual(ambiguities, []);
  assert.deepEqual(contradictions, []);
});
