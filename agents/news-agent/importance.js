// Structured importance classification, driven only by evidence already
// on the record (relevance, source verification, classification,
// freshness) — never by how sensational the headline text sounds. This
// module never reads/scores headline wording at all.

const { RELEVANCE_LEVELS } = require("./relevance");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { INFORMATION_CLASSIFICATIONS } = require("../../core/classification");
const { FRESHNESS_STATES } = require("../../core/freshness");

const IMPORTANCE_LEVELS = Object.freeze({
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  UNKNOWN: "UNKNOWN",
});

const IMPORTANCE_DEFINITIONS = Object.freeze({
  CRITICAL: "DIRECT relevance to the requested asset, from a verified source, classified FACT — the strongest evidence tier available.",
  HIGH: "DIRECT or INDIRECT relevance from a verified source, but not meeting every CRITICAL criterion (e.g. a SCHEDULED_EVENT rather than a confirmed FACT).",
  MEDIUM: "Relevant (any level) but from an unverified source, or verified with only MACRO/SECTOR relevance.",
  LOW: "LOW_RELEVANCE, or relevant but UNVERIFIED with no other supporting evidence.",
  UNKNOWN: "Relevance or verification_status could not be determined — insufficient evidence to assess importance.",
});

function assessImportance(newsItem, relevance) {
  if (relevance === RELEVANCE_LEVELS.UNKNOWN || newsItem.verification_status === "UNKNOWN") {
    return IMPORTANCE_LEVELS.UNKNOWN;
  }

  const verified =
    newsItem.verification_status === SOURCE_VERIFICATION_STATES.VERIFIED_PRIMARY ||
    newsItem.verification_status === SOURCE_VERIFICATION_STATES.VERIFIED_SECONDARY;
  const isFactOrScheduled =
    newsItem.classification === INFORMATION_CLASSIFICATIONS.FACT ||
    newsItem.classification === INFORMATION_CLASSIFICATIONS.SCHEDULED_EVENT;

  let level;

  if (relevance === RELEVANCE_LEVELS.LOW_RELEVANCE) {
    level = IMPORTANCE_LEVELS.LOW;
  } else if (relevance === RELEVANCE_LEVELS.DIRECT && verified && newsItem.classification === INFORMATION_CLASSIFICATIONS.FACT) {
    level = IMPORTANCE_LEVELS.CRITICAL;
  } else if ((relevance === RELEVANCE_LEVELS.DIRECT || relevance === RELEVANCE_LEVELS.INDIRECT) && verified) {
    level = IMPORTANCE_LEVELS.HIGH;
  } else if (verified || isFactOrScheduled) {
    level = IMPORTANCE_LEVELS.MEDIUM;
  } else {
    level = IMPORTANCE_LEVELS.LOW;
  }

  // A stale story is less actionable regardless of how important it
  // otherwise looks — cap rather than ignore the other evidence.
  if (newsItem.freshness_status === FRESHNESS_STATES.STALE && (level === IMPORTANCE_LEVELS.CRITICAL || level === IMPORTANCE_LEVELS.HIGH)) {
    level = IMPORTANCE_LEVELS.MEDIUM;
  }

  return level;
}

module.exports = { IMPORTANCE_LEVELS, IMPORTANCE_DEFINITIONS, assessImportance };
