const test = require("node:test");
const assert = require("node:assert/strict");
const { ProviderAdapter } = require("../providers/ProviderAdapter");

test("ProviderAdapter cannot be instantiated directly", () => {
  assert.throws(() => new ProviderAdapter(), /abstract/);
});

test("a subclass that doesn't implement fetchData fails safely, not silently", async () => {
  class IncompleteAdapter extends ProviderAdapter {}
  const instance = new IncompleteAdapter();
  await assert.rejects(() => instance.fetchData(), /must be implemented/);
});
