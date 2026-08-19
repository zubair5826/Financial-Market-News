const test = require("node:test");
const assert = require("node:assert/strict");
const { explainCrossDomainDisagreement, collectInternalConflicts, buildConflictingEvidence } = require("./conflicts");

test("explainCrossDomainDisagreement returns nothing when final assessment isn't CONFLICTING_EVIDENCE", () => {
  const result = explainCrossDomainDisagreement({ NEWS: { bias: "BULLISH" } }, "BULLISH");
  assert.deepEqual(result, []);
});

test("explainCrossDomainDisagreement names which agents disagree, why, evidence per side, and what's missing", () => {
  const named = { NEWS: { bias: "BULLISH" }, MACRO: null, TECHNICAL: { bias: "BEARISH" }, SENTIMENT: null };
  const [conflict] = explainCrossDomainDisagreement(named, "CONFLICTING_EVIDENCE");
  assert.deepEqual(conflict.bullish_agents, ["NEWS"]);
  assert.deepEqual(conflict.bearish_agents, ["TECHNICAL"]);
  assert.deepEqual(conflict.missing_information, ["MACRO", "SENTIMENT"]);
  assert.ok(conflict.reason.includes("NEWS") && conflict.reason.includes("TECHNICAL"));
  assert.equal(conflict.supporting_evidence_bullish.length, 1);
  assert.equal(conflict.supporting_evidence_bearish.length, 1);
});

test("collectInternalConflicts scans every supplied summary, including ones without a .bias field", () => {
  const named = {
    NEWS: { conflicts: [{ x: 1 }] },
    TRADE_SETUP: { conflicts: [] },
    RISK: { risk_level: "LOW" }, // no .conflicts field at all — must not crash
  };
  const result = collectInternalConflicts(named);
  assert.equal(result.length, 1);
  assert.equal(result[0].domain, "NEWS");
});

test("buildConflictingEvidence never crashes when Trade Setup/Risk summaries lack a .bias field", () => {
  const specialists = { NEWS: { bias: "BULLISH" }, MACRO: { bias: "BEARISH" }, TECHNICAL: null, SENTIMENT: null };
  const all = { ...specialists, TRADE_SETUP: { direction: "BULLISH", conflicts: [] }, RISK: { risk_level: "LOW" } };
  assert.doesNotThrow(() => buildConflictingEvidence(specialists, all, "CONFLICTING_EVIDENCE"));
});

test("buildConflictingEvidence combines cross-domain disagreement with internal conflicts", () => {
  const specialists = { NEWS: { bias: "BULLISH", conflicts: [] }, MACRO: { bias: "BEARISH", conflicts: [{ y: 1 }] }, TECHNICAL: null, SENTIMENT: null };
  const all = { ...specialists };
  const result = buildConflictingEvidence(specialists, all, "CONFLICTING_EVIDENCE");
  assert.ok(result.some((c) => c.type === "SPECIALIST_DISAGREEMENT"));
  assert.ok(result.some((c) => c.type === "INTERNAL_CONFLICT" && c.domain === "MACRO"));
});
