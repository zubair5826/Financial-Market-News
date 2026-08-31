// Offline tests for buildEvidencePackage() — Step 5B. No network call,
// no Anthropic call, no orchestrator/agent code modified. This file
// requires orchestrator/index.js read-only (mirroring
// tests/pipeline.test.js's own pattern) purely to exercise the builder
// against one genuine, real deterministic pipeline result, alongside
// synthetic fixtures for every edge case.

const test = require("node:test");
const assert = require("node:assert/strict");
const { processRequest } = require("../orchestrator");
const { buildEvidencePackage, INPUT_SCHEMA_VERSION } = require("./evidencePackage");
const { UNKNOWN } = require("../core/constants");

const THRESHOLDS = { freshMaxMs: 3_600_000, agingMaxMs: 86_400_000 };
const FULL_SIZING_PARAMS = { accountBalance: 10000, riskPercentage: 0.01, leverage: 1, entryPrice: 100, stopPrice: 95, contractSize: 1 };

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function zigzagCandles(asset = "BTC") {
  const prices = [100, 102, 104, 101, 99, 103, 107, 104, 100, 105, 110];
  return prices.map((p, i) => ({
    asset,
    timeframe: "1h",
    timestamp: iso(-(prices.length - 1 - i) * 3_600_000),
    open: p,
    high: p + 1,
    low: p - 1,
    close: p,
    source: "technical-src-A",
    classification: "FACT",
    verification_status: "VERIFIED_PRIMARY",
  }));
}

// Local fixture (not imported from tests/pipeline.test.js — each test
// file owns its own fixtures, matching this repo's existing pattern).
function bullishRequest(overrides = {}) {
  return {
    query: "Assess BTC",
    asset: "BTC",
    newsData: [
      {
        asset: "BTC",
        headline: "Regulator signals clearer path for crypto adoption",
        classification: "FACT",
        source: "news-src-A",
        publication_timestamp: iso(),
        impact_direction: "POSITIVE",
        verification_status: "VERIFIED_PRIMARY",
      },
    ],
    macroData: [
      {
        indicator: "CPI",
        classification: "FACT",
        country: "US",
        category: "INFLATION",
        source: "macro-src-A",
        release_timestamp: iso(),
        impact_direction: "POSITIVE",
        verification_status: "VERIFIED_PRIMARY",
      },
    ],
    technicalCandles: zigzagCandles(),
    sentimentData: [
      {
        asset: "BTC",
        sentiment: "BULLISH",
        classification: "FACT",
        source: "sentiment-src-A",
        timestamp: iso(),
        verification_status: "VERIFIED_PRIMARY",
      },
    ],
    options: { freshnessThresholds: THRESHOLDS, positionSizingParams: FULL_SIZING_PARAMS },
    ...overrides,
  };
}

// A fully synthetic pipelineResult shaped exactly like
// orchestrator/index.js's real return value, so edge cases (missing
// summaries, a rejected risk decision, etc.) don't depend on driving
// the real 8-agent pipeline into a specific state.
function syntheticPipelineResult(overrides = {}) {
  return {
    ok: true,
    timestamp: "2026-08-29T00:00:00.000Z",
    asset: "BTC",
    response: {
      agent_name: "chief-trading-manager",
      final_assessment: "BULLISH",
      decision_status: "TRADE_SETUP_SUPPORTED",
      confidence: "HIGH",
      uncertainties: ["Some uncertainty."],
      warnings: ["Some warning."],
      news_summary: {
        domain: "NEWS",
        bias: "POSITIVE",
        confidence: "HIGH",
        key_events: [{ headline: "Test headline" }],
        conflicts: [],
        warnings: [],
        sources: ["news-src-A"],
      },
      macro_summary: {
        domain: "MACRO",
        bias: "POSITIVE",
        confidence: "HIGH",
        key_indicators: [{ indicator: "CPI" }],
        macro_risks: [],
        conflicts: [],
        warnings: [],
        sources: ["macro-src-A"],
      },
      technical_summary: {
        domain: "TECHNICAL",
        bias: "BULLISH",
        confidence: "MEDIUM",
        trend_analysis: "UPTREND",
        momentum: "STRONG",
        conflicts: [],
        warnings: [],
        sources: ["technical-src-A"],
      },
      sentiment_summary: {
        domain: "SENTIMENT",
        bias: "BULLISH",
        confidence: "MEDIUM",
        conflicts: [],
        warnings: [],
        sources: ["sentiment-src-A"],
      },
      trade_setup_summary: {
        domain: "TRADE_SETUP",
        setup_status: "SETUP_PRESENT",
        direction: "LONG_BIAS",
        setup_quality: "HIGH",
        confidence: "HIGH",
        uncertainties: [],
        conflicts: [],
        warnings: [],
        sources: [],
      },
      risk_summary: {
        domain: "RISK",
        risk_level: "LOW",
        risk_decision: "RISK_ACCEPTABLE",
        risk_categories: ["LIQUIDITY"],
        position_size_status: "CALCULATED",
        invalidation_assessment: "Invalidated below 95.",
        confidence: "HIGH",
        uncertainties: [],
        warnings: [],
        sources: [],
      },
    },
    pipeline_summary: {
      data_controller_status: "NOT_RUN",
      news_status: "OK",
      macro_status: "OK",
      technical_status: "OK",
      sentiment_status: "OK",
      trade_setup_status: "SETUP_PRESENT",
      risk_decision: "RISK_ACCEPTABLE",
      final_assessment: "BULLISH",
      decision_status: "TRADE_SETUP_SUPPORTED",
    },
    warnings: [],
    errors: [],
    ...overrides,
  };
}

// --- Correct package construction / required fields ---

test("construction: a real, end-to-end deterministic pipelineResult produces a well-formed Evidence Package", () => {
  const pipelineResult = processRequest(bullishRequest());
  assert.equal(pipelineResult.ok, true);

  const pkg = buildEvidencePackage(pipelineResult, bullishRequest());
  assert.equal(pkg.input_schema_version, "llm-input-v1");
  assert.equal(pkg.requested_instrument, "BTC");
  assert.equal(pkg.original_query, "Assess BTC");
  assert.equal(pkg.final_decision.final_assessment, pipelineResult.response.final_assessment);
  assert.equal(pkg.risk_decision.risk_decision, pipelineResult.response.risk_summary.risk_decision);
});

test("required fields: the top-level Evidence Package has exactly the fields the design specifies, nothing more", () => {
  const pkg = buildEvidencePackage(syntheticPipelineResult(), { query: "Assess BTC" });
  assert.deepEqual(
    Object.keys(pkg).sort(),
    [
      "as_of",
      "data_quality_status",
      "domain_evidence",
      "final_decision",
      "freshness_status",
      "input_schema_version",
      "original_query",
      "requested_instrument",
      "risk_decision",
      "run_id",
      "trade_setup",
      "uncertainties",
      "warnings",
    ].sort()
  );
});

test("required fields: domain_evidence has exactly news/macro/technical/sentiment, nothing more", () => {
  const pkg = buildEvidencePackage(syntheticPipelineResult(), {});
  assert.deepEqual(Object.keys(pkg.domain_evidence).sort(), ["macro", "news", "sentiment", "technical"]);
});

test("INPUT_SCHEMA_VERSION is exported and matches the value stamped on every package", () => {
  assert.equal(INPUT_SCHEMA_VERSION, "llm-input-v1");
  const pkg = buildEvidencePackage(syntheticPipelineResult(), {});
  assert.equal(pkg.input_schema_version, INPUT_SCHEMA_VERSION);
});

// --- Allowed domain information ---

test("domain information: each domain block contains only the design's approved fields, nothing more", () => {
  const pkg = buildEvidencePackage(syntheticPipelineResult(), {});
  assert.deepEqual(Object.keys(pkg.domain_evidence.news).sort(), ["bias", "confidence", "conflicts", "key_events", "sources", "warnings"].sort());
  assert.deepEqual(
    Object.keys(pkg.domain_evidence.macro).sort(),
    ["bias", "confidence", "conflicts", "key_indicators", "sources", "warnings"].sort()
  );
  assert.deepEqual(
    Object.keys(pkg.domain_evidence.technical).sort(),
    ["bias", "confidence", "conflicts", "momentum", "sources", "trend_analysis", "warnings"].sort()
  );
  assert.deepEqual(Object.keys(pkg.domain_evidence.sentiment).sort(), ["bias", "confidence", "conflicts", "sources", "warnings"].sort());
});

test("domain information: values are copied verbatim from the pipeline's own summaries, never reformatted", () => {
  const pipelineResult = syntheticPipelineResult();
  const pkg = buildEvidencePackage(pipelineResult, {});
  assert.equal(pkg.domain_evidence.news.bias, "POSITIVE");
  assert.equal(pkg.domain_evidence.macro.bias, "POSITIVE");
  assert.equal(pkg.domain_evidence.technical.trend_analysis, "UPTREND");
  assert.equal(pkg.domain_evidence.technical.momentum, "STRONG");
  assert.equal(pkg.domain_evidence.sentiment.bias, "BULLISH");
  assert.deepEqual(pkg.domain_evidence.news.key_events, [{ headline: "Test headline" }]);
  assert.deepEqual(pkg.domain_evidence.macro.key_indicators, [{ indicator: "CPI" }]);
});

test("trade_setup: has exactly setup_status/direction/setup_quality/confidence/uncertainties, nothing more", () => {
  const pkg = buildEvidencePackage(syntheticPipelineResult(), {});
  assert.deepEqual(
    Object.keys(pkg.trade_setup).sort(),
    ["confidence", "direction", "setup_quality", "setup_status", "uncertainties"].sort()
  );
  assert.equal(pkg.trade_setup.setup_status, "SETUP_PRESENT");
  assert.equal(pkg.trade_setup.direction, "LONG_BIAS");
});

// --- Preservation of the existing Risk Manager decision as an immutable fact ---

test("risk decision: the package's risk_decision.risk_decision exactly matches the deterministic result, verbatim", () => {
  const pipelineResult = syntheticPipelineResult({
    response: { ...syntheticPipelineResult().response, risk_summary: { ...syntheticPipelineResult().response.risk_summary, risk_decision: "RISK_TOO_HIGH" } },
  });
  const pkg = buildEvidencePackage(pipelineResult, {});
  assert.equal(pkg.risk_decision.risk_decision, "RISK_TOO_HIGH");
});

test("risk decision: has exactly the design's approved fields, nothing more", () => {
  const pkg = buildEvidencePackage(syntheticPipelineResult(), {});
  assert.deepEqual(
    Object.keys(pkg.risk_decision).sort(),
    ["invalidation_assessment", "position_size_status", "risk_categories", "risk_decision", "risk_factors", "risk_level"].sort()
  );
});

test("risk decision: the returned package is frozen — a caller cannot mutate risk_decision.risk_decision into a different fact", () => {
  const pkg = buildEvidencePackage(syntheticPipelineResult(), {});
  const original = pkg.risk_decision.risk_decision;
  assert.ok(Object.isFrozen(pkg));
  assert.ok(Object.isFrozen(pkg.risk_decision));
  try {
    pkg.risk_decision.risk_decision = "OVERRIDDEN";
  } catch {
    // strict-mode assignment to a frozen object may throw — either
    // outcome is acceptable; the assertion below is what matters.
  }
  assert.equal(pkg.risk_decision.risk_decision, original);
});

test("risk decision: the whole package tree is deep-frozen, not just the top level", () => {
  const pkg = buildEvidencePackage(syntheticPipelineResult(), {});
  assert.ok(Object.isFrozen(pkg.domain_evidence));
  assert.ok(Object.isFrozen(pkg.domain_evidence.news));
  assert.ok(Object.isFrozen(pkg.trade_setup));
  assert.ok(Object.isFrozen(pkg.final_decision));
  assert.ok(Object.isFrozen(pkg.uncertainties));
  assert.ok(Object.isFrozen(pkg.warnings));
});

// --- Exclusion of credentials ---

test("credential exclusion: no key/token/credential-shaped field appears anywhere in the package, even if the request tries to smuggle one in", () => {
  const maliciousRequest = { query: "Assess BTC", apiKey: "sk-real-secret-should-never-appear", ANTHROPIC_API_KEY: "also-should-not-appear" };
  const pkg = buildEvidencePackage(syntheticPipelineResult(), maliciousRequest);
  const serialized = JSON.stringify(pkg);
  assert.ok(!serialized.includes("sk-real-secret-should-never-appear"));
  assert.ok(!serialized.includes("also-should-not-appear"));
  assert.ok(!/apiKey|api_key|credential|token|password/i.test(serialized));
});

test("credential exclusion: this module's source never references process.env or an apiKey-shaped identifier in actual code", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("./evidencePackage.js"), "utf8");
  const codeOnly = src.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.ok(!/process\.env/.test(codeOnly));
  assert.ok(!/apiKey/i.test(codeOnly));
});

// --- Exclusion of raw provider data ---

test("raw provider data exclusion: raw candle/record arrays and provider payload fields never appear in the package", () => {
  const pipelineResult = syntheticPipelineResult();
  // Simulate the kind of raw fields that must never leak through, even
  // if a caller's pipelineResult happened to carry them somewhere.
  pipelineResult.response.macro_summary.macro_records = [{ indicator: "CPI", actual_value: 3.1, evidence: { fred_series_id: "CPIAUCSL" } }];
  pipelineResult.response.technical_summary.raw_candles = [{ open: 100, high: 101, low: 99, close: 100.5 }];

  const pkg = buildEvidencePackage(pipelineResult, {});
  const serialized = JSON.stringify(pkg);
  assert.ok(!serialized.includes("macro_records"));
  assert.ok(!serialized.includes("raw_candles"));
  assert.ok(!serialized.includes("fred_series_id"));
  assert.ok(!serialized.includes("CPIAUCSL"));
});

test("raw provider data exclusion: original_query is the only field ever read from the caller's request object", () => {
  const request = { query: "Assess BTC", marketData: [{ asset: "BTC", price: 12345 }], newsData: [{ headline: "raw news payload" }] };
  const pkg = buildEvidencePackage(syntheticPipelineResult(), request);
  const serialized = JSON.stringify(pkg);
  assert.ok(!serialized.includes("12345"));
  assert.ok(!serialized.includes("raw news payload"));
});

// --- Exclusion of forbidden decision/execution fields ---

test("forbidden fields: no BUY/SELL/execution vocabulary or price/quantity field appears anywhere in the package", () => {
  const pkg = buildEvidencePackage(syntheticPipelineResult(), { query: "Assess BTC" });
  const serialized = JSON.stringify(pkg);
  assert.ok(!/\b(BUY|SELL|EXECUTE|ORDER|PLACE_TRADE)\b/i.test(serialized));
  assert.deepEqual(Object.keys(pkg), Object.keys(pkg).filter((k) => !/action|recommendation|override|execution|quantity|price/i.test(k)));
});

test("forbidden fields: the package has no top-level field capable of holding a revised or alternate decision", () => {
  const pkg = buildEvidencePackage(syntheticPipelineResult(), {});
  for (const forbidden of ["override", "recommendation", "action", "recommendation_type", "confidence_score"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(pkg, forbidden), false);
    assert.equal(Object.prototype.hasOwnProperty.call(pkg.risk_decision, forbidden), false);
  }
});

test("forbidden fields: internal diagnostics (fredDiagnostics/timeframeResults/persistence) never appear even if present on pipelineResult", () => {
  const pipelineResult = syntheticPipelineResult();
  pipelineResult.fredDiagnostics = { calls: 3, secretDetail: "should not leak" };
  pipelineResult.persistence = { run_id: "real-run-id-should-not-be-read-this-way", status: "PERSISTED" };
  pipelineResult.timeframeResults = [{ timeframe: "1h", raw: true }];

  const pkg = buildEvidencePackage(pipelineResult, {});
  const serialized = JSON.stringify(pkg);
  assert.ok(!serialized.includes("secretDetail"));
  assert.ok(!serialized.includes("should not leak"));
  assert.ok(!serialized.includes("real-run-id-should-not-be-read-this-way"));
  assert.equal(pkg.run_id, UNKNOWN); // never silently pulled from pipelineResult.persistence
});

// --- Deterministic output ---

test("determinism: calling buildEvidencePackage with the same inputs twice produces deepEqual (unfrozen-copy) results", () => {
  const pipelineResult = syntheticPipelineResult();
  const request = { query: "Assess BTC" };
  const pkg1 = buildEvidencePackage(pipelineResult, request);
  const pkg2 = buildEvidencePackage(pipelineResult, request);
  assert.deepEqual(pkg1, pkg2);
});

test("determinism: no field is derived from Date.now()/Math.random() — as_of is copied verbatim from pipelineResult.timestamp", () => {
  const pipelineResult = syntheticPipelineResult({ timestamp: "2020-01-01T00:00:00.000Z" });
  const pkg = buildEvidencePackage(pipelineResult, {});
  assert.equal(pkg.as_of, "2020-01-01T00:00:00.000Z");
});

// --- Safe handling of missing/empty optional fields ---

test("missing fields: a pipeline failure result (ok:false, response:null) produces a safe, fully-UNKNOWN package, never a crash", () => {
  const failureResult = { ok: false, timestamp: "2026-01-01T00:00:00.000Z", asset: UNKNOWN, response: null, pipeline_summary: { stage_failed: "receiveRequest" }, warnings: [], errors: [] };
  const pkg = buildEvidencePackage(failureResult, {});
  assert.equal(pkg.requested_instrument, UNKNOWN);
  assert.equal(pkg.final_decision.final_assessment, UNKNOWN);
  assert.equal(pkg.risk_decision.risk_decision, UNKNOWN);
  assert.deepEqual(pkg.domain_evidence.news.key_events, []);
  assert.deepEqual(pkg.uncertainties, []);
});

test("missing fields: a response missing one or more domain summaries degrades that domain to UNKNOWN/[] rather than crashing", () => {
  const pipelineResult = syntheticPipelineResult();
  delete pipelineResult.response.sentiment_summary;
  const pkg = buildEvidencePackage(pipelineResult, {});
  assert.equal(pkg.domain_evidence.sentiment.bias, UNKNOWN);
  assert.deepEqual(pkg.domain_evidence.sentiment.conflicts, []);
  // Unaffected domains remain fully populated.
  assert.equal(pkg.domain_evidence.news.bias, "POSITIVE");
});

test("missing fields: entirely missing/undefined pipelineResult, request, and options never throw", () => {
  assert.doesNotThrow(() => buildEvidencePackage());
  assert.doesNotThrow(() => buildEvidencePackage(undefined, undefined, undefined));
  assert.doesNotThrow(() => buildEvidencePackage(null, null, null));
  const pkg = buildEvidencePackage();
  assert.equal(pkg.requested_instrument, UNKNOWN);
  assert.equal(pkg.original_query, UNKNOWN);
  assert.equal(pkg.run_id, UNKNOWN);
});

test("missing fields: a malformed (non-object) pipelineResult is handled safely, never throws", () => {
  assert.doesNotThrow(() => buildEvidencePackage("not an object", {}));
  assert.doesNotThrow(() => buildEvidencePackage(42, {}));
  assert.doesNotThrow(() => buildEvidencePackage([], {}));
});

test("missing fields: an empty-string or whitespace-only options.runId falls back to UNKNOWN, never an empty string", () => {
  const pkg1 = buildEvidencePackage(syntheticPipelineResult(), {}, { runId: "" });
  const pkg2 = buildEvidencePackage(syntheticPipelineResult(), {}, { runId: "   " });
  assert.equal(pkg1.run_id, UNKNOWN);
  assert.equal(pkg2.run_id, UNKNOWN);
});

test("options.runId, when genuinely supplied by the caller, is used verbatim", () => {
  const pkg = buildEvidencePackage(syntheticPipelineResult(), {}, { runId: "run-abc-123" });
  assert.equal(pkg.run_id, "run-abc-123");
});

test("missing fields: data_quality absent from risk_summary degrades freshness/data-quality status to UNKNOWN, never guessed", () => {
  const pkg = buildEvidencePackage(syntheticPipelineResult(), {});
  assert.equal(pkg.freshness_status, UNKNOWN);
  assert.equal(pkg.data_quality_status, UNKNOWN);
});

test("when data_quality IS present on risk_summary, freshness_status/data_quality_status are read from it verbatim", () => {
  const pipelineResult = syntheticPipelineResult();
  pipelineResult.response.risk_summary.data_quality = { freshnessStatus: "STALE", qualityStatus: "LOW" };
  const pkg = buildEvidencePackage(pipelineResult, {});
  assert.equal(pkg.freshness_status, "STALE");
  assert.equal(pkg.data_quality_status, "LOW");
});

// --- No mutation of the original pipelineResult ---

test("no mutation: pipelineResult is byte-for-byte unchanged after building the Evidence Package", () => {
  const pipelineResult = syntheticPipelineResult();
  const before = JSON.parse(JSON.stringify(pipelineResult));
  buildEvidencePackage(pipelineResult, { query: "Assess BTC" }, { runId: "run-1" });
  assert.deepEqual(pipelineResult, before);
});

test("no mutation: a real end-to-end pipelineResult from processRequest() is also unchanged", () => {
  const pipelineResult = processRequest(bullishRequest());
  const before = JSON.parse(JSON.stringify(pipelineResult));
  buildEvidencePackage(pipelineResult, bullishRequest());
  assert.deepEqual(pipelineResult, before);
});

test("no mutation: mutating the returned Evidence Package's arrays never affects pipelineResult's own arrays (no shared references)", () => {
  const pipelineResult = syntheticPipelineResult();
  const pkg = buildEvidencePackage(pipelineResult, {});
  assert.notEqual(pkg.domain_evidence.news.key_events, pipelineResult.response.news_summary.key_events);
  assert.notEqual(pkg.uncertainties, pipelineResult.response.uncertainties);
});

test("no mutation: this module never assigns to any property of its pipelineResult/request/options parameters (structural check)", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("./evidencePackage.js"), "utf8");
  // No assignment into pipelineResult./response./request./options.
  // anywhere — the negative lookahead excludes ==/=== comparisons
  // (e.g. `safeResult.response === "object"`), which are reads, not
  // writes.
  assert.ok(!/(pipelineResult|response|request|options|safeResult|safeRequest|safeOptions)\.[a-zA-Z_]+\s*=(?!=)/.test(src));
});

// --- Isolation from the deterministic system ---

test("isolation: this module never requires the orchestrator, any agent, a provider adapter, server.js, or app.js", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("./evidencePackage.js"), "utf8");
  const requireLines = src.match(/require\("[^"]+"\)/g) || [];
  const forbidden = requireLines.filter((line) => /orchestrator|agents\/|providers\/|server\.js|app\.js/i.test(line));
  assert.deepEqual(forbidden, []);
});

// Step 5D update: app.js now legitimately, explicitly wires the LLM
// layer in (via llm/reasoningService.js, never by calling
// buildEvidencePackage() itself or duplicating its logic) — so app.js
// mentioning evidencePackage.js in its own descriptive comments is now
// expected, not a violation. server.js and orchestrator/index.js must
// still never reference it at all: server.js's route behavior was not
// modified by Step 5D, and the orchestrator must never know the LLM
// layer exists.
test("isolation: buildEvidencePackage is never called directly from server.js or orchestrator/index.js, and app.js never duplicates its logic (only delegates via llm/reasoningService.js)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  for (const rel of ["../server.js", "../orchestrator/index.js"]) {
    const full = path.resolve(__dirname, rel);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, "utf8");
    assert.ok(!/evidencePackage|buildEvidencePackage/.test(src), `${rel} unexpectedly references the Evidence Package layer`);
  }

  const appSrc = fs.readFileSync(path.resolve(__dirname, "../app.js"), "utf8");
  // app.js may talk ABOUT evidencePackage.js in comments (Step 5D's
  // module header explains the wiring), but must never require() it
  // directly or call buildEvidencePackage() itself — that stays solely
  // llm/reasoningService.js's job.
  assert.ok(!/require\(["'].*evidencePackage["']\)/.test(appSrc), "app.js must not require evidencePackage.js directly");
  assert.ok(!/buildEvidencePackage\(/.test(appSrc), "app.js must not call buildEvidencePackage() itself");
});
