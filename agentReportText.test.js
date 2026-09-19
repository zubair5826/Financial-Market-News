// Tests for the human-readable renderer (agentReportText.js).
//
// The renderer is pure formatting: it must print every value the
// pipeline produced, must never invent one, and must never crash on a
// degraded or failed run — a renderer that throws on a bad run hides
// exactly the run the reader most needs to see. Fully offline; no
// provider domain is enabled and no run is persisted here.

const test = require("node:test");
const assert = require("node:assert/strict");

const { renderAgentReportText } = require("./agentReportText");

function chiefReport(overrides = {}) {
  return {
    agent_name: "chief-trading-manager",
    timestamp: "2026-09-18T12:00:00.000Z",
    asset: "SPY",
    final_assessment: "BULLISH",
    decision_status: "TRADE_SETUP_SUPPORTED",
    news_summary: { domain: "NEWS", bias: "BULLISH", confidence: "HIGH", uncertainties: [], conflicts: [], warnings: [], sources: ["news-A"] },
    macro_summary: { domain: "MACRO", bias: "NEUTRAL", confidence: "MEDIUM", uncertainties: [], conflicts: [], warnings: [], sources: ["macro-A"] },
    technical_summary: { domain: "TECHNICAL", bias: "BULLISH", confidence: "HIGH", uncertainties: [], conflicts: [], warnings: [], sources: ["tech-A"] },
    sentiment_summary: null,
    trade_setup_summary: {
      domain: "TRADE_SETUP",
      setup_status: "SETUP_PRESENT",
      direction: "BULLISH",
      setup_quality: "HIGH",
      confidence: "HIGH",
    },
    risk_summary: {
      domain: "RISK",
      risk_level: "LOW",
      risk_decision: "RISK_ACCEPTABLE",
      risk_categories: [],
      data_quality: { freshnessStatus: "FRESH", qualityStatus: "HIGH", stale: false, unverified: false, conflicting: false },
      position_size_status: { status: "CALCULATED", position_size: 20, missing_parameters: [], notes: "Deterministic sizing." },
    },
    supporting_evidence: [{ domain: "NEWS", bias: "BULLISH", confidence: "HIGH" }],
    conflicting_evidence: [],
    missing_information: ["sentiment"],
    key_assumptions: ["Each input report's own confidence is trusted as computed."],
    confidence: "MEDIUM",
    uncertainties: ["Missing reports: sentiment."],
    warnings: [],
    sources: ["news-A", "macro-A", "tech-A"],
    ...overrides,
  };
}

function agentResult(overrides = {}) {
  return {
    pipelineResult: {
      ok: true,
      timestamp: "2026-09-18T12:00:00.000Z",
      asset: "SPY",
      response: chiefReport(),
      warnings: [],
      errors: [],
    },
    diagnostics: null,
    persistence: { status: "PERSISTED", run_id: "run-id-0001", error: null },
    llmAnnotation: null,
    ...overrides,
  };
}

test("1. every required field the review asked for appears in the text output", () => {
  const text = renderAgentReportText(agentResult());

  for (const expected of [
    "SPY", // instrument
    "2026-09-18T12:00:00.000Z", // timestamp
    "run-id-0001", // run_id
    "final_assessment: BULLISH",
    "decision_status : TRADE_SETUP_SUPPORTED",
    "risk_decision   : RISK_ACCEPTABLE",
    "risk_level      : LOW",
    "freshness_status   : FRESH",
    "data_quality_status: HIGH",
    "MACRO",
    "NEWS",
    "TECHNICAL",
    "SENTIMENT",
    "SUPPORTING EVIDENCE",
    "CONFLICTING EVIDENCE",
    "MISSING INFORMATION",
    "KEY ASSUMPTIONS",
    "UNCERTAINTIES",
    "SOURCES",
  ]) {
    assert.ok(text.includes(expected), `expected the report to contain ${JSON.stringify(expected)}`);
  }
});

test("2. the output states plainly that this is not a trade instruction", () => {
  const text = renderAgentReportText(agentResult());
  assert.match(text, /not a trade instruction/i);
  assert.match(text, /No broker or exchange is connected/i);
});

test("3. an absent domain report is shown as NOT AVAILABLE — never as neutral or blank", () => {
  const text = renderAgentReportText(agentResult());
  assert.match(text, /SENTIMENT: NOT AVAILABLE/);
});

test("4. absent data_quality renders UNKNOWN, never a guessed status", () => {
  const report = chiefReport();
  report.risk_summary = { ...report.risk_summary, data_quality: null };
  const result = agentResult();
  result.pipelineResult.response = report;

  const text = renderAgentReportText(result);
  assert.match(text, /freshness_status {3}: UNKNOWN/);
  assert.match(text, /data_quality_status: UNKNOWN/);
});

test("5. unavailable position sizing names the missing parameters and invents none", () => {
  const report = chiefReport();
  report.risk_summary = {
    ...report.risk_summary,
    position_size_status: {
      status: "DATA_UNAVAILABLE",
      position_size: "UNKNOWN",
      missing_parameters: ["leverage", "entryPrice", "stopPrice", "contractSize"],
      notes: "One or more required sizing parameters were not supplied — never assumed.",
    },
  };
  const result = agentResult();
  result.pipelineResult.response = report;

  const text = renderAgentReportText(result);
  assert.match(text, /position sizing: DATA_UNAVAILABLE/);
  assert.match(text, /missing parameters \(never assumed\): leverage, entryPrice, stopPrice, contractSize/);
});

test("6. a run with no chief report renders honestly instead of an empty skeleton", () => {
  const text = renderAgentReportText({
    pipelineResult: { ok: false, timestamp: "2026-09-18T12:00:00.000Z", asset: "UNKNOWN", response: null, warnings: [], errors: [{ ok: false, code: "MALFORMED_DATA", message: "request.query is required." }] },
    persistence: { status: "PERSISTED", run_id: "run-id-0002" },
    llmAnnotation: null,
  });

  assert.match(text, /NO CHIEF TRADING MANAGER REPORT WAS PRODUCED/);
  assert.match(text, /request\.query is required\./);
  assert.ok(!text.includes("final_assessment"), "must not print a decision block it never computed");
});

test("7. renders without throwing on an empty or partial result object", () => {
  assert.doesNotThrow(() => renderAgentReportText());
  assert.doesNotThrow(() => renderAgentReportText({}));
  assert.doesNotThrow(() => renderAgentReportText({ pipelineResult: {} }));
  const text = renderAgentReportText({});
  assert.match(text, /Instrument : UNKNOWN/);
});

test("8. no Claude block at all when the layer was not enabled", () => {
  const text = renderAgentReportText(agentResult());
  assert.ok(!text.includes("ADVISORY"), "an unused optional layer must add nothing to the report");
});

test("9. a VALID Claude annotation is rendered last and clearly labelled ADVISORY", () => {
  const text = renderAgentReportText(
    agentResult({
      llmAnnotation: {
        status: "VALID",
        output: {
          output_schema_version: "llm-output-v1",
          narrative_summary: "Macro is neutral while news and technicals lean bullish.",
          key_factors: [{ factor: "News bias", direction: "SUPPORTIVE", evidence_ref: "domain_evidence.news.bias" }],
          risk_commentary: "The Risk Manager's RISK_ACCEPTABLE decision stands.",
          uncertainties_acknowledged: ["Missing reports: sentiment."],
          caveats: ["This is not financial advice."],
        },
        code: null,
        message: null,
        errors: [],
      },
    })
  );

  assert.match(text, /ADVISORY — OPTIONAL CLAUDE REASONING LAYER/);
  assert.match(text, /did NOT influence final_assessment/);
  assert.match(text, /Narrative \(ADVISORY\)/);
  assert.match(text, /Key factors \(ADVISORY\)/);
  assert.match(text, /Risk commentary \(ADVISORY\)/);

  // It must come after every deterministic value, so it can never be
  // read as part of the decision.
  assert.ok(text.indexOf("ADVISORY") > text.indexOf("final_assessment"));
  assert.ok(text.indexOf("ADVISORY") > text.indexOf("SOURCES"));
});

test("10. a non-VALID annotation shows its status and reasons but no commentary", () => {
  const text = renderAgentReportText(
    agentResult({
      llmAnnotation: {
        status: "REJECTED",
        output: null,
        code: null,
        message: null,
        errors: ["narrative_summary contradicts the Risk Manager's RISK_TOO_HIGH decision"],
      },
    })
  );

  assert.match(text, /status: REJECTED/);
  assert.match(text, /contradicts the Risk Manager/);
  assert.match(text, /No advisory commentary is shown for a non-VALID result/);
});

test("11. conflicting evidence is rendered readably, not as a raw object dump", () => {
  const report = chiefReport({
    conflicting_evidence: [
      { type: "SPECIALIST_DISAGREEMENT", reason: "NEWS reported BULLISH evidence while MACRO reported BEARISH evidence." },
      { type: "INTERNAL_CONFLICT", domain: "TECHNICAL", detail: [{ a: 1 }] },
    ],
  });
  const result = agentResult();
  result.pipelineResult.response = report;

  const text = renderAgentReportText(result);
  assert.match(text, /SPECIALIST_DISAGREEMENT: NEWS reported BULLISH/);
  assert.match(text, /INTERNAL_CONFLICT in TECHNICAL: 1 conflict\(s\)/);
  assert.ok(!text.includes("[object Object]"));
});

test("12. the renderer never mutates the result it is given", () => {
  const result = agentResult();
  const before = JSON.stringify(result);
  renderAgentReportText(result);
  assert.equal(JSON.stringify(result), before);
});
