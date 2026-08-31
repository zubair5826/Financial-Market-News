// Offline tests for llm/config.js — Step 5A. Pure configuration, no
// network access possible from this file at all.

const test = require("node:test");
const assert = require("node:assert/strict");
const { ANTHROPIC_TRANSPORT_CONFIG, getAnthropicTransportConfig } = require("./config");

test("getAnthropicTransportConfig() returns an object with every required transport field", () => {
  const config = getAnthropicTransportConfig();
  assert.equal(typeof config.apiBaseUrl, "string");
  assert.equal(typeof config.apiVersion, "string");
  assert.equal(typeof config.model, "string");
  assert.equal(typeof config.timeoutMs, "number");
  assert.equal(typeof config.maxTokens, "number");
});

test("the exported config object is frozen (cannot be mutated by a careless caller)", () => {
  assert.ok(Object.isFrozen(ANTHROPIC_TRANSPORT_CONFIG));
  const original = ANTHROPIC_TRANSPORT_CONFIG.model;
  try {
    ANTHROPIC_TRANSPORT_CONFIG.model = "tampered";
  } catch {
    // strict mode may throw on a frozen-object write — either outcome
    // is acceptable, the assertion below is what actually matters.
  }
  assert.equal(ANTHROPIC_TRANSPORT_CONFIG.model, original);
});

test("getAnthropicTransportConfig() always returns the same values across calls (no hidden randomness/state)", () => {
  assert.deepEqual(getAnthropicTransportConfig(), getAnthropicTransportConfig());
});

test("the base URL points at the real Anthropic Messages API endpoint", () => {
  assert.equal(getAnthropicTransportConfig().apiBaseUrl, "https://api.anthropic.com/v1/messages");
});

test("the model is pinned to a specific version string, never 'latest'", () => {
  assert.ok(!getAnthropicTransportConfig().model.includes("latest"));
});

test("this file contains no API key, credential, or process.env reference in actual code (comments may reference the concept)", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("./config.js"), "utf8");
  const codeOnly = src
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  assert.ok(!/process\.env/.test(codeOnly));
  assert.ok(!/apiKey/i.test(codeOnly));
});
