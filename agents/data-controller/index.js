// The Data Controller — the system's data truth layer.
//
// Pipeline: RECEIVE -> VALIDATE -> CLASSIFY (pass-through, never
// mutated) -> CHECK FRESHNESS -> CHECK SOURCE VERIFICATION -> DETECT
// CONFLICTS -> NORMALIZE -> return validated data for other agents.
//
// It does not analyze markets, predict prices, or recommend a
// direction — see report.js, where recommendation_type is always
// NOT_AVAILABLE.
//
// No external provider is connected. `input` is data supplied
// internally by the system (see README.md). The pipeline is shaped so
// that a future provider adapter's failSafe() result (core/errors.js)
// can be passed straight in without any rewrite here — see the
// provider-error branch below.

const { computeFreshness, FRESHNESS_STATES } = require("../../core/freshness");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { createAgentMessage, validateAgentMessage } = require("../../core/agentMessage");
const { failSafe, ERROR_CODES } = require("../../core/errors");
const { UNKNOWN } = require("../../core/constants");
const { logEvent } = require("../../logs/logger");
const { normalizeRecord } = require("./normalize");
const { validateControllerInput } = require("./validate");
const { detectConflicts } = require("./conflicts");
const { buildAgentReport } = require("./report");

const CONTROLLER_STATUS = Object.freeze({
  SUCCESS: "SUCCESS",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
  CONFLICTING: "CONFLICTING",
  UNAVAILABLE: "UNAVAILABLE",
});

// A future provider is expected to fail via a mix of these codes.
const UNAVAILABLE_CODES = new Set([
  ERROR_CODES.API_UNAVAILABLE,
  ERROR_CODES.TIMEOUT,
  ERROR_CODES.RATE_LIMIT,
  ERROR_CODES.AUTH_FAILURE,
]);

function computeDataAge(timestampIso) {
  if (!timestampIso || timestampIso === UNKNOWN) return UNKNOWN;
  const ts = Date.parse(timestampIso);
  if (Number.isNaN(ts)) return UNKNOWN;
  const ageMs = Date.now() - ts;
  if (ageMs < 0) return UNKNOWN;
  return `${Math.round(ageMs / 1000)}s`;
}

// thresholds config may be a single { freshMaxMs, agingMaxMs } applied
// to every data_type, or a map keyed by data_type. Neither is assumed
// by default — no thresholds means freshness stays UNKNOWN.
function resolveFreshnessThresholds(record, options) {
  const cfg = options.freshnessThresholds;
  if (!cfg) return undefined;
  if (typeof cfg.freshMaxMs === "number" && typeof cfg.agingMaxMs === "number") return cfg;
  return cfg[record.data_type];
}

function emptyResult(status, warnings, errors, timestamp) {
  return {
    controller_status: status,
    validated_data: [],
    rejected_data: [],
    warnings,
    errors,
    conflicts: [],
    timestamp,
  };
}

function processMarketData(input, options = {}) {
  const timestamp = new Date().toISOString();

  // Structurally ready for a future provider adapter's failSafe()
  // result to flow straight in — no provider is connected yet, but
  // this path exists so wiring one up later doesn't require a rewrite.
  if (input && typeof input === "object" && !Array.isArray(input) && input.ok === false && input.code) {
    const status = UNAVAILABLE_CODES.has(input.code) ? CONTROLLER_STATUS.UNAVAILABLE : CONTROLLER_STATUS.FAILED;
    const result = emptyResult(status, [], [input], timestamp);
    logEvent({
      agent: "data-controller",
      request: { inputType: "provider-error", code: input.code },
      dataSource: UNKNOWN,
      responseStatus: status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  if (!Array.isArray(input)) {
    const err = failSafe(ERROR_CODES.MALFORMED_DATA, "Input must be an array of raw data records.");
    const result = emptyResult(CONTROLLER_STATUS.FAILED, [], [err], timestamp);
    logEvent({
      agent: "data-controller",
      request: { inputType: typeof input },
      dataSource: UNKNOWN,
      responseStatus: result.controller_status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  if (input.length === 0) {
    const result = emptyResult(CONTROLLER_STATUS.UNAVAILABLE, ["No data supplied — DATA UNAVAILABLE."], [], timestamp);
    logEvent({
      agent: "data-controller",
      request: { recordCount: 0 },
      dataSource: UNKNOWN,
      responseStatus: result.controller_status,
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
    const record = normalizeRecord(raw, options.fieldMap || {});

    const validation = validateControllerInput(record);
    if (!validation.valid) {
      rejected.push({
        record,
        errors: validation.errors,
        reason: failSafe(ERROR_CODES.MALFORMED_DATA, "Record failed Data Controller validation.", {
          errors: validation.errors,
        }),
      });
      continue;
    }

    // Freshness is computed here, never trusted from the caller's own
    // claim — a source calling itself "real-time" without evidence is
    // exactly what this step exists to prevent.
    const thresholds = resolveFreshnessThresholds(record, options);
    record.freshness_status = computeFreshness(record.timestamp, thresholds);

    if (record.freshness_status === FRESHNESS_STATES.UNKNOWN) {
      const reason =
        !record.timestamp || record.timestamp === UNKNOWN
          ? "no timestamp was supplied"
          : "no freshness thresholds were configured";
      warnings.push(`Freshness UNKNOWN for ${record.asset}/${record.data_type} from ${record.source} — ${reason}.`);
    } else if (record.freshness_status === FRESHNESS_STATES.STALE) {
      warnings.push(
        failSafe(
          ERROR_CODES.STALE_DATA,
          `${record.asset}/${record.data_type} from ${record.source} is STALE DATA.`,
          { asset: record.asset, data_type: record.data_type, source: record.source }
        )
      );
    }

    if (record.data_age === UNKNOWN) {
      record.data_age = computeDataAge(record.timestamp);
    }

    // Single-source default: an unconfirmed record is UNVERIFIED, not
    // UNKNOWN — we do know it's exactly one, uncorroborated source.
    if (record.verification_status === UNKNOWN) {
      record.verification_status = SOURCE_VERIFICATION_STATES.UNVERIFIED;
    }

    validated.push(record);
  }

  for (const r of rejected) errors.push(r.reason);

  const conflicts = detectConflicts(validated);
  for (const c of conflicts) {
    warnings.push(
      failSafe(ERROR_CODES.CONFLICTING_DATA, `Sources disagree for ${c.asset}/${c.data_type} — CONFLICTING DATA.`, c)
    );
  }

  if (validated.length === 0 && rejected.length > 0) {
    errors.push(
      failSafe(ERROR_CODES.MISSING_DATA, "No record passed validation — INSUFFICIENT DATA.", {
        rejectedCount: rejected.length,
      })
    );
  }

  let status;
  if (validated.length === 0) status = CONTROLLER_STATUS.FAILED;
  else if (conflicts.length > 0) status = CONTROLLER_STATUS.CONFLICTING;
  else if (rejected.length > 0) status = CONTROLLER_STATUS.PARTIAL;
  else status = CONTROLLER_STATUS.SUCCESS;

  const result = {
    controller_status: status,
    validated_data: validated,
    rejected_data: rejected,
    warnings,
    errors,
    conflicts,
    timestamp,
  };

  logEvent({
    agent: "data-controller",
    request: { recordCount: input.length },
    dataSource: Array.from(new Set(validated.map((r) => r.source))).join(",") || UNKNOWN,
    responseStatus: status,
    warnings,
    errors,
  });

  return result;
}

// Runs the full pipeline and returns both the raw controller result and
// its core/agentMessage.js report, validated before being returned —
// the Data Controller never hands downstream agents a malformed report.
function runDataController(input, options = {}) {
  const result = processMarketData(input, options);
  const report = buildAgentReport(result);

  const reportCheck = validateAgentMessage(report);
  if (!reportCheck.valid) {
    throw new Error(`Data Controller produced an invalid agent message: ${reportCheck.errors.join(", ")}`);
  }

  return { result, report };
}

module.exports = {
  CONTROLLER_STATUS,
  processMarketData,
  buildAgentReport,
  runDataController,
  computeDataAge,
};
