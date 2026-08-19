const test = require("node:test");
const assert = require("node:assert/strict");
const { redact } = require("../logs/logger");

test("redact removes credential-like keys recursively, keeps safe data", () => {
  const clean = redact({ apiKey: "abc123", nested: { token: "xyz" }, safe: "ok" });
  assert.equal(clean.apiKey, "[REDACTED]");
  assert.equal(clean.nested.token, "[REDACTED]");
  assert.equal(clean.safe, "ok");
});

test("redact leaves non-object values untouched", () => {
  assert.equal(redact("plain string"), "plain string");
  assert.equal(redact(null), null);
});
