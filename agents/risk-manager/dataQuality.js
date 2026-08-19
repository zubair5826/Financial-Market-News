// Structured data-quality assessment — every signal here is read from
// evidence already computed by the Trade Setup Agent (and, when
// supplied, the raw domain reports), never invented. Per the Step 10
// spec, risk must increase when: data is stale, unverified, sources
// conflict, information is missing, technical timeframes conflict,
// major scheduled events are near, or setup evidence is weak — this
// module detects exactly those seven conditions and nothing else.

const { UNKNOWN } = require("../../core/constants");

function mentionsStale(uncertaintiesOrWarnings) {
  return (uncertaintiesOrWarnings || []).some((entry) => {
    const text = typeof entry === "string" ? entry : entry && entry.message;
    return typeof text === "string" && text.includes("STALE");
  });
}

function mentionsUnverified(uncertaintiesOrWarnings) {
  return (uncertaintiesOrWarnings || []).some((entry) => {
    const text = typeof entry === "string" ? entry : entry && entry.message;
    return typeof text === "string" && text.toUpperCase().includes("UNVERIFIED");
  });
}

// "Major scheduled events are near" is only ever evaluated when the
// caller supplies a real window (options.upcomingEventWindowMs) AND
// macroReport.upcoming_events carries real, parseable scheduled_time
// values — per "Do not invent event timing," this returns UNKNOWN
// rather than guessing whenever either is missing.
function assessUpcomingEventsNear(macroReport, options = {}) {
  if (!macroReport || !Array.isArray(macroReport.upcoming_events) || macroReport.upcoming_events.length === 0) {
    return UNKNOWN;
  }
  if (typeof options.upcomingEventWindowMs !== "number") return UNKNOWN;

  const now = Date.now();
  const hasParsedTime = macroReport.upcoming_events.some((e) => e.scheduled_time && e.scheduled_time !== "UNKNOWN");
  if (!hasParsedTime) return UNKNOWN;

  return macroReport.upcoming_events.some((event) => {
    if (!event.scheduled_time || event.scheduled_time === "UNKNOWN") return false;
    const scheduledMs = Date.parse(event.scheduled_time);
    if (Number.isNaN(scheduledMs)) return false;
    const diff = scheduledMs - now;
    return diff >= 0 && diff <= options.upcomingEventWindowMs;
  });
}

function assessDataQuality({ tradeSetupReport, macroReport, technicalReport }, options = {}) {
  const missingInformation = [];
  if (!tradeSetupReport.news_evidence) missingInformation.push("news");
  if (!tradeSetupReport.macro_evidence) missingInformation.push("macro");
  if (!tradeSetupReport.technical_evidence) missingInformation.push("technical");
  if (!tradeSetupReport.sentiment_evidence) missingInformation.push("sentiment");

  const allUncertainties = [
    ...(tradeSetupReport.uncertainties || []),
    ...(tradeSetupReport.warnings || []),
  ];

  const technicalConflicts =
    (technicalReport && technicalReport.technical_conflicts && technicalReport.technical_conflicts.status === "CONFLICTING_SIGNALS") ||
    (tradeSetupReport.technical_evidence &&
      Array.isArray(tradeSetupReport.technical_evidence.conflicts) &&
      tradeSetupReport.technical_evidence.conflicts.length > 0);

  return {
    stale: mentionsStale(allUncertainties),
    unverified: mentionsUnverified(allUncertainties),
    conflicting: Array.isArray(tradeSetupReport.conflicting_evidence) && tradeSetupReport.conflicting_evidence.length > 0,
    missing_information: missingInformation,
    technical_timeframe_conflict: Boolean(technicalConflicts),
    upcoming_events_near: assessUpcomingEventsNear(macroReport, options),
    weak_setup_evidence: tradeSetupReport.setup_quality === "LOW" || tradeSetupReport.setup_quality === "UNKNOWN",
  };
}

module.exports = { assessDataQuality, assessUpcomingEventsNear };
