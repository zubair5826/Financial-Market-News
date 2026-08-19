const test = require("node:test");
const assert = require("node:assert/strict");
const { reconcileSources, SOURCE_VERIFICATION_STATES } = require("../core/verification");

test("reconcileSources flags CONFLICTING when two sources disagree", () => {
  const a = { asset: "TEST", data_type: "price", value: 100, source: "A" };
  const b = { asset: "TEST", data_type: "price", value: 105, source: "B" };
  const result = reconcileSources(a, b);
  assert.equal(result.status, SOURCE_VERIFICATION_STATES.CONFLICTING);
});

test("reconcileSources never discards either source on conflict", () => {
  const a = { asset: "X", data_type: "price", value: 1, source: "A" };
  const b = { asset: "X", data_type: "price", value: 2, source: "B" };
  const result = reconcileSources(a, b);
  assert.deepEqual(result.records, [a, b]);
});

test("reconcileSources marks agreement as VERIFIED_SECONDARY", () => {
  const a = { asset: "X", data_type: "price", value: 50, source: "A" };
  const b = { asset: "X", data_type: "price", value: 50, source: "B" };
  const result = reconcileSources(a, b);
  assert.equal(result.status, SOURCE_VERIFICATION_STATES.VERIFIED_SECONDARY);
});

test("reconcileSources returns UNKNOWN when one side is missing", () => {
  const a = { asset: "X", data_type: "price", value: 1, source: "A" };
  const result = reconcileSources(a, undefined);
  assert.equal(result.status, SOURCE_VERIFICATION_STATES.UNKNOWN);
});

test("reconcileSources throws if records are for different assets", () => {
  const a = { asset: "X", data_type: "price", value: 1, source: "A" };
  const b = { asset: "Y", data_type: "price", value: 1, source: "B" };
  assert.throws(() => reconcileSources(a, b));
});
