const test = require("node:test");
const assert = require("node:assert/strict");
const { assessMacroRelevance, RELEVANCE_LEVELS } = require("./relevance");

test("assessMacroRelevance returns UNKNOWN with no requested asset", () => {
  assert.equal(assessMacroRelevance({ currency: "USD" }, undefined), RELEVANCE_LEVELS.UNKNOWN);
});

test("assessMacroRelevance returns UNKNOWN when the record has no country/region/currency", () => {
  assert.equal(assessMacroRelevance({}, "USD"), RELEVANCE_LEVELS.UNKNOWN);
});

test("assessMacroRelevance returns DIRECT when the record's currency matches the requested asset itself", () => {
  assert.equal(assessMacroRelevance({ currency: "USD" }, "USD"), RELEVANCE_LEVELS.DIRECT);
});

test("assessMacroRelevance returns DIRECT via an explicit assetCurrency option", () => {
  const level = assessMacroRelevance({ currency: "USD" }, "EURUSD", { assetCurrency: "USD" });
  assert.equal(level, RELEVANCE_LEVELS.DIRECT);
});

test("assessMacroRelevance never guesses a country/currency mapping on its own", () => {
  // No assetCountry supplied, so a country match alone can't be judged.
  const level = assessMacroRelevance({ country: "US" }, "AAPL");
  assert.equal(level, RELEVANCE_LEVELS.LOW);
});

test("assessMacroRelevance returns HIGH via an explicit assetCountry option", () => {
  const level = assessMacroRelevance({ country: "US" }, "AAPL", { assetCountry: "US" });
  assert.equal(level, RELEVANCE_LEVELS.HIGH);
});
