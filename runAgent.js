// Personal-use market-analysis CLI — the convenient front door to the
// existing pipeline.
//
// It adds no intelligence logic and no second architecture. It parses
// a few flags, builds the SAME request/options objects every other
// layer of this project already uses, calls the single unified
// composition function (agentRequest.js's runAgentRequest), and prints
// what comes back. Every option it exposes is an option the pipeline
// already read before this file existed.
//
// Why it exists: neither existing runner could do a complete run.
// runIntelligence.js takes a symbol but enables macro (FRED) only;
// runLive.js enables all three domains but hard-codes SPY and dumps
// raw JSON. Both remain untouched and keep working exactly as before.
//
// Plain process.argv parsing — no CLI framework, matching this
// project's zero-dependency rule and runIntelligence.js's own
// "smallest possible runner" convention.
//
// This runner cannot place, modify, or cancel an order. No broker or
// exchange is connected anywhere in this project, and nothing here
// executes a trade.

const { runAgentRequest } = require("./agentRequest");
const { renderAgentReportText } = require("./agentReportText");

// The six parameters agents/risk-manager/positionSizing.js requires.
// ALL SIX OR NOTHING — that rule lives in that module and is NOT
// weakened, duplicated, or pre-empted here. This CLI only forwards
// whatever the user actually typed: it never defaults, estimates, or
// completes a missing value, so a partial set still produces the
// existing, honest POSITION SIZE: DATA_UNAVAILABLE together with the
// exact list of parameters that were missing.
const SIZING_FLAGS = Object.freeze({
  balance: "accountBalance",
  risk: "riskPercentage",
  leverage: "leverage",
  entry: "entryPrice",
  stop: "stopPrice",
  contract: "contractSize",
});

const USAGE = `
Usage: node runAgent.js <ASSET> [options]

  Runs the full 8-agent pipeline over the live provider domains and
  prints the Chief Trading Manager Report. Decision intelligence only —
  no broker connection, no order, no trade execution.

  <ASSET>                 Instrument symbol, e.g. SPY, MSFT, BTC.

Options
  --query="..."           Free-text request (default: "Assess <ASSET>").
  --format=text|json      Output format (default: text).

  --no-macro              Disable the FRED macro domain (on by default).
  --no-market             Disable Alpha Vantage price candles (on by default).
  --no-news               Disable Alpha Vantage news + derived sentiment (on by default).

  --timeframes=1day,1week Market timeframes to request (default: the
                          market adapter's own default, ["1day"]).
                          Each extra timeframe is one more Alpha Vantage
                          request against a small free-tier daily quota.
  --series=GNPCA,CPIAUCSL FRED series IDs (default: GNPCA).

  --llm                   Opt in to the isolated, ADVISORY Claude
                          reasoning layer (off by default; needs
                          ANTHROPIC_API_KEY). It never influences
                          risk_decision, decision_status, or
                          final_assessment.

  Position sizing — supply ALL SIX or none. A partial set is passed
  through unchanged and honestly reported as DATA_UNAVAILABLE with the
  missing parameters named; no value is ever assumed.
  --balance=10000         Account balance.
  --risk=0.01             Fraction of balance risked (0.01 = 1%).
  --leverage=1            Leverage.
  --entry=450.25          Entry price.
  --stop=442.00           Stop price.
  --contract=1            Contract size.

  --help                  Show this message.

Environment
  FRED_API_KEY, ALPHAVANTAGE_API_KEY  Required for live data. Without
      them nothing crashes and nothing is invented — the affected
      domain reports AUTH_FAILURE and comes back empty.
  ANTHROPIC_API_KEY       Only needed with --llm.
  RUN_STORE_FILE          Override where the run record is appended
      (default: data/runs.jsonl). Same variable server.js already reads.
`;

// Splits "--name=value" / "--name" / positional. Returns the raw,
// uninterpreted pieces — interpretation happens in buildInvocation()
// so both halves stay independently testable.
function parseArgs(argv = []) {
  const flags = {};
  const positionals = [];
  const warnings = [];

  for (const arg of argv) {
    if (typeof arg !== "string") continue;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) flags[body] = true;
    else flags[body.slice(0, eq)] = body.slice(eq + 1);
  }

  return { flags, positionals, warnings };
}

function asList(rawValue) {
  if (typeof rawValue !== "string") return undefined;
  const items = rawValue
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}

// A flag value that isn't a finite number is NOT silently coerced,
// defaulted, or passed through as NaN — it is reported to the caller
// and omitted, so the Risk Manager sees a genuinely absent parameter
// rather than a fabricated or malformed one.
function collectSizingParams(flags, warnings) {
  const params = {};
  let supplied = 0;
  for (const [flagName, paramName] of Object.entries(SIZING_FLAGS)) {
    if (!(flagName in flags)) continue;
    supplied += 1;
    const parsed = Number(flags[flagName]);
    if (Number.isFinite(parsed)) params[paramName] = parsed;
    else warnings.push(`--${flagName} is not a number ("${flags[flagName]}") — it was ignored, never guessed.`);
  }
  return supplied === 0 ? undefined : params;
}

// Builds the exact { request, options } pair runAgentRequest() takes.
// Nothing here is a new schema: request.options is the same per-agent
// options object orchestrator/index.js has always read, and the
// options argument holds the same per-domain enablement flags
// runMarketIntelligenceRequest() has always read.
function buildInvocation(parsed = {}) {
  const flags = parsed.flags || {};
  const positionals = parsed.positionals || [];
  const warnings = [...(parsed.warnings || [])];

  const asset = typeof positionals[0] === "string" ? positionals[0].trim() : "";
  const query = typeof flags.query === "string" && flags.query.trim() ? flags.query.trim() : `Assess ${asset || "UNKNOWN"}`;

  const requestOptions = {};
  const positionSizingParams = collectSizingParams(flags, warnings);
  if (positionSizingParams) requestOptions.positionSizingParams = positionSizingParams;

  const request = { query, asset, options: requestOptions };

  // Every domain ON by default — the whole point of this runner. Each
  // is still passed as the same explicit { enabled: true } the
  // composition layer has always required; the default lives here, in
  // the personal CLI, and never in the shared composition function, so
  // /api/market-intelligence keeps its disabled-by-default contract.
  const options = {
    macro: { enabled: flags["no-macro"] !== true },
    market: { enabled: flags["no-market"] !== true },
    news: { enabled: flags["no-news"] !== true },
  };

  const timeframes = asList(flags.timeframes);
  if (timeframes) options.marketTimeframes = timeframes;

  const seriesIds = asList(flags.series);
  if (seriesIds) options.macroSeriesIds = seriesIds;

  if (flags.llm === true) options.llm = { enabled: true };

  const runStoreFile = typeof process.env.RUN_STORE_FILE === "string" ? process.env.RUN_STORE_FILE.trim() : "";
  if (runStoreFile) options.runStore = { filePath: runStoreFile };

  const format = flags.format === "json" ? "json" : "text";
  if (flags.format !== undefined && flags.format !== "json" && flags.format !== "text") {
    warnings.push(`--format="${flags.format}" is not recognised — defaulting to text.`);
  }

  return { request, options, format, asset, help: flags.help === true, warnings };
}

async function main(argv = process.argv.slice(2)) {
  const invocation = buildInvocation(parseArgs(argv));

  if (invocation.help || !invocation.asset) {
    if (!invocation.asset && !invocation.help) {
      console.error("An asset/symbol is required.");
    }
    console.log(USAGE);
    return invocation.help ? 0 : 1;
  }

  for (const warning of invocation.warnings) console.error(`warning: ${warning}`);

  const result = await runAgentRequest(invocation.request, invocation.options);

  if (invocation.format === "json") console.log(JSON.stringify(result, null, 2));
  else console.log(renderAgentReportText(result));

  return 0;
}

module.exports = { parseArgs, buildInvocation, main, SIZING_FLAGS, USAGE };

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error("Agent run failed:", err.message);
      process.exitCode = 1;
    });
}
