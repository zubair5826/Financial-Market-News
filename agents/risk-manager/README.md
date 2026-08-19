# Risk Manager

Evaluates the risk of a proposed trade setup produced by the Trade
Setup Agent. The seventh of the 8 planned agents, and the second
(after Trade Setup) that consumes other agents' reports rather than
raw data.

```
RECEIVE Trade Setup report (+ optional News/Macro/Technical/Sentiment
   reports) -> VALIDATE each (never bypassed) -> DATA QUALITY
   -> POSITION SIZE (only if every parameter is explicitly supplied)
   -> INVALIDATION (technical levels only, never invented)
   -> RISK CATEGORIES/FACTORS -> RISK LEVEL -> RISK DECISION -> Risk Report
```

## Status

**IMPLEMENTED**: everything described below, driven by the Trade
Setup Agent's report and, optionally, the raw News/Macro/Technical/
Sentiment reports for finer-grained risk detail (volatility, volume,
upcoming events) that isn't captured in the Trade Setup Agent's
summarized evidence. **NOT IMPLEMENTED**: the Chief Trading Manager
(next step), any orchestration wiring that automatically threads a
real trade setup and its four source reports into this agent.
**FUTURE**: that wiring, once `orchestrator/` is built out.

## Responsibilities

Validates every supplied report's shape (never trusts a malformed or
wrongly-labeled report blindly), assesses data quality (staleness,
verification, conflicts, missing domains, technical timeframe
conflicts, proximity to major scheduled events, setup evidence
strength), computes position size **only** when every required
parameter is explicitly supplied, evaluates (never invents)
invalidation levels, detects risk categories with supporting factors,
and derives a risk level and risk decision. It does **not** execute
trades, does not connect to a broker, and does not override missing
evidence with assumptions anywhere.

## Input Contract

`processRiskAssessment(inputs, options)` — `inputs` is `{
tradeSetupReport, newsReport, macroReport, technicalReport,
sentimentReport }`. `tradeSetupReport` is the primary input; the four
domain reports are **optional** and add detail the Trade Setup Agent's
own embedded evidence doesn't carry (e.g. `technicalReport.volatility`,
`technicalReport.volume_analysis`, `macroReport.upcoming_events`).
Every supplied report is validated via `reportValidation.js` (correct
`agent_name` plus the fields this agent depends on) before being
trusted — a report that fails this check is treated as **not
supplied**, with a warning, never repaired or guessed at.

`options.positionSizingParams` — `{ accountBalance, riskPercentage,
leverage, entryPrice, stopPrice, contractSize }`, all optional; if any
is missing, position sizing reports `DATA_UNAVAILABLE` rather than
guessing. `options.upcomingEventWindowMs` — how "near" a scheduled
macro event must be to count as a timing risk; without it, event
proximity is always `UNKNOWN`, never assumed.

## Data Quality (`dataQuality.js`)

Detects exactly the seven conditions the Step 10 spec lists as things
that must increase risk — and nothing else:

- **stale** — an uncertainty/warning mentions `STALE`.
- **unverified** — an uncertainty/warning mentions `UNVERIFIED`.
- **conflicting** — the Trade Setup Agent's `conflicting_evidence` is
  non-empty.
- **missing_information** — which of news/macro/technical/sentiment
  evidence is absent from the trade setup.
- **technical_timeframe_conflict** — `technical_conflicts.status ===
  "CONFLICTING_SIGNALS"` (from a supplied technical report, or from the
  Trade Setup Agent's own technical evidence conflicts).
- **upcoming_events_near** — `true`/`false` only when a real,
  parseable `scheduled_time` exists **and** `options.upcomingEventWindowMs`
  is configured; otherwise `UNKNOWN` — timing is never invented.
- **weak_setup_evidence** — the trade setup's own `setup_quality` is
  `LOW` or `UNKNOWN`.

## Position Sizing (`positionSizing.js`)

Real-money position sizing is **never computed** unless all six listed
parameters are explicitly supplied as real numbers — none are ever
assumed, defaulted, or estimated. With all six present, a standard
deterministic fixed-fractional formula runs: `riskAmount =
accountBalance × riskPercentage`; `units = riskAmount / |entryPrice −
stopPrice|`; `position_size = units × contractSize`. `leverage` is
carried through in the output for context but isn't multiplied into
this formula — its absence still forces `DATA_UNAVAILABLE` per the
spec's literal instruction, since inventing a leverage-adjusted
formula this system isn't confident about would itself be a
fabrication risk.

## Stop / Invalidation (`invalidation.js`)

No stop-loss price is ever invented here. This module only evaluates
the invalidation conditions the Trade Setup Agent already derived from
real, validated Technical Agent support/resistance levels (Step 7 →
Step 9 → here) — it adds no new price, only a qualitative read of
whether real levels are actually available (`AVAILABLE` vs
`DATA_UNAVAILABLE`).

## Risk Categories and Factors (`riskCategories.js`)

`MARKET_RISK, VOLATILITY_RISK, LIQUIDITY_RISK, NEWS_RISK, MACRO_RISK,
TECHNICAL_RISK, SENTIMENT_RISK, DATA_RISK, CONFLICT_RISK, TIMING_RISK,
EXECUTION_RISK, UNKNOWN` — every category activated is backed by a
narrow, documented evidence rule (see the module's own header
comment), each paired with a `risk_factors` entry citing the concrete
evidence that triggered it. `VOLATILITY_RISK`/`LIQUIDITY_RISK` only
ever fire from a **supplied** Technical Agent report's own
`HIGH`/`EXTREME` volatility or `UNUSUALLY_LOW_VOLUME` status — never
assumed from a technical report simply being absent, and never
inferred from volume merely being `NOT_AVAILABLE` (a data gap is not
evidence of illiquidity). `EXECUTION_RISK` fires when position sizing
and/or invalidation levels aren't fully available. `UNKNOWN` exists in
the vocabulary but is never auto-activated.

## Risk Level and Risk Decision (`riskLevel.js`)

Fully documented, deterministic:

- **Risk level**: no setup reference, or the setup itself is
  `DATA_UNAVAILABLE` → `UNKNOWN`. Otherwise a base level from the
  active-category count (`0→LOW, 1–2→MODERATE, 3–4→HIGH, 5+→CRITICAL`),
  with two floors that can only ever **raise** the level, never lower
  it: `setup_status: CONFLICTING_EVIDENCE` floors at `HIGH`;
  `setup_quality: LOW` floors at `MODERATE`.
- **Risk decision** (`RISK_ACCEPTABLE / RISK_REQUIRES_REVIEW /
  RISK_TOO_HIGH / INSUFFICIENT_DATA / UNKNOWN`) — **this is never an
  execution decision**. The underlying setup lacking enough data
  (`DATA_UNAVAILABLE`/`INSUFFICIENT_DATA`) always forces
  `INSUFFICIENT_DATA` here too, regardless of the computed risk level.

## Output Contract (`report.js` — the Risk Report)

Exactly the spec's field list: `agent_name, timestamp, asset,
setup_reference, risk_level, risk_categories, risk_factors,
data_quality, conflicts, missing_information, position_size_status,
invalidation_assessment, risk_decision, confidence, uncertainties,
warnings, sources`. `setup_reference` is a **compact pointer** back to
the trade setup (`setup_status, direction, setup_quality, asset,
timestamp`), not a full duplicate of that report. `position_size_status`
and `invalidation_assessment` each hold a small **structured object**
(with their own `status` field) rather than a bare string — richer
context, same pattern already used elsewhere in this project (e.g. the
Technical Agent's `volatility` field). No execution command, no
`recommendation_type`, and — verified by test — no
`BUY`/`SELL`/`LONG`/`SHORT` anywhere in the serialized report.

## Anti-Hallucination Protections

- No account size, risk percentage, leverage, price, stop level,
  market/economic data, news, sentiment, or technical signal is ever
  invented — every value traces back to an already-validated upstream
  report or an explicitly caller-supplied parameter.
- No safety or profitability guarantee anywhere (scanned in tests).
- Position size is `UNKNOWN` unless every one of the 6 required
  parameters is a real number.
- No stop-loss price is invented — only real Technical Agent levels,
  passed through unchanged, are ever evaluated.
- No trade execution — the module exports exactly `RISK_LEVELS`,
  `RISK_DECISIONS`, `processRiskAssessment`, `runRiskManager`.

## Error Handling (`core/errors.js`)

`MALFORMED_DATA` for a non-object `inputs` argument. Each upstream
report's own error states are already resolved by that agent before
this one ever sees it — this agent consumes the already-final report
rather than re-implementing that handling.

## Logging

Every call logs via `logs/logger.js`: `agent: "risk-manager"`, request
shape, aggregated sources, `risk_decision`, warnings, errors. Secrets
are redacted by the logger itself (Step 3).

## Testing

Node's built-in `node:test` (no new dependency). Run via `npm test`.

- `reportValidation.test.js`, `dataQuality.test.js`,
  `positionSizing.test.js`, `invalidation.test.js`,
  `riskCategories.test.js`, `riskLevel.test.js` — unit tests per
  module.
- `riskManager.test.js` — every scenario listed in the Step 10 spec's
  TESTING section (valid setup, missing setup, stale/conflicting data,
  missing price, missing account data/risk parameters, high
  volatility, major event risk, unverified source, risk escalation,
  position size unavailable, no execution, no broker calls, no
  fabricated values).

**Note:** this environment has no `node` binary available (same as
every prior step), so the suite could not actually be executed here —
only reviewed by hand. While hand-tracing, two of the integration
test's own fixtures (for the "high volatility" and "major event risk"
scenarios) were found to be missing required fields that
`reportValidation.js` checks — meaning those fixtures would have been
silently rejected and treated as "not supplied," making the tests pass
without exercising the intended code path at all. Fixed by completing
the fixtures against `reportValidation.js`'s actual required-field
list. A separate real logic fix was needed in `index.js`: `confidence`
was originally computed before `missing_information` was fully
assembled (position-sizing gaps hadn't been folded in yet), so a setup
missing all position-sizing parameters could still report `confidence:
"HIGH"`. Fixed by reordering. Run `npm test` yourself to confirm
before relying on this.

## Current Limitations

- Untested by execution (highest priority to verify on your end).
- Risk-level/decision thresholds are this project's own documented
  heuristic, not a validated risk-management methodology.
- No orchestrator wiring — the caller must assemble `inputs` (and any
  `positionSizingParams`) manually for now.
- `VOLATILITY_RISK`/`LIQUIDITY_RISK`/timing-event detection all
  require the caller to separately supply the relevant raw domain
  report — the Trade Setup Agent's embedded evidence objects don't
  carry that level of detail.
