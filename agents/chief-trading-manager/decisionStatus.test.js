const test = require("node:test");
const assert = require("node:assert/strict");
const { determineDecisionStatus, DECISION_STATUS, RECOGNISED_RISK_DECISIONS } = require("./decisionStatus");
const { RISK_DECISIONS } = require("../risk-manager/riskLevel");

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

// --- An unrecognised risk_decision fails closed (documented rules 2b/8) ---

const UNRECOGNISED_RISK_DECISIONS = ["RISK_OK", "risk_acceptable", "RISK_ACCEPTABLE ", "APPROVED", "", null, undefined, 7, {}];
const SETUP_STATUSES = ["SETUP_PRESENT", "SETUP_NOT_PRESENT", "INSUFFICIENT_DATA", "CONFLICTING_EVIDENCE", "DATA_UNAVAILABLE", "UNKNOWN"];

test("determineDecisionStatus: an unrecognised risk_decision with a present setup is NO_DECISION, never TRADE_SETUP_SUPPORTED", () => {
  for (const value of UNRECOGNISED_RISK_DECISIONS) {
    const result = determineDecisionStatus({ tradeSetupSummary: setup(), riskSummary: { risk_decision: value } });
    assert.equal(result, DECISION_STATUS.NO_DECISION, `risk_decision ${String(value)}`);
  }
});

test("determineDecisionStatus: an unrecognised risk_decision is NO_DECISION for every setup_status, not just SETUP_PRESENT", () => {
  for (const value of UNRECOGNISED_RISK_DECISIONS) {
    for (const status of SETUP_STATUSES) {
      const result = determineDecisionStatus({ tradeSetupSummary: setup({ setup_status: status }), riskSummary: { risk_decision: value } });
      assert.equal(result, DECISION_STATUS.NO_DECISION, `risk_decision ${String(value)} + ${status}`);
    }
  }
});

test("determineDecisionStatus: a risk summary with no risk_decision field at all is NO_DECISION", () => {
  assert.equal(determineDecisionStatus({ tradeSetupSummary: setup(), riskSummary: {} }), DECISION_STATUS.NO_DECISION);
});

test("determineDecisionStatus: RISK_TOO_HIGH still wins first and a missing risk summary still waits, unaffected by the new guard", () => {
  assert.equal(
    determineDecisionStatus({ tradeSetupSummary: null, riskSummary: risk({ risk_decision: "RISK_TOO_HIGH" }) }),
    DECISION_STATUS.HIGH_RISK_REVIEW_REQUIRED
  );
  assert.equal(determineDecisionStatus({ tradeSetupSummary: setup(), riskSummary: null }), DECISION_STATUS.WAIT_FOR_MORE_DATA);
  assert.equal(determineDecisionStatus({ tradeSetupSummary: setup(), riskSummary: undefined }), DECISION_STATUS.WAIT_FOR_MORE_DATA);
});

test("determineDecisionStatus: all five valid Risk Manager values x every setup_status keep their documented result", () => {
  const allSetups = (result) => Object.fromEntries(SETUP_STATUSES.map((status) => [status, result]));
  const expected = {
    RISK_ACCEPTABLE: {
      SETUP_PRESENT: "TRADE_SETUP_SUPPORTED",
      SETUP_NOT_PRESENT: "TRADE_SETUP_NOT_SUPPORTED",
      INSUFFICIENT_DATA: "WAIT_FOR_MORE_DATA",
      CONFLICTING_EVIDENCE: "WAIT_FOR_MORE_DATA",
      DATA_UNAVAILABLE: "WAIT_FOR_MORE_DATA",
      UNKNOWN: "NO_DECISION",
    },
    RISK_REQUIRES_REVIEW: {
      SETUP_PRESENT: "HIGH_RISK_REVIEW_REQUIRED",
      SETUP_NOT_PRESENT: "TRADE_SETUP_NOT_SUPPORTED",
      INSUFFICIENT_DATA: "WAIT_FOR_MORE_DATA",
      CONFLICTING_EVIDENCE: "WAIT_FOR_MORE_DATA",
      DATA_UNAVAILABLE: "WAIT_FOR_MORE_DATA",
      UNKNOWN: "NO_DECISION",
    },
    RISK_TOO_HIGH: allSetups("HIGH_RISK_REVIEW_REQUIRED"),
    INSUFFICIENT_DATA: allSetups("WAIT_FOR_MORE_DATA"),
    UNKNOWN: allSetups("WAIT_FOR_MORE_DATA"),
  };
  assert.deepEqual(Object.keys(expected).sort(), Object.values(RISK_DECISIONS).sort());
  for (const [decision, bySetup] of Object.entries(expected)) {
    for (const [status, want] of Object.entries(bySetup)) {
      const got = determineDecisionStatus({ tradeSetupSummary: setup({ setup_status: status }), riskSummary: { risk_decision: decision } });
      assert.equal(got, want, `${decision} + ${status}`);
    }
  }
});

test("RECOGNISED_RISK_DECISIONS stays identical to the Risk Manager's own RISK_DECISIONS enum", () => {
  assert.deepEqual([...RECOGNISED_RISK_DECISIONS].sort(), Object.values(RISK_DECISIONS).sort());
});
