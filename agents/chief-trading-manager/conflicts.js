// Conflict explanation — per the Step 11 spec's CONFLICT HANDLING
// section, disagreement is never hidden, and when final_assessment is
// CONFLICTING_EVIDENCE this module must explain: which agents
// disagree, why, what evidence supports each side, and what
// information is missing. Each specialist's own internal conflicts
// (e.g. News's conflicting_reports) are also surfaced independently,
// regardless of whether the specialists disagree with EACH OTHER.

function explainCrossDomainDisagreement(namedSummaries, finalAssessment) {
  if (finalAssessment !== "CONFLICTING_EVIDENCE") return [];

  const bullishAgents = [];
  const bearishAgents = [];
  const missingAgents = [];

  for (const [name, summary] of Object.entries(namedSummaries)) {
    if (!summary) {
      missingAgents.push(name);
      continue;
    }
    if (summary.bias === "BULLISH") bullishAgents.push(name);
    else if (summary.bias === "BEARISH") bearishAgents.push(name);
  }

  return [
    {
      type: "SPECIALIST_DISAGREEMENT",
      bullish_agents: bullishAgents,
      bearish_agents: bearishAgents,
      reason: `${bullishAgents.join(", ") || "no agent"} reported BULLISH evidence while ${bearishAgents.join(", ") || "no agent"} reported BEARISH evidence for the same asset.`,
      supporting_evidence_bullish: bullishAgents.map((name) => namedSummaries[name]),
      supporting_evidence_bearish: bearishAgents.map((name) => namedSummaries[name]),
      missing_information: missingAgents,
    },
  ];
}

// Scans ALL supplied summaries (not just the 4 specialists) — Trade
// Setup and Risk can each carry their own internal conflicts worth
// surfacing, even though they don't participate in the bias-vs-bias
// disagreement check above (they don't carry a `.bias` field at all —
// Trade Setup has `.direction`, Risk has `.risk_level`/`.risk_decision`).
function collectInternalConflicts(namedSummaries) {
  const internal = [];
  for (const [name, summary] of Object.entries(namedSummaries)) {
    if (summary && Array.isArray(summary.conflicts) && summary.conflicts.length > 0) {
      internal.push({ type: "INTERNAL_CONFLICT", domain: name, detail: summary.conflicts });
    }
  }
  return internal;
}

// Two distinct scopes, intentionally: cross-domain disagreement only
// ever makes sense among the 4 specialists (the only summaries with a
// comparable `.bias` field — passing Trade Setup/Risk in here would
// silently do nothing useful, since neither has one). Internal-conflict
// collection scans every supplied summary, specialists included.
function buildConflictingEvidence(specialistSummaries, allSummaries, finalAssessment) {
  return [
    ...explainCrossDomainDisagreement(specialistSummaries, finalAssessment),
    ...collectInternalConflicts(allSummaries),
  ];
}

module.exports = { explainCrossDomainDisagreement, collectInternalConflicts, buildConflictingEvidence };
