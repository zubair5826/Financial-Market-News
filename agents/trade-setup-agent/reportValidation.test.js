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
    sources: ["source-A"],
  };
}

test("validateReport accepts a structurally valid news-agent report", () => {
  const result = validateReport(validNewsReport(), "news-agent");
  assert.equal(result.valid, true, result.errors.join(", "));
});

test("validateReport rejects a report with the wrong agent_name", () => {
  const report = { ...validNewsReport(), agent_name: "macro-agent" };
  const result = validateReport(report, "news-agent");
  assert.equal(result.valid, false);
});

test("validateReport rejects a report missing a required field", () => {
  const report = validNewsReport();
  delete report.overall_news_bias;
  const result = validateReport(report, "news-agent");
  assert.equal(result.valid, false);
});

test("validateReport rejects null/non-object input safely, never crashes", () => {
  assert.equal(validateReport(null, "news-agent").valid, false);
  assert.equal(validateReport("not a report", "news-agent").valid, false);
  assert.equal(validateReport(undefined, "news-agent").valid, false);
});
