const test = require("node:test");
const assert = require("node:assert/strict");
const { createAgentMessage, validateAgentMessage, AGENT_MESSAGE_FIELDS } = require("../core/agentMessage");

test("createAgentMessage defaults every field to UNKNOWN — never invents content", () => {
  const msg = createAgentMessage({ agent_name: "test-agent" });
  assert.equal(msg.agent_name, "test-agent");
  assert.equal(msg.findings, "UNKNOWN");
  for (const field of AGENT_MESSAGE_FIELDS) {
    assert.ok(field in msg, `missing field ${field}`);
  }
});

test("validateAgentMessage rejects a message missing required fields", () => {
  const result = validateAgentMessage({ agent_name: "x" });
  assert.equal(result.valid, false);
});

test("validateAgentMessage rejects a non-array sources field", () => {
  const msg = createAgentMessage({ sources: "not-an-array" });
  const result = validateAgentMessage(msg);
  assert.equal(result.valid, false);
});

test("validateAgentMessage accepts UNKNOWN for array-typed fields", () => {
  const msg = createAgentMessage({ agent_name: "test-agent" });
  const result = validateAgentMessage(msg);
  assert.equal(result.valid, true, result.errors.join(", "));
});
