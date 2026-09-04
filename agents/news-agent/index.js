// The News Intelligence Agent.
//
// Pipeline: RECEIVE -> VALIDATE -> CHECK SOURCE/TIMESTAMP -> CLASSIFY
// (pass-through, never mutated) -> DETECT DUPLICATES -> DETECT
// CONFLICTS -> ASSESS RELEVANCE -> ASSESS IMPORTANCE -> aggregate
// MARKET IMPACT -> return a News Summary for future agents.
//
// It does not execute trades, connect to a broker, or recommend a
// direction — see report.js, whose News Summary output has no
// recommendation_type field at all. No external news provider is
// connected; `input` is data supplied internally by the system (see
// README.md). The pipeline is shaped so a future provider adapter's
// failSafe() result (core/errors.js) can be passed straight in.

const { computeFreshness, FRESHNESS_STATES } = require("../../core/freshness");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { failSafe, ERROR_CODES } = require("../../core/errors");
const { UNKNOWN } = require("../../core/constants");
const { logEvent } = require("../../logs/logger");
const { normalizeNewsItem } = require("./normalize");
const { validateNewsInput } = require("./validate");
const { detectDuplicates } = require("./duplicates");
const { detectConflictingReports } = require("./conflicts");
const { assessRelevance, RELEVANCE_LEVELS } = require("./relevance");
const { assessImportance } = require("./importance");
const { buildNewsSummary } = require("./report");

const NEWS_AGENT_STATUS = Object.freeze({
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
    validated_items: [],
    rejected_items: [],
    duplicates: [],
    conflicts: [],
    warnings,
    errors,
    timestamp,
  };
}

function processNews(input, options = {}) {
  const timestamp = new Date().toISOString();

  // Structurally ready for a future provider adapter's failSafe()
  // result — no provider is connected yet, but this path exists so
  // wiring one up later doesn't require a rewrite.
  if (input && typeof input === "object" && !Array.isArray(input) && input.ok === false && input.code) {
    const status = UNAVAILABLE_CODES.has(input.code) ? NEWS_AGENT_STATUS.UNAVAILABLE : NEWS_AGENT_STATUS.FAILED;
    const result = emptyResult(status, [], [input], timestamp);
    logEvent({
      agent: "news-agent",
      request: { inputType: "provider-error", code: input.code },
      dataSource: UNKNOWN,
      responseStatus: status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  if (!Array.isArray(input)) {
    const err = failSafe(ERROR_CODES.MALFORMED_DATA, "Input must be an array of raw news records.");
    const result = emptyResult(NEWS_AGENT_STATUS.FAILED, [], [err], timestamp);
    logEvent({
      agent: "news-agent",
      request: { inputType: typeof input },
      dataSource: UNKNOWN,
      responseStatus: result.agent_status,
      warnings: result.warnings,
      errors: result.errors,
    });
    return result;
  }

  if (input.length === 0) {
    const result = emptyResult(NEWS_AGENT_STATUS.UNAVAILABLE, ["NEWS DATA UNAVAILABLE — no news data was supplied."], [], timestamp);
    logEvent({
      agent: "news-agent",
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
    const item = normalizeNewsItem(raw, options.fieldMap || {});

    const validation = validateNewsInput(item);
    if (!validation.valid) {
      const code = validation.missingFields.length > 0 ? ERROR_CODES.MISSING_DATA : ERROR_CODES.MALFORMED_DATA;
      const allErrors = [
        ...validation.missingFields.map((f) => `Missing required field: ${f} (DATA UNAVAILABLE).`),
        ...validation.structuralErrors,
      ];
      rejected.push({
        record: item,
        errors: allErrors,
        reason: failSafe(code, "News item failed News Agent validation.", { errors: allErrors }),
      });
      continue;
    }

    // Freshness is computed here from publication_timestamp, never
    // trusted from the caller's own claim — a story labeled "breaking"
    // without evidence is exactly what this step exists to catch.
    const thresholds = resolveFreshnessThresholds(item, options);
    item.freshness_status = computeFreshness(item.publication_timestamp, thresholds);

    if (item.freshness_status === FRESHNESS_STATES.UNKNOWN) {
      const reason =
        !item.publication_timestamp || item.publication_timestamp === UNKNOWN
          ? "no publication_timestamp was supplied"
          : "no freshness thresholds were configured";
      warnings.push(`Freshness UNKNOWN for "${item.headline}" from ${item.source} — ${reason}.`);
    } else if (item.freshness_status === FRESHNESS_STATES.STALE) {
      warnings.push(
        failSafe(ERROR_CODES.STALE_DATA, `"${item.headline}" from ${item.source} is STALE DATA.`, {
          headline: item.headline,
        })
      );
    }

    // retrieved_timestamp records this agent's own processing time —
    // that's a fact this system genuinely knows about itself, unlike
    // publication_timestamp, which it can never invent.
    if (item.retrieved_timestamp === UNKNOWN) {
      item.retrieved_timestamp = timestamp;
    }

    // A missing source is handled safely, not rejected: the headline
    // content is still usable, but nothing can be claimed about its
    // provenance, so verification is forced down regardless of any
    // caller-supplied claim.
    if (item.source === UNKNOWN) {
      item.verification_status = SOURCE_VERIFICATION_STATES.UNVERIFIED;
      warnings.push(`Source not supplied for "${item.headline}" — verification cannot be established (NOT_AVAILABLE).`);
    } else if (item.verification_status === UNKNOWN) {
      item.verification_status = SOURCE_VERIFICATION_STATES.UNVERIFIED;
    }

    validated.push(item);
  }

  for (const r of rejected) errors.push(r.reason);

  // Step 3A: an item with no meaningful connection to the requested
  // asset (LOW_RELEVANCE) must never participate in duplicate/conflict
  // detection — two items that only coincidentally share a tagged
  // asset/category (e.g. a genuine SPY-ETF story vs. an unrelated
  // SPY-adjacent crypto/forex-style listing) can otherwise be grouped
  // as "likely the same event" and flagged as a false CONFLICTING_DATA
  // signal, even though they aren't really about the same thing.
  //
  // Relevance is computed here ONLY to build this narrowed candidate
  // list — assessRelevance() is pure and deterministic (reads only
  // related_assets/related_markets/category), so calling it again in
  // the existing assignment loop below produces byte-identical
  // results; it is not reordered relative to conflict detection, so
  // that loop's existing dependency (verification_status is set to
  // CONFLICTING by detectConflictingReports() BEFORE importance reads
  // it) is completely unchanged. validated/rejected are never touched
  // by this narrowing — every item, including every LOW_RELEVANCE one,
  // still flows into validated_items/news_items exactly as before.
  const conflictDetectionCandidates = validated.filter(
    (item) =>
      assessRelevance(item, options.requestedAsset, { sectorCategories: options.sectorCategories }) !== RELEVANCE_LEVELS.LOW_RELEVANCE
  );

  const duplicates = detectDuplicates(conflictDetectionCandidates);
  const conflicts = detectConflictingReports(conflictDetectionCandidates, duplicates);
  for (const c of conflicts) {
    warnings.push(
      failSafe(ERROR_CODES.CONFLICTING_DATA, `Conflicting reports detected among likely-same-event items — CONFLICTING DATA.`, c)
    );
  }

  for (const item of validated) {
    item.relevance = assessRelevance(item, options.requestedAsset, { sectorCategories: options.sectorCategories });
    item.importance = assessImportance(item, item.relevance);
  }

  if (validated.length === 0 && rejected.length > 0) {
    errors.push(
      failSafe(ERROR_CODES.MISSING_DATA, "No news item passed validation — INSUFFICIENT DATA.", {
        rejectedCount: rejected.length,
      })
    );
  }

  let status;
  if (validated.length === 0) status = NEWS_AGENT_STATUS.FAILED;
  else if (conflicts.length > 0) status = NEWS_AGENT_STATUS.CONFLICTING;
  else if (rejected.length > 0) status = NEWS_AGENT_STATUS.PARTIAL;
  else status = NEWS_AGENT_STATUS.SUCCESS;

  const result = {
    agent_status: status,
    validated_items: validated,
    rejected_items: rejected,
    duplicates,
    conflicts,
    warnings,
    errors,
    timestamp,
  };

  logEvent({
    agent: "news-agent",
    request: { recordCount: input.length, requestedAsset: options.requestedAsset || UNKNOWN },
    dataSource: Array.from(new Set(validated.map((i) => i.source))).join(",") || UNKNOWN,
    responseStatus: status,
    warnings,
    errors,
  });

  return result;
}

function runNewsAgent(input, options = {}) {
  const result = processNews(input, options);
  const report = buildNewsSummary(result, options);
  return { result, report };
}

module.exports = { NEWS_AGENT_STATUS, processNews, runNewsAgent };
