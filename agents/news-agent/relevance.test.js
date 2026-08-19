const test = require("node:test");
const assert = require("node:assert/strict");
const { assessRelevance, RELEVANCE_LEVELS } = require("./relevance");

test("assessRelevance returns UNKNOWN when no requested asset is given", () => {
  assert.equal(assessRelevance({ related_assets: ["BTC"] }, undefined), RELEVANCE_LEVELS.UNKNOWN);
});

test("assessRelevance returns UNKNOWN when the item has no asset/market/category evidence", () => {
  assert.equal(assessRelevance({}, "BTC"), RELEVANCE_LEVELS.UNKNOWN);
});

test("assessRelevance returns DIRECT when related_assets names the requested asset", () => {
  assert.equal(assessRelevance({ related_assets: ["BTC", "ETH"] }, "BTC"), RELEVANCE_LEVELS.DIRECT);
});

test("assessRelevance returns INDIRECT for a related_markets match with no direct asset match", () => {
  assert.equal(assessRelevance({ related_assets: ["ETH"], related_markets: ["crypto"] }, "BTC"), RELEVANCE_LEVELS.INDIRECT);
});

test("assessRelevance returns MACRO for a macro category with no asset/market match", () => {
  assert.equal(assessRelevance({ category: "macro" }, "BTC"), RELEVANCE_LEVELS.MACRO);
});

test("assessRelevance returns LOW_RELEVANCE when tagged data doesn't connect to the asset", () => {
  assert.equal(assessRelevance({ related_assets: ["ETH"], category: "sports" }, "BTC"), RELEVANCE_LEVELS.LOW_RELEVANCE);
});

test("assessRelevance returns LOW_RELEVANCE for any unrelated category when no sectorCategories are configured", () => {
  assert.equal(assessRelevance({ category: "sports" }, "BTC"), RELEVANCE_LEVELS.LOW_RELEVANCE);
});

test("assessRelevance returns SECTOR only when the category is explicitly configured as relevant", () => {
  const level = assessRelevance({ category: "technology" }, "AAPL", { sectorCategories: ["technology"] });
  assert.equal(level, RELEVANCE_LEVELS.SECTOR);
});
