const test = require("node:test");
const assert = require("node:assert/strict");
const { assessTrend, TREND_STATES } = require("./trend");

test("assessTrend returns UNKNOWN when SMAs could not be calculated", () => {
  const trend = assessTrend({ currentPrice: 100, fastSMA: "UNKNOWN", slowSMA: 90 });
  assert.equal(trend, TREND_STATES.UNKNOWN);
});

test("assessTrend returns STRONG_UPTREND when price > fastSMA > slowSMA and structure confirms", () => {
  const trend = assessTrend({ currentPrice: 110, fastSMA: 105, slowSMA: 100, marketStructure: "HIGHER_HIGH" });
  assert.equal(trend, TREND_STATES.STRONG_UPTREND);
});

test("assessTrend returns UPTREND when price > fastSMA > slowSMA without structure confirmation", () => {
  const trend = assessTrend({ currentPrice: 110, fastSMA: 105, slowSMA: 100, marketStructure: "UNKNOWN" });
  assert.equal(trend, TREND_STATES.UPTREND);
});

test("assessTrend returns STRONG_DOWNTREND when price < fastSMA < slowSMA and structure confirms", () => {
  const trend = assessTrend({ currentPrice: 90, fastSMA: 95, slowSMA: 100, marketStructure: "LOWER_LOW" });
  assert.equal(trend, TREND_STATES.STRONG_DOWNTREND);
});

test("assessTrend returns SIDEWAYS when price/SMA order is inconsistent", () => {
  const trend = assessTrend({ currentPrice: 100, fastSMA: 105, slowSMA: 95 });
  assert.equal(trend, TREND_STATES.SIDEWAYS);
});

test("assessTrend never invents a trend from a hunch — only these three inputs decide it", () => {
  const trendA = assessTrend({ currentPrice: 100, fastSMA: 100, slowSMA: 100 });
  assert.equal(trendA, TREND_STATES.SIDEWAYS);
});
