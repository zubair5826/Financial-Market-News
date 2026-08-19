// The Sentiment Analysis Agent.
//
// Pipeline: RECEIVE -> VALIDATE -> CHECK SOURCE/TIMESTAMP -> CLASSIFY
// (pass-through, never mutated) -> DERIVE STRENGTH -> DETECT CONFLICTS
// -> AGGREGATE -> return a Sentiment Report for future agents.
//
// It does not execute trades, connect to a broker, or recommend a
// direction — see report.js, whose Sentiment Report output has no
// recommendation_type field at all. No external sentiment/social-media
// provider is connected; `input` is data supplied internally by the
// system (see README.md). Mirrors the architecture of
// agents/data-controller, agents/news-agent, agents/macro-agent, and
// agents/technical-agent.

const { computeFreshness, FRESHNESS_STATES } = require("../../core/freshness");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { failSafe, ERROR_CODES } = require("../../core/errors");
const { UNKNOWN } = require("../../core/constants");
const { logEvent } = require("../../logs/logger");
const { normalizeSentimentRecord } = require("./normalize");
const { validateSentimentInput } = require("./validate");
const { deriveSentimentStrength } = require("./strength");
const { detectSentimentConflicts } = require("./conflicts");
const { buildSentimentReport } = require("./report");

const SENTIMENT_AGENT_STATUS = Object.freeze({
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
  return cfg[record.source_type];
}

function emptyResult(status, warnings, errors, timestamp) {
  return {
    agent_status: status,
    validated_records: [],
    rejected_records: [],
    conflicts: [],
    warnings,
    errors,
    timestamp,
  };
}

function processSentimentData(input, options = {}) {
  const timestamp = new Date().toISOString();

  // Structurally ready for a future provider adapter's failSafe()
  // result — no provider is connected yet, but this path exists so
  // wiring one up later doesn't require a rewrite.
  if (input && typeof input === "object" && !Array.isArray(input) && input.ok === false && input.code) {
    const status = UNAVAILABLE_CODES.has(input.code) ? SENTIMENT_AGENT_STATUS.UNAVAILABLE : SENTIMENT_AGENT_STATUS.FAILED;
    const result = emptyResult(status, [], [input], timestamp);
    logEvent({
      agent: "sentiment-agent",
      request: { inputType: "provider-error", code: input.code },
      dataSource: UNKNOWN,
      responseStatus: status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  if (!Array.isArray(input)) {
    const err = failSafe(ERROR_CODES.MALFORMED_DATA, "Input must be an array of raw sentiment records.");
    const result = emptyResult(SENTIMENT_AGENT_STATUS.FAILED, [], [err], timestamp);
    logEvent({
      agent: "sentiment-agent",
      request: { inputType: typeof input },
      dataSource: UNKNOWN,
      responseStatus: result.agent_status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  if (input.length === 0) {
    const result = emptyResult(
      SENTIMENT_AGENT_STATUS.UNAVAILABLE,
      ["SENTIMENT DATA UNAVAILABLE — no sentiment data was supplied."],
      [],
      timestamp
    );
    logEvent({
      agent: "sentiment-agent",
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
    const record = normalizeSentimentRecord(raw, options.fieldMap || {});

    const validation = validateSentimentInput(record);
    if (!validation.valid) {
      const code = validation.missingFields.length > 0 ? ERROR_CODES.MISSING_DATA : ERROR_CODES.MALFORMED_DATA;
      const allErrors = [
        ...validation.missingFields.map((f) => `Missing required field: ${f} (DATA UNAVAILABLE).`),
        ...validation.structuralErrors,
      ];
      rejected.push({
        record,
        errors: allErrors,
        reason: failSafe(code, "Sentiment record failed Sentiment Agent validation.", { errors: allErrors }),
      });
      continue;
    }

    // Freshness is computed here from timestamp, never trusted from the
    // caller's own "live"/"current" claim.
    const thresholds = resolveFreshnessThresholds(record, options);
    record.freshness_status = computeFreshness(record.timestamp, thresholds);

    if (record.freshness_status === FRESHNESS_STATES.UNKNOWN) {
      const reason =
        !record.timestamp || record.timestamp === UNKNOWN ? "no timestamp was supplied" : "no freshness thresholds were configured";
      warnings.push(`Freshness UNKNOWN for ${record.asset} sentiment from ${record.source} — ${reason}.`);
    } else if (record.freshness_status === FRESHNESS_STATES.STALE) {
      warnings.push(
        failSafe(ERROR_CODES.STALE_DATA, `${record.asset} sentiment from ${record.source} is STALE DATA.`, {
          asset: record.asset,
        })
      );
    }

    if (record.source === UNKNOWN) {
      record.verification_status = SOURCE_VERIFICATION_STATES.UNVERIFIED;
      warnings.push(`Source not supplied for ${record.asset} sentiment — verification cannot be established (NOT_AVAILABLE).`);
    } else if (record.verification_status === UNKNOWN) {
      record.verification_status = SOURCE_VERIFICATION_STATES.UNVERIFIED;
    }

    // Strength is never inferred from wording — only from a caller-
    // tagged strength value or a configured sentiment_score threshold.
    record.sentiment_strength = deriveSentimentStrength(record, options.strengthOptions || {});

    validated.push(record);
  }

  for (const r of rejected) errors.push(r.reason);

  // Conflict detection runs over everything validated, same as the
  // Data Controller/News/Macro agents — groupByAsset already separates
  // unrelated assets into their own groups, so this doesn't change
  // behavior for the requested asset. Scoping to requestedAsset happens
  // in report.js instead, at the point of use, matching the naming
  // convention (validated_records means the FULL validated set) used
  // by every other agent in this project.
  const conflicts = detectSentimentConflicts(validated);
  for (const c of conflicts) {
    warnings.push(
      failSafe(ERROR_CODES.CONFLICTING_DATA, `Conflicting sentiment detected for ${c.asset} — CONFLICTING_SENTIMENT.`, c)
    );
  }

  if (input.length > 0 && validated.length === 0 && rejected.length > 0) {
    errors.push(
      failSafe(ERROR_CODES.MISSING_DATA, "No sentiment record passed validation — INSUFFICIENT DATA.", {
        rejectedCount: rejected.length,
      })
    );
  }

  let status;
  if (input.length > 0 && validated.length === 0) status = SENTIMENT_AGENT_STATUS.FAILED;
  else if (conflicts.length > 0) status = SENTIMENT_AGENT_STATUS.CONFLICTING;
  else if (rejected.length > 0) status = SENTIMENT_AGENT_STATUS.PARTIAL;
  else status = SENTIMENT_AGENT_STATUS.SUCCESS;

  const result = {
    agent_status: status,
    validated_records: validated,
    rejected_records: rejected,
    conflicts,
    warnings,
    errors,
    timestamp,
  };

  logEvent({
    agent: "sentiment-agent",
    request: { recordCount: input.length, requestedAsset: options.requestedAsset || UNKNOWN },
    dataSource: Array.from(new Set(validated.map((r) => r.source))).join(",") || UNKNOWN,
    responseStatus: status,
    warnings,
    errors,
  });

  return result;
}

function runSentimentAgent(input, options = {}) {
  const result = processSentimentData(input, options);
  const report = buildSentimentReport(result, options);
  return { result, report };
}

module.exports = { SENTIMENT_AGENT_STATUS, processSentimentData, runSentimentAgent };
