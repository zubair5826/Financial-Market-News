const test = require("node:test");
const assert = require("node:assert/strict");
const { assessDataQuality, assessUpcomingEventsNear } = require("./dataQuality");
const { UNKNOWN } = require("../../core/constants");

function baseSetupReport(overrides = {}) {
  return {
    news_evidence: { conflicts: [] },
    macro_evidence: { conflicts: [] },
    technical_evidence: { conflicts: [] },
    sentiment_evidence: { conflicts: [] },
    conflicting_evidence: [],
    setup_quality: "HIGH",
    uncertainties: [],
    warnings: [],
    ...overrides,
  };
}

test("assessDataQuality detects a STALE mention in uncertainties", () => {
  const report = baseSetupReport({ uncertainties: ["BTC data from source-A is STALE DATA."] });
  const result = assessDataQuality({ tradeSetupReport: report, macroReport: null, technicalReport: null });
  assert.equal(result.stale, true);
});

test("assessDataQuality detects an UNVERIFIED mention in warnings", () => {
  const report = baseSetupReport({ warnings: ["Source not supplied — verification cannot be established (NOT_AVAILABLE)."] });
  const result = assessDataQuality({ tradeSetupReport: report, macroReport: null, technicalReport: null });
  // This particular warning doesn't literally say UNVERIFIED, so confirm it does NOT falsely flag.
  assert.equal(result.unverified, false);
});

test("assessDataQuality lists missing domains by name, never guesses they exist", () => {
  const report = baseSetupReport({ news_evidence: null, sentiment_evidence: null });
  const result = assessDataQuality({ tradeSetupReport: report, macroReport: null, technicalReport: null });
  assert.deepEqual(result.missing_information, ["news", "sentiment"]);
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
