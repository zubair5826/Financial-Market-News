// Structured event importance, driven only by relevance, source
// verification, indicator category, and freshness — never by how
// dramatic an indicator's name or headline framing sounds. This module
// never inspects any free-text field.

const { RELEVANCE_LEVELS } = require("./relevance");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { INFORMATION_CLASSIFICATIONS } = require("../../core/classification");
const { FRESHNESS_STATES } = require("../../core/freshness");
const { INDICATOR_CATEGORIES } = require("./categories");

const IMPORTANCE_LEVELS = Object.freeze({
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  UNKNOWN: "UNKNOWN",
});

const IMPORTANCE_DEFINITIONS = Object.freeze({
  CRITICAL: "DIRECT relevance, from a verified source, in a high-sensitivity category (INFLATION/EMPLOYMENT/GDP/INTEREST_RATES/CENTRAL_BANK).",
  HIGH: "DIRECT or HIGH relevance from a verified source, but not meeting every CRITICAL criterion.",
  MEDIUM: "Relevant (any level) but from an unverified source, or verified with only MEDIUM/LOW relevance.",
  LOW: "LOW relevance, or relevant but UNVERIFIED with no other supporting evidence.",
  UNKNOWN: "Relevance or verification_status could not be determined — insufficient evidence to assess importance.",
});

const HIGH_SENSITIVITY_CATEGORIES = new Set([
  INDICATOR_CATEGORIES.INFLATION,
  INDICATOR_CATEGORIES.EMPLOYMENT,
  INDICATOR_CATEGORIES.GDP,
  INDICATOR_CATEGORIES.INTEREST_RATES,
  INDICATOR_CATEGORIES.CENTRAL_BANK,
]);

function assessImportance(record, relevance) {
  if (relevance === RELEVANCE_LEVELS.UNKNOWN || record.verification_status === "UNKNOWN") {
    return IMPORTANCE_LEVELS.UNKNOWN;
  }

  const verified =
    record.verification_status === SOURCE_VERIFICATION_STATES.VERIFIED_PRIMARY ||
    record.verification_status === SOURCE_VERIFICATION_STATES.VERIFIED_SECONDARY;
  const isFactOrScheduled =
    record.classification === INFORMATION_CLASSIFICATIONS.FACT ||
    record.classification === INFORMATION_CLASSIFICATIONS.SCHEDULED_EVENT;
  const highSensitivity = HIGH_SENSITIVITY_CATEGORIES.has(record.category);

  let level;
  if (relevance === RELEVANCE_LEVELS.LOW) {
    level = IMPORTANCE_LEVELS.LOW;
  } else if (relevance === RELEVANCE_LEVELS.DIRECT && verified && highSensitivity) {
    level = IMPORTANCE_LEVELS.CRITICAL;
  } else if ((relevance === RELEVANCE_LEVELS.DIRECT || relevance === RELEVANCE_LEVELS.HIGH) && verified) {
    level = IMPORTANCE_LEVELS.HIGH;
  } else if (verified || isFactOrScheduled) {
    level = IMPORTANCE_LEVELS.MEDIUM;
  } else {
    level = IMPORTANCE_LEVELS.LOW;
  }

  if (record.freshness_status === FRESHNESS_STATES.STALE && (level === IMPORTANCE_LEVELS.CRITICAL || level === IMPORTANCE_LEVELS.HIGH)) {
    level = IMPORTANCE_LEVELS.MEDIUM;
  }

  return level;
}

module.exports = { IMPORTANCE_LEVELS, IMPORTANCE_DEFINITIONS, assessImportance };
