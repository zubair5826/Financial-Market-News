const test = require("node:test");
const assert = require("node:assert/strict");
const { failSafe, ERROR_CODES } = require("../core/errors");

test("failSafe returns a structured failure, never a fabricated success", () => {
  const result = failSafe(ERROR_CODES.API_UNAVAILABLE, "provider did not respond");
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.API_UNAVAILABLE);
});

test("failSafe covers invalid/malformed API response scenarios", () => {
  const result = failSafe(ERROR_CODES.INVALID_RESPONSE, "response failed schema validation");
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.INVALID_RESPONSE);
});

test("failSafe rejects unknown error codes rather than silently accepting them", () => {
  assert.throws(() => failSafe("NOT_A_REAL_CODE", "x"));
});
