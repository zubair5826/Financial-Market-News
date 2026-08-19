const test = require("node:test");
const assert = require("node:assert/strict");
const { detectConflicts } = require("./conflicts");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");

test("detectConflicts flags disagreeing sources for the same indicator/country/period, preserves both", () => {
  const a = { indicator: "CPI", indicator_code: "CPI", country: "US", period: "2026-07", actual_value: 3.2, source: "A", verification_status: "UNVERIFIED" };
  const b = { indicator: "CPI", indicator_code: "CPI", country: "US", period: "2026-07", actual_value: 3.5, source: "B", verification_status: "UNVERIFIED" };
  const conflicts = detectConflicts([a, b]);

  assert.equal(conflicts.length, 1);
  assert.equal(a.verification_status, SOURCE_VERIFICATION_STATES.CONFLICTING);
  assert.equal(b.verification_status, SOURCE_VERIFICATION_STATES.CONFLICTING);
  assert.equal(conflicts[0].records.length, 2);
});

test("detectConflicts upgrades agreeing UNVERIFIED sources to VERIFIED_SECONDARY", () => {
  const a = { indicator: "CPI", indicator_code: "CPI", country: "US", period: "2026-07", actual_value: 3.2, source: "A", verification_status: "UNVERIFIED" };
  const b = { indicator: "CPI", indicator_code: "CPI", country: "US", period: "2026-07", actual_value: 3.2, source: "B", verification_status: "UNVERIFIED" };
  const conflicts = detectConflicts([a, b]);

  assert.equal(conflicts.length, 0);
  assert.equal(a.verification_status, SOURCE_VERIFICATION_STATES.VERIFIED_SECONDARY);
});

test("detectConflicts leaves a single unmatched record untouched", () => {
  const a = { indicator: "CPI", indicator_code: "CPI", country: "US", period: "2026-07", actual_value: 3.2, source: "A", verification_status: "UNVERIFIED" };
  const conflicts = detectConflicts([a]);
  assert.equal(conflicts.length, 0);
  assert.equal(a.verification_status, SOURCE_VERIFICATION_STATES.UNVERIFIED);
});

test("detectConflicts does not group different indicators/countries/periods together", () => {
  const a = { indicator: "CPI", indicator_code: "CPI", country: "US", period: "2026-07", actual_value: 3.2, source: "A", verification_status: "UNVERIFIED" };
  const b = { indicator: "GDP", indicator_code: "GDP", country: "US", period: "2026-07", actual_value: 2.1, source: "B", verification_status: "UNVERIFIED" };
  const conflicts = detectConflicts([a, b]);
  assert.equal(conflicts.length, 0);
});
