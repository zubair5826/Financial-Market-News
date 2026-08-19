// Deterministic confluence analysis — documented rule, exactly:
//
//   Each domain (NEWS/MACRO/TECHNICAL/SENTIMENT) with a bias that
//   AGREES with the overall aggregated direction (or is NEUTRAL)
//   contributes a score based on ITS OWN confidence: HIGH=1.0,
//   MEDIUM=0.66, LOW=0.33, UNKNOWN=0. A domain whose bias OPPOSES the
//   overall direction contributes 0 to confluence (it's tracked
//   separately as conflicting_evidence, never silently folded in). A
//   domain with unresolved internal conflicts (e.g. News's own
//   conflicting_reports) has its contribution halved — confidence
//   alone isn't enough if the evidence backing it disagrees with
//   itself. A domain with no report supplied contributes 0 (it isn't
//   "confidence UNKNOWN evidence," it's absent evidence).
//
//   confluence_score = sum of the 4 domain contributions (0–4).
//   confluence_ratio = confluence_score / 4 (0–1), used by quality.js.
//
// This never just counts how many agents agree — confidence,
// freshness (via each domain's own confidence, which already accounts
// for staleness — see each agent's report.js), verification (via
// confidence, since a domain full of UNVERIFIED evidence reports LOW/
// MEDIUM confidence, never HIGH), conflicts, and data availability are
// all explicit inputs to the score, as the Step 9 spec requires.

const CONFIDENCE_WEIGHT = Object.freeze({ HIGH: 1, MEDIUM: 0.66, LOW: 0.33, UNKNOWN: 0 });

function scoreDomain(evidence, overallDirection) {
  if (!evidence || evidence.bias === "UNKNOWN") return 0;

  const agrees = evidence.bias === overallDirection || evidence.bias === "NEUTRAL";
  if (!agrees) return 0;

  let score = CONFIDENCE_WEIGHT[evidence.confidence] ?? 0;
  const hasConflicts = Array.isArray(evidence.conflicts) && evidence.conflicts.length > 0;
  if (hasConflicts) score *= 0.5;

  return score;
}

function assessConfluence({ newsEvidence, macroEvidence, technicalEvidence, sentimentEvidence }, overallDirection) {
  const domainScores = {
    NEWS: scoreDomain(newsEvidence, overallDirection),
    MACRO: scoreDomain(macroEvidence, overallDirection),
    TECHNICAL: scoreDomain(technicalEvidence, overallDirection),
    SENTIMENT: scoreDomain(sentimentEvidence, overallDirection),
  };

  const confluenceScore = Object.values(domainScores).reduce((sum, v) => sum + v, 0);
  const confluenceRatio = confluenceScore / 4;

  return { domain_scores: domainScores, confluence_score: confluenceScore, confluence_ratio: confluenceRatio };
}

module.exports = { CONFIDENCE_WEIGHT, scoreDomain, assessConfluence };
