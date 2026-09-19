// Human-readable renderer for the Chief Trading Manager Report.
//
// A pure, read-only formatting layer and nothing more. It computes no
// analysis, derives no status, and never invents a value: every line
// below is printed from a field the deterministic pipeline already
// produced. A field the pipeline did not produce prints as UNKNOWN or
// "(none)" — never as a guess, and never silently omitted, because a
// gap the reader cannot see is worse than a gap they can.
//
// JSON remains fully available (runAgent.js --format=json), and this
// renderer is never on the path of any decision. Nothing here is an
// execution instruction: final_assessment, decision_status and
// risk_decision are decision-INTELLIGENCE labels, exactly as
// agents/chief-trading-manager/report.js and README.md define them.
//
// The Claude annotation, when present, is rendered in its own clearly
// fenced ADVISORY block at the very end, after every deterministic
// value, so it can never be read as part of the decision.

const UNKNOWN = "UNKNOWN";

function value(v) {
  if (v === null || v === undefined || v === "") return UNKNOWN;
  return String(v);
}

// One-line JSON for a structured entry that has no obvious prose form.
// Truncation is explicitly marked — never silent.
function compact(entry, maxLength = 300) {
  let text;
  try {
    text = JSON.stringify(entry);
  } catch {
    return "(unserializable entry)";
  }
  if (typeof text !== "string") return "(unserializable entry)";
  return text.length > maxLength ? `${text.slice(0, maxLength)}… (truncated, full value in --format=json)` : text;
}

function section(title, lines) {
  return [`--- ${title} ---`, ...(lines.length > 0 ? lines : ["(none)"]), ""];
}

function bulletList(items, render) {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.map((item) => `  - ${render ? render(item) : value(item)}`);
}

// Each specialist summary carries a `bias`, its own confidence, and
// its own sources/conflicts — all copied verbatim by
// agents/chief-trading-manager/evidence.js.
function renderDomainSummary(label, summary) {
  if (!summary) return [`  ${label}: NOT AVAILABLE (no report reached the Chief Trading Manager)`];
  const lines = [`  ${label}: bias ${value(summary.bias)} | confidence ${value(summary.confidence)}`];
  if (Array.isArray(summary.sources) && summary.sources.length > 0) {
    lines.push(`    sources: ${summary.sources.join(", ")}`);
  }
  if (Array.isArray(summary.conflicts) && summary.conflicts.length > 0) {
    lines.push(`    internal conflicts: ${summary.conflicts.length}`);
  }
  return lines;
}

function renderTradeSetup(summary) {
  if (!summary) return ["  NOT AVAILABLE (no trade setup report reached the Chief Trading Manager)"];
  return [
    `  setup_status : ${value(summary.setup_status)}`,
    `  direction    : ${value(summary.direction)}`,
    `  setup_quality: ${value(summary.setup_quality)}`,
    `  confidence   : ${value(summary.confidence)}`,
  ];
}

// Position sizing is reported exactly as the Risk Manager computed it.
// DATA_UNAVAILABLE is the honest, expected result whenever the caller
// did not supply all six required sizing parameters — this renderer
// never fills one in, and says plainly which ones were missing.
function renderPositionSizing(riskSummary) {
  const sizing = riskSummary && riskSummary.position_size_status;
  if (!sizing) return ["  position sizing: UNKNOWN (no risk report reached the Chief Trading Manager)"];
  const lines = [`  position sizing: ${value(sizing.status)}`];
  if (sizing.position_size !== undefined) lines.push(`    position_size: ${value(sizing.position_size)}`);
  if (Array.isArray(sizing.missing_parameters) && sizing.missing_parameters.length > 0) {
    lines.push(`    missing parameters (never assumed): ${sizing.missing_parameters.join(", ")}`);
  }
  if (sizing.notes) lines.push(`    ${sizing.notes}`);
  return lines;
}

function renderConflict(entry) {
  if (!entry || typeof entry !== "object") return value(entry);
  if (entry.type === "SPECIALIST_DISAGREEMENT" && entry.reason) return `SPECIALIST_DISAGREEMENT: ${entry.reason}`;
  if (entry.type === "INTERNAL_CONFLICT") {
    const count = Array.isArray(entry.detail) ? entry.detail.length : 1;
    return `INTERNAL_CONFLICT in ${value(entry.domain)}: ${count} conflict(s) — ${compact(entry.detail)}`;
  }
  return compact(entry);
}

function renderSupporting(entry) {
  if (!entry || typeof entry !== "object") return value(entry);
  return `${value(entry.domain)}: bias ${value(entry.bias)} (confidence ${value(entry.confidence)})`;
}

function renderWarning(entry) {
  if (entry && typeof entry === "object") return value(entry.message) === UNKNOWN ? compact(entry) : value(entry.message);
  return value(entry);
}

// llmAnnotation is rendered LAST, clearly fenced and labelled
// ADVISORY. It is commentary on a decision that was already final
// before it was requested — it never contributed to any value printed
// above it, and a non-VALID status changes nothing about them.
function renderLlmAnnotation(llmAnnotation) {
  if (!llmAnnotation) return [];

  const header = [
    "=========================================================",
    "  ADVISORY — OPTIONAL CLAUDE REASONING LAYER",
    "  Commentary only. This did NOT influence final_assessment,",
    "  decision_status, risk_decision, or any risk computation",
    "  above; all of those were already final before it ran.",
    "=========================================================",
    `  status: ${value(llmAnnotation.status)}`,
  ];

  if (llmAnnotation.status !== "VALID" || !llmAnnotation.output) {
    const lines = [...header];
    if (llmAnnotation.code) lines.push(`  code   : ${value(llmAnnotation.code)}`);
    if (llmAnnotation.message) lines.push(`  message: ${value(llmAnnotation.message)}`);
    if (Array.isArray(llmAnnotation.errors) && llmAnnotation.errors.length > 0) {
      lines.push("  rejected because:");
      lines.push(...bulletList(llmAnnotation.errors));
    }
    lines.push("  No advisory commentary is shown for a non-VALID result.", "");
    return lines;
  }

  const output = llmAnnotation.output;
  const lines = [...header, "", "  Narrative (ADVISORY):", `    ${value(output.narrative_summary)}`, ""];

  if (Array.isArray(output.key_factors) && output.key_factors.length > 0) {
    lines.push("  Key factors (ADVISORY):");
    for (const factor of output.key_factors) {
      lines.push(`    - [${value(factor.direction)}] ${value(factor.factor)}  (ref: ${value(factor.evidence_ref)})`);
    }
    lines.push("");
  }

  lines.push("  Risk commentary (ADVISORY):", `    ${value(output.risk_commentary)}`, "");

  if (Array.isArray(output.uncertainties_acknowledged) && output.uncertainties_acknowledged.length > 0) {
    lines.push("  Uncertainties acknowledged (ADVISORY):", ...bulletList(output.uncertainties_acknowledged).map((l) => `  ${l}`), "");
  }
  if (Array.isArray(output.caveats) && output.caveats.length > 0) {
    lines.push("  Caveats (ADVISORY):", ...bulletList(output.caveats).map((l) => `  ${l}`), "");
  }

  return lines;
}

// result: the { pipelineResult, diagnostics, persistence, llmAnnotation }
//   object runAgentRequest() returns. Every field is optional — a
//   partial or failed result renders honestly rather than throwing,
//   because a renderer that crashes on a degraded run hides exactly
//   the run the reader most needs to see.
// Returns a plain string. Never mutates its argument.
function renderAgentReportText(result = {}) {
  const pipelineResult = result.pipelineResult || {};
  const report = pipelineResult.response || null;
  const runId = (result.persistence && result.persistence.run_id) || UNKNOWN;

  const lines = [
    "=========================================================",
    "  MARKET ANALYSIS REPORT",
    "  Decision intelligence only — not a trade instruction.",
    "  No broker or exchange is connected. Nothing is executed.",
    "=========================================================",
    `Instrument : ${value(pipelineResult.asset)}`,
    `Timestamp  : ${value(pipelineResult.timestamp)}`,
    `Run ID     : ${value(runId)}`,
    `Pipeline OK: ${pipelineResult.ok === undefined ? UNKNOWN : String(pipelineResult.ok)}`,
    "",
  ];

  // A run that failed before the Chief Trading Manager ever produced a
  // report (a malformed request, or an ambiguous provider/payload
  // merge) has no report to render. Say so plainly and print the
  // errors that explain it, rather than printing an empty skeleton
  // that looks like a completed analysis.
  if (!report) {
    lines.push(
      "--- NO CHIEF TRADING MANAGER REPORT WAS PRODUCED ---",
      "The run did not reach a final assessment. Nothing below was computed.",
      ""
    );
    const failures = []
      .concat(Array.isArray(pipelineResult.errors) ? pipelineResult.errors : [])
      .concat(pipelineResult.ok === false && pipelineResult.message ? [pipelineResult] : []);
    lines.push(...section("ERRORS", bulletList(failures, renderWarning)));
    lines.push(...renderLlmAnnotation(result.llmAnnotation));
    return lines.join("\n");
  }

  const riskSummary = report.risk_summary || null;
  const dataQuality = (riskSummary && riskSummary.data_quality) || null;

  lines.push(
    ...section("DECISION", [
      `  final_assessment: ${value(report.final_assessment)}`,
      `  decision_status : ${value(report.decision_status)}`,
      `  risk_decision   : ${value(riskSummary && riskSummary.risk_decision)}`,
      `  risk_level      : ${value(riskSummary && riskSummary.risk_level)}`,
      `  confidence      : ${value(report.confidence)}`,
    ])
  );

  // Surfaced from risk_summary.data_quality. Both values are the Risk
  // Manager's own already-computed labels, copied verbatim.
  lines.push(
    ...section("DATA QUALITY", [
      `  freshness_status   : ${value(dataQuality && dataQuality.freshnessStatus)}`,
      `  data_quality_status: ${value(dataQuality && dataQuality.qualityStatus)}`,
      `  stale inputs       : ${dataQuality ? String(Boolean(dataQuality.stale)) : UNKNOWN}`,
      `  unverified inputs  : ${dataQuality ? String(Boolean(dataQuality.unverified)) : UNKNOWN}`,
      `  conflicting inputs : ${dataQuality ? String(Boolean(dataQuality.conflicting)) : UNKNOWN}`,
    ])
  );

  lines.push(
    ...section("DOMAIN SUMMARIES", [
      ...renderDomainSummary("MACRO    ", report.macro_summary),
      ...renderDomainSummary("NEWS     ", report.news_summary),
      ...renderDomainSummary("TECHNICAL", report.technical_summary),
      ...renderDomainSummary("SENTIMENT", report.sentiment_summary),
    ])
  );

  lines.push(...section("TRADE SETUP", renderTradeSetup(report.trade_setup_summary)));
  lines.push(...section("RISK", [
    `  risk_level   : ${value(riskSummary && riskSummary.risk_level)}`,
    `  risk_decision: ${value(riskSummary && riskSummary.risk_decision)}`,
    ...(riskSummary && Array.isArray(riskSummary.risk_categories) && riskSummary.risk_categories.length > 0
      ? [`  categories   : ${riskSummary.risk_categories.join(", ")}`]
      : ["  categories   : (none)"]),
    ...renderPositionSizing(riskSummary),
  ]));

  lines.push(...section("SUPPORTING EVIDENCE", bulletList(report.supporting_evidence, renderSupporting)));
  lines.push(...section("CONFLICTING EVIDENCE", bulletList(report.conflicting_evidence, renderConflict)));
  lines.push(...section("MISSING INFORMATION", bulletList(report.missing_information)));
  lines.push(...section("KEY ASSUMPTIONS", bulletList(report.key_assumptions)));
  lines.push(...section("UNCERTAINTIES", bulletList(report.uncertainties)));
  lines.push(...section("WARNINGS", bulletList(pipelineResult.warnings, renderWarning)));
  lines.push(...section("ERRORS", bulletList(pipelineResult.errors, renderWarning)));
  lines.push(...section("SOURCES", bulletList(report.sources)));

  lines.push(...renderLlmAnnotation(result.llmAnnotation));

  return lines.join("\n");
}

module.exports = { renderAgentReportText };
