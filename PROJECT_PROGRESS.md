# Project Progress — Financial Market Intelligence

Status snapshot of the whole repository: the Market Intelligence
multi-agent pipeline, the Portfolio Intelligence system, and the
production HTTP API wrapping both. Update this file whenever a
material change lands — it is the authoritative source for "what's
done" and "what's next," not a substitute for the code or tests.

This project has **no LLM/Claude/Anthropic integration of any kind.**
Every agent, provider adapter, and portfolio calculation below is
deterministic hand-written logic — there is no prompt, no model call,
and no AI-generated inference anywhere in the runtime path.

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
- **CLI wrappers**: `runIntelligence.js` (Market Intelligence, FRED
  only), `runPortfolioIntelligence.js` (with a `--existing-portfolio`
  flag), `runPortfolioScenarioComparison.js` (JSON-request CLI).

### Production HTTP API (`server.js`)
Minimal HTTP server using only Node's built-in `http` module — no
Express or other framework:
- `GET /health` → `200 {"status":"ok"}`
- `POST /api/intelligence` → calls the existing, unmodified
  `runApplicationRequest()` (from `app.js`); FRED is only touched if
  the caller's own request body sets `options.macro.enabled === true`
- `POST /api/portfolio-intelligence` → calls the existing, unmodified
  `runPortfolioIntelligenceRequest()`; never touches any provider
- Request-body size limit, malformed/invalid-JSON handling, generic
  500s with no leaked stack traces or internals, 404 for unknown
  routes, 405 for unsupported methods, graceful `SIGTERM`/`SIGINT`
  shutdown, binds to `process.env.PORT || 3000` on all interfaces.
- Start command: **`npm start`** (runs `node server.js`).

### Tests
**1023/1023 passing** as of the last full run (`npm test`, Node
v24.19.0) — covers every core contract, all 8 agents, the orchestrator,
both provider integrations (including mocked failure-mode coverage for
`API_UNAVAILABLE`/`TIMEOUT`/`RATE_LIMIT`/`AUTH_FAILURE`), the complete
Portfolio Intelligence stack, and the HTTP API layer. No test requires
real credentials or makes a real network call.

### Git / deployment status
- 5 commits on `main`, most recent `a5622b6` ("Add production HTTP
  API").
- Remote `origin` → `https://github.com/zubair5826/Financial-Market-News.git`,
  pushed and up to date (`main` tracks `origin/main`, no divergence).
- `.env` is gitignored and confirmed never tracked; no credentials are
  committed anywhere in history.
- Not yet actually deployed to any hosting platform (e.g. Railway) —
  the code is push-ready and locally smoke-tested via `npm start`, but
  no live production deployment exists yet.

## 2. In Progress

Nothing is actively in progress — every capability above is complete
and tested. The project is between milestones, not mid-implementation
on anything.

## 3. Not Yet Implemented

- **No HTTP endpoint for Portfolio Scenario Comparison** — it has a
  CLI (`runPortfolioScenarioComparison.js`) but no `/api/...` route.
- **No sentiment or generic-market-data provider** — both remain
  caller-supplied only, by design; no provider has been evaluated
  beyond the Step 15 audit already on record.
- **No natural-language extraction of existing holdings** —
  `existingPortfolio` must be supplied as structured JSON today.
- **No actual deployment** to Railway or any other host — only local
  verification (`npm start` + curl/smoke tests) has been done.
- **No authentication/authorization** on any HTTP endpoint — the API
  is currently open to any caller who can reach it.
- **No rate limiting, request logging, or metrics** on the HTTP layer
  itself (`logs/logger.js` covers agent-level events, not HTTP
  requests).

## 4. Future Planned Work (not started, not scheduled)

- Consider whether the HTTP API needs authentication before any public
  deployment.
- Consider an `/api/scenario-comparison` HTTP route mirroring the
  existing CLI, if a real need for it is demonstrated.
- Consider a sentiment data provider, if one is identified and
  evaluated the same way FRED/Alpha Vantage were.
- Consider actual deployment to a hosting platform, once the above
  questions (especially authentication) are resolved.

None of the above is authorized or scheduled — this section exists
only to record known open questions, not a roadmap commitment.

## Standing Rules (unchanged, apply to every future step)

- Never modify CafeBot or any file outside this project.
- No LLM/Claude/Anthropic integration exists or should be assumed.
- Never implement real-money trading, broker/exchange connection, or
  automatic trade execution.
- Never hardcode a credential; every secret is read from an environment
  variable in exactly one file per provider.
- Never install a dependency unless genuinely required, and document
  why (the project currently has zero npm dependencies).
- Only build what is explicitly requested — do not get ahead of
  instructions.
