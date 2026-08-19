const test = require("node:test");
const assert = require("node:assert/strict");
const { determineDecisionStatus, DECISION_STATUS } = require("./decisionStatus");

function setup(overrides = {}) {
  return { setup_status: "SETUP_PRESENT", ...overrides };
}
function risk(overrides = {}) {
  return { risk_decision: "RISK_ACCEPTABLE", ...overrides };
}

test("determineDecisionStatus: RISK_TOO_HIGH is an absolute override regardless of setup status", () => {
  const result = determineDecisionStatus({ tradeSetupSummary: setup(), riskSummary: risk({ risk_decision: "RISK_TOO_HIGH" }) });
  assert.equal(result, DECISION_STATUS.HIGH_RISK_REVIEW_REQUIRED);
});

test("determineDecisionStatus: RISK_TOO_HIGH overrides even a SETUP_PRESENT + otherwise-clean setup", () => {
  const result = determineDecisionStatus({
    tradeSetupSummary: setup({ setup_status: "SETUP_PRESENT" }),
    riskSummary: risk({ risk_decision: "RISK_TOO_HIGH" }),
  });
  assert.equal(result, DECISION_STATUS.HIGH_RISK_REVIEW_REQUIRED);
});

test("determineDecisionStatus: no risk report or unknown risk waits for more data", () => {
  assert.equal(determineDecisionStatus({ tradeSetupSummary: setup(), riskSummary: null }), DECISION_STATUS.WAIT_FOR_MORE_DATA);
  assert.equal(
    determineDecisionStatus({ tradeSetupSummary: setup(), riskSummary: risk({ risk_decision: "UNKNOWN" }) }),
    DECISION_STATUS.WAIT_FOR_MORE_DATA
  );
});

test("determineDecisionStatus: no trade setup or an unresolved setup waits for more data", () => {
  assert.equal(determineDecisionStatus({ tradeSetupSummary: null, riskSummary: risk() }), DECISION_STATUS.WAIT_FOR_MORE_DATA);
  assert.equal(
    determineDecisionStatus({ tradeSetupSummary: setup({ setup_status: "INSUFFICIENT_DATA" }), riskSummary: risk() }),
    DECISION_STATUS.WAIT_FOR_MORE_DATA
  );
  assert.equal(
    determineDecisionStatus({ tradeSetupSummary: setup({ setup_status: "CONFLICTING_EVIDENCE" }), riskSummary: risk() }),
    DECISION_STATUS.WAIT_FOR_MORE_DATA
  );
});

test("determineDecisionStatus: SETUP_NOT_PRESENT maps to TRADE_SETUP_NOT_SUPPORTED", () => {
  const result = determineDecisionStatus({ tradeSetupSummary: setup({ setup_status: "SETUP_NOT_PRESENT" }), riskSummary: risk() });
  assert.equal(result, DECISION_STATUS.TRADE_SETUP_NOT_SUPPORTED);
});

test("determineDecisionStatus: SETUP_PRESENT + RISK_REQUIRES_REVIEW still requires review, not automatic support", () => {
  const result = determineDecisionStatus({ tradeSetupSummary: setup(), riskSummary: risk({ risk_decision: "RISK_REQUIRES_REVIEW" }) });
  assert.equal(result, DECISION_STATUS.HIGH_RISK_REVIEW_REQUIRED);
});

test("determineDecisionStatus: SETUP_PRESENT + RISK_ACCEPTABLE supports the trade setup", () => {
  const result = determineDecisionStatus({ tradeSetupSummary: setup(), riskSummary: risk() });
  assert.equal(result, DECISION_STATUS.TRADE_SETUP_SUPPORTED);
});

test("determineDecisionStatus never returns a value resembling an execution order", () => {
  const result = determineDecisionStatus({ tradeSetupSummary: setup(), riskSummary: risk() });
  assert.equal(/BUY|SELL|LONG|SHORT/i.test(result), false);
});
