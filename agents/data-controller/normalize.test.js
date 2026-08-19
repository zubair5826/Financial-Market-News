const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRecord } = require("./normalize");
const { UNKNOWN } = require("../../core/constants");

test("normalizeRecord maps direct field names with no fieldMap", () => {
  const record = normalizeRecord({ asset: "BTC", data_type: "price", value: 50000 });
  assert.equal(record.asset, "BTC");
  assert.equal(record.value, 50000);
});

test("normalizeRecord applies a caller-supplied fieldMap without assuming any provider format", () => {
  const raw = { symbol: "BTC", price: 50000 };
  const record = normalizeRecord(raw, { asset: "symbol", value: "price" });
  assert.equal(record.asset, "BTC");
  assert.equal(record.value, 50000);
});

test("normalizeRecord defaults unmapped fields to UNKNOWN, never invents them", () => {
  const record = normalizeRecord({ asset: "BTC" });
  assert.equal(record.source, UNKNOWN);
  assert.equal(record.timestamp, UNKNOWN);
});

test("normalizeRecord handles a non-object input safely", () => {
  const record = normalizeRecord(null);
  assert.equal(record.asset, UNKNOWN);
});
