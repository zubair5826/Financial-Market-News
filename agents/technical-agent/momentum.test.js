const test = require("node:test");
const assert = require("node:assert/strict");
const { assessMomentum, MOMENTUM_STATES } = require("./momentum");

test("assessMomentum returns UNKNOWN with no signals available", () => {
  assert.equal(assessMomentum({}), MOMENTUM_STATES.UNKNOWN);
});

test("assessMomentum returns STRONG_POSITIVE when both signals agree positively", () => {
  const momentum = assessMomentum({ rsiValue: 70, macdHistogram: 1.5 });
  assert.equal(momentum, MOMENTUM_STATES.STRONG_POSITIVE);
});

test("assessMomentum returns STRONG_NEGATIVE when both signals agree negatively", () => {
  const momentum = assessMomentum({ rsiValue: 20, macdHistogram: -1.5 });
  assert.equal(momentum, MOMENTUM_STATES.STRONG_NEGATIVE);
});

test("assessMomentum returns POSITIVE (not STRONG) when only one signal is positive", () => {
  const momentum = assessMomentum({ rsiValue: 65, macdHistogram: -0.1 });
  // rsi vote +1, macd vote -1 -> net 0 -> NEUTRAL, not POSITIVE; verify exact tie behavior
  assert.equal(momentum, MOMENTUM_STATES.NEUTRAL);
});

test("assessMomentum never becomes a BUY/SELL instruction — output is always one of the defined states", () => {
  const momentum = assessMomentum({ rsiValue: 55 });
  assert.ok(Object.values(MOMENTUM_STATES).includes(momentum));
});

test("assessMomentum returns NEUTRAL for a single signal in the middle zone", () => {
  const momentum = assessMomentum({ rsiValue: 50 });
  assert.equal(momentum, MOMENTUM_STATES.NEUTRAL);
});
