// The Macroeconomic Intelligence Agent.
//
// Pipeline: RECEIVE -> VALIDATE -> CHECK SOURCE/TIMESTAMP -> CLASSIFY
// (pass-through, never mutated) -> CALCULATE SURPRISE (only when
// actual+expected both exist) -> DETECT CONFLICTS -> ASSESS RELEVANCE
// -> ASSESS IMPORTANCE -> aggregate MARKET IMPACT -> IDENTIFY MACRO
// RISKS -> process upcoming events + central bank events -> return a
// Macro Report for future agents.
//
// It does not execute trades, connect to a broker, or recommend a
// direction — see report.js, whose Macro Report output has no
// recommendation_type field at all. No external economic-data provider
// is connected; `input` is data supplied internally by the system (see
// README.md). Mirrors the architecture of agents/data-controller and
// agents/news-agent.

const { computeFreshness, FRESHNESS_STATES } = require("../../core/freshness");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { failSafe, ERROR_CODES } = require("../../core/errors");
const { UNKNOWN } = require("../../core/constants");
const { logEvent } = require("../../logs/logger");
const { normalizeMacroRecord } = require("./normalize");
const { validateMacroInput } = require("./validate");
const { calculateSurprise } = require("./surprise");
const { detectConflicts } = require("./conflicts");
const { assessMacroRelevance } = require("./relevance");
const { assessImportance } = require("./importance");
const { detectRiskFlags, MACRO_RISK_FLAGS } = require("./riskFlags");
const { processUpcomingEvents } = require("./events");
const { processCentralBankEvents, buildCentralBankAssessment } = require("./centralBank");
const { buildMacroReport } = require("./report");

const MACRO_AGENT_STATUS = Object.freeze({
  SUCCESS: "SUCCESS",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
  CONFLICTING: "CONFLICTING",
  UNAVAILABLE: "UNAVAILABLE",
});

const UNAVAILABLE_CODES = new Set([
  ERROR_CODES.API_UNAVAILABLE,
  ERROR_CODES.TIMEOUT,
  ERROR_CODES.RATE_LIMIT,
  ERROR_CODES.AUTH_FAILURE,
]);

function resolveFreshnessThresholds(record, options) {
  const cfg = options.freshnessThresholds;
  if (!cfg) return undefined;
  if (typeof cfg.freshMaxMs === "number" && typeof cfg.agingMaxMs === "number") return cfg;
  return cfg[record.category];
}

function emptyResult(status, warnings, errors, timestamp) {
  return {
    agent_status: status,
    validated_records: [],
    rejected_records: [],
    upcoming_events: [],
    central_bank_assessment: buildCentralBankAssessment([]),
    macro_risks: [],
    conflicts: [],
    warnings,
    errors,
    timestamp,
  };
}

function processMacroData(input, options = {}) {
  const timestamp = new Date().toISOString();

  // Structurally ready for a future provider adapter's failSafe()
  // result — no provider is connected yet, but this path exists so
  // wiring one up later doesn't require a rewrite.
  if (input && typeof input === "object" && !Array.isArray(input) && input.ok === false && input.code) {
    const status = UNAVAILABLE_CODES.has(input.code) ? MACRO_AGENT_STATUS.UNAVAILABLE : MACRO_AGENT_STATUS.FAILED;
    const result = emptyResult(status, [], [input], timestamp);
    logEvent({
      agent: "macro-agent",
      request: { inputType: "provider-error", code: input.code },
      dataSource: UNKNOWN,
      responseStatus: status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  if (!Array.isArray(input)) {
    const err = failSafe(ERROR_CODES.MALFORMED_DATA, "Input must be an array of raw macro records.");
    const result = emptyResult(MACRO_AGENT_STATUS.FAILED, [], [err], timestamp);
    logEvent({
      agent: "macro-agent",
      request: { inputType: typeof input },
      dataSource: UNKNOWN,
      responseStatus: result.agent_status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  const hasUpcomingEvents = Array.isArray(options.upcomingEvents) && options.upcomingEvents.length > 0;
  const hasCentralBankEvents = Array.isArray(options.centralBankEvents) && options.centralBankEvents.length > 0;

  if (input.length === 0 && !hasUpcomingEvents && !hasCentralBankEvents) {
    const result = emptyResult(
      MACRO_AGENT_STATUS.UNAVAILABLE,
      ["MACRO DATA UNAVAILABLE — no macro data was supplied."],
      [],
      timestamp
    );
    logEvent({
      agent: "macro-agent",
      request: { recordCount: 0 },
      dataSource: UNKNOWN,
      responseStatus: result.agent_status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  const warnings = [];
  const errors = [];
  const validated = [];
  const rejected = [];

  for (const raw of input) {
    const record = normalizeMacroRecord(raw, options.fieldMap || {});

    const validation = validateMacroInput(record);
    if (!validation.valid) {
      const code = validation.missingFields.length > 0 ? ERROR_CODES.MISSING_DATA : ERROR_CODES.MALFORMED_DATA;
      const allErrors = [
        ...validation.missingFields.map((f) => `Missing required field: ${f} (DATA UNAVAILABLE).`),
        ...validation.structuralErrors,
      ];
      rejected.push({
        record,
        errors: allErrors,
        reason: failSafe(code, "Macro record failed Macro Agent validation.", { errors: allErrors }),
      });
      continue;
    }

    // Freshness is computed here from release_timestamp, never trusted
    // from the caller's own "current"/"real-time" claim.
    const thresholds = resolveFreshnessThresholds(record, options);
    record.freshness_status = computeFreshness(record.release_timestamp, thresholds);

    if (record.freshness_status === FRESHNESS_STATES.UNKNOWN) {
      const reason =
        !record.release_timestamp || record.release_timestamp === UNKNOWN
          ? "no release_timestamp was supplied"
          : "no freshness thresholds were configured";
      warnings.push(`Freshness UNKNOWN for ${record.indicator} (${record.country}) from ${record.source} — ${reason}.`);
    } else if (record.freshness_status === FRESHNESS_STATES.STALE) {
      warnings.push(
        failSafe(ERROR_CODES.STALE_DATA, `${record.indicator} (${record.country}) from ${record.source} is STALE DATA.`, {
          indicator: record.indicator,
        })
      );
    }

    if (record.retrieved_timestamp === UNKNOWN) {
      record.retrieved_timestamp = timestamp;
    }

    if (record.source === UNKNOWN) {
      record.verification_status = SOURCE_VERIFICATION_STATES.UNVERIFIED;
      warnings.push(`Source not supplied for ${record.indicator} — verification cannot be established (NOT_AVAILABLE).`);
    } else if (record.verification_status === UNKNOWN) {
      record.verification_status = SOURCE_VERIFICATION_STATES.UNVERIFIED;
    }

    // Surprise is calculated only when actual_value and expected_value
    // both actually exist — never estimated from a missing value.
    const surprise = calculateSurprise(record, options.surpriseOptions || {});
    record.surprise_value = surprise.surprise_value;
    record.surprise_direction = surprise.surprise_direction;

    validated.push(record);
  }

  for (const r of rejected) errors.push(r.reason);

  const conflicts = detectConflicts(validated);
  for (const c of conflicts) {
    warnings.push(
      failSafe(ERROR_CODES.CONFLICTING_DATA, `Conflicting macro sources detected for ${c.indicator} (${c.country}) — CONFLICTING DATA.`, c)
    );
  }

  for (const record of validated) {
    record.market_relevance = assessMacroRelevance(record, options.requestedAsset, {
      assetCurrency: options.assetCurrency,
      assetCountry: options.assetCountry,
      assetRegion: options.assetRegion,
    });
    record.importance = assessImportance(record, record.market_relevance);
  }

  const { validated: upcomingEvents, rejected: rejectedEvents } = processUpcomingEvents(
    options.upcomingEvents || [],
    options
  );
  for (const r of rejectedEvents) {
    warnings.push(`Upcoming event rejected: ${r.errors.join(" ")}`);
  }

  const { validated: centralBankEvents, rejected: rejectedCentralBankEvents } = processCentralBankEvents(
    options.centralBankEvents || [],
    options
  );
  for (const r of rejectedCentralBankEvents) {
    warnings.push(`Central bank event rejected: ${r.errors.join(" ")}`);
  }
  const centralBankAssessment = buildCentralBankAssessment(centralBankEvents);

  const macroRisks = detectRiskFlags(validated, centralBankEvents, conflicts);
  if (input.length === 0 && (hasUpcomingEvents || hasCentralBankEvents)) {
    macroRisks.push(MACRO_RISK_FLAGS.DATA_UNAVAILABLE);
  }

  if (input.length > 0 && validated.length === 0 && rejected.length > 0) {
    errors.push(
      failSafe(ERROR_CODES.MISSING_DATA, "No macro record passed validation — INSUFFICIENT DATA.", {
        rejectedCount: rejected.length,
      })
    );
  }

  // Status reflects the primary macro records channel (consistent with
  // the Data Controller/News Agent precedent). Upcoming/central-bank
  // event rejections are still surfaced via warnings above, but don't
  // independently flip SUCCESS to PARTIAL — a documented scope choice,
  // see README.md.
  let status;
  if (input.length > 0 && validated.length === 0) status = MACRO_AGENT_STATUS.FAILED;
  else if (conflicts.length > 0) status = MACRO_AGENT_STATUS.CONFLICTING;
  else if (rejected.length > 0) status = MACRO_AGENT_STATUS.PARTIAL;
  else status = MACRO_AGENT_STATUS.SUCCESS;

  const result = {
    agent_status: status,
    validated_records: validated,
    rejected_records: rejected,
    upcoming_events: upcomingEvents,
    central_bank_assessment: centralBankAssessment,
    macro_risks: macroRisks,
    conflicts,
    warnings,
    errors,
    timestamp,
  };

  logEvent({
    agent: "macro-agent",
    request: { recordCount: input.length, requestedAsset: options.requestedAsset || UNKNOWN },
    dataSource: Array.from(new Set(validated.map((r) => r.source))).join(",") || UNKNOWN,
    responseStatus: status,
    warnings,
    errors,
  });

  return result;
}

function runMacroAgent(input, options = {}) {
  const result = processMacroData(input, options);
  const report = buildMacroReport(result, options);
  return { result, report };
}

module.exports = { MACRO_AGENT_STATUS, processMacroData, runMacroAgent };
