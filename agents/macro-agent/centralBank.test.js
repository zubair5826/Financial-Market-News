const test = require("node:test");
const assert = require("node:assert/strict");
const { processCentralBankEvents, buildCentralBankAssessment, deriveOverallPolicyDirection } = require("./centralBank");

test("processCentralBankEvents accepts a valid event", () => {
  const { validated, rejected } = processCentralBankEvents([{ central_bank: "Federal Reserve", policy_direction: "HAWKISH" }]);
  assert.equal(validated.length, 1);
  assert.equal(rejected.length, 0);
  assert.equal(validated[0].policy_direction, "HAWKISH");
});

test("processCentralBankEvents rejects an event with no central_bank named", () => {
  const { validated, rejected } = processCentralBankEvents([{ decision: "hold" }]);
  assert.equal(validated.length, 0);
  assert.equal(rejected.length, 1);
});

test("processCentralBankEvents never infers policy_direction — it stays UNKNOWN unless tagged", () => {
  const { validated } = processCentralBankEvents([{ central_bank: "ECB", guidance: "will consider all incoming data" }]);
  assert.equal(validated[0].policy_direction, "UNKNOWN");
});

test("deriveOverallPolicyDirection returns MIXED when hawkish and dovish events both present", () => {
  const events = [{ policy_direction: "HAWKISH" }, { policy_direction: "DOVISH" }];
  assert.equal(deriveOverallPolicyDirection(events), "MIXED");
});

test("buildCentralBankAssessment returns UNKNOWN overall direction for no events", () => {
  const assessment = buildCentralBankAssessment([]);
  assert.equal(assessment.overall_policy_direction, "UNKNOWN");
  assert.deepEqual(assessment.events, []);
});
