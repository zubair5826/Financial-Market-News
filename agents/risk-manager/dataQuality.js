// Structured data-quality assessment — every signal here is read from
// evidence already computed by the Trade Setup Agent (and, when
// supplied, the raw domain reports), never invented. Per the Step 10
// spec, risk must increase when: data is stale, unverified, sources
// conflict, information is missing, technical timeframes conflict,
// major scheduled events are near, or setup evidence is weak — this
// module detects exactly those seven conditions and nothing else.
//
// Step 101: stale/unverified detection no longer scans human-readable
// message text (the previous mechanism was a fragile substring check
// against each warning/uncertainty's own message — "does this text
// contain the word STALE" / "does this text contain the word
// UNVERIFIED" — that silently stopped working the moment any agent
// reworded its own warning string, and in practice almost never fired
// at all — see PROJECT_PROGRESS.md/Step 100 notes). It now reads the
// SAME structured
// fields every domain agent already sets on its own records, via the
// per-domain evidence objects trade-setup-agent/evidence.js already
// attaches to the Trade Setup Report:
//   - warnings: that domain's full, unfiltered warnings array, which
//     already contains a structured failSafe() object
//     `{ ok: false, code: ERROR_CODES.STALE_DATA, message, details }`
//     for every record that domain flagged STALE (core/errors.js).
//     `.code` — a fixed, controlled enum value — is the source of
//     truth here, never `.message`; rewording a warning's message
//     never changes detection.
//   - items: a sample of that domain's own already-validated records,
//     which already carry `freshness_status` (core/freshness.js's
//     FRESHNESS_STATES) and `verification_status`
//     (core/verification.js's SOURCE_VERIFICATION_STATES) fields set
//     directly by that agent — never re-derived from text here.

const { UNKNOWN } = require("../../core/constants");
const { ERROR_CODES } = require("../../core/errors");
const { FRESHNESS_STATES } = require("../../core/freshness");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { CONFIDENCE_LEVELS } = require("../../core/confidence");

// The four domain evidence objects trade-setup-agent/evidence.js
// attaches to every Trade Setup Report — each already carries
// `warnings` (full, unfiltered) and `items` (a sample of validated
// records) straight through from that domain's own report.
function collectDomainEvidences(tradeSetupReport) {
  return [
    tradeSetupReport.news_evidence,
    tradeSetupReport.macro_evidence,
    tradeSetupReport.technical_evidence,
    tradeSetupReport.sentiment_evidence,
  ].filter(Boolean);
}

// Structural stale detection: an OBJECT entry whose `code` is exactly
// ERROR_CODES.STALE_DATA — set only by failSafe(), never guessed by
// inspecting an entry's message text. Plain-string warnings are simply
// not stale signals under this mechanism.
function countStaleSignals(warningsList) {
  return (warningsList || []).filter((entry) => entry && typeof entry === "object" && entry.code === ERROR_CODES.STALE_DATA).length;
}

// Structural unverified detection: a record whose verification_status
// is exactly SOURCE_VERIFICATION_STATES.UNVERIFIED — the same field
// every agent (data-controller/news/macro/technical/sentiment) already
// sets on each of its own validated records.
function countUnverifiedItems(itemsList) {
  return (itemsList || []).filter((item) => item && item.verification_status === SOURCE_VERIFICATION_STATES.UNVERIFIED).length;
}

function collectFreshnessStatuses(itemsList) {
  return (itemsList || [])
    .map((item) => item && item.freshness_status)
    .filter((status) => typeof status === "string" && Object.values(FRESHNESS_STATES).includes(status));
}

// One overall freshness label for the whole assessment, using the same
// FRESHNESS_STATES vocabulary every domain agent already uses per
// record: STALE takes priority (it's the condition risk must react
// to), then AGING, then UNKNOWN (freshness genuinely could not be
// confirmed for at least one item), else FRESH. No freshness signal at
// all is honestly reported as UNKNOWN, never guessed as FRESH.
function deriveFreshnessStatus(staleCount, freshnessStatuses) {
  if (staleCount > 0 || freshnessStatuses.includes(FRESHNESS_STATES.STALE)) return FRESHNESS_STATES.STALE;
  if (freshnessStatuses.includes(FRESHNESS_STATES.AGING)) return FRESHNESS_STATES.AGING;
  if (freshnessStatuses.includes(FRESHNESS_STATES.UNKNOWN)) return FRESHNESS_STATES.UNKNOWN;
  if (freshnessStatuses.length > 0) return FRESHNESS_STATES.FRESH;
  return FRESHNESS_STATES.UNKNOWN;
}

// An overall quality label reusing the project's existing HIGH/MEDIUM/
// LOW/UNKNOWN vocabulary (core/confidence.js's CONFIDENCE_LEVELS — the
// same terminology every agent report already uses for its own
// `confidence` field), applied here to data quality specifically: LOW
// when a real, structural problem was detected (stale or unverified
// data present); MEDIUM when a domain is simply missing, or freshness
// data WAS observed but couldn't be confirmed fresh (AGING, or UNKNOWN
// for an actual sampled item — as opposed to no freshness data existing
// at all, which is not itself evidence of a quality problem); HIGH when
// none of the above applies. A disclosed, reasoned aggregation rule —
// not an invented threshold pulled from nowhere.
function deriveQualityStatus({ staleCount, unverifiedCount, missingCount, freshnessStatus, hasFreshnessData }) {
  if (staleCount > 0 || unverifiedCount > 0) return CONFIDENCE_LEVELS.LOW;
  if (missingCount > 0) return CONFIDENCE_LEVELS.MEDIUM;
  if (hasFreshnessData && (freshnessStatus === FRESHNESS_STATES.UNKNOWN || freshnessStatus === FRESHNESS_STATES.AGING)) {
    return CONFIDENCE_LEVELS.MEDIUM;
  }
  return CONFIDENCE_LEVELS.HIGH;
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

  const domainEvidences = collectDomainEvidences(tradeSetupReport);
  const allWarnings = [...(tradeSetupReport.warnings || []), ...domainEvidences.flatMap((e) => e.warnings || [])];
  // evidence.items is only a SAMPLE of each domain's validated records
  // (trade-setup-agent/evidence.js narrows news/macro down to their own
  // key_events/key_indicators — CRITICAL/HIGH importance only). When the
  // raw macroReport is also supplied (already an existing parameter of
  // this function), its macro_records is the FULL, unfiltered set — used
  // here INSTEAD of macro_evidence.items (its subset) so an unverified/
  // aging record of ordinary importance is never missed just because it
  // wasn't "key." newsReport/sentimentReport aren't parameters of this
  // function today, so news/sentiment unverified-record coverage remains
  // limited to their sampled key_events — a disclosed, pre-existing
  // completeness gap, not one Step 101 redesigns the pipeline to close.
  const nonMacroEvidences = domainEvidences.filter((e) => e !== tradeSetupReport.macro_evidence);
  const macroItems =
    macroReport && Array.isArray(macroReport.macro_records)
      ? macroReport.macro_records
      : (tradeSetupReport.macro_evidence && tradeSetupReport.macro_evidence.items) || [];
  const allItems = [...nonMacroEvidences.flatMap((e) => e.items || []), ...macroItems];

  const staleCount = countStaleSignals(allWarnings);
  const unverifiedCount = countUnverifiedItems(allItems);
  const missingCount = missingInformation.length;
  const freshnessStatuses = collectFreshnessStatuses(allItems);
  const freshnessStatus = deriveFreshnessStatus(staleCount, freshnessStatuses);
  const qualityStatus = deriveQualityStatus({
    staleCount,
    unverifiedCount,
    missingCount,
    freshnessStatus,
    hasFreshnessData: freshnessStatuses.length > 0,
  });

  const technicalConflicts =
    (technicalReport && technicalReport.technical_conflicts && technicalReport.technical_conflicts.status === "CONFLICTING_SIGNALS") ||
    (tradeSetupReport.technical_evidence &&
      Array.isArray(tradeSetupReport.technical_evidence.conflicts) &&
      tradeSetupReport.technical_evidence.conflicts.length > 0);

  return {
    stale: staleCount > 0,
    unverified: unverifiedCount > 0,
    conflicting: Array.isArray(tradeSetupReport.conflicting_evidence) && tradeSetupReport.conflicting_evidence.length > 0,
    missing_information: missingInformation,
    technical_timeframe_conflict: Boolean(technicalConflicts),
    upcoming_events_near: assessUpcomingEventsNear(macroReport, options),
    weak_setup_evidence: tradeSetupReport.setup_quality === "LOW" || tradeSetupReport.setup_quality === "UNKNOWN",
    // Structured, machine-readable quality summary (Step 101) — see
    // module comment above for exactly how each field is derived.
    freshnessStatus,
    staleCount,
    unverifiedCount,
    missingCount,
    qualityStatus,
  };
}

module.exports = { assessDataQuality, assessUpcomingEventsNear };
