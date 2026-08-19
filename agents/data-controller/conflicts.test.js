const test = require("node:test");
const assert = require("node:assert/strict");
const { detectConflicts } = require("./conflicts");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");

test("detectConflicts flags disagreeing sources for the same asset/data_type and preserves both", () => {
  const a = { asset: "BTC", data_type: "price", value: 50000, source: "A", verification_status: "UNVERIFIED" };
  const b = { asset: "BTC", data_type: "price", value: 51000, source: "B", verification_status: "UNVERIFIED" };
  const conflicts = detectConflicts([a, b]);

  assert.equal(conflicts.length, 1);
  assert.equal(a.verification_status, SOURCE_VERIFICATION_STATES.CONFLICTING);
  assert.equal(b.verification_status, SOURCE_VERIFICATION_STATES.CONFLICTING);
  assert.equal(conflicts[0].records.length, 2);
});

test("detectConflicts upgrades agreeing UNVERIFIED sources to VERIFIED_SECONDARY", () => {
  const a = { asset: "BTC", data_type: "price", value: 50000, source: "A", verification_status: "UNVERIFIED" };
  const b = { asset: "BTC", data_type: "price", value: 50000, source: "B", verification_status: "UNVERIFIED" };
  const conflicts = detectConflicts([a, b]);

  assert.equal(conflicts.length, 0);
  assert.equal(a.verification_status, SOURCE_VERIFICATION_STATES.VERIFIED_SECONDARY);
  assert.equal(b.verification_status, SOURCE_VERIFICATION_STATES.VERIFIED_SECONDARY);
});

test("detectConflicts leaves a single unmatched record untouched", () => {
  const a = { asset: "BTC", data_type: "price", value: 50000, source: "A", verification_status: "UNVERIFIED" };
  const conflicts = detectConflicts([a]);
  assert.equal(conflicts.length, 0);
  assert.equal(a.verification_status, SOURCE_VERIFICATION_STATES.UNVERIFIED);
});
