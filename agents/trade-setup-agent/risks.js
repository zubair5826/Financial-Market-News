// Structured setup risk flags — this agent's own contribution to risk
// awareness, but it does NOT replace the future Risk Manager. Every
// flag is backed by a narrow, documented evidence rule, never a vague
// impression:
//
//   DATA_RISK: one or more of the 4 domain reports was not supplied
//     (or failed structural validation and was treated as absent).
//   NEWS_RISK / MACRO_RISK / TECHNICAL_RISK / SENTIMENT_RISK: that
//     domain's own report reports unresolved internal conflicts.
//   CONFLICT_RISK: cross-domain evidence disagrees (conflicting_evidence
//     is non-empty).
//   TIMING_RISK: any domain's own uncertainties mention STALE data or
//     UNKNOWN freshness.
//   UNKNOWN: reserved for cases with no evidence to assess risk at all
//     (never auto-activated by this function — see README.md).

const SETUP_RISKS = Object.freeze({
  DATA_RISK: "DATA_RISK",
  NEWS_RISK: "NEWS_RISK",
  MACRO_RISK: "MACRO_RISK",
  TECHNICAL_RISK: "TECHNICAL_RISK",
  SENTIMENT_RISK: "SENTIMENT_RISK",
  CONFLICT_RISK: "CONFLICT_RISK",
  TIMING_RISK: "TIMING_RISK",
  UNKNOWN: "UNKNOWN",
});

function hasUnresolvedConflicts(evidence) {
  return Boolean(evidence && Array.isArray(evidence.conflicts) && evidence.conflicts.length > 0);
}

function hasTimingConcern(evidence) {
  if (!evidence || !Array.isArray(evidence.uncertainties)) return false;
  return evidence.uncertainties.some(
    (u) => typeof u === "string" && (u.includes("STALE") || u.toLowerCase().includes("freshness unknown"))
  );
}

function detectSetupRisks({ newsEvidence, macroEvidence, technicalEvidence, sentimentEvidence }, conflictingEvidence) {
  const risks = new Set();

  if (!newsEvidence || !macroEvidence || !technicalEvidence || !sentimentEvidence) {
    risks.add(SETUP_RISKS.DATA_RISK);
  }

  if (hasUnresolvedConflicts(newsEvidence)) risks.add(SETUP_RISKS.NEWS_RISK);
  if (hasUnresolvedConflicts(macroEvidence)) risks.add(SETUP_RISKS.MACRO_RISK);
  if (hasUnresolvedConflicts(technicalEvidence)) risks.add(SETUP_RISKS.TECHNICAL_RISK);
  if (hasUnresolvedConflicts(sentimentEvidence)) risks.add(SETUP_RISKS.SENTIMENT_RISK);

  if (Array.isArray(conflictingEvidence) && conflictingEvidence.length > 0) {
    risks.add(SETUP_RISKS.CONFLICT_RISK);
  }

  if (
    hasTimingConcern(newsEvidence) ||
    hasTimingConcern(macroEvidence) ||
    hasTimingConcern(technicalEvidence) ||
    hasTimingConcern(sentimentEvidence)
  ) {
    risks.add(SETUP_RISKS.TIMING_RISK);
  }

  return Array.from(risks);
}

module.exports = { SETUP_RISKS, detectSetupRisks };
