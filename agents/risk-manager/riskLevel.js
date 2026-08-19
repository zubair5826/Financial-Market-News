// Risk level and risk decision — deterministic rules, documented
// exactly:
//
//   RISK LEVEL
//   No setup reference at all, or the Trade Setup Agent itself
//   reported DATA_UNAVAILABLE -> UNKNOWN (there's nothing to grade).
//   Otherwise, a base level comes from how many distinct risk
//   categories are active: 0 -> LOW, 1-2 -> MODERATE, 3-4 -> HIGH,
//   5+ -> CRITICAL. Two floors can only ever RAISE that base level,
//   never lower it: the underlying setup_status being
//   CONFLICTING_EVIDENCE floors the level at HIGH (contradictory
//   cross-domain signals are inherently elevated risk regardless of
//   category count); setup_quality LOW floors the level at MODERATE.
//
//   RISK DECISION
//   This is NEVER an execution decision.
//   setup_status DATA_UNAVAILABLE or INSUFFICIENT_DATA -> INSUFFICIENT_DATA,
//   regardless of the computed risk level (not enough evidence to
//   trust any risk read on it).
//   risk_level UNKNOWN -> UNKNOWN.
//   risk_level CRITICAL -> RISK_TOO_HIGH.
//   risk_level HIGH or MODERATE -> RISK_REQUIRES_REVIEW.
//   risk_level LOW -> RISK_ACCEPTABLE.

const RISK_LEVELS = Object.freeze({ LOW: "LOW", MODERATE: "MODERATE", HIGH: "HIGH", CRITICAL: "CRITICAL", UNKNOWN: "UNKNOWN" });

const RISK_DECISIONS = Object.freeze({
  RISK_ACCEPTABLE: "RISK_ACCEPTABLE",
  RISK_REQUIRES_REVIEW: "RISK_REQUIRES_REVIEW",
  RISK_TOO_HIGH: "RISK_TOO_HIGH",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  UNKNOWN: "UNKNOWN",
});

const LEVEL_RANK = Object.freeze({ LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 });

function baseLevelByCount(count) {
  if (count >= 5) return RISK_LEVELS.CRITICAL;
  if (count >= 3) return RISK_LEVELS.HIGH;
  if (count >= 1) return RISK_LEVELS.MODERATE;
  return RISK_LEVELS.LOW;
}

function assessRiskLevel({ activeCategoryCount, setupStatus, setupQuality }) {
  if (!setupStatus || setupStatus === "DATA_UNAVAILABLE") return RISK_LEVELS.UNKNOWN;

  let level = baseLevelByCount(activeCategoryCount);

  if (setupStatus === "CONFLICTING_EVIDENCE" && LEVEL_RANK[RISK_LEVELS.HIGH] > LEVEL_RANK[level]) {
    level = RISK_LEVELS.HIGH;
  }
  if (setupQuality === "LOW" && LEVEL_RANK[RISK_LEVELS.MODERATE] > LEVEL_RANK[level]) {
    level = RISK_LEVELS.MODERATE;
  }

  return level;
}

function assessRiskDecision(riskLevel, setupStatus) {
  if (!setupStatus || setupStatus === "DATA_UNAVAILABLE" || setupStatus === "INSUFFICIENT_DATA") {
    return RISK_DECISIONS.INSUFFICIENT_DATA;
  }
  if (riskLevel === RISK_LEVELS.UNKNOWN) return RISK_DECISIONS.UNKNOWN;
  if (riskLevel === RISK_LEVELS.CRITICAL) return RISK_DECISIONS.RISK_TOO_HIGH;
  if (riskLevel === RISK_LEVELS.HIGH || riskLevel === RISK_LEVELS.MODERATE) return RISK_DECISIONS.RISK_REQUIRES_REVIEW;
  return RISK_DECISIONS.RISK_ACCEPTABLE;
}

module.exports = { RISK_LEVELS, RISK_DECISIONS, assessRiskLevel, assessRiskDecision };
