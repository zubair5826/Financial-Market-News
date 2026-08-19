# Trading Intelligence System

A multi-agent AI Trading Intelligence System. This is a **separate
project** from CafeBot — no code, data, or configuration is shared
between the two.

## Status

**Core system implemented and tested. No live data connection.**

All 8 agents, the shared contracts, and the orchestrator that wires
them together are IMPLEMENTED and covered by an automated test suite
(492 tests, 0 failures as of the last full run). What is **not**
implemented is any connection to a real data source: no market data
feed, no news/macro/sentiment provider, no broker, no exchange, and no
trade execution exist anywhere in this codebase. Every test runs
against synthetic, in-memory fixture data only.

In short: the *reasoning pipeline* is real and working end to end; the
*data* it reasons about is currently supplied by hand (tests) or must
be supplied by a caller — nothing is fetched from the outside world.

## System Architecture

```
USER REQUEST
     |
ORCHESTRATOR (orchestrator/index.js — processRequest)
     |  receiveRequest -> identifyAsset -> validateInputs -> prepareAgentInputs
     |
DATA CONTROLLER              <- only runs if request.marketData is supplied
     |                          (validates/normalizes generic price/value data)
     |
SPECIALIST AGENTS (run independently; one failing never crashes another)
     |  News Agent · Macro Agent · Technical Agent · Sentiment Agent
     |
TRADE SETUP AGENT             <- synthesizes the 4 specialist reports into
     |                           a directional setup (never an order)
RISK MANAGER                  <- evaluates the setup for risk;
     |                           RISK_TOO_HIGH is an absolute override
CHIEF TRADING MANAGER         <- final synthesis + decision status
     |
STRUCTURED USER RESPONSE      <- { ok, asset, response, pipeline_summary,
                                    warnings, errors }
```

**IMPLEMENTED** — the entire pipeline above, wired together in
[orchestrator/index.js](orchestrator/index.js) via `processRequest()`.
Every stage is a real, tested function; nothing here is a stub.

**NOT IMPLEMENTED** — anything upstream of "USER REQUEST." There is no
HTTP server, no CLI, and no scheduler in this repository. A caller
invokes `processRequest(request)` directly (see [Data Flow](#data-flow)
below); how a request eventually reaches that call (an API endpoint, a
CLI, a cron job) is **FUTURE** and unspecified.

## Data Flow

A request is a plain object. Every field is optional except `query`;
missing fields degrade gracefully (that domain is simply not assessed)
rather than causing an error:

```js
{
  query: "Assess BTC",              // required, non-empty string
  asset: "BTC",                     // optional — inferred from data if omitted
  marketData: [ /* DataRecord-shaped items, see core/dataRecord.js */ ],
  newsData: [ /* News Agent input records */ ],
  macroData: [ /* Macro Agent input records */ ],
  technicalCandles: [ /* OHLC candles */ ],
  sentimentData: [ /* Sentiment Agent input records */ ],
  upcomingEvents: [ /* macro calendar events */ ],
  centralBankEvents: [ /* central bank policy events */ ],
  options: {
    freshnessThresholds: { freshMaxMs, agingMaxMs },  // caller-supplied, never hard-coded
    positionSizingParams: { accountBalance, riskPercentage, leverage, entryPrice, stopPrice, contractSize },
    // plus per-agent overrides — see each agent's README.md
  },
}
```

`processRequest()` returns:

```js
{
  ok: true | false,
  timestamp: "...",
  asset: "BTC" | "MULTIPLE" | "UNKNOWN",
  response: { /* the Chief Trading Manager's full report, or null on early failure */ },
  pipeline_summary: {
    data_controller_status, news_status, macro_status, technical_status,
    sentiment_status, trade_setup_status, risk_decision, final_assessment,
    decision_status,
  },
  warnings: [ /* every warning from every stage, preserved, never dropped */ ],
  errors: [ /* every error from every stage, preserved, never dropped */ ],
}
```

A failed specialist, missing domain, stale timestamp, or unverified
source never produces a crash and never produces invented data — it
surfaces as a `warning`/`error` entry and/or an `UNKNOWN` sentinel
value, at every layer, all the way to this top-level response. See
[Fail-Safe Guarantees](#fail-safe-guarantees).

**IMPLEMENTED** and covered end-to-end by [tests/pipeline.test.js](tests/pipeline.test.js)
(13 required scenarios: valid request, missing asset, missing market
data, partial specialist failure, conflicting specialists, risk
rejection, successful full pipeline, empty data, stale data,
unverified data, no fabricated fallback, no external API, no
execution).

## Agents (`agents/`)

All 8 are **IMPLEMENTED**, each with its own detailed README covering
its exact input contract, output report shape, and test coverage:

| # | Agent | Role | Docs |
|---|---|---|---|
| 1 | Data Controller | Validates/normalizes generic price/value observations into the Data Contract | [agents/data-controller/README.md](agents/data-controller/README.md) |
| 2 | News Agent | Aggregates news items into an overall bias, with conflict/duplicate detection | [agents/news-agent/README.md](agents/news-agent/README.md) |
| 3 | Macro Agent | Aggregates macroeconomic releases and central bank events into a bias | [agents/macro-agent/README.md](agents/macro-agent/README.md) |
| 4 | Technical Agent | Computes indicators (SMA/EMA/RSI/MACD/ATR/Bollinger), trend, structure, support/resistance | [agents/technical-agent/README.md](agents/technical-agent/README.md) |
| 5 | Sentiment Agent | Aggregates tagged sentiment records into a bias | [agents/sentiment-agent/README.md](agents/sentiment-agent/README.md) |
| 6 | Trade Setup Agent | Synthesizes the 4 specialist reports into a directional setup + confluence/quality score | [agents/trade-setup-agent/README.md](agents/trade-setup-agent/README.md) |
| 7 | Risk Manager | Assesses the setup for risk (data quality, conflicts, timing, execution gaps) and issues a risk decision | [agents/risk-manager/README.md](agents/risk-manager/README.md) |
| 8 | Chief Trading Manager | Final synthesis: cross-domain conflict detection, overall assessment, decision status | [agents/chief-trading-manager/README.md](agents/chief-trading-manager/README.md) |

Every agent follows the same internal shape: `normalize.js` →
`validate.js` → freshness/verification (computed server-side, never
trusted from the caller) → domain analysis modules → `report.js` →
`index.js` exporting `process*()` (pure result) and `run*Agent()`
(`{ result, report }`).

None of the 8 agents, individually or together, contain a BUY/SELL/
LONG/SHORT field, an execution function, or a broker/exchange call —
verified by dedicated tests in every agent's suite and re-confirmed in
the Step 13 security audit.

## Shared Contracts (`core/`)

**IMPLEMENTED.** Every agent is built on the same foundation:

- **Data Contract** (`core/dataRecord.js`) — every factual data point
  carries an explicit source, timestamp, freshness, verification
  status, and classification. No bare, provenance-free values.
- **Information Classification** (`core/classification.js`) — exactly
  one of `FACT / HISTORICAL / SCHEDULED_EVENT / MARKET_EXPECTATION /
  FORECAST / SCENARIO / UNVERIFIED / UNKNOWN` per item.
  `SCENARIO`/`FORECAST`/`MARKET_EXPECTATION` can never be presented as
  `FACT` — enforced by `canBePresentedAsFact()`.
- **Data Freshness** (`core/freshness.js`) — `FRESH / AGING / STALE /
  UNKNOWN`, computed from a real timestamp and **caller-supplied**
  thresholds only (no hard-coded default — different data types need
  different windows, and no data type has a chosen provider yet).
- **Source Verification** (`core/verification.js`) — `VERIFIED_PRIMARY
  / VERIFIED_SECONDARY / UNVERIFIED / CONFLICTING / UNKNOWN`.
  `reconcileSources()` never auto-resolves a disagreement — it returns
  `CONFLICTING` and preserves both records.
- **Sentinels** (`core/constants.js`) — `UNKNOWN` (undetermined) vs.
  `NOT_AVAILABLE` (confirmed absent, e.g. candle `volume`) are always
  distinguished, never conflated with a fabricated default.
- **Agent Message Contract** (`core/agentMessage.js`) — agents
  communicate via structured reports, not free-form text.
- **Error Handling** (`core/errors.js`) — `failSafe(code, message,
  details)` always returns `{ ok: false, code, message, details }`;
  never a fabricated success. Standard codes: `API_UNAVAILABLE,
  TIMEOUT, RATE_LIMIT, MALFORMED_DATA, MISSING_DATA, STALE_DATA,
  CONFLICTING_DATA, INVALID_RESPONSE, AUTH_FAILURE`.
- **Hallucination Prevention Rules** (`core/hallucinationRules.js`) —
  13 documented rules every agent's implementation follows (reference
  documentation; enforcement lives in each agent's own validated
  logic, not in this module itself).

## Provider Abstraction (`providers/`)

**IMPLEMENTED (interface only). NOT IMPLEMENTED (any real provider).**

`ProviderAdapter` ([providers/ProviderAdapter.js](providers/ProviderAdapter.js))
is an abstract base class — it cannot be instantiated directly
(test-enforced) — defining the contract every future provider must
implement:

```js
class MyProvider extends ProviderAdapter {
  async fetchData(request) { /* returns { ok: true, data: DataRecord[] }
                                 or a failSafe() result — never fabricates */ }
  async healthCheck() { /* reports connectivity/auth health */ }
}
```

### Provider readiness verification

The abstraction was checked against all four domains this system will
eventually need real data for — none require any provider-specific
assumption baked into the agent layer:

- **Market data** — Data Controller consumes generic `{ asset,
  data_type, value, source, classification }` records; any provider
  just needs to shape its output into that array. No provider name,
  field, or quirk is hard-coded anywhere in `agents/data-controller/`.
- **News** — News Agent consumes generic `{ headline, source,
  publication_timestamp, classification, impact_direction, ... }`
  records — a `fieldMap` option already exists in `normalize.js` so a
  provider's own field names never need to match this contract
  exactly.
- **Macro** — same pattern (`indicator, release_timestamp, ...`), plus
  a separate calendar/central-bank event shape, both provider-agnostic.
- **Sentiment** — same pattern (`asset, sentiment, timestamp, ...`).

In every case, the actual analysis logic (bias derivation, indicator
math, conflict detection) operates purely on the already-normalized
record shape — it never reaches back into a raw provider response. A
future provider adapter's only job is: call the real API, map its
response into the agent's input array shape (or return a `failSafe()`
result on any failure), and hand that array to the corresponding
`run*Agent()` function. **No agent code changes required.**

### Provider integration plan (FUTURE — not started)

1. Choose and document a specific provider per domain (market data,
   news, macro, sentiment) — none chosen yet, intentionally.
2. Implement one `ProviderAdapter` subclass per provider under
   `providers/`, each calling the real API and mapping the response
   into that domain's input record shape (or a `failSafe()` result).
3. Add that provider's credentials to `.env` (never committed — see
   [Security](#security)) and read them via `process.env` **only**
   inside that adapter file.
4. Wire the adapter into the orchestrator's request-building step
   (upstream of `processRequest()` — the orchestrator itself does not
   change) so `request.newsData` etc. are populated from a live call
   instead of a caller-supplied array.
5. Every failure mode the adapter can hit (`API_UNAVAILABLE, TIMEOUT,
   RATE_LIMIT, AUTH_FAILURE, INVALID_RESPONSE`) maps directly onto an
   existing `core/errors.js` code — no new error-handling design is
   needed downstream.

### Step 15 — first-integration recommendation (PREPARATION ONLY)

A Step 15 audit evaluated Market Data, News, Macro, and Sentiment as
candidates for the **first** real provider integration (still
**FUTURE** — no provider is connected). **Macro was recommended**:
its data is discrete/scheduled (not a continuous stream, so far lower
rate-limit pressure), typically sourced from authoritative
calendar/statistical-agency providers (a stronger fit for
`VERIFIED_PRIMARY`/`VERIFIED_SECONDARY`), numeric rather than
natural-language (no subjective interpretation burden on the
provider), and freshness is naturally well-defined around each
release's scheduled time. Market Data was ranked last: its Data
Controller output currently isn't consumed by any downstream agent
(Trade Setup/Risk Manager/Chief Trading Manager never read it), so
integrating it first would add real-world risk surface (a live feed)
without changing any decision the system produces.

One real, documented gap: `options.fieldMap` is a single object shared
identically across all 4 specialists in one request (see
`orchestrator/index.js`'s `sharedOptions`), not namespaced per agent.
This is not a problem for a single-domain (e.g. Macro-only) first
integration, but would need either per-domain-prefixed options or
adapter-side mapping (before data reaches `run*Agent()`) once two
differently-shaped live providers are combined in one request. Not
fixed — not required for a single first integration.

### Step 16 — Macro provider selected for future integration (NOT CONNECTED)

**SELECTED FOR FUTURE INTEGRATION: FRED (Federal Reserve Economic
Data, Federal Reserve Bank of St. Louis)** — `fred.stlouisfed.org`.
**No account, API key, or connection exists.** Chosen over Financial
Modeling Prep's economic calendar (a third-party source flagged that
endpoint as possibly deprecated — unconfirmed), Trading Economics (no
free tier found — paid plans only, per third-party pricing summaries),
and Alpha Vantage's Economic Indicators (free, but no forecast/
consensus values and no calendar/scheduled-release concept) because it
is the most authoritative source available (the original statistical
agency for most of its series), free with a generous documented rate
limit (~120 requests/minute — sourced from search results, not a
direct primary fetch; **treat as needing final confirmation before any
real connection**), simplest to authenticate (a single API key, no
OAuth/signing), and has the longest operating history of any candidate
evaluated.

**Known, real limitation, not a defect:** FRED provides `actual_value`
and prior-period values (as `previous_value`) but **no forecast/
consensus `expected_value`** — so `calculateSurprise()` in
`agents/macro-agent/surprise.js` will always return `UNKNOWN` for
FRED-sourced records. This is correct, honest behavior under the
existing contract, not something to work around.

See the full Step 16 report for the complete field mapping, fail-safe
matrix, and pre-live checklist — none of it implemented yet.

## Environments

No environment-specific code exists yet — the system currently runs
identically everywhere because no provider is connected. This section
documents the **intended** distinction for when one is:

| Environment | Purpose | Data source | Credentials |
|---|---|---|---|
| **development** | Local iteration | Synthetic fixtures or a caller-supplied request, same as tests | None required |
| **testing** | CI / `npm test` | Synthetic, in-memory fixtures only (`tests/`, `agents/*/*.test.js`) — never a real network call | None — tests must never require real credentials |
| **production** (FUTURE) | Real usage | Live provider adapters (once built, per the integration plan above) | Real values, in `.env` only, never committed, never hard-coded, never logged |

`NODE_ENV` (documented in [.env.example](.env.example)) is the
intended selector (`development` / `test` / `production`), read via
`process.env.NODE_ENV` **only** at the point a future provider adapter
or server entrypoint needs it — no code currently reads it, since no
such entrypoint exists yet. **No real credentials exist in this repo
in any environment.**

## Security

- **No secrets in source.** Verified repo-wide: zero `process.env`
  usage, zero hard-coded key-shaped strings (`sk-`, `AKIA`, `ghp_`,
  PEM blocks, etc.), zero network calls (`fetch`/`axios`/`http.request`/
  `WebSocket`) anywhere in `core/`, `agents/`, `providers/`,
  `orchestrator/`.
- **`.env` is gitignored** ([.gitignore](.gitignore)), along with
  `.env.*.local`. Only [.env.example](.env.example) is committed, and
  it contains no real values — see [Environments](#environments).
- **Logging redaction.** [logs/logger.js](logs/logger.js) recursively
  redacts any object key named `apiKey/api_key/key/token/secret/
  password/authorization/credential/credentials` (case-insensitive) at
  any nesting depth before a log line is written. `logs/*.log` is
  gitignored.
- **No execution surface.** No `execute`/`placeOrder`/`submitOrder`/
  `sendOrder` function exists anywhere; no broker/exchange connection
  code exists anywhere — verified by dedicated tests and a full
  repo-wide grep audit (Step 13).

## Observability

[logs/logger.js](logs/logger.js)'s `logEvent()` is called by every
agent and the orchestrator, appending one structured JSON line per run
to `logs/system.log`:

```js
{ timestamp, agent, request /* redacted */, data_source, response_status,
  warnings, errors, final_decision }
```

This already covers every field Step 14 requires: `timestamp, agent,
request, source (data_source), response status, warnings, errors,
decision (final_decision)`. Secrets are never logged (see
[Security](#security)).

## Fail-Safe Guarantees

Every condition below is verified — by code inspection and, where the
condition is reproducible today, by a passing test — to never result
in fabricated information. It always resolves to a `failSafe()`
result, an `UNKNOWN`/`NOT_AVAILABLE` sentinel, or a surfaced
warning/error instead:

| Condition | Mechanism | Status |
|---|---|---|
| Malformed data | Each agent's `validate.js` rejects structurally invalid records into a `rejected` list with a `failSafe(MALFORMED_DATA, ...)` reason; never silently coerced | Tested today |
| Missing data | Absent/empty input arrays produce `UNKNOWN`-bias reports, never invented values; missing specialists are explicitly listed (`collectReports().missing`) | Tested today |
| Stale data | `computeFreshness()` returns `STALE` past `agingMaxMs`; News Agent raises `failSafe(STALE_DATA, ...)`, surfaced up to the top-level response | Tested today |
| Conflicting data | `reconcileSources()` / domain conflict detectors return `CONFLICTING`/populate `conflicts`, never auto-resolved; visible through Trade Setup's `conflicting_evidence` and Chief Trading Manager's `CONFLICTING_EVIDENCE` state | Tested today |
| API unavailable | `ProviderAdapter.fetchData()` contract requires either `{ ok: true, data }` or a `failSafe(API_UNAVAILABLE, ...)` result | Design-verified; **not reproducible today — no real provider exists to fail** |
| Timeout | Same contract — a timeout maps to `failSafe(TIMEOUT, ...)` | Design-verified; **not reproducible today** |
| Rate limit | Same contract — maps to `failSafe(RATE_LIMIT, ...)` | Design-verified; **not reproducible today** |
| Authentication failure | Same contract — maps to `failSafe(AUTH_FAILURE, ...)`, and no adapter would ever log the credential itself (see Security) | Design-verified; **not reproducible today** |

The four "design-verified" rows cannot be exercised by an automated
test yet because no concrete provider exists to actually time out,
rate-limit, or reject authentication — that becomes testable once a
real `ProviderAdapter` subclass is built (see [Provider integration
plan](#provider-integration-plan-future--not-started)).

## Testing

```bash
npm test
```

Runs Node's built-in test runner (`node --test`) across every
`*.test.js` file in `agents/` and `tests/`. **492 tests, 0 failures**
as of the last full run (Node v24.19.0). No external dependencies, no
network access, and no real credentials are required to run the suite
— every test uses synthetic, hand-constructed fixture data.

Coverage includes: every core contract, every agent's own unit tests
(structural validation, freshness, verification, classification
pass-through, bias/indicator correctness, no-fabrication assertions),
the orchestrator's individual functions in isolation
([tests/orchestrator.test.js](tests/orchestrator.test.js)), and a full
13-scenario end-to-end pipeline suite exercising all 8 real agents
together ([tests/pipeline.test.js](tests/pipeline.test.js)).

## Known Limitations

- **No real data anywhere.** Every number, headline, and price in this
  system's test suite is synthetic. Nothing has ever been validated
  against real market behavior.
- **No provider chosen.** Market data, news, macro, and sentiment
  providers are all `UNKNOWN` — none selected, none assumed.
- **No HTTP server or CLI entrypoint.** `processRequest()` must be
  called directly by a Node process; there is no way to reach this
  system over a network yet.
- **No persistence layer.** `data/` exists but is empty — no report
  history, no request log beyond `logs/system.log`, is ever written.
- **No agent system prompts committed.** `prompts/` is an empty
  placeholder — this codebase is deterministic logic, not an LLM
  agent, but if a future LLM-driven layer is added on top, its prompts
  don't exist yet.
- **Freshness/quality/confidence thresholds are all caller-supplied**
  with documented defaults in a few places (e.g. Trade Setup's quality
  thresholds) — none represent a real-world-calibrated value, since no
  real data has ever flowed through this system.
- **No automatic or manual trade execution, anywhere, under any
  configuration.** This system produces decision *intelligence*
  (bias, setup, risk, and decision-status labels) — it has no code
  path that could place, modify, or cancel an order even if asked to.

## Folder Structure

- `core/` — shared contracts. **IMPLEMENTED.**
- `agents/` — all 8 agents. **IMPLEMENTED.**
- `orchestrator/` — full pipeline wiring (`processRequest()`). **IMPLEMENTED.**
- `providers/` — provider adapter interface only. **IMPLEMENTED**
  (interface); **NOT IMPLEMENTED** (any real provider) — see [Provider
  Abstraction](#provider-abstraction-providers).
- `logs/` — logging foundation + runtime log output. **IMPLEMENTED.**
- `tests/` — cross-cutting contract, orchestrator, and end-to-end
  pipeline tests. **IMPLEMENTED.** (Per-agent unit tests live alongside
  each agent in `agents/<agent-name>/*.test.js`.)
- `data/` — reserved for future persisted output. **NOT IMPLEMENTED**
  (empty).
- `prompts/` — reserved for future agent system prompts. **NOT
  IMPLEMENTED** (empty).

## Setup

No dependencies to install — the entire system uses only Node.js
built-ins (`fs`, `path`, `node:test`, `node:assert/strict`). Requires
Node.js 18+.

```bash
npm test
```
