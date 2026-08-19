// Setup quality — deterministic criteria, documented exactly:
//
//   UNKNOWN: fewer than 2 domains have any usable (non-UNKNOWN-bias)
//   evidence at all — not enough to judge quality one way or another.
//   LOW: 2+ domains have evidence, but the evidence directly conflicts
//   (a domain's bias opposes the overall direction) — any cross-domain
//   disagreement caps quality at LOW, regardless of how confident the
//   agreeing domains are.
//   Otherwise, quality is read off confluence.js's confluence_ratio
//   against configurable thresholds (default: >=0.75 HIGH, >=0.4
//   MEDIUM, else LOW) — this project's own synthesis heuristic for
//   combining evidence, not a claim about external market reality, so
//   it ships with a documented sensible default rather than requiring
//   configuration the way a real-world threshold (freshness,
//   volatility) would.
//
// A HIGH-quality setup is NOT a guarantee of profitability — it only
// describes how much of the supplied evidence, weighted by confidence
// and internal consistency, agrees on a direction.

const QUALITY_LEVELS = Object.freeze({ HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW", UNKNOWN: "UNKNOWN" });

const DEFAULT_QUALITY_THRESHOLDS = Object.freeze({ highMin: 0.75, mediumMin: 0.4 });

function assessSetupQuality({ taggedDomains, hasOpposingEvidence, confluenceRatio }, options = {}) {
  if (taggedDomains < 2) return QUALITY_LEVELS.UNKNOWN;
  if (hasOpposingEvidence) return QUALITY_LEVELS.LOW;

  const thresholds = options.qualityThresholds || DEFAULT_QUALITY_THRESHOLDS;
  if (confluenceRatio >= thresholds.highMin) return QUALITY_LEVELS.HIGH;
  if (confluenceRatio >= thresholds.mediumMin) return QUALITY_LEVELS.MEDIUM;
  return QUALITY_LEVELS.LOW;
}

module.exports = { QUALITY_LEVELS, DEFAULT_QUALITY_THRESHOLDS, assessSetupQuality };
