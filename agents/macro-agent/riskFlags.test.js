const test = require("node:test");
const assert = require("node:assert/strict");
const { detectRiskFlags, MACRO_RISK_FLAGS } = require("./riskFlags");

test("detectRiskFlags flags HIGH_INFLATION_RISK on an above-expectation INFLATION record", () => {
  const records = [{ category: "INFLATION", surprise_direction: "ABOVE_EXPECTATION", freshness_status: "FRESH" }];
  const flags = detectRiskFlags(records, [], []);
  assert.ok(flags.includes(MACRO_RISK_FLAGS.HIGH_INFLATION_RISK));
});

test("detectRiskFlags flags DATA_CONFLICT and DATA_STALE from evidence, not assumption", () => {
  const records = [{ category: "OTHER", freshness_status: "STALE" }];
  const conflicts = [{ indicator: "CPI" }];
  const flags = detectRiskFlags(records, [], conflicts);
  assert.ok(flags.includes(MACRO_RISK_FLAGS.DATA_CONFLICT));
  assert.ok(flags.includes(MACRO_RISK_FLAGS.DATA_STALE));
});

test("detectRiskFlags never activates RECESSION_RISK or GEOPOLITICAL_MACRO_RISK on its own", () => {
  const records = [
    { category: "GDP", surprise_direction: "BELOW_EXPECTATION", freshness_status: "FRESH" },
    { category: "EMPLOYMENT", surprise_direction: "BELOW_EXPECTATION", freshness_status: "FRESH" },
  ];
  const flags = detectRiskFlags(records, [], []);
  assert.equal(flags.includes(MACRO_RISK_FLAGS.RECESSION_RISK), false);
  assert.equal(flags.includes(MACRO_RISK_FLAGS.GEOPOLITICAL_MACRO_RISK), false);
});

test("detectRiskFlags flags CENTRAL_BANK_RISK and POLICY_UNCERTAINTY only from tagged evidence", () => {
  const events = [{ policy_direction: "HAWKISH", uncertainty: "elevated" }];
  const flags = detectRiskFlags([], events, []);
  assert.ok(flags.includes(MACRO_RISK_FLAGS.CENTRAL_BANK_RISK));
  assert.ok(flags.includes(MACRO_RISK_FLAGS.POLICY_UNCERTAINTY));
});

test("detectRiskFlags returns no flags when there is no supporting evidence", () => {
  const flags = detectRiskFlags([{ category: "OTHER", freshness_status: "FRESH" }], [], []);
  assert.deepEqual(flags, []);
});
