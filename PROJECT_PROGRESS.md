# Project Progress — Financial Market Intelligence

Status snapshot of the whole repository: the Market Intelligence
multi-agent pipeline, the Portfolio Intelligence system, and the
production HTTP API wrapping both. Update this file whenever a
material change lands — it is the authoritative source for "what's
done" and "what's next," not a substitute for the code or tests.

**Every decision this system makes is deterministic.** Every agent,
provider adapter, and portfolio calculation below is hand-written
logic — no model call influences a risk decision, a decision status,
or a final assessment, and none ever will.

Since Step 5D there is also an **isolated, opt-in Claude/Anthropic
reasoning layer** under `llm/` (see the section below and
`LLM_REASONING_LAYER_DESIGN.md`). It is off unless a caller sets
`options.llm.enabled === true`, it runs only *after* the deterministic
pipeline has finished, and its output is attached as a separate,
additive `llmAnnotation` field that can never replace or mutate the
deterministic result. An earlier revision of this file stated that no
LLM integration of any kind existed; that was accurate when written and
is no longer true.

## 1. Completed

### Market Intelligence — 8 deterministic agents + orchestrator
All 8 agents are implemented, tested, and wired together end to end:

- **Data Controller** (`agents/data-controller/`) — validates,
  classifies, and normalizes generic price/value observations into the
  Data Contract.
- **News Agent** (`agents/news-agent/`) — aggregates news items into an
  overall bias with conflict/duplicate detection.
- **Macro Agent** (`agents/macro-agent/`) — aggregates macroeconomic
  releases and central bank events into a bias; computes surprises only
  when both actual and expected values exist.
- **Technical Agent** (`agents/technical-agent/`) — computes indicators
  (SMA/EMA/RSI/MACD/ATR/Bollinger), trend, structure, and
  support/resistance from OHLCV candles.
- **Sentiment Agent** (`agents/sentiment-agent/`) — aggregates tagged
  sentiment records into a bias.
- **Trade Setup Agent** (`agents/trade-setup-agent/`) — synthesizes the
  four specialist reports above into a directional setup with a
  confluence/quality score. Never an order.
- **Risk Manager** (`agents/risk-manager/`) — assesses the setup for
  data-quality issues, conflicts, timing, and invalidation risk; issues
  a risk decision, with `RISK_TOO_HIGH` as an absolute override.
- **Chief Trading Manager** (`agents/chief-trading-manager/`) — final
  cross-domain synthesis and decision-status label.
- **Orchestrator** (`orchestrator/index.js`) — wires all 8 agents into
  one `processRequest()` call: `receiveRequest → identifyAsset →
  validateInputs → prepareAgentInputs → specialists → Trade Setup →
  Risk Manager → Chief Trading Manager → structured response`. Fully
  implemented, not a skeleton.

No agent or the orchestrator contains a `BUY`/`SELL`/`LONG`/`SHORT`
field, an execution function, or a broker/exchange call.

### Provider integrations
- **FRED** (`providers/adapters/fredMacroAdapter.js` +
  `fredMacroLiveSource.js` + `fredMacroApplicationService.js`) — real,
  tested macro data integration for the Macro Agent. Reads
  `FRED_API_KEY`, and only that one file reads it.
- **Alpha Vantage** (`providers/adapters/alphaVantageMarketAdapter.js`
  and `alphaVantageNewsAdapter.js` + their live-sources +
  `marketIntelligenceApplicationService.js`) — real, tested integration
  supplying technical price candles (Technical Agent) and news (News
  Agent). Reads `ALPHAVANTAGE_API_KEY`. Includes a discovered-and-fixed
  real rate-limit issue: Alpha Vantage's free tier enforces a 1
  request/second burst limit, handled with a sequential-acquisition
  1100ms delay when both market and news are requested together.
- Sentiment and the Data Controller's own generic `marketData` domain
  have **no connected provider** — this is intentional, not a gap in
  what was attempted.

### Portfolio Intelligence (fully separate system — no provider, no
Market Intelligence dependency)
- **Investor Profile** extraction (`investment/investorProfileExtraction.js`)
  and validation (`investment/investorProfileValidation.js`) — turns
  natural-language text into a structured, validated investor profile.
- **Portfolio Construction** (`investment/portfolioConstruction.js`) —
  deterministic base risk-tolerance archetypes, horizon/objective/
  liquidity nudges, and hard concentration-constraint enforcement
  (`maximumConcentration`, per-class caps, exclusions/inclusions).
  Supports an optional `existingPortfolio` input that informs
  concentration-cap math against a true total-portfolio basis — it
  never creates an implicit cap, never loosens an explicit one, never
  triggers FX conversion, and never selects a security/ticker.
- **Portfolio Intelligence entrypoint** (`portfolioIntelligence.js`) —
  the 8-field response contract (`status, portfolio, missingInformation,
  unknowns, ambiguities, contradictions, assumptions, warnings`).
- **Portfolio Scenario Comparison** (`investment/portfolioScenarioComparison.js`)
  — compares exactly two allocation scenarios from one shared investor
  profile, with an optional shared `existingPortfolio`. Frozen 7-field
  output contract (`status, baseProfile, scenarios,
  allocationDifferences, unallocatedDifference, currencyMismatch,
  notes`).
- **CLI wrappers**: `runAgent.js` (the general-purpose personal CLI:
  any symbol, all three live domains on by default, readable text via
  `agentReportText.js` or `--format=json`, built on
  `agentRequest.js`'s `runAgentRequest()`), `runIntelligence.js`
  (Market Intelligence, FRED only), `runPortfolioIntelligence.js` (with a `--existing-portfolio`
  flag), `runPortfolioScenarioComparison.js` (JSON-request CLI).

### Production HTTP API (`server.js`)
Minimal HTTP server using only Node's built-in `http` module — no
Express or other framework:
- `GET /` → the static personal-use web interface, `public/index.html`
  (Step 121 below). No auth needed to load it (it holds no token) and
  not rate-limited; exact path and method only.
- `GET /health` → `200 {"status":"ok"}`
- `POST /api/intelligence` → calls the existing, unmodified
  `runApplicationRequest()` (from `app.js`); FRED is only touched if
  the caller's own request body sets `options.macro.enabled === true`
- `POST /api/portfolio-intelligence` → calls the existing, unmodified
  `runPortfolioIntelligenceRequest()`; never touches any provider
- `POST /api/market-intelligence` → calls `runAgentRequest()`
  (`agentRequest.js`), which calls the existing, unmodified
  `runMarketIntelligenceRequest()` (the live multi-source path
  `runLive.js` uses) and then reuses the existing run store and the
  existing optional Claude layer. Returns
  `{ pipelineResult, diagnostics, persistence, llmAnnotation }`:
  `pipelineResult`/`diagnostics` verbatim from
  `runMarketIntelligenceRequest()`, plus the two additive fields. Every
  run is **persisted** to the run store (honoring `RUN_STORE_FILE` and a
  body-supplied `options.runStore`), and `llmAnnotation` is `null`
  unless the caller sets `options.llm.enabled === true` (advisory only,
  exactly as on `/api/intelligence`). Each provider domain is touched
  only when the caller's own `options.{macro,market,news}.enabled ===
  true` — `runAgentRequest()` enables none of them itself. *(An earlier
  revision of this file said this route had no persistence and no LLM
  annotation; that was true before `agentRequest.js` existed and was
  corrected in Step 121.)* This is the endpoint the web interface calls.
- Request-body size limit, malformed/invalid-JSON handling, generic
  500s with no leaked stack traces or internals, 404 for unknown
  routes, 405 for unsupported methods, graceful `SIGTERM`/`SIGINT`
  shutdown.
- Bearer-token authentication (`API_AUTH_TOKEN`, fails closed) and
  per-client-IP rate limiting applied before route lookup.
- One operational log line per HTTP request/response (route, run ID
  when the response carries one, and a coarse SUCCESS/CLIENT_ERROR/
  SERVER_ERROR outcome), written through `logs/logger.js`'s async,
  rotating log — never headers, the request body, or the response
  payload itself.
- Binds to `process.env.HOST || "127.0.0.1"` on
  `process.env.PORT || 3000` — **loopback by default** since Step 106;
  container/cloud deploys must set `HOST=0.0.0.0`.
- Start command: **`npm start`** (runs `node server.js`).

### Claude/Anthropic reasoning layer (isolated, opt-in, additive)
Implemented under `llm/` per `LLM_REASONING_LAYER_DESIGN.md`, wired in
at exactly one point (`app.js`) and nowhere else:

- `llm/config.js` — transport configuration only (base URL, API
  version, pinned model `claude-sonnet-5`, timeout, max tokens). Holds
  no secret.
- `llm/anthropicLiveSource.js` — **the only file that reads
  `ANTHROPIC_API_KEY`**, matching the one-file-per-credential rule
  already enforced for FRED and Alpha Vantage. The key travels only in
  the `x-api-key` transport header.
- `llm/anthropicAdapter.js` — HTTP transport and error mapping.
- `llm/evidencePackage.js` — builds a deep-frozen Evidence Package
  from the **completed** `pipelineResult`; this is the only thing the
  model ever sees. No credential and no raw request object is included.
- `llm/reasoningService.js` — composes Evidence Package → transport →
  output validation into one call. Imports no agent, orchestrator,
  provider, `server.js`, or `app.js`.
- `llm/validateClaudeOutput.js` / `llm/validateOutput.js` /
  `llm/hallucinationGuard.js` / `llm/assertNoRiskOverride.js` — reject
  any model output that is malformed, cites evidence that isn't in the
  package, invents a number, claims BUY/SELL authority, or attempts to
  override the Risk Manager.

Guarantees, each covered by a test in `app.llmIntegration.test.js`:
disabled unless `options.llm.enabled === true` (and no network request
is even built when disabled); the deterministic pipeline runs to
completion first; `pipelineResult` is byte-for-byte unchanged whether
the layer succeeds, fails, times out, or throws; any failure surfaces
only as a non-`VALID` `llmAnnotation` with a fixed generic message; and
the API key never appears in the Evidence Package, the response, or a
log line.

`app.js` returns `{ pipelineResult, fredDiagnostics, persistence,
llmAnnotation }`, with `llmAnnotation` `null` whenever the layer did
not run. `POST /api/intelligence` passes `options` straight through, so
the layer is reachable over HTTP under the same opt-in rule.

### Tests
**1559/1559 passing** across 108 test files as of the last full run
(`npm test`, Node v22 — Step 121). Treat that number as a snapshot:
`npm test` is the authoritative count. Coverage spans every core
contract, all 8 agents, the
orchestrator, both provider integrations (including mocked failure-mode
coverage for `API_UNAVAILABLE`/`TIMEOUT`/`RATE_LIMIT`/`AUTH_FAILURE`),
the complete Portfolio Intelligence stack, the HTTP API layer, and the
27 dedicated LLM-isolation tests in `app.llmIntegration.test.js`. No
test requires real credentials or makes a real network call.

### Git / deployment status

> **Superseded.** The commit-level snapshot that used to sit here (5
> commits, `a5622b6`, "not yet deployed") was already stale when Step
> 117 audited git directly, and stating it twice with two different
> answers made this file contradict itself. Step 117 below is the
> authoritative git/deployment record; read that instead of trusting a
> commit hash written down here. Only the two facts that do not change
> with the next commit are kept:

- Remote `origin` → `https://github.com/zubair5826/Financial-Market-News.git`.
- `.env` is gitignored and confirmed never tracked; no credentials are
  committed anywhere in history.

### Step 106 — external review fixes (deployment hardening)

An end-to-end review ran the suite, started the server and probed it.
Five real defects were found and are now fixed, each with its own
regression test:

1. **Rate limiting was fully bypassable.** `getClientIp()` always
   trusted `X-Forwarded-For`, a header any client can set. Proven, not
   theorized: against a 3/minute limit, six requests carrying six
   different forged values all returned `200`. That header is now read
   only under an explicit `TRUST_PROXY` opt-in; the default ignores it
   and counts the real socket address. Tests `106-1`, `106-2`,
   `106-2b` in `server.test.js`.
2. **Freshness never applied on the live multi-source path.**
   `app.js` set thresholds, but
   `providers/marketIntelligenceApplicationService.js` — the path
   `runLive.js` uses, and the only one pulling live candles and live
   news — set none, so every record was `UNKNOWN` and the stale-data
   signal could not fire there. Fixed by `withFreshnessPolicy()`.
   Tests `106-15`–`106-17`.
3. **One freshness window covered every domain.** All four specialists
   share one options object, and `app.js` filled it from the MACRO
   policy — so a three-week-old news headline was reported `FRESH`
   under a 30-day window. `orchestrator/index.js` now has
   `optionsForDomain()`, and `config/freshness.js` exposes a
   pipeline-domain map. A domain with no policy entry (`sentiment`,
   `marketData` — neither has a provider) resolves to `UNKNOWN`, never
   to another domain's window. Tests in
   `tests/perDomainFreshness.test.js` plus `106-12`–`106-14`.
4. **`npm test` wrote to the production run store.**
   `server.test.js`'s empty-body case had no body in which to pass a
   `runStore` override, so every test run appended a synthetic row to
   the real `data/runs.jsonl`. `server.js` now reads a
   `RUN_STORE_FILE` default (also useful in deployment). Tests
   `106-3`, `106-4`, plus a CI guard.
5. **The server bound to all interfaces.** Now loopback by default,
   with `HOST` as the documented opt-in and a startup banner that says
   so.

Also in this step: `README.md` was updated where it had drifted, the
FRED "no release timestamp → macro freshness is permanently `UNKNOWN`"
limitation is now stated in `README.md`'s Known Limitations, and a
full environment-variable table was added.

A GitHub Actions workflow was authored (Node 18 + 22 matrix, plus a
guard that fails the build if a test run wrote to the production
`data/runs.jsonl`) at `ci/github-actions-test.yml`, which at the time
could not be written directly under `.github/workflows/`.

**This has since been done.** `.github/workflows/test.yml` now exists
and is byte-for-byte identical to `ci/github-actions-test.yml`, so the
suite runs on every push and pull request. The `data/runs.jsonl` guard
was re-verified locally: a full `npm test` from a clean tree leaves no
`data/runs.jsonl` behind.

### Steps 112–113 — HOW_TO_RUN.md formally accepted as authoritative

`HOW_TO_RUN.md` (the file referenced immediately above) was found, in
review, to have been rewritten outside this project's normal
step-by-step process, in violation of the protected-file rule that had
applied to it since Step 91. It was never committed to this
repository, so no git history or diff exists for it either before or
after that rewrite. Its content was independently verified against the
current codebase (HTTP API, auth, rate limiting, `HOST`/`TRUST_PROXY`,
instrument-symbol verification, timeframe support, run persistence)
and found accurate throughout — the version it replaced predated the
HTTP API, persistence, and instrument-safety work entirely and would
have actively misled a reader. The decision (Step 113): accept the
current `HOW_TO_RUN.md` as authoritative project documentation going
forward. It is no longer treated as a protected/never-modify file —
`README.md`, `PROJECT_PROGRESS.md`, and any other documentation remain
the files to update for future changes, same as before.

### Step 114 — `runFredAwareRequest()` syntax fix

`providers/fredMacroApplicationService.js` would not parse: `node
--check` reported "await is only valid in async functions" at the
`await loadLiveMacroData(...)` call. The cause was 37 lines earlier —
the `runMarketIntelligenceRequest(...)` delegation block at the top of
`runFredAwareRequest()` had been pasted twice, and the duplicate
carried an extra closing brace that ended the `async function` early.
Everything after it, including that `await`, had become top-level
module code, which CommonJS does not allow.

Fix: deleted the 12 duplicated lines and the stray brace. No logic,
comments, or other files changed; the function body now runs to its
original single closing brace. `node --check` passes and the full
suite is green.

### Step 115 — documentation resync (this update)

An audit compared this file against the code. `README.md` and
`HOW_TO_RUN.md` were both found accurate and current. This file was
not: it predated the entire `llm/` reasoning layer, the
`/api/market-intelligence` route, and CI activation, and its Standing
Rules still instructed future work to assume no Anthropic integration
exists — which would have invited a contributor to remove or bypass
the isolation machinery that layer depends on. Those four corrections
are the substance of this revision. No source file was changed by this
step.

### Step 116 — production deployment configuration

The code was already deployment-ready; nothing was configured. Verified
first, by live smoke test rather than by reading: with `HOST=0.0.0.0`,
`npm start` binds to the external interface and `/health` answers `200`
there (loopback-only default confirmed as the failure mode without it);
`PORT` is honored from the environment as a string; auth fails closed
(`401` with no token, `200` with one); `SIGTERM` shuts down gracefully;
`RUN_STORE_FILE` redirects run records and leaves `data/runs.jsonl`
untouched; and a container with empty `data/` and `logs/` directories
starts cleanly and creates both files on demand.

Added (configuration and documentation only — no source file changed):

- `railway.json` — Railpack builder, `npm start`, **`/health` health
  check**, `ON_FAILURE` restart policy with 10 retries. The health
  check is the safety-relevant part: without one, a container that
  booted but is still bound to loopback reports healthy while every
  request fails.
- `.nvmrc` pinning Node 22 — the version the suite is verified on.
  `engines: ">=18"` alone would let a platform default put production
  on an untested major. CI still covers both 18 and 22.
- `README.md` — a `## Deployment` section (required platform
  variables, why `HOST` is not defaulted to `0.0.0.0`, ephemeral
  filesystem consequences), and an `ANTHROPIC_API_KEY` row added to
  the "every environment variable this system reads" table, which had
  omitted it.

Full suite re-run after the change: **1440/1440**.

### Step 117 — git state audit, and `.gitattributes`

Railway deployment was verified live: `/health` returns
`{"status":"ok"}`, unauthenticated `POST /api/intelligence` returns
401, authenticated returns 200 with `pipelineResult.ok === true`,
persistence `PERSISTED`, and `llmAnnotation` `null` with the LLM layer
off. **The deployed code is commit `92fda34` (`origin/main`), not the
current working tree**, and the audit below explains what that means.

Git state, read directly from `.git` (refs, reflog, and a parse of the
index compared against working-tree blob hashes):

- Local `main`, `origin/main`, and tag `v1.1.1` all point at
  `92fda34` ("fix: accept fenced Claude JSON output"). 20 commits on
  `main`. CI activation **is** committed (`9b94893`), so
  `.github/workflows/test.yml` is in the repository.
- Of 261 tracked files, exactly **two** differ from the index:
  - `app.js` — **line endings only.** A Windows editor re-saved it as
    CRLF; content is byte-identical to the committed blob after
    normalization (9870 bytes LF vs 10050 bytes CRLF, one `\r` per
    line). No code change.
  - `providers/fredMacroApplicationService.js` — the committed blob is
    an **older** revision with no market/news delegation at all. The
    `options.market`/`options.news` → `runMarketIntelligenceRequest()`
    branch is uncommitted working-tree work. The duplicated-block
    corruption fixed in Step 114 therefore **never reached git**; the
    committed version parses cleanly and passes 1440/1440 on its own
    (verified by restoring it and re-running the suite), because no
    test exercises that delegation branch.
- **`railway.json` and `.nvmrc` are untracked** — they are not in the
  repository, so the live Railway deployment is not using them. The
  successful deploy came from variables set in the Railway dashboard,
  which means the `/health` health check and the Node-22 pin are
  configured but **not yet active**.

Added: `.gitattributes` with `* text=auto eol=lf`, so line endings are
normalized in the repository and a Windows working tree stops producing
whole-file diffs. Added before the first commit from this machine
specifically so the CRLF noise never enters history. No source file was
changed.

Full suite after the change: **1440/1440**.

### Step 118 — regression tests for the market/news delegation branch

Step 117 found that `runFredAwareRequest()`'s `options.market` /
`options.news` delegation to `runMarketIntelligenceRequest()` had no
test at all. Four were added to
`providers/fredMacroApplicationService.test.js` (tests 16-19), in the
file's existing style — injected `fetchImpl` per provider plus the
existing network guard, which fails the test if the real global
`fetch` is ever reached. Only one Alpha Vantage domain is enabled per
test where possible, so the implementation's 1100ms inter-request
delay (which applies only when market and news are both enabled) never
triggers and no timer patching was needed.

- **16** — `options.news.enabled` delegates. A news request being
  issued at all is the proof: the local FRED path never contacts Alpha
  Vantage.
- **17** — `options.market.enabled` delegates the same way.
- **18** — with macro also enabled, `fredDiagnostics` is exactly the
  delegated service's `diagnostics.macro` (`{ seriesResults, warnings }`),
  not the whole `diagnostics` object.
- **19** — the branch's own wiring: a caller using this service's
  original FRED-style `options.adapterConfig` still reaches the macro
  loader once delegated (`options.macroAdapterConfig || options.adapterConfig`).

Coverage of `providers/fredMacroApplicationService.js`, measured with
`node --test --experimental-test-coverage`:

| | lines | branches | uncovered |
|---|---|---|---|
| before | 86.25% | 80.00% | 29-39 (the delegation block) |
| after | **100%** | **94.74%** | none |

Verified by mutation rather than by coverage alone — with the tests in
place: restoring the older committed revision that has no delegation
fails 3 of them (it previously failed none); removing only the
`|| options.adapterConfig` fallback fails exactly test 19; and mapping
`fredDiagnostics` to the whole `diagnostics` object instead of
`diagnostics.macro` fails all 4.

Full suite: **1444/1444** (1440 + 4). Only the test file changed; no
source file was touched.

### Step 119 — full completion audit

A whole-repository audit against a v1.x production-readiness bar. The
repository was inspected before anything was changed; the suite was
re-run first as a baseline (**1470/1470**, Node v22), `node --check`
was run across all 228 JS files (clean), and the HTTP API, `runDemo.js`
and graceful `SIGTERM` shutdown were exercised live rather than read.

**Verdict: the system is complete.** All 8 agents, the orchestrator,
both provider integrations, Portfolio Intelligence, the HTTP API, the
LLM annotation layer, error handling, deployment configuration and the
security model were each checked and found finished, not stubbed. No
decision logic, risk calculation, `final_assessment` behavior,
contract, response schema, or architecture was modified by this step,
and no working functionality was removed.

One real functional gap was found, and it was a documentation gap
rather than a code one:

- **Nothing in this project loads `.env`.** Zero dependencies means no
  `dotenv`, and no entrypoint passes `--env-file`. `HOW_TO_RUN.md`
  step 3 told a reader to put real keys in `.env` and then run
  `node runIntelligence.js`, which silently reaches no provider — the
  affected domain honestly reports `AUTH_FAILURE` and comes back empty,
  so the failure is quiet rather than loud. `README.md`,
  `HOW_TO_RUN.md` and `.env.example` now state this and give the three
  real ways to supply the variables (`node --env-file=.env …` on Node
  20.6+, shell export, or the deployment platform's own store).
  `npm start`/`npm test` were deliberately left alone: adding
  `--env-file` to either would raise the Node floor from 18 to 20.6 and
  make the test suite depend on an uncommitted file.

Documentation contradictions found and corrected:

- `README.md`'s architecture section still said "There is no HTTP
  server, no CLI, and no scheduler in this repository" — the same file
  documents all four HTTP routes and five CLI runners further down.
- `README.md`'s folder structure omitted `llm/`, `investment/`, `ci/`,
  `.github/workflows/` and every root entrypoint.
- `HOW_TO_RUN.md` referenced a `demo_output.json` that does not exist
  and that `runDemo.js` never writes.
- This file's "Git / deployment status" snapshot (5 commits,
  `a5622b6`, "not yet deployed") contradicted Step 117's own direct
  read of `.git` further down. Superseded in place.
- This file's §4 still listed CI activation and deployment as
  unstarted; Steps 116–117 record both as done.
- The test count here was stale (1440/1444 → 1470 at audit time).
- `ci/README.md` still instructed the reader to copy the workflow into
  `.github/workflows/`, which had already been done, leaving two
  byte-identical workflow files free to drift. Rewritten to name the
  live file as the only one to edit.

Stale comments corrected in three safety-critical wiring files, where a
wrong comment is a real hazard rather than untidiness:

- `llm/evidencePackage.js` claimed "nothing calls this file yet" and
  described the reasoning layer as "not-yet-built". Both are wired.
- `providers/fredMacroLiveSource.js` claimed it "is NOT wired into the
  orchestrator — connecting it to the pipeline remains a separate,
  future, separately-authorized step". It has been composed into the
  pipeline since the application-service layer existed.
- `server.js` said it calls "exactly two existing, unmodified
  functions". It calls three.

Two zero-behavior consistency fixes:

- `agents/chief-trading-manager/index.js` and `report.js` declared
  their own `const UNKNOWN = "UNKNOWN"` instead of importing the shared
  sentinel from `core/constants.js`, as every other agent does.
  Identical value, one source of truth.
- `core/index.js`'s barrel was missing `core/dedupe.js`. Nothing
  imports the barrel today, which is exactly how a core module stayed
  out of it unnoticed, so `tests/coreIndex.test.js` (3 tests) now
  asserts the barrel re-exports every core module, as the same binding,
  and exports nothing a core module does not define.

Reported and deliberately **not** changed, because each is decision
logic and changing it needs an explicit decision (see §4):

- `agents/chief-trading-manager/decisionStatus.js` fails **open** on an
  unrecognized `risk_decision`: its documented rule 8 says "anything
  not covered above → `NO_DECISION`", but the code returns
  `TRADE_SETUP_SUPPORTED` for any value that is not
  `RISK_REQUIRES_REVIEW` once the earlier guards pass. Unreachable
  through the orchestrator, since the real Risk Manager only ever emits
  the five `RISK_DECISIONS` values; reachable through the public
  `runChiefTradingManager()`, because `reportValidation.js` checks that
  a field is *present*, not that its value is in the enum.
- `orchestrator/index.js`'s `processRequest()` never reads
  `validateInputs().ok`, so a request with e.g. `marketData: "oops"`
  returns `ok: true` carrying a `MALFORMED_DATA` entry in `errors`.
  Consistent with the project's degrade-never-crash stance, but
  undocumented.
- `runMarketIntelligenceRequest()` can reject, which `server.js` turns
  into a bare generic 500 rather than a structured `failSafe()` result.
- `server.close()` does not call `closeIdleConnections()`, so a
  keep-alive client can hold graceful shutdown open until the 10s
  forced-exit fallback.

Full suite after the change: **1473/1473** (1470 + 3 new barrel tests).

### Update after Step 119 — decision-status fix implemented; preparing v1.2.1

The Step 119 text above is left as written, because it was true when
it was written. One of the items it reported as "not changed" has
since been changed:

- **`agents/chief-trading-manager/decisionStatus.js` no longer fails
  open. IMPLEMENTED.** Any `risk_decision` outside the five Risk
  Manager values (`RISK_ACCEPTABLE`, `RISK_REQUIRES_REVIEW`,
  `RISK_TOO_HIGH`, `INSUFFICIENT_DATA`, `UNKNOWN`) now produces
  `NO_DECISION`, as documented rule 8 always said. The check runs after
  the `RISK_TOO_HIGH` override and the missing/`INSUFFICIENT_DATA`/
  `UNKNOWN` guards and before any setup-status rule, so an invalid
  value can never read as an acceptable risk. Behavior for the five
  valid values is unchanged. The recognised set is exported as
  `RECOGNISED_RISK_DECISIONS`.
- **Regression tests are included:** 6 in `decisionStatus.test.js`
  (unrecognised values across every setup status, a missing field, the
  full valid-value matrix, and a check that the recognised set equals
  the Risk Manager's `RISK_DECISIONS`) and 1 in
  `chiefTradingManager.test.js` (an unrecognised value reaching the
  public `processChiefDecision()` with every specialist bullish).
- **Full suite: 1480 passed / 0 failed** (1473 + 7), `node --check`
  clean across all 229 JS files.

Still unresolved and unchanged: **`runMarketIntelligenceRequest()` can
reject, which `server.js` turns into a bare generic 500.** A catch
inside that service was tried and reverted, because the same function
is reached through `/api/intelligence` and `runLive.js`, so it changed
their behavior too, and the generic 500 is a documented, tested
convention. The other two Step 119 items (`processRequest()` returning
`ok: true` alongside a `MALFORMED_DATA` input error, and `server.close()`
not calling `closeIdleConnections()`) are likewise unchanged.

**Release state.** `package.json` is set to **1.2.1**. The tags
`v1.2.0` (`4ae1ece`) and `v1.1.1` (`92fda34`) already exist locally and
on `origin` and are unchanged; `package.json` read `0.1.0` at every
earlier tag. This work is being prepared as **v1.2.1**. It is not yet
committed or tagged.

## 2. In Progress

Nothing is actively in progress — every capability above is complete
and tested. The project is between milestones, not mid-implementation
on anything.

## 3. Not Yet Implemented

- **The web interface covers Market Intelligence only** — it has no
  page for Portfolio Intelligence or Scenario Comparison, and no view
  of past runs in `data/runs.jsonl`.
- **No HTTP endpoint for Portfolio Scenario Comparison** — it has a
  CLI (`runPortfolioScenarioComparison.js`) but no `/api/...` route.
- **No sentiment or generic-market-data provider** — both remain
  caller-supplied only, by design; no provider has been evaluated
  beyond the Step 15 audit already on record.
- **No natural-language extraction of existing holdings** —
  `existingPortfolio` must be supplied as structured JSON today.
- ~~Deployed from `origin/main` (`92fda34`), which predates Steps
  114–117; the delegation branch, the documentation resync and
  `railway.json`/`.nvmrc` are local-only.~~ Closed: the working tree is
  committed and `origin/main` is up to date (verified at Step 119, on a
  clean tree with the full suite green).
- ~~The market/news delegation branch has no test.~~ Closed in Step 118
  (tests 16-19), and committed since.
- **No metrics/observability platform integration** — `logs/logger.js`
  covers structured agent- and HTTP-request-level events to a local,
  rotating file; there is no external metrics/APM/log-aggregation
  service wired up.
- **No prompt-template registry for the LLM layer** —
  `llm/reasoningService.js` carries a single inline system prompt and
  says so in its own header. The versioned registry proposed in
  `LLM_REASONING_LAYER_DESIGN.md` §4 (`llm/promptRegistry.js`,
  `llm/prompts/reasoning-v1.md`) is a disclosed, deliberate gap, not
  an oversight. Every candidate output is validated identically
  regardless of how it was prompted.
- **The LLM layer has never made a real Anthropic call** — every test
  injects a mock transport, by design. The pinned model ID
  (`claude-sonnet-5`) was confirmed valid and genuinely pinned rather
  than a moving alias, but a first real call against a live key
  remains unexercised.
- **`npm test` writes to the production `logs/system.log`** — the ~30
  `logEvent()` call sites in the agents and orchestrator use the
  default path, so a full suite run appends roughly 0.5 MB and, after
  enough runs, rotates real operational history out through
  `system.log.1..3`. `logEvent()` already accepts a
  `testOptions.logFilePath` override, but `server.test.js`
  deliberately reads the real `LOG_FILE` to assert request logging and
  `tests/logger.test.js` explicitly asserts `LOG_FILE` is never a test
  path — so redirecting it is a design decision, not a bug fix, and
  was left alone here. Noted for a future step.

## 4. Future Planned Work (not started, not scheduled)

- Consider an `/api/scenario-comparison` HTTP route mirroring the
  existing CLI, if a real need for it is demonstrated.
- Consider a sentiment data provider, if one is identified and
  evaluated the same way FRED/Alpha Vantage were.
- Redirect `logs/system.log` during `npm test` (see §3) — needs a
  deliberate decision about the two tests that assert against the real
  `LOG_FILE`, so it is a step of its own, not a drive-by fix.
- Decide the two fail-open edges Step 119 reported (below): the
  unrecognized-`risk_decision` path in
  `agents/chief-trading-manager/decisionStatus.js`, and
  `processRequest()` returning `ok: true` while carrying a
  `MALFORMED_DATA` input error. Both are decision logic and neither was
  touched. *(Update: the first of the two, the unrecognized-
  `risk_decision` path, is now fixed — see "Update after Step 119"
  above. The second is unchanged.)*

Deployment and CI activation used to be listed here as unstarted. Both
are done — see Steps 116–117 — and were removed from this list because
leaving them made this section contradict the record above it.

None of the above is authorized or scheduled — this section exists
only to record known open questions, not a roadmap commitment.

## Standing Rules (unchanged, apply to every future step)

- Never modify CafeBot or any file outside this project.
- The Claude/Anthropic reasoning layer under `llm/` is **advisory
  only**. It stays opt-in and off by default, runs only after the
  deterministic pipeline is final, and must never be allowed to
  influence `risk_decision`, `decision_status`, or
  `final_assessment`. Never widen it into the decision path.
- Never implement real-money trading, broker/exchange connection, or
  automatic trade execution.
- Never hardcode a credential; every secret is read from an environment
  variable in exactly one file per provider.
- Never install a dependency unless genuinely required, and document
  why (the project currently has zero npm dependencies).
- Only build what is explicitly requested — do not get ahead of
  instructions.

### Step 120 - full 8-agent audit completed after v1.2.1

The post-release audit covered all eight specialist agents without modifying agent code. All agent-specific test suites passed in full:

- Data Controller: 14/14 passed
- News Agent: 26/26 passed
- Macro Agent: 31/31 passed
- Technical Agent: 46/46 passed
- Sentiment Agent: 22/22 passed
- Trade Setup Agent: 23/23 passed
- Risk Manager: 20/20 passed
- Chief Trading Manager: 24/24 passed

The complete project suite was then rerun: 1480/1480 passed, 0 failed, 0 skipped, 0 cancelled. No concrete defect was identified during the audit and no agent code change was required.

The working tree was checked after the audit. The only untracked path is Claude outputs/, which remains intentionally untracked. No tracked project files were modified by the audit.


### Step 121 - personal-use web interface (`GET /`)

The first browser UI for the project. Nothing in the decision path was
touched: no agent, the orchestrator, `agentRequest.js`, `runAgent.js`,
`agentReportText.js`, and the `/api/market-intelligence` handler are all
unchanged, and there are still zero npm dependencies.

- **`public/index.html` (new).** One self-contained plain HTML/CSS/JS
  file, no build step. Inputs: symbol, question, Macro/Market/News
  checkboxes (all on by default), optional market timeframes, the six
  optional position-sizing values, the API token, and an optional
  Claude checkbox (off by default). It builds the same
  `{ request, options }` pair `runAgent.js` builds, sets
  `options.{macro,market,news}.enabled` explicitly from the
  checkboxes, and sends it to the existing `POST /api/market-intelligence`
  with `Authorization: Bearer <token>`. Results show the Decision
  (`final_assessment`, `decision_status`) first, labelled as the
  deterministic assessment and not an order or trade execution; then
  data quality and risk (risk decision/level, freshness/quality flags,
  position sizing, invalidation conditions); the macro,
  market/technical, news and sentiment summaries; the trade setup
  (status, direction, `setup_quality`, potential levels); evidence,
  uncertainties, warnings, errors and sources; provider diagnostics and
  the run ID; `llmAnnotation` only in a separate block labelled
  **ADVISORY — CLAUDE**; and a collapsed "Show raw JSON". Missing fields
  render as `UNKNOWN`. Loading state, and clear messages for a missing
  token, 401, 429 (with Retry-After), 5xx, non-JSON and network
  failures. The token is kept in memory, or in `sessionStorage` only if
  the user ticks "remember for this tab"; it is never hardcoded.
  All response values are written with `textContent`, never
  `innerHTML`, so provider text cannot inject markup.
- **`server.js`.** One new exact route, `GET /`, reads and returns
  `public/index.html` (path fixed relative to `server.js`, never taken
  from the URL) with `Content-Security-Policy` (`default-src 'none'`,
  `connect-src 'self'`, `frame-ancestors 'none'`), `X-Frame-Options:
  DENY`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`
  and `Referrer-Policy: no-referrer`. Only `GET /` is exempt from the
  per-IP rate limiter; `POST /` (405) and every API route are counted
  exactly as before. Other methods on `/` → 405; `/index.html`,
  `/public/...` and all other unknown paths → 404; a failed file read →
  the usual generic 500. Auth, body-size limit, `/health`, logging and
  graceful shutdown are unchanged. The startup banner now prints the
  web-interface URL.
- **Tests.** 10 new tests in `server.test.js` (121-1 … 121-10): `GET /`
  returns 200 HTML identical to the file, security headers, no token
  needed or embedded (and the API still fails closed with no token
  configured), 404 for unknown and file-like paths, 405 for other
  methods, the rate-limit exemption is exactly `GET /`, the
  market-intelligence API's 401/200 behavior and four-field shape are
  unchanged, the generic 500 on a read failure, the fixed page path,
  and static checks on the page (single endpoint, no hardcoded token,
  no `localStorage`, domains on / Claude off by default, no `innerHTML`,
  no execution surface).
- **Also verified in a real headless browser** (not part of `npm test`):
  missing-token and 401 messages, a full live-path run with no
  provider keys (every domain honestly `AUTH_FAILURE`, Decision
  `INSUFFICIENT_DATA` / `WAIT_FOR_MORE_DATA`, no `undefined`/`null`
  shown), a rich result with a VALID advisory block, the no-report
  path, 500 and 429 messages, and a 400 px-wide layout with no
  horizontal scroll.
- **Docs.** `README.md` (new Web interface section, route table, `GET /`
  security notes, folder structure), `HOW_TO_RUN.md` (new section 4),
  and this file (the stale `/api/market-intelligence` description
  above corrected; `runAgent.js` added to the CLI list; test count).

Full suite: **1559/1559** passed, 0 failed (1549 before this step + 10
new). Note: Step 120 above recorded 1480; the suite had already grown
to 1549 before this step began (tests added after Step 120, e.g. for
`agentRequest.js`, `runAgent.js` and `agentReportText.js`), which this
file had not yet recorded. `node --check server.js` is clean. Not committed or tagged.
