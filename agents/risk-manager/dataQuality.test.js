const test = require("node:test");
const assert = require("node:assert/strict");
const { assessDataQuality, assessUpcomingEventsNear } = require("./dataQuality");
const { UNKNOWN } = require("../../core/constants");

function baseSetupReport(overrides = {}) {
  return {
    news_evidence: { conflicts: [], warnings: [], items: [] },
    macro_evidence: { conflicts: [], warnings: [], items: [] },
    technical_evidence: { conflicts: [], warnings: [], items: [] },
    sentiment_evidence: { conflicts: [], warnings: [], items: [] },
    conflicting_evidence: [],
    setup_quality: "HIGH",
    uncertainties: [],
    warnings: [],
    ...overrides,
  };
}

function staleWarning(message = "BTC data from source-A is STALE DATA.") {
  return { ok: false, code: "STALE_DATA", message, details: {} };
}

// Step 101: stale/unverified detection reads structured fields
// (a failSafe() object's `.code`, or a record's own verification_status/
// freshness_status) — never an uncertainty/warning's message text.

test("1. stale data produces staleCount > 0 (and the stale boolean, from a structured STALE_DATA warning, not text)", () => {
  const report = baseSetupReport({ macro_evidence: { conflicts: [], warnings: [staleWarning()], items: [] } });
  const result = assessDataQuality({ tradeSetupReport: report, macroReport: null, technicalReport: null });
  assert.equal(result.stale, true);
  assert.ok(result.staleCount > 0);
});

test("2. unverified data produces unverifiedCount > 0 (and the unverified boolean, from a record's verification_status, not text)", () => {
  const report = baseSetupReport({
    news_evidence: { conflicts: [], warnings: [], items: [{ headline: "x", verification_status: "UNVERIFIED" }] },
  });
  const result = assessDataQuality({ tradeSetupReport: report, macroReport: null, technicalReport: null });
  assert.equal(result.unverified, true);
  assert.ok(result.unverifiedCount > 0);
});

test("assessDataQuality does NOT flag stale from a plain-string warning merely mentioning STALE — message text is never the source of truth", () => {
  const report = baseSetupReport({ warnings: ["BTC data from source-A is STALE DATA."] });
  const result = assessDataQuality({ tradeSetupReport: report, macroReport: null, technicalReport: null });
  assert.equal(result.stale, false);
  assert.equal(result.staleCount, 0);
});

test("assessDataQuality does NOT flag unverified from a plain-string warning merely mentioning UNVERIFIED — message text is never the source of truth", () => {
  const report = baseSetupReport({ warnings: ["Source not supplied — verification cannot be established (NOT_AVAILABLE)."] });
  const result = assessDataQuality({ tradeSetupReport: report, macroReport: null, technicalReport: null });
  assert.equal(result.unverified, false);
  assert.equal(result.unverifiedCount, 0);
});

test("5. changing a STALE_DATA warning's message wording does not break stale detection", () => {
  const reworded = baseSetupReport({
    macro_evidence: { conflicts: [], warnings: [staleWarning("A totally different phrasing with no trigger word.")], items: [] },
  });
  const result = assessDataQuality({ tradeSetupReport: reworded, macroReport: null, technicalReport: null });
  assert.equal(result.stale, true);
  assert.ok(result.staleCount > 0);
});

test("assessDataQuality lists missing domains by name, never guesses they exist", () => {
  const report = baseSetupReport({ news_evidence: null, sentiment_evidence: null });
  const result = assessDataQuality({ tradeSetupReport: report, macroReport: null, technicalReport: null });
  assert.deepEqual(result.missing_information, ["news", "sentiment"]);
});

test("3. missing data is represented structurally as missingCount, matching missing_information.length", () => {
  const report = baseSetupReport({ news_evidence: null, sentiment_evidence: null });
  const result = assessDataQuality({ tradeSetupReport: report, macroReport: null, technicalReport: null });
  assert.equal(result.missingCount, 2);
  assert.equal(result.missingCount, result.missing_information.length);

  const complete = assessDataQuality({ tradeSetupReport: baseSetupReport(), macroReport: null, technicalReport: null });
  assert.equal(complete.missingCount, 0);
});

test("structured quality object exposes freshnessStatus and qualityStatus using existing project terminology", () => {
  const clean = assessDataQuality({ tradeSetupReport: baseSetupReport(), macroReport: null, technicalReport: null });
  assert.equal(clean.freshnessStatus, "UNKNOWN"); // no freshness signal observed at all — honest, not guessed FRESH
  assert.equal(clean.qualityStatus, "HIGH");

  const stale = assessDataQuality(
    { tradeSetupReport: baseSetupReport({ macro_evidence: { conflicts: [], warnings: [staleWarning()], items: [] } }), macroReport: null, technicalReport: null }
  );
  assert.equal(stale.freshnessStatus, "STALE");
  assert.equal(stale.qualityStatus, "LOW");

  const missingOnly = assessDataQuality({ tradeSetupReport: baseSetupReport({ news_evidence: null }), macroReport: null, technicalReport: null });
  assert.equal(missingOnly.qualityStatus, "MEDIUM");
});

test("assessDataQuality flags weak_setup_evidence for LOW or UNKNOWN setup quality", () => {
  const low = assessDataQuality({ tradeSetupReport: baseSetupReport({ setup_quality: "LOW" }), macroReport: null, technicalReport: null });
  assert.equal(low.weak_setup_evidence, true);
  const high = assessDataQuality({ tradeSetupReport: baseSetupReport({ setup_quality: "HIGH" }), macroReport: null, technicalReport: null });
  assert.equal(high.weak_setup_evidence, false);
});

test("assessUpcomingEventsNear returns UNKNOWN without a configured window — never guesses proximity", () => {
  const macroReport = { upcoming_events: [{ event: "CPI", scheduled_time: new Date().toISOString() }] };
  assert.equal(assessUpcomingEventsNear(macroReport, {}), UNKNOWN);
});

test("assessUpcomingEventsNear returns true for an event inside the configured window", () => {
  const soon = new Date(Date.now() + 3_600_000).toISOString(); // 1h from now
  const macroReport = { upcoming_events: [{ event: "CPI", scheduled_time: soon }] };
  const result = assessUpcomingEventsNear(macroReport, { upcomingEventWindowMs: 86_400_000 }); // 24h window
  assert.equal(result, true);
});

test("assessUpcomingEventsNear returns false for an event outside the configured window", () => {
  const later = new Date(Date.now() + 7 * 86_400_000).toISOString(); // 7 days from now
  const macroReport = { upcoming_events: [{ event: "CPI", scheduled_time: later }] };
  const result = assessUpcomingEventsNear(macroReport, { upcomingEventWindowMs: 86_400_000 }); // 24h window
  assert.equal(result, false);
});

test("assessUpcomingEventsNear returns UNKNOWN when scheduled_time itself is UNKNOWN — never invents timing", () => {
  const macroReport = { upcoming_events: [{ event: "CPI", scheduled_time: "UNKNOWN" }] };
  const result = assessUpcomingEventsNear(macroReport, { upcomingEventWindowMs: 86_400_000 });
  assert.equal(result, UNKNOWN);
});
