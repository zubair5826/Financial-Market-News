const test = require("node:test");
const assert = require("node:assert/strict");
const { validateReport } = require("./reportValidation");

function validNewsReport() {
  return {
    agent_name: "news-agent",
    overall_news_bias: "BULLISH",
    confidence: "HIGH",
    uncertainties: [],
    conflicting_reports: [],
    warnings: [],
    sources: [],
  };
}

test("validateReport accepts a structurally valid report", () => {
  const result = validateReport(validNewsReport(), "news-agent");
  assert.equal(result.valid, true, result.errors.join(", "));
});

test("validateReport rejects the wrong agent_name", () => {
  const report = { ...validNewsReport(), agent_name: "macro-agent" };
  assert.equal(validateReport(report, "news-agent").valid, false);
});

test("validateReport rejects a report missing a required field", () => {
  const report = validNewsReport();
  delete report.overall_news_bias;
  assert.equal(validateReport(report, "news-agent").valid, false);
});

test("validateReport supports all six expected agent types", () => {
  const names = ["news-agent", "macro-agent", "technical-agent", "sentiment-agent", "trade-setup-agent", "risk-manager"];
  for (const name of names) {
    assert.doesNotThrow(() => validateReport({ agent_name: name }, name));
  }
});

test("validateReport never crashes on null/non-object input", () => {
  assert.equal(validateReport(null, "news-agent").valid, false);
  assert.equal(validateReport("nope", "news-agent").valid, false);
});
