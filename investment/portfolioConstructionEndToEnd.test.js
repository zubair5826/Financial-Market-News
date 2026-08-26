// Portfolio Construction End-to-End Offline Caller Verification — Step
// 60. A verification harness ONLY: no production entrypoint, no
// service, no orchestrator, no network access, no provider, no
// credentials. Proves the complete future caller chain works together
// exactly as each layer's own contract promises:
//
//   investor text
//     -> extractInvestorProfile()          [investment/investorProfileExtraction.js]
//     -> validateInvestorProfile()         [investment/investorProfileValidation.js]
//     -> constructPortfolio()              [investment/portfolioConstruction.js]
//     -> validatePortfolioConstructionResult() [investment/portfolioConstructionValidation.js]
//
// This file is deliberately the smallest possible addition: a
// dedicated test only, chosen after confirming no existing test
// already exercises the full chain (investorProfileExtraction.test.js
// stops at validateInvestorProfile(); portfolioConstruction.test.js
// starts from a hand-built validated profile, never from real text).

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractInvestorProfile } = require("./investorProfileExtraction");
const { validateInvestorProfile, VALIDATION_STATUS } = require("./investorProfileValidation");
const { constructPortfolio, RESULT_STATUS } = require("./portfolioConstruction");
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

// Runs the full chain and returns every intermediate value, so tests
// can assert on each stage individually.
function runChain(text, options = {}) {
  const extraction = extractInvestorProfile(text);
  const validation = validateInvestorProfile(extraction.profile);
  const construction = constructPortfolio(validation, options);
  const constructionCheck = validatePortfolioConstructionResult(construction, {
    investmentAmount: typeof extraction.profile.investmentAmount.value === "number" ? extraction.profile.investmentAmount.value : undefined,
  });
  return { extraction, validation, construction, constructionCheck };
}

// --- A. Fully valid investor profile -> successful Portfolio Construction ---
test("A. a fully valid investor text produces VALID -> READY through the complete chain", () => {
  const text = "I have CAD $10,000 and want to invest for 5 years. I am comfortable with moderate risk. I want balanced growth.";
  const { validation, construction, constructionCheck } = runChain(text);
  assert.equal(validation.status, VALIDATION_STATUS.VALID);
  assert.equal(construction.status, RESULT_STATUS.READY);
  assert.ok(construction.allocations.length > 0);
  assert.deepEqual(constructionCheck.errors, []);
  assert.equal(constructionCheck.valid, true);
});

// --- B. Incomplete investor information -> INSUFFICIENT_INFORMATION -> BLOCKED ---
test("B. incomplete investor text (amount only) produces INSUFFICIENT_INFORMATION -> BLOCKED through the complete chain", () => {
  const { validation, construction } = runChain("I have $3,000.");
  assert.equal(validation.status, VALIDATION_STATUS.INSUFFICIENT_INFORMATION);
  assert.deepEqual(validation.missingRequiredFields.sort(), ["investmentHorizon", "riskTolerance"]);
  assert.equal(construction.status, RESULT_STATUS.BLOCKED);
  assert.deepEqual(construction.allocations, []);
});

// --- C. Unknown currency -> percentage-only, disclosed ---
test("C. an unspecified (bare $) currency produces INCOMPLETE -> percentage-only allocations through the complete chain", () => {
  const text = "I have $5,000 and want to invest for 5 years. I am comfortable with moderate risk. I want balanced growth.";
  const { validation, construction } = runChain(text);
  assert.equal(validation.profile.investmentCurrency.value, "UNKNOWN");
  assert.equal(validation.status, VALIDATION_STATUS.INCOMPLETE);
  assert.equal(construction.status, RESULT_STATUS.INCOMPLETE);
  assert.ok(construction.allocations.length > 0);
  assert.ok(construction.allocations.every((a) => a.amount === "UNKNOWN" && a.currency === "UNKNOWN"));
  assert.ok(construction.unknowns.some((u) => u.includes("investmentCurrency")));
});

// --- D. Hard restriction scenario survives the complete chain ---
test("D. explicit exclusion and a named concentration cap both survive the complete chain and are respected", () => {
  const text = "I have CAD $10,000 for 5 years. I am comfortable with moderate risk. I want balanced growth. No crypto. Keep gold below 10%.";
  const { extraction, construction } = runChain(text);
  assert.deepEqual(extraction.profile.assetClassRestrictions.excluded, ["CRYPTO"]);
  assert.equal(extraction.profile.assetClassRestrictions.maximumByClass.GOLD, 0.1);
  assert.equal(construction.status, RESULT_STATUS.READY);
  assert.ok(!construction.allocations.find((a) => a.assetClass === "CRYPTO"));
  const gold = construction.allocations.find((a) => a.assetClass === "GOLD");
  assert.ok(!gold || gold.percentage <= 0.1 + 1e-9);
});

// --- E. Emergency cash stays outside allocation, disclosed correctly ---
test("E. emergencyCashRequirement extracted from text stays outside the allocation and is disclosed through the complete chain", () => {
  const text = "I have CAD $10,000 for 5 years. I am comfortable with moderate risk. I want balanced growth. I need $2,000 kept aside for emergencies.";
  const { extraction, construction } = runChain(text);
  assert.equal(extraction.profile.emergencyCashRequirement.value, 2000);
  assert.ok(!construction.allocations.some((a) => a.reason.toLowerCase().includes("emergency")));
  assert.ok(construction.assumptions.some((a) => a.includes("emergency cash reserve") && a.includes("2000")));
  // The full 10,000 is still used for percentage-to-amount math — emergency cash never reduces it.
  const totalAllocated = construction.allocations.reduce((s, a) => s + (typeof a.amount === "number" ? a.amount : 0), 0);
  const totalPct = construction.allocations.reduce((s, a) => s + a.percentage, 0);
  assert.ok(Math.abs(totalAllocated - totalPct * 10000) < 1);
});

// --- F. Conflict/impossible constraint scenario -> NEEDS_CLARIFICATION survives the complete chain ---
test("F. a self-contradictory hard restriction (excluded AND included-only for the same class) produces NEEDS_CLARIFICATION through the complete chain", () => {
  const text = "I have CAD $10,000 for 5 years. I am comfortable with moderate risk. I want balanced growth. Only equities. No equities.";
  const { extraction, validation, construction } = runChain(text);
  // Extraction itself already detects this as a contradiction...
  assert.ok(extraction.contradictions.some((c) => c.fields.includes("assetClassRestrictions")));
  // ...and validateInvestorProfile() legitimately does not re-check
  // restriction-level contradictions (that is not its job — only
  // horizon self-consistency is, per its own frozen contract), so it
  // may report VALID/INCOMPLETE here. Portfolio Construction's own
  // defense-in-depth restriction check is what must catch this before
  // any allocation is produced — and it does:
  assert.notEqual(construction.status, RESULT_STATUS.READY);
  assert.equal(construction.status, RESULT_STATUS.NEEDS_CLARIFICATION);
  assert.deepEqual(construction.allocations, []);
  assert.ok(construction.conflicts.some((c) => c.fields.includes("assetClassRestrictions")));
});

// --- G. Determinism ---
test("G. identical investor text produces an identical final result through the complete chain, every time", () => {
  const text = "I have CAD $10,000 for 5 years. I am comfortable with moderate risk. I want balanced growth. No crypto.";
  const first = runChain(text);
  const second = runChain(text);
  assert.deepEqual(first.extraction, second.extraction);
  assert.deepEqual(first.validation, second.validation);
  assert.deepEqual(first.construction, second.construction);
});

// --- H. Immutability across the whole chain ---
test("H. no stage of the complete chain mutates an earlier stage's output", () => {
  const text = "I have CAD $10,000 for 5 years. I am comfortable with moderate risk. I want balanced growth.";
  const extraction = extractInvestorProfile(text);
  const extractionSnapshot = JSON.parse(JSON.stringify(extraction));
  const validation = validateInvestorProfile(extraction.profile);
  assert.deepEqual(extraction, extractionSnapshot); // validateInvestorProfile() didn't touch extraction's own output

  const validationSnapshot = JSON.parse(JSON.stringify(validation));
  const construction = constructPortfolio(validation);
  assert.deepEqual(validation, validationSnapshot); // constructPortfolio() didn't touch the validation result

  const constructionSnapshot = JSON.parse(JSON.stringify(construction));
  validatePortfolioConstructionResult(construction, { investmentAmount: 10000 });
  assert.deepEqual(construction, constructionSnapshot); // the final validator didn't touch its own input
});

// --- 6/7/8: raw text and raw extraction output never reach Portfolio Construction; it receives the full validation result ---
test("no raw text or raw extraction output ever reaches constructPortfolio(); it only ever receives the full validateInvestorProfile() result", () => {
  const text = "I have CAD $10,000 for 5 years. I am comfortable with moderate risk. I want balanced growth.";
  const extraction = extractInvestorProfile(text);
  const validation = validateInvestorProfile(extraction.profile);
  // constructPortfolio's own first line of defense re-confirms status
  // independently — passing raw text or the raw extraction envelope
  // (neither of which has a `.status` field) must be rejected safely,
  // never silently treated as a usable profile.
  const withRawText = constructPortfolio(text);
  assert.equal(withRawText.status, RESULT_STATUS.BLOCKED);
  const withRawExtraction = constructPortfolio(extraction);
  assert.equal(withRawExtraction.status, RESULT_STATUS.BLOCKED);
  // The genuine full validation result is what actually works.
  const withValidation = constructPortfolio(validation);
  assert.notEqual(withValidation.status, RESULT_STATUS.BLOCKED);
});

// --- No network/provider access anywhere in the chain ---
test("the complete chain never performs a real network call", async () => {
  const { networkCalled } = await withNetworkGuard(async () =>
    runChain("I have CAD $10,000 for 5 years. I am comfortable with moderate risk. I want balanced growth.")
  );
  assert.equal(networkCalled, false);
});
