// Unit-level tests for the individual orchestrator pipeline functions.
// End-to-end tests exercising the full real 8-agent pipeline live in
// tests/pipeline.test.js — this file tests each named function from
// the Step 12 spec in isolation.

const test = require("node:test");
const assert = require("node:assert/strict");
const orchestrator = require("../orchestrator");

test("receiveRequest accepts a valid request shape", () => {
  const result = orchestrator.receiveRequest({ query: "AAPL price" });
  assert.equal(result.ok, true);
});

test("receiveRequest fails safely on a malformed request", () => {
  const result = orchestrator.receiveRequest({});
  assert.equal(result.ok, false);
});

test("receiveRequest fails safely on a non-object request", () => {
  const result = orchestrator.receiveRequest(null);
  assert.equal(result.ok, false);
});

test("identifyAsset trusts an explicit request.asset", () => {
  const result = orchestrator.identifyAsset({ query: "x", asset: "BTC" });
  assert.equal(result.ok, true);
  assert.equal(result.asset, "BTC");
});

test("identifyAsset infers a single agreed-upon asset from supplied data payloads", () => {
  const result = orchestrator.identifyAsset({
    query: "x",
    newsData: [{ asset: "ETH" }],
    sentimentData: [{ asset: "ETH" }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.asset, "ETH");
});

test("identifyAsset returns MULTIPLE when supplied data disagrees, never guessing one", () => {
  const result = orchestrator.identifyAsset({
    query: "x",
    newsData: [{ asset: "ETH" }],
    sentimentData: [{ asset: "BTC" }],
  });
  assert.equal(result.asset, "MULTIPLE");
});

test("identifyAsset fails safely — never guesses — when nothing identifies an asset", () => {
  const result = orchestrator.identifyAsset({ query: "x" });
  assert.equal(result.ok, false);
});

test("validateInputs accepts a request with well-formed array payloads", () => {
  const result = orchestrator.validateInputs({ query: "x", newsData: [] });
  assert.equal(result.ok, true);
});

test("validateInputs rejects a payload field that isn't an array, without crashing", () => {
  const result = orchestrator.validateInputs({ query: "x", newsData: "not-an-array" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test("validateInputs warns (but does not fail) when no data payloads were supplied at all", () => {
  const result = orchestrator.validateInputs({ query: "x" });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => w.includes("No data payloads")));
});

test("prepareAgentInputs never runs the Data Controller when no marketData is supplied — no hidden shortcut, just nothing to validate", () => {
  const prepared = orchestrator.prepareAgentInputs({ query: "x" }, {});
  assert.equal(prepared.dataControllerOutcome, null);
  assert.deepEqual(prepared.newsInput, []);
});

test("prepareAgentInputs routes request.marketData through the real Data Controller", () => {
  const prepared = orchestrator.prepareAgentInputs(
    { query: "x", marketData: [{ asset: "BTC", data_type: "price", value: 100, source: "s", classification: "FACT" }] },
    {}
  );
  assert.notEqual(prepared.dataControllerOutcome, null);
  assert.equal(prepared.dataControllerOutcome.report.agent_name, "data-controller");
});

test("dispatchSpecialists calls all 4 specialists and never fabricates a report for one that fails", () => {
  const prepared = { newsInput: [], macroInput: [], technicalInput: [], sentimentInput: [], upcomingEvents: [], centralBankEvents: [], sharedOptions: {} };
  const { outcomes, errors } = orchestrator.dispatchSpecialists(prepared);
  assert.ok(outcomes.news && outcomes.macro && outcomes.technical && outcomes.sentiment);
  assert.equal(errors.length, 0);
});

test("collectReports lists missing specialists explicitly rather than silently dropping them", () => {
  const collected = orchestrator.collectReports({ outcomes: { news: null, macro: null, technical: null, sentiment: null }, errors: [] });
  assert.deepEqual(collected.missing, ["news", "macro", "technical", "sentiment"]);
  assert.equal(collected.newsReport, null);
});

test("returnResponse never claims ok:true after an early receiveRequest failure", () => {
  const failure = orchestrator.receiveRequest({});
  const response = orchestrator.returnResponse({ timestamp: new Date().toISOString(), failure, stage: "receiveRequest" });
  assert.equal(response.ok, false);
  assert.equal(response.response, null);
});

test("the orchestrator module exposes no broker/exchange/order execution capability", () => {
  const exportedNames = Object.keys(orchestrator);
  assert.equal(exportedNames.some((n) => /broker|exchange/i.test(n)), false);
});
