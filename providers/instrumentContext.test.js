// Offline tests for the centralized Instrument/Request Context —
// Step 99. Pure logic, no network access, no provider.

const test = require("node:test");
const assert = require("node:assert/strict");
const { UNKNOWN, normalizeSymbol, resolveInstrumentContext, symbolsMatch } = require("./instrumentContext");

// 4. Request symbol normalization.
test("4. resolveInstrumentContext trims and preserves the requested symbol, normalizing separately", () => {
  const ctx = resolveInstrumentContext({ query: "Assess BTC", asset: "  btc  " });
  assert.equal(ctx.requestedSymbol, "btc");
  assert.equal(ctx.normalizedSymbol, "BTC");
});

// 5. Case normalization.
test("5. normalizeSymbol/symbolsMatch are case-insensitive", () => {
  assert.equal(normalizeSymbol("btc"), "BTC");
  assert.equal(normalizeSymbol("Btc"), "BTC");
  assert.ok(symbolsMatch("spy", "SPY"));
  assert.ok(symbolsMatch("BTC", "btc"));
  assert.ok(!symbolsMatch("BTC", "SPY"));
});

test("no explicit request.asset resolves to UNKNOWN, never guessed from query text", () => {
  const ctx = resolveInstrumentContext({ query: "Assess BTC" });
  assert.equal(ctx.requestedSymbol, UNKNOWN);
  assert.equal(ctx.normalizedSymbol, UNKNOWN);
});

test("symbolsMatch never treats two UNKNOWN/non-string values as a match", () => {
  assert.equal(symbolsMatch(UNKNOWN, UNKNOWN), false);
  assert.equal(symbolsMatch(undefined, "SPY"), false);
  assert.equal(symbolsMatch("SPY", undefined), false);
  assert.equal(symbolsMatch(null, null), false);
});

test("resolveInstrumentContext never mutates the caller's request or options", () => {
  const request = { query: "Assess BTC", asset: "BTC" };
  const options = { timeframes: ["1day"], domains: ["technical"] };
  const requestSnapshot = JSON.parse(JSON.stringify(request));
  const optionsSnapshot = JSON.parse(JSON.stringify(options));
  resolveInstrumentContext(request, options);
  assert.deepEqual(request, requestSnapshot);
  assert.deepEqual(options, optionsSnapshot);
});

test("resolveInstrumentContext carries through explicit timeframes/domains without inventing any", () => {
  const ctx = resolveInstrumentContext({ asset: "SPY" }, { timeframes: ["1day"], domains: ["technical", "news"] });
  assert.deepEqual(ctx.requestedTimeframes, ["1day"]);
  assert.deepEqual(ctx.requestedDomains, ["technical", "news"]);
});

test("resolveInstrumentContext defaults timeframes/domains to empty arrays when not supplied", () => {
  const ctx = resolveInstrumentContext({ asset: "SPY" });
  assert.deepEqual(ctx.requestedTimeframes, []);
  assert.deepEqual(ctx.requestedDomains, []);
});
