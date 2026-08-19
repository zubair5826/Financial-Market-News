const test = require("node:test");
const assert = require("node:assert/strict");
const { detectDuplicates } = require("./duplicates");

test("detectDuplicates groups items sharing related_assets and category", () => {
  const items = [
    { headline: "Fed holds rates steady", category: "monetary-policy", related_assets: ["USD"] },
    { headline: "Fed keeps interest rates unchanged", category: "monetary-policy", related_assets: ["USD"] },
  ];
  const groups = detectDuplicates(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 2);
});

test("detectDuplicates does not group unrelated items", () => {
  const items = [
    { headline: "Fed holds rates steady", category: "monetary-policy", related_assets: ["USD"] },
    { headline: "Local team wins championship", category: "sports", related_assets: ["N/A"] },
  ];
  const groups = detectDuplicates(items);
  assert.equal(groups.length, 0);
});

test("detectDuplicates never deletes or mutates the original items array contents", () => {
  const items = [
    { headline: "Fed holds rates steady", category: "monetary-policy", related_assets: ["USD"] },
    { headline: "Fed keeps interest rates unchanged", category: "monetary-policy", related_assets: ["USD"] },
  ];
  const originalLength = items.length;
  detectDuplicates(items);
  assert.equal(items.length, originalLength);
  assert.equal(items[0].headline, "Fed holds rates steady");
  assert.equal(items[1].headline, "Fed keeps interest rates unchanged");
});
