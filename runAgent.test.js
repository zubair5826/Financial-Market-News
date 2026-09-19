// Tests for the personal-use CLI (runAgent.js).
//
// Argument parsing and invocation building are pure functions and are
// tested directly — no process is spawned, no provider is enabled, and
// no network call is possible from anything exercised here. The one
// end-to-end test at the bottom runs main() with every domain
// explicitly disabled, so it exercises the real composition and the
// real renderer without touching a provider or the real run store.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { parseArgs, buildInvocation, main } = require("./runAgent");

const TEST_RUNS_FILE = path.join(os.tmpdir(), `run-agent-test-runs-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);

test.after(() => {
  try {
    fs.unlinkSync(TEST_RUNS_FILE);
  } catch {
    // Already absent.
  }
});

async function withEnvVar(name, value, fn) {
  const original = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
}

// Captures console.log/console.error for the duration of fn().
async function captureOutput(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const out = [];
  const err = [];
  console.log = (...args) => out.push(args.join(" "));
  console.error = (...args) => err.push(args.join(" "));
  try {
    const value = await fn();
    return { value, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

// ============================================================
// A. Argument parsing
// ============================================================

test("A1. parses positionals, --flag=value and bare --flag", () => {
  const parsed = parseArgs(["SPY", "--query=Assess SPY now", "--llm", "--format=json"]);
  assert.deepEqual(parsed.positionals, ["SPY"]);
  assert.equal(parsed.flags.query, "Assess SPY now");
  assert.equal(parsed.flags.llm, true);
  assert.equal(parsed.flags.format, "json");
});

test("A2. an empty argv parses to empty structures, never a guess", () => {
  const parsed = parseArgs([]);
  assert.deepEqual(parsed.positionals, []);
  assert.deepEqual(parsed.flags, {});
});

// ============================================================
// B. Invocation building — defaults
// ============================================================

test("B1. all three live domains are enabled by default", () => {
  const invocation = buildInvocation(parseArgs(["SPY"]));
  assert.deepEqual(invocation.options.macro, { enabled: true });
  assert.deepEqual(invocation.options.market, { enabled: true });
  assert.deepEqual(invocation.options.news, { enabled: true });
});

test("B2. each domain can be turned off individually", () => {
  const invocation = buildInvocation(parseArgs(["SPY", "--no-news"]));
  assert.equal(invocation.options.macro.enabled, true);
  assert.equal(invocation.options.market.enabled, true);
  assert.equal(invocation.options.news.enabled, false);
});

test("B3. the asset is taken from the positional and threaded into the request", () => {
  const invocation = buildInvocation(parseArgs(["MSFT"]));
  assert.equal(invocation.asset, "MSFT");
  assert.equal(invocation.request.asset, "MSFT");
  assert.equal(invocation.request.query, "Assess MSFT");
});

test("B4. an explicit --query overrides the generated default", () => {
  const invocation = buildInvocation(parseArgs(["MSFT", "--query=What is the macro backdrop?"]));
  assert.equal(invocation.request.query, "What is the macro backdrop?");
  assert.equal(invocation.request.asset, "MSFT");
});

test("B5. timeframes and series are forwarded as the existing pipeline options, not new ones", () => {
  const invocation = buildInvocation(parseArgs(["SPY", "--timeframes=1day,1week", "--series=GNPCA,CPIAUCSL"]));
  assert.deepEqual(invocation.options.marketTimeframes, ["1day", "1week"]);
  assert.deepEqual(invocation.options.macroSeriesIds, ["GNPCA", "CPIAUCSL"]);
});

test("B6. omitted timeframes/series are left absent so each layer's own default applies", () => {
  const invocation = buildInvocation(parseArgs(["SPY"]));
  assert.equal("marketTimeframes" in invocation.options, false);
  assert.equal("macroSeriesIds" in invocation.options, false);
});

test("B7. the Claude layer is off unless --llm is passed", () => {
  assert.equal("llm" in buildInvocation(parseArgs(["SPY"])).options, false);
  assert.deepEqual(buildInvocation(parseArgs(["SPY", "--llm"])).options.llm, { enabled: true });
});

test("B8. format defaults to text and accepts json", () => {
  assert.equal(buildInvocation(parseArgs(["SPY"])).format, "text");
  assert.equal(buildInvocation(parseArgs(["SPY", "--format=json"])).format, "json");
});

test("B9. an unrecognised --format falls back to text and says so, never silently", () => {
  const invocation = buildInvocation(parseArgs(["SPY", "--format=yaml"]));
  assert.equal(invocation.format, "text");
  assert.ok(invocation.warnings.some((w) => w.includes("--format")));
});

test("B10. RUN_STORE_FILE is honored, matching server.js's own variable", async () => {
  await withEnvVar("RUN_STORE_FILE", "/tmp/custom-runs.jsonl", () => {
    const invocation = buildInvocation(parseArgs(["SPY"]));
    assert.deepEqual(invocation.options.runStore, { filePath: "/tmp/custom-runs.jsonl" });
  });
  await withEnvVar("RUN_STORE_FILE", undefined, () => {
    assert.equal("runStore" in buildInvocation(parseArgs(["SPY"])).options, false);
  });
});

// ============================================================
// C. Position sizing — all-six-or-nothing preserved
// ============================================================

test("C1. no sizing flags means no positionSizingParams at all — nothing is invented", () => {
  const invocation = buildInvocation(parseArgs(["SPY"]));
  assert.equal("positionSizingParams" in invocation.request.options, false);
});

test("C2. all six flags map to the exact parameter names the Risk Manager requires", () => {
  const invocation = buildInvocation(
    parseArgs(["SPY", "--balance=10000", "--risk=0.01", "--leverage=1", "--entry=100", "--stop=95", "--contract=1"])
  );
  assert.deepEqual(invocation.request.options.positionSizingParams, {
    accountBalance: 10000,
    riskPercentage: 0.01,
    leverage: 1,
    entryPrice: 100,
    stopPrice: 95,
    contractSize: 1,
  });
});

test("C3. a PARTIAL set is forwarded as-is — the CLI never completes the missing values", () => {
  const invocation = buildInvocation(parseArgs(["SPY", "--balance=10000", "--risk=0.01"]));
  assert.deepEqual(invocation.request.options.positionSizingParams, { accountBalance: 10000, riskPercentage: 0.01 });
  // No defaulted leverage/entry/stop/contract anywhere.
  assert.equal("leverage" in invocation.request.options.positionSizingParams, false);
  assert.equal("entryPrice" in invocation.request.options.positionSizingParams, false);
});

test("C4. a non-numeric sizing value is reported and omitted, never coerced or guessed", () => {
  const invocation = buildInvocation(parseArgs(["SPY", "--balance=ten-thousand", "--risk=0.01"]));
  assert.equal("accountBalance" in invocation.request.options.positionSizingParams, false);
  assert.equal(invocation.request.options.positionSizingParams.riskPercentage, 0.01);
  assert.ok(invocation.warnings.some((w) => w.includes("--balance")));
});

// ============================================================
// D. Help / missing asset
// ============================================================

test("D1. --help prints usage and exits 0 without running anything", async () => {
  const { value: code, stdout } = await captureOutput(() => main(["--help"]));
  assert.equal(code, 0);
  assert.match(stdout, /Usage: node runAgent\.js/);
});

test("D2. a missing asset prints usage and exits 1 without running anything", async () => {
  const { value: code, stderr } = await captureOutput(() => main([]));
  assert.equal(code, 1);
  assert.match(stderr, /An asset\/symbol is required/);
});

test("D3. the usage text says plainly that nothing is executed", async () => {
  const { stdout } = await captureOutput(() => main(["--help"]));
  assert.match(stdout, /no broker connection, no order, no trade execution/i);
});

// ============================================================
// E. End-to-end, offline
// ============================================================

test("E1. a full run with every domain disabled produces a rendered text report and no network call", async () => {
  const originalFetch = global.fetch;
  let networkCalled = false;
  global.fetch = (...args) => {
    networkCalled = true;
    throw new Error(`Unexpected real network call: ${args[0]}`);
  };

  try {
    await withEnvVar("RUN_STORE_FILE", TEST_RUNS_FILE, async () => {
      const { value: code, stdout } = await captureOutput(() =>
        main(["SPY", "--no-macro", "--no-market", "--no-news"])
      );

      assert.equal(code, 0);
      assert.equal(networkCalled, false);
      assert.match(stdout, /MARKET ANALYSIS REPORT/);
      assert.match(stdout, /Instrument : SPY/);
      assert.match(stdout, /decision_status/);
      // No credential of any kind appears in the output.
      assert.ok(!/api[_-]?key/i.test(stdout));
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("E2. --format=json emits the full structured result instead of text", async () => {
  await withEnvVar("RUN_STORE_FILE", TEST_RUNS_FILE, async () => {
    const { value: code, stdout } = await captureOutput(() =>
      main(["SPY", "--no-macro", "--no-market", "--no-news", "--format=json"])
    );

    assert.equal(code, 0);
    const parsed = JSON.parse(stdout);
    assert.deepEqual(Object.keys(parsed).sort(), ["diagnostics", "llmAnnotation", "persistence", "pipelineResult"]);
    assert.equal(parsed.llmAnnotation, null);
  });
});

test("E3. the run is persisted to the configured store, never to the real data/runs.jsonl", async () => {
  await withEnvVar("RUN_STORE_FILE", TEST_RUNS_FILE, async () => {
    const { value: code } = await captureOutput(() => main(["BTC", "--no-macro", "--no-market", "--no-news"]));
    assert.equal(code, 0);

    const lines = fs.readFileSync(TEST_RUNS_FILE, "utf8").trim().split("\n").filter(Boolean);
    const record = JSON.parse(lines[lines.length - 1]);
    assert.equal(record.requested_instrument, "BTC");
  });
});

test("E4. sizing flags reach the Risk Manager end to end, and the all-six rule still governs", async () => {
  await withEnvVar("RUN_STORE_FILE", TEST_RUNS_FILE, async () => {
    const partial = await captureOutput(() =>
      main(["SPY", "--no-macro", "--no-market", "--no-news", "--balance=10000", "--format=json"])
    );
    const partialSizing = JSON.parse(partial.stdout).pipelineResult.response.risk_summary.position_size_status;
    assert.equal(partialSizing.status, "DATA_UNAVAILABLE");
    assert.ok(partialSizing.missing_parameters.includes("entryPrice"));
    assert.ok(!partialSizing.missing_parameters.includes("accountBalance"));
  });
});
