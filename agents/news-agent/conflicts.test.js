const test = require("node:test");
const assert = require("node:assert/strict");
const { detectDuplicates } = require("./duplicates");
const { detectConflictingReports } = require("./conflicts");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");

test("detectConflictingReports flags disagreeing impact_direction within a likely-same-event group, preserves both", () => {
  const items = [
    {
      headline: "Company announces positive earnings",
      category: "earnings",
      related_assets: ["ACME"],
      source: "source-A",
      impact_direction: "POSITIVE",
      verification_status: "UNVERIFIED",
    },
    {
      headline: "Company reportedly missed expectations",
      category: "earnings",
      related_assets: ["ACME"],
      source: "source-B",
      impact_direction: "NEGATIVE",
      verification_status: "UNVERIFIED",
    },
  ];
  const groups = detectDuplicates(items);
  const conflicts = detectConflictingReports(items, groups);

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].items.length, 2);
  assert.ok(items.every((i) => i.verification_status === SOURCE_VERIFICATION_STATES.CONFLICTING));
});

test("detectConflictingReports does not flag a group with agreeing or untagged impact_direction", () => {
  const items = [
    { headline: "A", category: "earnings", related_assets: ["ACME"], impact_direction: "POSITIVE" },
    { headline: "B", category: "earnings", related_assets: ["ACME"], impact_direction: "POSITIVE" },
  ];
  const groups = detectDuplicates(items);
  const conflicts = detectConflictingReports(items, groups);
  assert.equal(conflicts.length, 0);
});
