# Project Progress — Trading Intelligence System

Status snapshot of the multi-agent AI Trading Intelligence System.
Update this file whenever a step completes or the plan changes — it is
the authoritative source for "what's done" and "what's next."

## Completed Steps

### Step 3 — Foundation
Shared contracts every agent builds on: `core/dataRecord.js` (Data
Contract), `core/classification.js`, `core/freshness.js`,
`core/verification.js`, `core/confidence.js`,
`core/hallucinationRules.js`, `core/agentMessage.js`, `core/errors.js`.
Plus `providers/ProviderAdapter.js` (interface only, no real provider),
`logs/logger.js`, `orchestrator/index.js` (skeleton — most functions
still stubbed, not wired to real agents), and the `tests/` foundation
suite.

### Step 4 — Data Controller (`agents/data-controller/`)
The system's data-truth layer: validates, classifies (pass-through),
checks freshness/source verification, detects conflicts, normalizes
raw market data into the Data Contract. No trading analysis, no
recommendations.

### Step 5 — News Intelligence Agent (`agents/news-agent/`)
Validates news items, detects likely duplicates and conflicting
reports, assesses relevance/importance, aggregates market impact and
an evidence-based news bias. No live news provider connected.

### Step 6 — Macroeconomic Intelligence Agent (`agents/macro-agent/`)
Validates macro indicator records, calculates economic surprises
(actual vs. expected) only when both values exist, tracks upcoming
events and central bank events as their own sub-models, flags
evidence-based macro risks. No live economic-data provider connected.

### Step 7 — Technical Analysis Agent (`agents/technical-agent/`)
Deterministic OHLCV validation and indicator math (SMA, EMA, RSI,
MACD, ATR, Bollinger Bands, volume stats), market structure/trend/
momentum/volatility/pattern detection, support/resistance levels,
multi-timeframe conflict detection. No live market-data provider
connected.

### Step 8 — Sentiment Analysis Agent (`agents/sentiment-agent/`)
Validates sentiment records, derives strength deterministically
(never from wording), detects conflicting sentiment per asset,
aggregates a weighted sentiment bias and market-impact assessment. No
live sentiment/social-media provider connected.

### Step 9 — Trade Setup Agent (`agents/trade-setup-agent/`)
Consumes the four reports above (not raw data) to assess setup
direction, confluence, quality, potential levels (referencing only
real Technical Agent levels — never invented), and setup-level risks.
Does not execute trades, does not replace the future Risk Manager.

**Every agent above shares the same anti-hallucination discipline**:
classification is always pass-through (FORECAST/SCENARIO/
MARKET_EXPECTATION/UNVERIFIED never become FACT), conflicts are always
preserved rather than silently resolved, missing data is always
`UNKNOWN`/`NOT_AVAILABLE`/`DATA_UNAVAILABLE` rather than fabricated,
and every report exposes a bias/direction field that is explicitly
**not** a trading instruction (no `BUY`/`SELL`/`LONG`/`SHORT` anywhere
in any agent's output).

## Not Yet Built

- **Step 10 — Risk Manager** (`agents/risk-manager/` exists only as an
  empty placeholder from the original Step 2 scaffold)
- **Step 11 — Chief Trading Manager** (`agents/chief-trading-manager/`
  — same, empty placeholder only)
- Orchestrator wiring that actually calls the agents end-to-end
  (`orchestrator/index.js` is still a skeleton — most functions throw
  "not implemented yet")
- Any real data/broker/exchange provider (`providers/` has the
  interface only)
- Any external API connection or API key of any kind

## Important Limitations (carried across every step)

- **Untested by execution.** No `node` binary has been available in
  any session so far, so none of the ~300+ test cases across all 6
  built agents have actually been run — only hand-traced against the
  implementation. **Run `npm test` at the project root before relying
  on any of this code**, and report back what happens.
- Two real logic bugs were found and fixed during hand-tracing (not
  execution) and are worth knowing about if similar code is touched
  again:
  - **News Agent** (`agents/news-agent/relevance.js`): `SECTOR`
    relevance was originally reachable for *any* category, which would
    have wrongly called an unrelated story sector-relevant to any
    asset. Fixed to require an explicit `options.sectorCategories`.
  - **Technical Agent** (`agents/technical-agent/conflicts.js`): read
    `currentPrice` (camelCase) from timeframe-analysis objects, but
    `index.js` actually produces `current_price` (snake_case) — the
    mismatch meant `PRICE_MOMENTUM_CONFLICT` could never fire. Fixed,
    with a regression-guard test added.
  - **Trade Setup Agent** (`agents/trade-setup-agent/index.js`): when
    the aggregated direction itself came out `MIXED`, the
    conflicting-evidence check only compared each domain against a
    single `BULLISH`/`BEARISH` pole, so opposing domains would both
    wrongly land in `supporting_evidence`. Fixed by special-casing the
    `MIXED` direction.
- No real provider has been selected for any data type (market data,
  news, macro/economic data, sentiment/social media). Every agent
  accepts internally-supplied data only.
- Each agent's own `README.md` documents its specific limitations in
  more detail — this file is the cross-project summary, not a
  replacement for those.

## Next Step

**Step 10 — Risk Manager.** Not started. Waiting for explicit
instruction before implementing — do not begin without it.

## Standing Rules (apply to every future step)

- Never modify CafeBot or any file outside this project.
- Never connect a real API, broker, or exchange; never create an API
  key.
- Never implement real-money trading or automatic trade execution.
- Never install a dependency unless genuinely required, and document
  why.
- Only build the agent explicitly requested — do not get ahead of
  instructions.
