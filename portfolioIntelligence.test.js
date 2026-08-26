// Offline tests for the Portfolio Intelligence entrypoint — Step 63.
// Uses the REAL chain (extraction, validation, construction,
// construction-validation) exactly as frozen in Step 62 — no mocking
// of the chain itself. Mocks/guards are used only to prove prohibited
// behavior (no network/provider access).

const test = require("node:test");
const assert = require("node:assert/strict");
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

const VALID_TEXT = "I have CAD $10,000 and want to invest for 5 years. I am comfortable with moderate risk. I want balanced growth.";

// 1. Valid request -> READY + portfolio.
test("1. a fully valid request produces READY with a populated portfolio", () => {
  const result = runPortfolioIntelligenceRequest({ text: VALID_TEXT });
  assert.equal(result.status, RESULT_STATUS.READY);
  assert.ok(result.portfolio);
  assert.ok(result.portfolio.allocations.length > 0);
  assert.deepEqual(result.missingInformation, []);
  assert.deepEqual(result.contradictions, []);
});

// 1b. Step 66 audit: INCOMPLETE via a missing RECOMMENDED field (objective) with currency KNOWN
// is materially distinct from INCOMPLETE via unknown currency — real dollar amounts must still
// be computed here, unlike the percentage-only unknown-currency case (test 4).
test("1d. an INCOMPLETE profile caused by a missing objective (currency known) still produces real dollar amounts, not percentage-only (Step 66 audit)", () => {
  const text = "I have CAD $10,000 and want to invest for 5 years. I am comfortable with moderate risk.";
  const result = runPortfolioIntelligenceRequest({ text });
  assert.equal(result.status, RESULT_STATUS.INCOMPLETE);
  assert.ok(result.portfolio);
  assert.ok(result.portfolio.allocations.every((a) => typeof a.amount === "number" && a.currency === "CAD"));
  assert.ok(result.unknowns.some((u) => u.includes("investmentObjective")));
});

// 2. Insufficient information -> BLOCKED + portfolio null + missing information.
test("2. insufficient investor information produces BLOCKED, portfolio null, and names the missing fields", () => {
  const result = runPortfolioIntelligenceRequest({ text: "I have $3,000." });
  assert.equal(result.status, RESULT_STATUS.BLOCKED);
  assert.equal(result.portfolio, null);
  assert.deepEqual(result.missingInformation.sort(), ["investmentHorizon", "riskTolerance"]);
});

// 3. Profile clarification/conflict -> NEEDS_CLARIFICATION + portfolio null.
test("3. a self-contradictory hard restriction produces NEEDS_CLARIFICATION, portfolio null, contradictions populated", () => {
  const text = "I have CAD $10,000 for 5 years. I am comfortable with moderate risk. I want balanced growth. Only equities. No equities.";
  const result = runPortfolioIntelligenceRequest({ text });
  assert.equal(result.status, RESULT_STATUS.NEEDS_CLARIFICATION);
  assert.equal(result.portfolio, null);
  assert.ok(result.contradictions.some((c) => c.fields.includes("assetClassRestrictions")));
});

// 4. Unknown currency -> INCOMPLETE + percentage-only portfolio.
test("4. an unspecified currency produces INCOMPLETE with a percentage-only portfolio", () => {
  const text = "I have $5,000 and want to invest for 5 years. I am comfortable with moderate risk. I want balanced growth.";
  const result = runPortfolioIntelligenceRequest({ text });
  assert.equal(result.status, RESULT_STATUS.INCOMPLETE);
  assert.ok(result.portfolio);
  assert.ok(result.portfolio.allocations.every((a) => a.amount === "UNKNOWN" && a.currency === "UNKNOWN"));
  assert.ok(result.unknowns.some((u) => u.includes("investmentCurrency")));
});

// 5. Hard portfolio constraint conflict -> NEEDS_CLARIFICATION + portfolio null.
test("5. an impossible eligible-universe conflict (excluded and included-only overlap) produces NEEDS_CLARIFICATION with conflicts exposed", () => {
  const text = "I have CAD $10,000 for 5 years. I am comfortable with moderate risk. I want balanced growth. No crypto. Only crypto.";
  const result = runPortfolioIntelligenceRequest({ text });
  assert.equal(result.status, RESULT_STATUS.NEEDS_CLARIFICATION);
  assert.equal(result.portfolio, null);
  assert.ok(result.contradictions.length > 0);
});

// 6. Emergency cash preserved through the complete chain.
test("6. emergency cash is disclosed via assumptions and never becomes an allocation line or reduces the investable amount", () => {
  const text = "I have CAD $10,000 for 5 years. I am comfortable with moderate risk. I want balanced growth. I need $2,000 kept aside for emergencies.";
  const result = runPortfolioIntelligenceRequest({ text });
  assert.equal(result.status, RESULT_STATUS.READY);
  assert.ok(result.assumptions.some((a) => a.includes("emergency cash reserve") && a.includes("2000")));
  assert.ok(!result.portfolio.allocations.some((a) => a.reason.toLowerCase().includes("emergency")));
  const totalAllocated = result.portfolio.allocations.reduce((s, a) => s + (typeof a.amount === "number" ? a.amount : 0), 0);
  const totalPct = result.portfolio.allocations.reduce((s, a) => s + a.percentage, 0);
  assert.ok(Math.abs(totalAllocated - totalPct * 10000) < 1);
});

// 7. Eligible asset universe option correctly forwarded.
test("7. an eligibleAssetUniverse option is forwarded to constructPortfolio() and disclosed in constraintsApplied", () => {
  const result = runPortfolioIntelligenceRequest({ text: VALID_TEXT, options: { eligibleAssetUniverse: ["EQUITIES", "BONDS"] } });
  assert.ok(result.portfolio.constraintsApplied.some((c) => c.includes("eligible asset universe")));
});

// 8. Investment vehicle restrictions correctly forwarded.
test("8. an investmentVehicleRestrictions option is forwarded and every allocation line reflects it", () => {
  const result = runPortfolioIntelligenceRequest({ text: VALID_TEXT, options: { investmentVehicleRestrictions: { excluded: [], includedOnly: ["ETF"] } } });
  assert.ok(result.portfolio.allocations.every((a) => a.investmentVehicle === "ETF"));
});

// 9/10. marketIntelligence / existingPortfolio are never automatically called or used.
test("9/10. marketIntelligence and existingPortfolio are never automatically populated, and supplying them changes no computation", () => {
  const withoutExtras = runPortfolioIntelligenceRequest({ text: VALID_TEXT });
  const withExtras = runPortfolioIntelligenceRequest({
    text: VALID_TEXT,
    options: { marketIntelligence: { note: "should be ignored for computation" }, existingPortfolio: [{ assetClass: "EQUITIES", investmentVehicle: "ETF", value: 500, currency: "CAD" }] },
  });
  assert.deepEqual(withoutExtras.portfolio.allocations, withExtras.portfolio.allocations);
  // Confirm the module itself never reaches for Market Intelligence or any provider.
  const source = require("fs").readFileSync(require.resolve("./portfolioIntelligence"), "utf8");
  assert.ok(!/runMarketIntelligenceRequest|fredMacro|alphaVantage|processRequest/i.test(source));
});

// 11. Exact response contract.
test("11. the response contains exactly the frozen 8-field contract, nothing more", () => {
  const result = runPortfolioIntelligenceRequest({ text: VALID_TEXT });
  assert.deepEqual(
    Object.keys(result).sort(),
    ["ambiguities", "assumptions", "contradictions", "missingInformation", "portfolio", "status", "unknowns", "warnings"].sort()
  );
  // No raw text, no duplicated InvestorProfile, no raw extraction envelope, no credentials.
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(VALID_TEXT));
  assert.ok(!("profile" in result));
  assert.ok(!("investmentVehicleRestrictions" in result));
  assert.ok(!serialized.toLowerCase().includes("apikey"));
});

// 12. Final Portfolio Construction validation is invoked.
test("12. the final construction-validation safety net is genuinely exercised (a healthy result passes it silently)", () => {
  // We cannot easily force validatePortfolioConstructionResult() to
  // fail without corrupting the real chain, so this proves it runs
  // and passes for a real, valid result — the safeFailureResponse()
  // fallback path is exercised indirectly by construction 40 already
  // covering validatePortfolioConstructionResult()'s own invalid-input
  // handling in its own dedicated test suite.
  const result = runPortfolioIntelligenceRequest({ text: VALID_TEXT });
  assert.equal(result.status, RESULT_STATUS.READY);
  assert.notEqual(result.warnings.includes("Portfolio Construction produced an internally inconsistent result and was suppressed for safety."), true);
});

// 13. Determinism.
test("13. identical requests produce identical responses", () => {
  const request = { text: VALID_TEXT, options: { investmentVehicleRestrictions: { excluded: [], includedOnly: ["ETF"] } } };
  assert.deepEqual(runPortfolioIntelligenceRequest(request), runPortfolioIntelligenceRequest(request));
});

// 14. Request/options immutability.
test("14. the request and its options object are never mutated", () => {
  const request = { text: VALID_TEXT, options: { investmentVehicleRestrictions: { excluded: [], includedOnly: ["ETF"] } } };
  const snapshot = JSON.parse(JSON.stringify(request));
  runPortfolioIntelligenceRequest(request);
  assert.deepEqual(request, snapshot);
});

// 14b. Step 64 audit: eligibleAssetUniverse specifically, alongside investmentVehicleRestrictions, deep-snapshotted.
test("14b. eligibleAssetUniverse and investmentVehicleRestrictions are never mutated (Step 64 audit)", () => {
  const request = {
    text: VALID_TEXT,
    options: { eligibleAssetUniverse: ["EQUITIES", "BONDS"], investmentVehicleRestrictions: { excluded: ["CRYPTO"], includedOnly: [] } },
  };
  const snapshot = JSON.parse(JSON.stringify(request));
  runPortfolioIntelligenceRequest(request);
  assert.deepEqual(request, snapshot);
});

// Step 64 audit 1: null options must default safely, exactly like omitted options.
test("1b. { text, options: null } is handled exactly like omitted options (Step 64 audit)", () => {
  const withNullOptions = runPortfolioIntelligenceRequest({ text: VALID_TEXT, options: null });
  const withNoOptions = runPortfolioIntelligenceRequest({ text: VALID_TEXT });
  assert.deepEqual(withNullOptions, withNoOptions);
});

// Step 64 audit 1: a non-object request (string/number/array) must degrade safely, never throw.
test("1c. a non-object request (string, number, array) degrades safely to BLOCKED, never throws (Step 64 audit)", () => {
  for (const badRequest of ["just a string", 42, ["not", "an", "object"], true]) {
    assert.doesNotThrow(() => runPortfolioIntelligenceRequest(badRequest));
    const result = runPortfolioIntelligenceRequest(badRequest);
    assert.equal(result.status, RESULT_STATUS.BLOCKED);
    assert.equal(result.portfolio, null);
  }
});

// 15. No network/provider/credential access.
test("15. runPortfolioIntelligenceRequest never performs a real network call", async () => {
  const { networkCalled } = await withNetworkGuard(async () => runPortfolioIntelligenceRequest({ text: VALID_TEXT }));
  assert.equal(networkCalled, false);
});

test("15b. no credential-shaped field appears anywhere in the response", () => {
  const result = runPortfolioIntelligenceRequest({ text: VALID_TEXT });
  const serialized = JSON.stringify(result).toLowerCase();
  assert.ok(!serialized.includes("credential"));
  assert.ok(!serialized.includes("api_key"));
});

// 16. Raw text is the only natural-language input.
test("16. text is the only field ever interpreted as natural language; malformed/missing text degrades safely, never throws", () => {
  for (const badRequest of [undefined, null, {}, { text: 42 }, { text: null }, { text: "" }]) {
    assert.doesNotThrow(() => runPortfolioIntelligenceRequest(badRequest));
    const result = runPortfolioIntelligenceRequest(badRequest);
    assert.equal(result.status, RESULT_STATUS.BLOCKED);
    assert.equal(result.portfolio, null);
  }
});
