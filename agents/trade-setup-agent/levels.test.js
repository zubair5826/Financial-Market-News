const test = require("node:test");
const assert = require("node:assert/strict");
const { deriveLevels, deriveInvalidationConditions } = require("./levels");

function technicalReportWithLevels() {
  return {
    support_levels: [{ level: 100, type: "SUPPORT", timeframe: "1h", evidence: [], strength: "MODERATE", confidence: "MEDIUM" }],
    resistance_levels: [{ level: 120, type: "RESISTANCE", timeframe: "1h", evidence: [], strength: "WEAK", confidence: "LOW" }],
  };
}

test("deriveLevels returns no levels and dataAvailable false without a technical report", () => {
  const levels = deriveLevels(null, "BULLISH");
  assert.equal(levels.dataAvailable, false);
  assert.deepEqual(levels.potential_levels, []);
});

test("deriveLevels never invents a price — every level traces back to the technical report's own numbers", () => {
  const levels = deriveLevels(technicalReportWithLevels(), "BULLISH");
  const allLevelValues = levels.potential_levels.map((l) => l.level);
  assert.ok(allLevelValues.every((v) => v === 100 || v === 120));
});

test("deriveLevels proposes SUPPORT levels for a BULLISH direction, not RESISTANCE", () => {
  const levels = deriveLevels(technicalReportWithLevels(), "BULLISH");
  assert.equal(levels.proposed.length, 1);
  assert.equal(levels.proposed[0].role, "SUPPORT");
  assert.equal(levels.proposed[0].level_type, "PROPOSED_SETUP_LEVEL");
});

test("deriveLevels proposes RESISTANCE levels for a BEARISH direction", () => {
  const levels = deriveLevels(technicalReportWithLevels(), "BEARISH");
  assert.equal(levels.proposed.length, 1);
  assert.equal(levels.proposed[0].role, "RESISTANCE");
});

test("deriveLevels observed levels always include both support and resistance regardless of direction", () => {
  const levels = deriveLevels(technicalReportWithLevels(), "BULLISH");
  assert.equal(levels.observed.length, 2);
});

test("deriveInvalidationConditions returns DATA_UNAVAILABLE with no technical report", () => {
  const levels = deriveLevels(null, "BULLISH");
  const conditions = deriveInvalidationConditions(levels, "BULLISH");
  assert.equal(conditions[0].condition, "DATA_UNAVAILABLE");
});

test("deriveInvalidationConditions never adds an invented offset to the observed level", () => {
  const levels = deriveLevels(technicalReportWithLevels(), "BULLISH");
  const conditions = deriveInvalidationConditions(levels, "BULLISH");
  assert.equal(conditions[0].level, 100);
  assert.equal(conditions[0].condition, "CLOSE_BELOW_LEVEL");
});
