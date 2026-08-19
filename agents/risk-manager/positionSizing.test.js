const test = require("node:test");
const assert = require("node:assert/strict");
const { calculatePositionSize } = require("./positionSizing");
const { UNKNOWN } = require("../../core/constants");

test("calculatePositionSize returns DATA_UNAVAILABLE with no parameters, never invents a size", () => {
  const result = calculatePositionSize({});
  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.equal(result.position_size, UNKNOWN);
  assert.equal(result.missing_parameters.length, 6);
});

test("calculatePositionSize returns DATA_UNAVAILABLE when only some parameters are supplied", () => {
  const result = calculatePositionSize({ accountBalance: 10000, riskPercentage: 0.01 });
  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.ok(result.missing_parameters.includes("leverage"));
  assert.ok(result.missing_parameters.includes("entryPrice"));
});

test("calculatePositionSize computes a deterministic size when every parameter is supplied", () => {
  const result = calculatePositionSize({
    accountBalance: 10000,
    riskPercentage: 0.01,
    leverage: 1,
    entryPrice: 100,
    stopPrice: 95,
    contractSize: 1,
  });
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.risk_amount, 100);
  assert.equal(result.units, 20);
  assert.equal(result.position_size, 20);
});

test("calculatePositionSize returns DATA_UNAVAILABLE when entryPrice equals stopPrice (zero per-unit risk)", () => {
  const result = calculatePositionSize({
    accountBalance: 10000,
    riskPercentage: 0.01,
    leverage: 1,
    entryPrice: 100,
    stopPrice: 100,
    contractSize: 1,
  });
  assert.equal(result.status, "DATA_UNAVAILABLE");
});

test("calculatePositionSize never assumes leverage even though it isn't used in the formula", () => {
  const result = calculatePositionSize({
    accountBalance: 10000,
    riskPercentage: 0.01,
    entryPrice: 100,
    stopPrice: 95,
    contractSize: 1,
  });
  assert.equal(result.status, "DATA_UNAVAILABLE");
  assert.ok(result.missing_parameters.includes("leverage"));
});
