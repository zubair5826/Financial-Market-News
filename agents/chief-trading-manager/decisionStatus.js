// Decision status — the ACTIONABILITY verdict, kept deliberately
// separate from final_assessment (what the specialist evidence says
// about direction). This is decision-intelligence output ONLY: no
// state here ever becomes a broker/exchange instruction.
//
// Documented, deterministic rule, checked in this exact order:
//
//   1. RISK OVERRIDE (absolute, checked first, per the spec's explicit
//      emphasis): if the Risk Manager's risk_decision is
//      RISK_TOO_HIGH, decision_status is ALWAYS
//      HIGH_RISK_REVIEW_REQUIRED — never overridden by how bullish or
//      bearish the specialist evidence looks.
//   2. No Risk Manager report supplied, or its own risk_decision is
//      INSUFFICIENT_DATA/UNKNOWN: we don't know the risk yet, so we
//      cannot responsibly support a trade -> WAIT_FOR_MORE_DATA.
//   3. No Trade Setup report supplied, or its setup_status is
//      DATA_UNAVAILABLE/INSUFFICIENT_DATA -> WAIT_FOR_MORE_DATA.
//   4. Trade Setup's setup_status is CONFLICTING_EVIDENCE ->
//      WAIT_FOR_MORE_DATA (contradictory setup-level signals — more
//      evidence could resolve it).
//   5. Trade Setup's setup_status is SETUP_NOT_PRESENT ->
//      TRADE_SETUP_NOT_SUPPORTED.
//   6. Trade Setup's setup_status is SETUP_PRESENT and Risk Manager's
//      risk_decision is RISK_REQUIRES_REVIEW -> HIGH_RISK_REVIEW_REQUIRED
//      (elevated risk still blocks an automatic "supported" verdict).
//   7. Trade Setup's setup_status is SETUP_PRESENT and Risk Manager's
//      risk_decision is RISK_ACCEPTABLE -> TRADE_SETUP_SUPPORTED.
//   8. Anything not covered above -> NO_DECISION.

const DECISION_STATUS = Object.freeze({
  TRADE_SETUP_SUPPORTED: "TRADE_SETUP_SUPPORTED",
  TRADE_SETUP_NOT_SUPPORTED: "TRADE_SETUP_NOT_SUPPORTED",
  WAIT_FOR_MORE_DATA: "WAIT_FOR_MORE_DATA",
  HIGH_RISK_REVIEW_REQUIRED: "HIGH_RISK_REVIEW_REQUIRED",
  NO_DECISION: "NO_DECISION",
});

function determineDecisionStatus({ tradeSetupSummary, riskSummary }) {
  if (riskSummary && riskSummary.risk_decision === "RISK_TOO_HIGH") {
    return DECISION_STATUS.HIGH_RISK_REVIEW_REQUIRED;
  }

  if (!riskSummary || riskSummary.risk_decision === "INSUFFICIENT_DATA" || riskSummary.risk_decision === "UNKNOWN") {
    return DECISION_STATUS.WAIT_FOR_MORE_DATA;
  }

  if (!tradeSetupSummary || tradeSetupSummary.setup_status === "DATA_UNAVAILABLE" || tradeSetupSummary.setup_status === "INSUFFICIENT_DATA") {
    return DECISION_STATUS.WAIT_FOR_MORE_DATA;
  }

  if (tradeSetupSummary.setup_status === "CONFLICTING_EVIDENCE") {
    return DECISION_STATUS.WAIT_FOR_MORE_DATA;
  }

  if (tradeSetupSummary.setup_status === "SETUP_NOT_PRESENT") {
    return DECISION_STATUS.TRADE_SETUP_NOT_SUPPORTED;
  }

  if (tradeSetupSummary.setup_status === "SETUP_PRESENT") {
    return riskSummary.risk_decision === "RISK_REQUIRES_REVIEW"
      ? DECISION_STATUS.HIGH_RISK_REVIEW_REQUIRED
      : DECISION_STATUS.TRADE_SETUP_SUPPORTED;
  }

  return DECISION_STATUS.NO_DECISION;
}

module.exports = { DECISION_STATUS, determineDecisionStatus };
