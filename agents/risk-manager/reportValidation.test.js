const test = require("node:test");
const assert = require("node:assert/strict");
const { validateReport } = require("./reportValidation");

function validTradeSetupReport() {
  return {
    agent_name: "trade-setup-agent",
    asset: "BTC",
    setup_status: "SETUP_PRESENT",
    direction: "BULLISH",
    conflicting_evidence: [],
    setup_quality: "HIGH",
    potential_levels: [],
    invalidation_conditions: [],
    confidence: "HIGH",
    uncertainties: [],
    warnings: [],
    sources: [],
  };
}

test("validateReport accepts a structurally valid trade-setup-agent report", () => {
  const result = validateReport(validTradeSetupReport(), "trade-setup-agent");
  assert.equal(result.valid, true, result.errors.join(", "));
});

test("validateReport rejects the wrong agent_name", () => {
  const report = { ...validTradeSetupReport(), agent_name: "news-agent" };
  const result = validateReport(report, "trade-setup-agent");
  assert.equal(result.valid, false);
});

test("validateReport rejects a report missing a required field", () => {
  const report = validTradeSetupReport();
  delete report.setup_status;
  const result = validateReport(report, "trade-setup-agent");
  assert.equal(result.valid, false);
});

test("validateReport never crashes on null/non-object input", () => {
  assert.equal(validateReport(null, "trade-setup-agent").valid, false);
  assert.equal(validateReport("nope", "trade-setup-agent").valid, false);
});
