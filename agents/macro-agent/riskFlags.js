// Structured macro risk flags. Every flag activated here is backed by a
// narrow, documented evidence rule — never activated from vague
// sensational impression. RECESSION_RISK and GEOPOLITICAL_MACRO_RISK
// are deliberately NOT auto-detected: reliably inferring either from a
// single indicator or event would be an overreach this agent has no
// evidence to support. They remain in the vocabulary for a future
// agent/human to apply with real justification, but this module never
// activates them on its own.

const { FRESHNESS_STATES } = require("../../core/freshness");
const { INDICATOR_CATEGORIES } = require("./categories");
const { SURPRISE_STATES } = require("./surprise");

const MACRO_RISK_FLAGS = Object.freeze({
  HIGH_INFLATION_RISK: "HIGH_INFLATION_RISK",
  RATE_DECISION_RISK: "RATE_DECISION_RISK",
  CENTRAL_BANK_RISK: "CENTRAL_BANK_RISK",
  EMPLOYMENT_RISK: "EMPLOYMENT_RISK",
  GROWTH_RISK: "GROWTH_RISK",
  RECESSION_RISK: "RECESSION_RISK",
  GEOPOLITICAL_MACRO_RISK: "GEOPOLITICAL_MACRO_RISK",
  POLICY_UNCERTAINTY: "POLICY_UNCERTAINTY",
  DATA_CONFLICT: "DATA_CONFLICT",
  DATA_STALE: "DATA_STALE",
  DATA_UNAVAILABLE: "DATA_UNAVAILABLE",
  UNKNOWN: "UNKNOWN",
});

const MACRO_RISK_FLAG_DEFINITIONS = Object.freeze({
  HIGH_INFLATION_RISK: "An INFLATION-category indicator came in ABOVE_EXPECTATION.",
  RATE_DECISION_RISK: "An INTEREST_RATES or CENTRAL_BANK category record is present in this batch.",
  CENTRAL_BANK_RISK: "A central bank event with a tagged (non-UNKNOWN) policy_direction is present.",
  EMPLOYMENT_RISK: "An EMPLOYMENT-category indicator surprised (ABOVE or BELOW expectation) in either direction.",
  GROWTH_RISK: "A GDP-category indicator came in BELOW_EXPECTATION.",
  RECESSION_RISK: "NOT auto-detected by this agent — no single-indicator evidence rule is reliable enough. Reserved for future use with explicit justification.",
  GEOPOLITICAL_MACRO_RISK: "NOT auto-detected by this agent — outside what structured macro/event data alone can support. Reserved for future use with explicit justification.",
  POLICY_UNCERTAINTY: "A central bank event carries a tagged, non-UNKNOWN uncertainty value.",
  DATA_CONFLICT: "One or more conflicting macro records were detected in this batch.",
  DATA_STALE: "One or more validated macro records are STALE.",
  DATA_UNAVAILABLE: "No macro data was available to assess (set by the caller/index.js, not by this function).",
  UNKNOWN: "Insufficient evidence to assess risk.",
});

function detectRiskFlags(records, centralBankEvents, conflicts) {
  const flags = new Set();

  if (conflicts.length > 0) flags.add(MACRO_RISK_FLAGS.DATA_CONFLICT);
  if (records.some((r) => r.freshness_status === FRESHNESS_STATES.STALE)) flags.add(MACRO_RISK_FLAGS.DATA_STALE);

  for (const r of records) {
    if (r.category === INDICATOR_CATEGORIES.INFLATION && r.surprise_direction === SURPRISE_STATES.ABOVE_EXPECTATION) {
      flags.add(MACRO_RISK_FLAGS.HIGH_INFLATION_RISK);
    }
    if (
      r.category === INDICATOR_CATEGORIES.EMPLOYMENT &&
      (r.surprise_direction === SURPRISE_STATES.ABOVE_EXPECTATION || r.surprise_direction === SURPRISE_STATES.BELOW_EXPECTATION)
    ) {
      flags.add(MACRO_RISK_FLAGS.EMPLOYMENT_RISK);
    }
    if (r.category === INDICATOR_CATEGORIES.GDP && r.surprise_direction === SURPRISE_STATES.BELOW_EXPECTATION) {
      flags.add(MACRO_RISK_FLAGS.GROWTH_RISK);
    }
    if (r.category === INDICATOR_CATEGORIES.INTEREST_RATES || r.category === INDICATOR_CATEGORIES.CENTRAL_BANK) {
      flags.add(MACRO_RISK_FLAGS.RATE_DECISION_RISK);
    }
  }

  for (const event of centralBankEvents) {
    if (event.policy_direction && event.policy_direction !== "UNKNOWN") {
      flags.add(MACRO_RISK_FLAGS.CENTRAL_BANK_RISK);
    }
    if (event.uncertainty && event.uncertainty !== "UNKNOWN" && event.uncertainty !== "NOT_AVAILABLE") {
      flags.add(MACRO_RISK_FLAGS.POLICY_UNCERTAINTY);
    }
  }

  return Array.from(flags);
}

module.exports = { MACRO_RISK_FLAGS, MACRO_RISK_FLAG_DEFINITIONS, detectRiskFlags };
