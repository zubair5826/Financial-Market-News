const test = require("node:test");
const assert = require("node:assert/strict");
const { detectSetupRisks, SETUP_RISKS } = require("./risks");

function evidence(overrides = {}) {
  return { domain: "TEST", bias: "BULLISH", confidence: "HIGH", uncertainties: [], conflicts: [], warnings: [], items: [], ...overrides };
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

test("detectSetupRisks flags TIMING_RISK from a structured STALE_DATA warning object (Step 101, not text)", () => {
  const all = {
    newsEvidence: evidence({ warnings: [{ ok: false, code: "STALE_DATA", message: "BTC news from source-A is STALE DATA.", details: {} }] }),
    macroEvidence: evidence(),
    technicalEvidence: evidence(),
    sentimentEvidence: evidence(),
  };
  const risks = detectSetupRisks(all, []);
  assert.ok(risks.includes(SETUP_RISKS.TIMING_RISK));
});

test("detectSetupRisks flags TIMING_RISK from a structured UNKNOWN freshness_status item, never from text", () => {
  const all = {
    newsEvidence: evidence({ items: [{ headline: "x", freshness_status: "UNKNOWN" }] }),
    macroEvidence: evidence(),
    technicalEvidence: evidence(),
    sentimentEvidence: evidence(),
  };
  const risks = detectSetupRisks(all, []);
  assert.ok(risks.includes(SETUP_RISKS.TIMING_RISK));
});

test("detectSetupRisks does NOT flag TIMING_RISK from a plain-string uncertainty merely mentioning STALE — message text is never the source of truth", () => {
  const all = {
    newsEvidence: evidence({ uncertainties: ["BTC news from source-A is STALE DATA."] }),
    macroEvidence: evidence(),
    technicalEvidence: evidence(),
    sentimentEvidence: evidence(),
  };
  const risks = detectSetupRisks(all, []);
  assert.equal(risks.includes(SETUP_RISKS.TIMING_RISK), false);
});

test("detectSetupRisks: rewording a STALE_DATA warning's message never changes TIMING_RISK detection", () => {
  const baseline = {
    newsEvidence: evidence({ warnings: [{ ok: false, code: "STALE_DATA", message: "Original wording: STALE DATA.", details: {} }] }),
    macroEvidence: evidence(),
    technicalEvidence: evidence(),
    sentimentEvidence: evidence(),
  };
  const reworded = {
    newsEvidence: evidence({ warnings: [{ ok: false, code: "STALE_DATA", message: "Completely different wording, no trigger word at all.", details: {} }] }),
    macroEvidence: evidence(),
    technicalEvidence: evidence(),
    sentimentEvidence: evidence(),
  };
  assert.ok(detectSetupRisks(baseline, []).includes(SETUP_RISKS.TIMING_RISK));
  assert.ok(detectSetupRisks(reworded, []).includes(SETUP_RISKS.TIMING_RISK));
});

test("detectSetupRisks never auto-activates UNKNOWN as a risk flag", () => {
  const all = { newsEvidence: evidence(), macroEvidence: evidence(), technicalEvidence: evidence(), sentimentEvidence: evidence() };
  const risks = detectSetupRisks(all, []);
  assert.equal(risks.includes(SETUP_RISKS.UNKNOWN), false);
});
