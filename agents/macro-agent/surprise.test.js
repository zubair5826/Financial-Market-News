const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateSurprise, SURPRISE_STATES } = require("./surprise");
const { UNKNOWN } = require("../../core/constants");

test("calculateSurprise returns UNKNOWN when expected_value is missing", () => {
  const result = calculateSurprise({ actual_value: 3.2, expected_value: UNKNOWN });
  assert.equal(result.surprise_direction, SURPRISE_STATES.UNKNOWN);
  assert.equal(result.surprise_value, UNKNOWN);
});

test("calculateSurprise returns UNKNOWN when actual_value is missing", () => {
  const result = calculateSurprise({ actual_value: UNKNOWN, expected_value: 3.0 });
  assert.equal(result.surprise_direction, SURPRISE_STATES.UNKNOWN);
});

test("calculateSurprise identifies ABOVE_EXPECTATION", () => {
  const result = calculateSurprise({ actual_value: 3.5, expected_value: 3.0 });
  assert.equal(result.surprise_direction, SURPRISE_STATES.ABOVE_EXPECTATION);
  assert.ok(result.surprise_value > 0);
});

test("calculateSurprise identifies BELOW_EXPECTATION", () => {
  const result = calculateSurprise({ actual_value: 2.5, expected_value: 3.0 });
  assert.equal(result.surprise_direction, SURPRISE_STATES.BELOW_EXPECTATION);
  assert.ok(result.surprise_value < 0);
});

test("calculateSurprise identifies IN_LINE on an exact match", () => {
  const result = calculateSurprise({ actual_value: 3.0, expected_value: 3.0 });
  assert.equal(result.surprise_direction, SURPRISE_STATES.IN_LINE);
  assert.equal(result.surprise_value, 0);
});

test("calculateSurprise respects a configured tolerance band", () => {
  const result = calculateSurprise({ actual_value: 3.01, expected_value: 3.0 }, { inLineToleranceRatio: 0.05 });
  assert.equal(result.surprise_direction, SURPRISE_STATES.IN_LINE);
});
