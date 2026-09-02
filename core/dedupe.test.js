// Offline unit tests for dedupeExact() — the shared exact-duplicate
// list collapser used by agents/macro-agent/report.js and
// agents/technical-agent/report.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const { dedupeExact } = require("./dedupe");

test("identical string entries are collapsed to one", () => {
  const result = dedupeExact(["a", "a", "a"]);
  assert.deepEqual(result, ["a"]);
});

test("different string entries are all preserved", () => {
  const result = dedupeExact(["a", "b", "c"]);
  assert.deepEqual(result, ["a", "b", "c"]);
});

test("first-occurrence order is preserved when duplicates are interleaved", () => {
  const result = dedupeExact(["a", "b", "a", "c", "b"]);
  assert.deepEqual(result, ["a", "b", "c"]);
});

test("identical plain objects (e.g. failSafe() results) are collapsed by structural equality, not reference equality", () => {
  const makeWarning = () => ({ ok: false, code: "STALE_DATA", message: "x is STALE DATA.", details: { asset: "BTC" } });
  // Three genuinely distinct object instances with identical content —
  // exactly what three separate failSafe() calls for the same
  // condition produce.
  const result = dedupeExact([makeWarning(), makeWarning(), makeWarning()]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], makeWarning());
});

test("objects that differ in any field are never collapsed", () => {
  const a = { code: "STALE_DATA", message: "BTC (1h) is STALE DATA." };
  const b = { code: "STALE_DATA", message: "ETH (1h) is STALE DATA." };
  const result = dedupeExact([a, a, b]);
  assert.equal(result.length, 2);
});

test("a mixed array of strings and objects dedupes each independently", () => {
  const warning = { code: "STALE_DATA", message: "x" };
  const result = dedupeExact(["dup", "dup", warning, warning, "unique"]);
  assert.deepEqual(result, ["dup", warning, "unique"]);
});

test("an empty array returns an empty array", () => {
  assert.deepEqual(dedupeExact([]), []);
});

test("a single-entry array is returned unchanged", () => {
  assert.deepEqual(dedupeExact(["only"]), ["only"]);
});

test("a non-array input is returned unchanged, never throws", () => {
  assert.equal(dedupeExact(null), null);
  assert.equal(dedupeExact(undefined), undefined);
  assert.equal(dedupeExact("not an array"), "not an array");
});

test("the input array is never mutated", () => {
  const input = ["a", "a", "b"];
  const before = [...input];
  dedupeExact(input);
  assert.deepEqual(input, before);
});

test("the returned array is a new array, never the same reference as the input", () => {
  const input = ["a", "b"];
  const result = dedupeExact(input);
  assert.notEqual(result, input);
});

test("object entries are never mutated, and the surviving reference is the FIRST occurrence's own object", () => {
  const first = { code: "STALE_DATA", message: "x" };
  const second = { code: "STALE_DATA", message: "x" };
  const result = dedupeExact([first, second]);
  assert.equal(result[0], first); // same reference as the first occurrence
  assert.notEqual(result[0], second);
  assert.deepEqual(first, { code: "STALE_DATA", message: "x" }); // untouched
});
