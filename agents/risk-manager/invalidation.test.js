const test = require("node:test");
const assert = require("node:assert/strict");
const { assessInvalidation } = require("./invalidation");

test("assessInvalidation returns DATA_UNAVAILABLE with no trade setup report", () => {
  const result = assessInvalidation(null);
  assert.equal(result.status, "DATA_UNAVAILABLE");
});

test("assessInvalidation returns DATA_UNAVAILABLE when the setup itself has no real levels", () => {
  const result = assessInvalidation({ invalidation_conditions: [{ condition: "DATA_UNAVAILABLE", reason: "no levels" }] });
  assert.equal(result.status, "DATA_UNAVAILABLE");
});

test("assessInvalidation returns AVAILABLE and passes real conditions through unchanged, no invented level", () => {
  const conditions = [{ condition: "CLOSE_BELOW_LEVEL", level: 100, level_type: "PROPOSED_SETUP_LEVEL" }];
  const result = assessInvalidation({ invalidation_conditions: conditions });
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.conditions[0].level, 100);
});
