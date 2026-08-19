const test = require("node:test");
const assert = require("node:assert/strict");
const { detectSetupRisks, SETUP_RISKS } = require("./risks");

function evidence(overrides = {}) {
  return { domain: "TEST", bias: "BULLISH", confidence: "HIGH", uncertainties: [], conflicts: [], ...overrides };
}

test("detectSetupRisks flags DATA_RISK when any domain is missing", () => {
  const risks = detectSetupRisks({ newsEvidence: evidence(), macroEvidence: null, technicalEvidence: evidence(), sentimentEvidence: evidence() }, []);
  assert.ok(risks.includes(SETUP_RISKS.DATA_RISK));
});

test("detectSetupRisks does not flag DATA_RISK when all four domains are present", () => {
  const all = { newsEvidence: evidence(), macroEvidence: evidence(), technicalEvidence: evidence(), sentimentEvidence: evidence() };
  const risks = detectSetupRisks(all, []);
  assert.equal(risks.includes(SETUP_RISKS.DATA_RISK), false);
});

test("detectSetupRisks flags the specific domain risk when that domain has unresolved conflicts", () => {
  const all = {
    newsEvidence: evidence({ conflicts: [{ x: 1 }] }),
    macroEvidence: evidence(),
    technicalEvidence: evidence(),
    sentimentEvidence: evidence(),
  };
  const risks = detectSetupRisks(all, []);
  assert.ok(risks.includes(SETUP_RISKS.NEWS_RISK));
  assert.equal(risks.includes(SETUP_RISKS.MACRO_RISK), false);
});

test("detectSetupRisks flags CONFLICT_RISK only when conflicting_evidence is non-empty", () => {
  const all = { newsEvidence: evidence(), macroEvidence: evidence(), technicalEvidence: evidence(), sentimentEvidence: evidence() };
  const risks = detectSetupRisks(all, [evidence({ bias: "BEARISH" })]);
  assert.ok(risks.includes(SETUP_RISKS.CONFLICT_RISK));
});

test("detectSetupRisks flags TIMING_RISK only from an explicit STALE/freshness-UNKNOWN uncertainty", () => {
  const all = {
    newsEvidence: evidence({ uncertainties: ["BTC news from source-A is STALE DATA."] }),
    macroEvidence: evidence(),
    technicalEvidence: evidence(),
    sentimentEvidence: evidence(),
  };
  const risks = detectSetupRisks(all, []);
  assert.ok(risks.includes(SETUP_RISKS.TIMING_RISK));
});

test("detectSetupRisks never auto-activates UNKNOWN as a risk flag", () => {
  const all = { newsEvidence: evidence(), macroEvidence: evidence(), technicalEvidence: evidence(), sentimentEvidence: evidence() };
  const risks = detectSetupRisks(all, []);
  assert.equal(risks.includes(SETUP_RISKS.UNKNOWN), false);
});
