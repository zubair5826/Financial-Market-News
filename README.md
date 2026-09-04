# Trading Intelligence System

A multi-agent AI Trading Intelligence System. This is a **separate
project** from CafeBot — no code, data, or configuration is shared
between the two.

## Status

**Core system implemented and tested. Macro, technical, and news
providers are integrated; no broker/exchange connection or trade
execution exists.**

All 8 agents, the shared contracts, and the orchestrator that wires
them together are IMPLEMENTED and covered by an automated test suite.
Two real, live data providers are also IMPLEMENTED and tested: FRED
(macro data, for the Macro Agent) and Alpha Vantage (daily price
candles for the Technical Agent, and news for the News Agent) — see
[Provider Abstraction](#provider-abstraction-providers) below.
Sentiment, and the Data Controller's own generic `marketData` domain,
still have no connected provider. No broker, no exchange, and no trade
execution exist anywhere in this codebase. Every automated test in
this repository runs against synthetic, in-memory, or mocked fixture
data only — no test requires real credentials or makes a real network
call.

In short: the *reasoning pipeline* is real and working end to end;
three of its data domains (macro, technical, and news) can now be
populated from a real, live external source when real credentials are
supplied; the other two (sentiment, and the Data Controller's generic
market-value domain) still have their data supplied by hand (tests) or
by a caller.

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
  different windows, and no single threshold has been calibrated
  against sustained real production traffic for any of them).
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

**IMPLEMENTED — the abstract interface, plus two real, tested provider
integrations (FRED for macro; Alpha Vantage for technical price
candles and news).** Sentiment, and the Data Controller's own generic
`marketData` domain, have no connected provider yet.

`ProviderAdapter` ([providers/ProviderAdapter.js](providers/ProviderAdapter.js))
is an abstract base class — it cannot be instantiated directly
(test-enforced) — defining the contract every provider implements:

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

### Provider integration plan — completed for macro, technical, and news

The plan below was executed for three of the four domains (macro via
FRED; technical price candles and news via Alpha Vantage). Sentiment,
and the Data Controller's own generic `marketData` domain, still have
no connected provider and remain future work.

1. Choose and document a specific provider per domain — done for
   technical (candles), news, and macro (see Step 16 below); sentiment
   and the Data Controller's `marketData` domain remain unchosen,
   intentionally.
2. Implement one `ProviderAdapter` subclass per provider under
   `providers/adapters/`, each calling the real API and mapping the
   response into that domain's input record shape (or a `failSafe()`
   result) — done for FRED and Alpha Vantage (technical + news).
3. Add that provider's credentials to `.env` (never committed — see
   [Security](#security)) and read them via `process.env` **only**
   inside that adapter's live-source file — done: `FRED_API_KEY` is
   read solely in `providers/fredMacroLiveSource.js`, and
   `ALPHAVANTAGE_API_KEY` is read solely in
   `providers/alphaVantageMarketLiveSource.js` and
   `providers/alphaVantageNewsLiveSource.js`.
4. Wire the adapter into the request-building step upstream of
   `processRequest()` (the orchestrator itself is unmodified) — done
   via `providers/fredMacroApplicationService.js` and
   `providers/marketIntelligenceApplicationService.js`, which compose
   live provider data into a request before calling the existing,
   unmodified `processRequest()` exactly once.
5. Every failure mode the adapter can hit (`API_UNAVAILABLE, TIMEOUT,
   RATE_LIMIT, AUTH_FAILURE, INVALID_RESPONSE`) maps directly onto an
   existing `core/errors.js` code — implemented and covered by mocked
   tests in each adapter's own test suite (see [Fail-Safe
   Guarantees](#fail-safe-guarantees)).

A real, discovered-and-fixed issue along the way: Alpha Vantage's free
tier enforces a real "1 request per second" burst limit (separate from
its daily quota). `providers/marketIntelligenceApplicationService.js`
acquires market and news data sequentially with a fixed 1100ms delay
between them to stay under it; FRED (a separate account) is
unaffected and remains concurrent.

### Step 15 — first-integration recommendation (historical)

A Step 15 audit evaluated Market Data, News, Macro, and Sentiment as
candidates for the first real provider integration. **Macro was
recommended**:
its data is discrete/scheduled (not a continuous stream, so far lower
rate-limit pressure), typically sourced from authoritative
calendar/statistical-agency providers (a stronger fit for
`VERIFIED_PRIMARY`/`VERIFIED_SECONDARY`), numeric rather than
natural-language (no subjective interpretation burden on the
provider), and freshness is naturally well-defined around each
release's scheduled time. Market Data (the Data Controller's generic
domain) was ranked last at the time of that audit and remains
unintegrated today; News has since been integrated (via Alpha
Vantage), and Alpha Vantage was also brought in as the Technical
Agent's provider (distinct from the Data Controller's Market Data
domain — see [Provider Abstraction](#provider-abstraction-providers)).

One real, documented gap: `options.fieldMap` is a single object shared
identically across all 4 specialists in one request (see
`orchestrator/index.js`'s `sharedOptions`), not namespaced per agent.
This is not a problem for a single-domain (e.g. Macro-only) first
integration, but would need either per-domain-prefixed options or
adapter-side mapping (before data reaches `run*Agent()`) once two
differently-shaped live providers are combined in one request. Not
fixed — not required for the integrations built so far, since each
composes its own request independently.

### Step 16 — Macro provider selected and connected: FRED

**FRED (Federal Reserve Economic Data, Federal Reserve Bank of St.
Louis)** — `fred.stlouisfed.org` — is implemented and tested
(`providers/adapters/fredMacroAdapter.js` and the surrounding
live-source/application-service layer). Chosen over Financial
Modeling Prep's economic calendar (a third-party source flagged that
endpoint as possibly deprecated — unconfirmed), Trading Economics (no
free tier found — paid plans only, per third-party pricing summaries),
and Alpha Vantage's Economic Indicators (free, but no forecast/
consensus values and no calendar/scheduled-release concept) because it
is the most authoritative source available (the original statistical
agency for most of its series), free with a generous documented rate
limit (~120 requests/minute — sourced from search results, not a
direct primary fetch; **this figure has not been re-confirmed against
a real, sustained production load**), simplest to authenticate (a
single API key, no OAuth/signing), and has the longest operating
history of any candidate evaluated. Alpha Vantage was separately
integrated for technical price candles and news (see above).

**Known, real limitation, not a defect:** FRED provides `actual_value`
and prior-period values (as `previous_value`) but **no forecast/
consensus `expected_value`** — so `calculateSurprise()` in
`agents/macro-agent/surprise.js` will always return `UNKNOWN` for
FRED-sourced records. This is correct, honest behavior under the
existing contract, not something to work around.

See the full Step 16 report for the complete field mapping, fail-safe
matrix, and pre-live checklist — now implemented for FRED and Alpha
Vantage, as described above.

## Environments

No `NODE_ENV`-driven code branching exists yet — every environment
runs the same code paths. What differs across environments is which
provider credentials are present and whether real network calls are
made:

| Environment | Purpose | Data source | Credentials |
|---|---|---|---|
| **development** | Local iteration | Synthetic fixtures, a caller-supplied request, or live FRED/Alpha Vantage calls if credentials are set | `FRED_API_KEY`/`ALPHAVANTAGE_API_KEY` only if live calls are wanted |
| **testing** | CI / `npm test` | Synthetic, in-memory, or mocked fixtures only (`tests/`, `agents/*/*.test.js`, `providers/**/*.test.js`) — never a real network call | None — tests must never require real credentials |
| **production** | Real usage | Live FRED and Alpha Vantage calls via the existing adapters, for macro/technical/news; sentiment and the Data Controller's `marketData` domain remain caller-supplied | Real values, in `.env` only, never committed, never hard-coded, never logged |

`NODE_ENV` (documented in [.env.example](.env.example)) is the
intended selector (`development` / `test` / `production`), read via
`process.env.NODE_ENV` **only** at the point a future provider adapter
or server entrypoint needs it — no code currently reads it. **No real
credentials exist in this repo in any environment.**

### Every environment variable this system reads

| Variable | Read only in | Effect if unset |
|---|---|---|
| `FRED_API_KEY` | `providers/fredMacroLiveSource.js` | Macro live calls return `AUTH_FAILURE`; never fabricated data |
| `ALPHAVANTAGE_API_KEY` | `providers/alphaVantage*LiveSource.js` | Market/news live calls return `AUTH_FAILURE` |
| `API_AUTH_TOKEN` | `server.js` | **Fails closed** — every API request is rejected with 401 |
| `PORT` | `server.js` | `3000` |
| `HOST` | `server.js` | `127.0.0.1` (loopback only). Container/cloud platforms need `HOST=0.0.0.0` |
| `TRUST_PROXY` | `server.js` | Off — `X-Forwarded-For` is ignored and rate limiting uses the real socket address. Set to `1` **only** behind a proxy that overwrites that header |
| `RATE_LIMIT_WINDOW_MS` | `server.js` | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | `server.js` | `30` |
| `RUN_STORE_FILE` | `server.js` | `data/runs.jsonl` |

## HTTP API (`server.js`)

`npm start`. Four routes, no framework, no dependencies:

| Route | Auth | Rate limited | Body |
|---|---|---|---|
| `GET /health` | none | no | — |
| `POST /api/intelligence` | `Authorization: Bearer $API_AUTH_TOKEN` | yes | `{ request, options }` |
| `POST /api/portfolio-intelligence` | same | yes | the request object itself |
| `POST /api/market-intelligence` | same | yes | `{ request, options }` |

`POST /api/market-intelligence` uses the same
`Authorization: Bearer $API_AUTH_TOKEN` check as the other protected
routes and calls the existing, unmodified
`runMarketIntelligenceRequest()`
([providers/marketIntelligenceApplicationService.js](providers/marketIntelligenceApplicationService.js))
— the same live-data composition `runLive.js` already exercises from
the command line, now reachable over HTTP. Each provider domain
(`macro`/`market`/`news`) is only touched when the caller's own
`options.<domain>.enabled === true`, identical to
`/api/intelligence`'s `options.macro.enabled` rule. It returns that
function's existing `{ pipelineResult, diagnostics }` shape verbatim —
no new response contract, no persistence, and no LLM annotation (this
entrypoint has neither).

Security properties, each covered by tests in
[server.test.js](server.test.js): the bearer comparison is
length-normalized and timing-safe; every auth failure returns the same
generic `401` regardless of cause; rate limiting runs before route
lookup, method checks and body parsing, so it cannot be dodged by
hitting an unknown path; `X-Forwarded-For` is honored only under an
explicit `TRUST_PROXY` opt-in, so a forged header cannot open a fresh
rate-limit bucket; internal errors never leak a message or stack.

**This process does not terminate TLS.** Put it behind a reverse proxy
or platform that does, and set `TRUST_PROXY=1` there.

## Security

- **No secrets in source.** Zero hard-coded key-shaped strings
  (`sk-`, `AKIA`, `ghp_`, PEM blocks, etc.) anywhere in the repo.
  `process.env` and real network calls (`fetch`) are used **only**
  inside the FRED and Alpha Vantage live-source files
  (`providers/fredMacroLiveSource.js`,
  `providers/alphaVantageMarketLiveSource.js`,
  `providers/alphaVantageNewsLiveSource.js` — each the sole reader of
  its own credential) — verified absent everywhere else, including
  `core/`, `agents/`, `orchestrator/`, and the rest of `providers/`.
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
| API unavailable | `ProviderAdapter.fetchData()` contract requires either `{ ok: true, data }` or a `failSafe(API_UNAVAILABLE, ...)` result | Tested today, via mocked FRED/Alpha Vantage responses in each adapter's own test suite |
| Timeout | Same contract — a timeout maps to `failSafe(TIMEOUT, ...)` | Tested today, via mocked responses |
| Rate limit | Same contract — maps to `failSafe(RATE_LIMIT, ...)`; Alpha Vantage's real per-second burst limit is additionally handled by a sequential-acquisition delay (see [Provider Abstraction](#provider-abstraction-providers)) | Tested today, via mocked responses |
| Authentication failure | Same contract — maps to `failSafe(AUTH_FAILURE, ...)`, and no adapter would ever log the credential itself (see Security) | Tested today, via mocked responses |

The four rows above are exercised by mocked provider responses in
`providers/adapters/*.test.js` and the surrounding live-source/
application-service test files — they do not make a real network call
(no automated test does), but they do exercise the real FRED/Alpha
Vantage adapter code against a simulated failure response, not just a
design review.

## Testing

```bash
npm test
```

Runs Node's built-in test runner (`node --test`) across every
`*.test.js` file in the repository, including `agents/`, `tests/`,
`providers/` (and its `adapters/` subfolder). No external
dependencies, no real network access, and no real credentials are
required to run the suite — every test uses synthetic, hand-constructed,
or mocked fixture data. Run `npm test` for the current pass/fail count.

Coverage includes: every core contract, every agent's own unit tests
(structural validation, freshness, verification, classification
pass-through, bias/indicator correctness, no-fabrication assertions),
the orchestrator's individual functions in isolation
([tests/orchestrator.test.js](tests/orchestrator.test.js)), a full
13-scenario end-to-end pipeline suite exercising all 8 real agents
together ([tests/pipeline.test.js](tests/pipeline.test.js)), and the
FRED/Alpha Vantage adapter, live-source, and application-service test
suites under `providers/` (including mocked failure-mode coverage —
see [Fail-Safe Guarantees](#fail-safe-guarantees)).

## Known Limitations

- **No real data in the automated test suite.** Every number,
  headline, and price used by `npm test` is synthetic or mocked.
  Real FRED/Alpha Vantage responses were exercised manually during
  development (which is how the Alpha Vantage per-second rate limit,
  documented above, was discovered) — not as part of the committed,
  repeatable automated suite.
- **Sentiment, and the Data Controller's generic `marketData` domain,
  have no chosen provider.** Technical price candles and news
  (Alpha Vantage) and macro (FRED) are integrated; sentiment and
  the Data Controller's own domain remain `UNKNOWN` — not selected,
  not assumed.
- **An HTTP API and CLI runners exist** ([server.js](server.js),
  [runIntelligence.js](runIntelligence.js), [runLive.js](runLive.js),
  [runPortfolioIntelligence.js](runPortfolioIntelligence.js)) — see
  [HTTP API](#http-api-serverjs). The API requires a bearer token, is
  rate-limited per client IP, and binds to loopback unless `HOST` says
  otherwise.
- **Run records are persisted** to `data/runs.jsonl` (one JSONL line
  per completed run, credentials redacted — [data/runStore.js](data/runStore.js)).
  What is NOT recorded is the market OUTCOME of a run: nothing in this
  repository stores what actually happened afterwards, so system
  accuracy still cannot be measured from these records alone. That is
  the single biggest remaining gap in this project.
- **The deterministic pipeline remains the sole decision authority.**
  Every field this system's docs describe elsewhere as a decision —
  `risk_decision`, `decision_status`, `final_assessment` — is produced
  entirely by the deterministic agents/orchestrator described
  throughout this document, exactly as before. `prompts/` is an empty
  placeholder — no agent in the deterministic pipeline is, or has ever
  been, driven by an LLM.
- **An isolated, opt-in Claude/Anthropic reasoning layer exists under
  [`llm/`](llm/)**, per the design in
  [LLM_REASONING_LAYER_DESIGN.md](LLM_REASONING_LAYER_DESIGN.md). It
  runs only when a caller explicitly sets `options.llm.enabled ===
  true` (see [app.js](app.js)); the deterministic system requires no
  Anthropic credential and behaves identically whether the layer is
  used or not. When enabled, it reads the already-finalized pipeline
  result read-only, through a deep-frozen Evidence Package
  ([llm/evidencePackage.js](llm/evidencePackage.js)), and returns its
  output as a separate, additive `llmAnnotation` field — it never
  replaces, overrides, or feeds back into `risk_decision`,
  `decision_status`, or `final_assessment`. A validation/hallucination
  guard ([llm/validateOutput.js](llm/validateOutput.js)) rejects any
  Claude output that would attempt to override the Risk Manager's
  decision. Any failure of this layer (network, timeout, auth, rate
  limit, malformed response, schema, or a risk-override attempt) is
  reported only through `llmAnnotation`; the deterministic
  `pipelineResult` is unaffected either way. `ANTHROPIC_API_KEY`
  ([.env.example](.env.example), read only in
  [llm/anthropicLiveSource.js](llm/anthropicLiveSource.js)) is
  required only when this optional path is enabled — it is never read
  by, and never needed for, ordinary deterministic operation.
- **Freshness thresholds are centralized but not calibrated.**
  [config/freshness.js](config/freshness.js) defines a reasoned window
  per domain (market / news / macro) and orchestrator/index.js applies
  each to its own specialist. They are disclosed defaults derived from
  each provider's actual publication cadence — not values tuned
  against sustained real production traffic. Two pipeline domains
  (`sentiment`, and the Data Controller's `marketData`) are
  deliberately absent from that policy because neither has a chosen
  provider; records in those domains honestly report `UNKNOWN`
  freshness rather than borrowing another domain's window.
- **FRED-sourced macro data can never report anything but `UNKNOWN`
  freshness.** FRED publishes no genuine release timestamp, and
  `providers/adapters/fredMacroAdapter.js` deliberately refuses to
  derive one. A macro freshness window is still defined for any future
  provider that does supply one, but in practice the stale-data signal
  is inert for macro today. Correct, disclosed behavior — not a gap to
  work around by inventing a timestamp.
- **Quality/confidence thresholds elsewhere are still caller-supplied**
  with documented defaults in a few places (e.g. Trade Setup's quality
  thresholds) — none represent a real-world-calibrated value.
- **No automatic or manual trade execution, anywhere, under any
  configuration.** This system produces decision *intelligence*
  (bias, setup, risk, and decision-status labels) — it has no code
  path that could place, modify, or cancel an order even if asked to.

## Folder Structure

- `core/` — shared contracts. **IMPLEMENTED.**
- `agents/` — all 8 agents. **IMPLEMENTED.**
- `orchestrator/` — full pipeline wiring (`processRequest()`). **IMPLEMENTED.**
- `providers/` — the abstract adapter interface, plus real FRED and
  Alpha Vantage integrations. **IMPLEMENTED** — see [Provider
  Abstraction](#provider-abstraction-providers).
- `logs/` — logging foundation + runtime log output. **IMPLEMENTED.**
- `tests/` — cross-cutting contract, orchestrator, and end-to-end
  pipeline tests. **IMPLEMENTED.** (Per-agent unit tests live alongside
  each agent in `agents/<agent-name>/*.test.js`.)
- `config/` — centralized freshness policy. **IMPLEMENTED.**
- `data/` — persisted run records (`runs.jsonl`, gitignored) plus
  `runStore.js`. **IMPLEMENTED.**
- `prompts/` — reserved for future agent system prompts. **NOT
  IMPLEMENTED** (empty).

## Setup

No dependencies to install — the entire system uses only Node.js
built-ins (`fs`, `path`, `node:test`, `node:assert/strict`). Requires
Node.js 18+.

```bash
npm test
```
