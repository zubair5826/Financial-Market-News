// Section 10 — Orchestrator. STEP 12: wires the real pipeline together —
// USER REQUEST -> DATA CONTROLLER -> SPECIALIST AGENTS -> TRADE SETUP
// -> RISK MANAGER -> CHIEF TRADING MANAGER -> STRUCTURED USER RESPONSE.
//
// ON THE DATA CONTROLLER'S ROLE HERE (read this before changing the
// wiring below): core/dataRecord.js's Data Contract was built for
// generic price/value observations (Step 4). The four specialist
// agents (News/Macro/Technical/Sentiment) each have their own
// domain-shaped contracts — a headline, a macro indicator, an OHLCV
// candle, a sentiment record — that were deliberately never bridged to
// that generic shape, documented as a conscious limitation in every
// one of their READMEs since Step 5: there's no real provider yet to
// anchor a mapping against, and inventing one would mean guessing at
// structure this system has no evidence for. So "do not bypass the
// Data Controller" is honored like this: whatever generic market data
// actually IS supplied (request.marketData) genuinely runs through
// runDataController() below — nothing skips that. It does NOT mean
// forcing news/macro/candle/sentiment payloads through a contract that
// was never designed to represent them; each specialist validates its
// own payload directly, exactly as designed in Steps 5–8. This is a
// deliberate architecture note, not an oversight.

const { failSafe, ERROR_CODES } = require("../core/errors");
const { UNKNOWN } = require("../core/constants");
const { logEvent } = require("../logs/logger");

const { runDataController } = require("../agents/data-controller");
const { runNewsAgent } = require("../agents/news-agent");
const { runMacroAgent } = require("../agents/macro-agent");
const { runTechnicalAgent } = require("../agents/technical-agent");
const { runSentimentAgent } = require("../agents/sentiment-agent");
const { runTradeSetupAgent } = require("../agents/trade-setup-agent");
const { runRiskManager } = require("../agents/risk-manager");
const { runChiefTradingManager } = require("../agents/chief-trading-manager");

// Validates the shape of an incoming user request. Does not interpret
// it, identify an asset, or call any agent. Unchanged from Step 3.
function receiveRequest(request) {
  if (!request || typeof request !== "object" || typeof request.query !== "string" || !request.query.trim()) {
    return failSafe(ERROR_CODES.MALFORMED_DATA, "request.query is required and must be a non-empty string.");
  }
  return { ok: true, request };
}

// Extracts the asset this request is about. An explicit request.asset
// is trusted as-is; otherwise this looks for agreement across whatever
// data payloads were supplied (their own .asset fields), never
// guessing a value that isn't literally present somewhere in the
// request. No agreement at all -> a structured failure, not a silent
// UNKNOWN treated as if it were fine to proceed on.
function identifyAsset(request) {
  if (request && typeof request.asset === "string" && request.asset.trim()) {
    return { ok: true, asset: request.asset.trim() };
  }

  const payloads = [
    request && request.marketData,
    request && request.newsData,
    request && request.macroData,
    request && request.technicalCandles,
    request && request.sentimentData,
  ];

  const assets = new Set();
  for (const payload of payloads) {
    if (!Array.isArray(payload)) continue;
    for (const item of payload) {
      const candidate = item && item.asset;
      if (candidate && candidate !== "UNKNOWN") assets.add(candidate);
    }
  }

  if (assets.size === 1) return { ok: true, asset: [...assets][0] };
  if (assets.size > 1) return { ok: true, asset: "MULTIPLE" };

  return failSafe(ERROR_CODES.MISSING_DATA, "No asset was specified and none could be inferred from the supplied data.");
}

const DATA_PAYLOAD_KEYS = Object.freeze([
  "marketData",
  "newsData",
  "macroData",
  "technicalCandles",
  "sentimentData",
  "upcomingEvents",
  "centralBankEvents",
]);

// Structural pre-flight check only — each agent still runs its own
// deep validation on its own payload (that responsibility is never
// duplicated or bypassed here). This just catches a payload field that
// exists but isn't even an array, before wasting a call on it.
function validateInputs(request) {
  const warnings = [];
  const errors = [];

  if (!request || typeof request !== "object") {
    return { ok: false, warnings, errors: [failSafe(ERROR_CODES.MALFORMED_DATA, "request must be an object.")] };
  }

  let suppliedPayloads = 0;
  for (const key of DATA_PAYLOAD_KEYS) {
    if (request[key] === undefined) continue;
    if (!Array.isArray(request[key])) {
      errors.push(failSafe(ERROR_CODES.MALFORMED_DATA, `request.${key} must be an array.`, { key }));
      continue;
    }
    suppliedPayloads += 1;
  }

  if (suppliedPayloads === 0) {
    warnings.push(
      "No data payloads were supplied (marketData/newsData/macroData/technicalCandles/sentimentData) — downstream agents will report their own DATA UNAVAILABLE state."
    );
  }

  return { ok: errors.length === 0, warnings, errors };
}

// PER-DOMAIN FRESHNESS (Step 106). core/freshness.js needs a
// { freshMaxMs, agingMaxMs } pair, and every specialist reads it from
// the SAME shared options object this orchestrator hands out — which
// meant one single window had to cover news, macro, candles and
// sentiment at once, even though config/freshness.js correctly defines
// a different, evidence-based window per domain. A 30-day macro window
// applied to a news headline would call a three-week-old article
// FRESH; that is exactly the kind of quietly-wrong signal this project
// exists to avoid.
//
// The fix is this one helper. When a caller supplies
// options.freshnessThresholdsByDomain — a plain map keyed by the
// domain names below — each specialist is handed ITS OWN window
// instead of the shared one. Rules, deliberately strict:
//   - A domain PRESENT in the map gets that map's value.
//   - A domain ABSENT from the map gets `undefined`, which
//     core/freshness.js already resolves to FRESHNESS_STATES.UNKNOWN.
//     It is never quietly given another domain's window: an honest
//     UNKNOWN beats a confidently wrong FRESH.
//   - No map supplied at all -> the shared options object is passed
//     through completely untouched, so every existing caller and test
//     that only sets options.freshnessThresholds behaves exactly as
//     before.
// Entrypoints (app.js, providers/marketIntelligenceApplicationService.js)
// only build this map when the caller supplied no explicit
// options.freshnessThresholds of their own, so an explicit caller
// value is still never overridden.
const FRESHNESS_DOMAINS = Object.freeze(["marketData", "news", "macro", "technical", "sentiment"]);

function optionsForDomain(options = {}, domain) {
  const byDomain = options.freshnessThresholdsByDomain;
  if (!byDomain || typeof byDomain !== "object") return options;
  return { ...options, freshnessThresholds: byDomain[domain] };
}

// Runs the Data Controller on request.marketData if supplied (see the
// module header for why this is the ONLY payload that goes through it),
// and shapes the raw per-specialist payloads + shared options. Nothing
// here validates the specialist payloads themselves — that's each
// agent's own job, unchanged.
function prepareAgentInputs(request, options = {}) {
  let dataControllerOutcome = null;
  if (Array.isArray(request.marketData) && request.marketData.length > 0) {
    dataControllerOutcome = runDataController(request.marketData, optionsForDomain(options, "marketData"));
  }

  return {
    dataControllerOutcome,
    newsInput: Array.isArray(request.newsData) ? request.newsData : [],
    macroInput: Array.isArray(request.macroData) ? request.macroData : [],
    technicalInput: Array.isArray(request.technicalCandles) ? request.technicalCandles : [],
    sentimentInput: Array.isArray(request.sentimentData) ? request.sentimentData : [],
    upcomingEvents: Array.isArray(request.upcomingEvents) ? request.upcomingEvents : [],
    centralBankEvents: Array.isArray(request.centralBankEvents) ? request.centralBankEvents : [],
    sharedOptions: options,
  };
}

// Calls all 4 specialist agents. Each call is individually guarded: a
// specialist that throws unexpectedly does not take down the other 3
// or fabricate a substitute report — its slot is recorded as null and
// the failure is preserved as a structured error, never hidden.
function dispatchSpecialists(prepared) {
  const outcomes = {};
  const errors = [];

  const jobs = [
    ["news", () => runNewsAgent(prepared.newsInput, optionsForDomain(prepared.sharedOptions, "news"))],
    [
      "macro",
      () =>
        runMacroAgent(prepared.macroInput, {
          ...optionsForDomain(prepared.sharedOptions, "macro"),
          upcomingEvents: prepared.upcomingEvents,
          centralBankEvents: prepared.centralBankEvents,
        }),
    ],
    ["technical", () => runTechnicalAgent(prepared.technicalInput, optionsForDomain(prepared.sharedOptions, "technical"))],
    ["sentiment", () => runSentimentAgent(prepared.sentimentInput, optionsForDomain(prepared.sharedOptions, "sentiment"))],
  ];

  for (const [key, job] of jobs) {
    try {
      outcomes[key] = job();
    } catch (err) {
      outcomes[key] = null;
      errors.push(failSafe(ERROR_CODES.INVALID_RESPONSE, `The ${key} agent failed unexpectedly: ${err.message}`, { agent: key }));
    }
  }

  return { outcomes, errors };
}

// Extracts each specialist's report from dispatchSpecialists()'s
// outcomes. A specialist that failed or wasn't run contributes null,
// never a fabricated report — missing ones are listed explicitly so
// nothing is silently dropped downstream.
function collectReports(dispatchOutcome) {
  const { outcomes, errors } = dispatchOutcome;

  const newsReport = outcomes.news ? outcomes.news.report : null;
  const macroReport = outcomes.macro ? outcomes.macro.report : null;
  const technicalReport = outcomes.technical ? outcomes.technical.report : null;
  const sentimentReport = outcomes.sentiment ? outcomes.sentiment.report : null;

  const missing = [];
  if (!newsReport) missing.push("news");
  if (!macroReport) missing.push("macro");
  if (!technicalReport) missing.push("technical");
  if (!sentimentReport) missing.push("sentiment");

  return { newsReport, macroReport, technicalReport, sentimentReport, missing, errors };
}

function sendToTradeSetup(collected, options) {
  return runTradeSetupAgent(
    {
      newsReport: collected.newsReport,
      macroReport: collected.macroReport,
      technicalReport: collected.technicalReport,
      sentimentReport: collected.sentimentReport,
    },
    options
  );
}

function sendToRiskManager(tradeSetupOutcome, collected, options) {
  return runRiskManager(
    {
      tradeSetupReport: tradeSetupOutcome.report,
      newsReport: collected.newsReport,
      macroReport: collected.macroReport,
      technicalReport: collected.technicalReport,
      sentimentReport: collected.sentimentReport,
    },
    options
  );
}

function sendToChiefManager(tradeSetupOutcome, riskOutcome, collected, options) {
  return runChiefTradingManager(
    {
      newsReport: collected.newsReport,
      macroReport: collected.macroReport,
      technicalReport: collected.technicalReport,
      sentimentReport: collected.sentimentReport,
      tradeSetupReport: tradeSetupOutcome.report,
      riskReport: riskOutcome.report,
    },
    options
  );
}

// Shapes the final structured response. Every warning/error/missing-
// information signal collected across the whole pipeline is preserved
// here — a failed or missing specialist never becomes fabricated data,
// per the Step 12 spec's explicit requirement. Conflicts are not
// re-summarized here since the Chief Trading Manager's own report
// (returned as `response`) already carries the full, detailed
// conflicting_evidence — duplicating it would risk the two copies
// drifting out of sync.
function returnResponse(pipelineState) {
  if (pipelineState.failure) {
    return {
      ok: false,
      timestamp: pipelineState.timestamp,
      asset: UNKNOWN,
      response: null,
      pipeline_summary: { stage_failed: pipelineState.stage },
      warnings: [],
      errors: [pipelineState.failure],
    };
  }

  const { timestamp, asset, dataControllerOutcome, inputWarnings, inputErrors, dispatchErrors, collected, tradeSetupOutcome, riskOutcome, chiefOutcome } =
    pipelineState;

  const warnings = [
    ...inputWarnings,
    ...(dataControllerOutcome ? dataControllerOutcome.result.warnings : []),
    ...(collected.newsReport ? collected.newsReport.warnings : []),
    ...(collected.macroReport ? collected.macroReport.warnings : []),
    ...(collected.technicalReport ? collected.technicalReport.warnings : []),
    ...(collected.sentimentReport ? collected.sentimentReport.warnings : []),
    ...tradeSetupOutcome.report.warnings,
    ...riskOutcome.report.warnings,
    ...chiefOutcome.report.warnings,
  ];
  if (collected.missing.length > 0) {
    warnings.push(`Specialist reports missing from this pipeline run: ${collected.missing.join(", ")}.`);
  }

  const errors = [
    ...inputErrors,
    ...(dataControllerOutcome ? dataControllerOutcome.result.errors : []),
    ...dispatchErrors,
    ...collected.errors,
  ];

  return {
    ok: true,
    timestamp,
    asset,
    response: chiefOutcome.report,
    pipeline_summary: {
      data_controller_status: dataControllerOutcome ? dataControllerOutcome.result.controller_status : "NOT_RUN",
      news_status: collected.newsReport ? "OK" : "MISSING",
      macro_status: collected.macroReport ? "OK" : "MISSING",
      technical_status: collected.technicalReport ? "OK" : "MISSING",
      sentiment_status: collected.sentimentReport ? "OK" : "MISSING",
      trade_setup_status: tradeSetupOutcome.report.setup_status,
      risk_decision: riskOutcome.report.risk_decision,
      final_assessment: chiefOutcome.report.final_assessment,
      decision_status: chiefOutcome.report.decision_status,
    },
    warnings,
    errors,
  };
}

// The full pipeline, in the exact order the Step 12 spec lays out.
// Never executes a trade, never connects to a broker/exchange, never
// creates an order — there is no such code path anywhere in this
// function or anything it calls.
function processRequest(request) {
  const timestamp = new Date().toISOString();

  const received = receiveRequest(request);
  if (!received.ok) {
    logEvent({
      agent: "orchestrator",
      request: { stage: "receiveRequest" },
      dataSource: UNKNOWN,
      responseStatus: "FAILED",
      warnings: [],
      errors: [received],
    });
    return returnResponse({ timestamp, failure: received, stage: "receiveRequest" });
  }

  const inputValidation = validateInputs(request);
  const assetResult = identifyAsset(request);
  const asset = assetResult.ok ? assetResult.asset : UNKNOWN;
  if (!assetResult.ok) {
    inputValidation.warnings.push(
      "No asset could be identified — downstream agents will report INSUFFICIENT_DATA/UNKNOWN for anything asset-specific."
    );
  }

  const options = { ...(request.options || {}), requestedAsset: assetResult.ok ? assetResult.asset : undefined };

  const prepared = prepareAgentInputs(request, options);
  const dispatchOutcome = dispatchSpecialists(prepared);
  const collected = collectReports(dispatchOutcome);

  const tradeSetupOutcome = sendToTradeSetup(collected, options);
  const riskOutcome = sendToRiskManager(tradeSetupOutcome, collected, options);
  const chiefOutcome = sendToChiefManager(tradeSetupOutcome, riskOutcome, collected, options);

  const response = returnResponse({
    timestamp,
    asset,
    dataControllerOutcome: prepared.dataControllerOutcome,
    inputWarnings: inputValidation.warnings,
    inputErrors: inputValidation.errors,
    dispatchErrors: dispatchOutcome.errors,
    collected,
    tradeSetupOutcome,
    riskOutcome,
    chiefOutcome,
  });

  logEvent({
    agent: "orchestrator",
    request: { asset, query: request.query },
    dataSource:
      [
        ...(collected.newsReport ? collected.newsReport.sources : []),
        ...(collected.macroReport ? collected.macroReport.sources : []),
        ...(collected.technicalReport ? collected.technicalReport.sources : []),
        ...(collected.sentimentReport ? collected.sentimentReport.sources : []),
      ].join(",") || UNKNOWN,
    responseStatus: response.pipeline_summary.decision_status,
    warnings: response.warnings,
    errors: response.errors,
  });

  return response;
}

module.exports = {
  FRESHNESS_DOMAINS,
  optionsForDomain,
  receiveRequest,
  identifyAsset,
  validateInputs,
  prepareAgentInputs,
  dispatchSpecialists,
  collectReports,
  sendToTradeSetup,
  sendToRiskManager,
  sendToChiefManager,
  returnResponse,
  processRequest,
};
