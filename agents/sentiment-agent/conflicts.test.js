const test = require("node:test");
const assert = require("node:assert/strict");
const { detectSentimentConflicts } = require("./conflicts");

test("detectSentimentConflicts flags opposing BULLISH/BEARISH sentiment for the same asset, preserves both", () => {
  const a = { asset: "BTC", sentiment: "BULLISH", source: "A", verification_status: "UNVERIFIED" };
  const b = { asset: "BTC", sentiment: "BEARISH", source: "B", verification_status: "UNVERIFIED" };
  const conflicts = detectSentimentConflicts([a, b]);

  assert.equal(conflicts.length, 1);
  assert.equal(a.verification_status, "CONFLICTING");
  assert.equal(b.verification_status, "CONFLICTING");
  assert.equal(conflicts[0].records.length, 2);
});

test("detectSentimentConflicts does not flag agreeing sentiment", () => {
  const a = { asset: "BTC", sentiment: "BULLISH", source: "A", verification_status: "UNVERIFIED" };
  const b = { asset: "BTC", sentiment: "BULLISH", source: "B", verification_status: "UNVERIFIED" };
  const conflicts = detectSentimentConflicts([a, b]);
  assert.equal(conflicts.length, 0);
  assert.equal(a.verification_status, "UNVERIFIED");
});

test("detectSentimentConflicts does not flag different assets against each other", () => {
  const a = { asset: "BTC", sentiment: "BULLISH", source: "A", verification_status: "UNVERIFIED" };
  const b = { asset: "ETH", sentiment: "BEARISH", source: "B", verification_status: "UNVERIFIED" };
  const conflicts = detectSentimentConflicts([a, b]);
  assert.equal(conflicts.length, 0);
});

test("detectSentimentConflicts leaves a single unmatched record untouched", () => {
  const a = { asset: "BTC", sentiment: "BULLISH", source: "A", verification_status: "UNVERIFIED" };
  const conflicts = detectSentimentConflicts([a]);
  assert.equal(conflicts.length, 0);
  assert.equal(a.verification_status, "UNVERIFIED");
});
