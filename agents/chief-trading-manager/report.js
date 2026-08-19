// Builds the Chief Trading Manager's final report — the top-level
// decision-intelligence output for the user, per the Step 11 spec's
// explicit field list. No execution command, no order/broker field
// anywhere in this shape. final_assessment and decision_status are
// both decision-intelligence output only — never an execution
// instruction. See README.md.

const UNKNOWN = "UNKNOWN";

// Methodological assumptions this agent's own logic makes — never
// assumptions about market behavior or outcomes. Kept short and
// literal so nothing here could be mistaken for invented reasoning
// about the evidence itself.
function buildKeyAssumptions({ suppliedCount, validCount }) {
  const assumptions = [
    "Each input report's own confidence, classification, and verification ratings are trusted as computed by that agent — not independently re-verified here.",
    "The most recently supplied report per domain is used; this agent does not fetch or check for a newer one.",
    "Absence of a report is treated as absence of evidence, never as neutral or negative evidence.",
  ];
  if (suppliedCount !== validCount) {
    assumptions.push(
      `${suppliedCount - validCount} of ${suppliedCount} supplied report(s) failed structural validation and were treated as not supplied.`
    );
  }
  return assumptions;
}

function buildChiefReport(result) {
  return {
    agent_name: "chief-trading-manager",
    timestamp: result.timestamp,
    asset: result.asset || UNKNOWN,
    final_assessment: result.final_assessment,
    decision_status: result.decision_status,
    news_summary: result.news_summary,
    macro_summary: result.macro_summary,
    technical_summary: result.technical_summary,
    sentiment_summary: result.sentiment_summary,
    trade_setup_summary: result.trade_setup_summary,
    risk_summary: result.risk_summary,
    supporting_evidence: result.supporting_evidence,
    conflicting_evidence: result.conflicting_evidence,
    missing_information: result.missing_information,
    key_assumptions: buildKeyAssumptions({ suppliedCount: result.suppliedCount, validCount: result.validCount }),
    confidence: result.confidence,
    uncertainties: result.uncertainties,
    warnings: result.warnings,
    sources: result.sources,
  };
}

module.exports = { buildChiefReport, buildKeyAssumptions };
