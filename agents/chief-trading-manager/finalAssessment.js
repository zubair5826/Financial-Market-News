// Final assessment — synthesized ONLY from the four specialist reports
// (News, Macro, Technical, Sentiment), never from the Trade Setup
// Agent's own `direction`. Trade Setup's direction is itself already
// derived from these same four specialists (Step 9) — counting it as
// a fifth vote here would double-count the same evidence and make the
// synthesis circular. Trade Setup and Risk Manager are surfaced in
// their own summaries and drive `decisionStatus.js` instead (whether
// to ACT), which is a separate question from what the specialist
// evidence itself says about market direction.
//
// Documented, deterministic rule:
//
//   UNKNOWN            no specialist report was supplied at all.
//   NO_DECISION         reports were supplied, but none passed
//                        structural validation — nothing usable.
//   INSUFFICIENT_DATA   fewer than 2 valid specialists carry a
//                        directional bias (BULLISH/BEARISH/NEUTRAL/
//                        MIXED) at all.
//   CONFLICTING_EVIDENCE at least one specialist is BULLISH and at
//                        least one is BEARISH — direct opposition.
//   MIXED               no direct opposition, but at least one
//                        specialist's own bias is itself MIXED.
//   NEUTRAL             no opposition, no internal mixing, and no
//                        BULLISH/BEARISH lean.
//   BULLISH / BEARISH    a clear majority among tagged specialists.
//
// This is a synthesis of evidence direction — never an execution
// order. See README.md.

const FINAL_ASSESSMENTS = Object.freeze({
  BULLISH: "BULLISH",
  BEARISH: "BEARISH",
  NEUTRAL: "NEUTRAL",
  MIXED: "MIXED",
  NO_DECISION: "NO_DECISION",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  CONFLICTING_EVIDENCE: "CONFLICTING_EVIDENCE",
  UNKNOWN: "UNKNOWN",
});

function countVotes(specialistSummaries) {
  let bullish = 0;
  let bearish = 0;
  let tagged = 0;
  let mixedDomainCount = 0;

  for (const summary of specialistSummaries) {
    if (!summary) continue;
    if (summary.bias === "BULLISH") {
      bullish += 1;
      tagged += 1;
    } else if (summary.bias === "BEARISH") {
      bearish += 1;
      tagged += 1;
    } else if (summary.bias === "NEUTRAL") {
      tagged += 1;
    } else if (summary.bias === "MIXED") {
      tagged += 1;
      mixedDomainCount += 1;
    }
  }

  return { bullish, bearish, tagged, mixedDomainCount };
}

function determineFinalAssessment({ specialistSummaries, suppliedCount, validCount }) {
  if (suppliedCount === 0) return { assessment: FINAL_ASSESSMENTS.UNKNOWN, ...countVotes(specialistSummaries) };
  if (validCount === 0) return { assessment: FINAL_ASSESSMENTS.NO_DECISION, ...countVotes(specialistSummaries) };

  const votes = countVotes(specialistSummaries);

  if (votes.tagged < 2) return { assessment: FINAL_ASSESSMENTS.INSUFFICIENT_DATA, ...votes };
  if (votes.bullish > 0 && votes.bearish > 0) return { assessment: FINAL_ASSESSMENTS.CONFLICTING_EVIDENCE, ...votes };
  if (votes.bullish === 0 && votes.bearish === 0) {
    return { assessment: votes.mixedDomainCount > 0 ? FINAL_ASSESSMENTS.MIXED : FINAL_ASSESSMENTS.NEUTRAL, ...votes };
  }
  return { assessment: votes.bullish > votes.bearish ? FINAL_ASSESSMENTS.BULLISH : FINAL_ASSESSMENTS.BEARISH, ...votes };
}

module.exports = { FINAL_ASSESSMENTS, countVotes, determineFinalAssessment };
