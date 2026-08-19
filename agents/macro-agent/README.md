# Macroeconomic Intelligence Agent

Analyzes verified macroeconomic information and scheduled economic
events. The third of the 8 planned agents to be implemented, after the
Data Controller ([../data-controller](../data-controller)) and News
Agent ([../news-agent](../news-agent)).

```
RECEIVE VALIDATED MACRO DATA -> VALIDATE -> DISTINGUISH ACTUAL/EXPECTED/FORECAST
   -> IDENTIFY SURPRISES -> IDENTIFY UPCOMING EVENTS -> ASSESS MARKET IMPACT
   -> IDENTIFY MACRO RISKS -> structured Macro Report for future agents
```

## Status

**IMPLEMENTED**: everything described below, driven entirely by
internally-supplied macro records, upcoming events, and central bank
events. **NOT IMPLEMENTED**: any external economic-data provider
connection, any orchestration wiring that actually calls this agent,
the remaining 5 agents. **FUTURE**: a real provider adapter under
`providers/` feeding this agent's `input`.

## Responsibilities

Validates macro records, distinguishes actual/expected/forecast/
previous/scenario values, calculates economic surprises only when
possible, passes classification through unmodified, detects
conflicting sources, assesses relevance/importance relative to a
requested asset, tracks upcoming scheduled events and central bank
events as their own sub-models, and flags evidence-backed macro risks.
It does **not** execute trades, connect to a broker, or recommend a
direction — the Macro Report (`report.js`) has no `recommendation_type`
field at all (tests 18–19).

## Architecture

Mirrors `agents/data-controller` and `agents/news-agent`:
`normalize.js` -> `validate.js` -> freshness/verification defaults ->
`surprise.js` -> `conflicts.js` -> `relevance.js` + `importance.js` ->
`riskFlags.js` -> `impact.js` (aggregate) -> `report.js`, orchestrated
by `index.js`. Two additional sub-pipelines run alongside the main
macro-record pipeline: `events.js` (upcoming scheduled events) and
`centralBank.js` (central bank events) — both distinct contracts from
the main Macro Data Model, since their fields (`scheduled_time`,
`meeting_date`, `guidance`) don't fit an actual/expected/forecast
indicator shape.

## Macro Data Model (`macroRecord.js`)

27 fields exactly as specified: `indicator, indicator_code, country,
region, currency, category, actual_value, previous_value,
expected_value, forecast_value, unit, period, release_timestamp,
retrieved_timestamp, source, source_type, classification,
verification_status, freshness_status, confidence, surprise_value,
surprise_direction, market_relevance, potential_market_impact,
impact_direction, evidence, notes`. Every unset field defaults to
`UNKNOWN`, never fabricated.

**Required for acceptance** (`validate.js`): only `indicator` and
`classification` — without an indicator name there's no content to
process, and without a classification downstream code can't tell FACT
from FORECAST from SCENARIO. `actual_value` is deliberately **not**
required (test 3) — a `SCHEDULED_EVENT` record for a release that
hasn't happened yet legitimately has no actual value; it's handled
safely, not rejected. `release_timestamp` is also not required — a
missing one just means `freshness_status` stays `UNKNOWN`.

## Actual vs Expected vs Forecast

`actual_value`, `expected_value`, `forecast_value`, and
`previous_value` are separate fields, never conflated. The agent never
writes into one from another, and `classification` (see below) is the
authoritative signal for which kind of value a record represents —
`FACT` for a released actual, `HISTORICAL` for a previous period,
`SCHEDULED_EVENT` for an announced future release, `MARKET_EXPECTATION`
for economists' consensus, `FORECAST` for an analyst projection,
`SCENARIO` for a hypothetical.

## Classification

Pass-through only — this agent never assigns, infers, or upgrades a
`classification`. `FORECAST`, `MARKET_EXPECTATION`, `SCENARIO`, and
`UNVERIFIED` can never become `FACT` because nothing here ever
rewrites the field (tests 9–12).

## Surprise Calculation (`surprise.js`)

`SURPRISE = ACTUAL - EXPECTED`, computed **only** when both
`actual_value` and `expected_value` are real numbers — never estimated
from a missing value (tests 4–5). States: `ABOVE_EXPECTATION`,
`BELOW_EXPECTATION`, `IN_LINE` (exact match by default, or within an
optional configured `inLineToleranceRatio`), `UNKNOWN` (tests 6–8).
`surprise_direction` (a factual comparison of two given numbers) is
kept structurally separate from `impact_direction` (a market
interpretation, in `impact.js`) — the spec explicitly warns that
`ABOVE_EXPECTATION` does not automatically mean bullish or bearish,
since the same surprise can mean different things depending on
monetary-policy context this agent has no way to reliably infer.

## Source Verification & Conflict Detection

Uses `core/verification.js`. A lone, uncorroborated record defaults to
`UNVERIFIED`. Two or more sources disagreeing on the same
indicator+country+period never picks a winner — `conflicts.js` reuses
`core/verification.js`'s `reconcileSources()` (mapping macro's
`actual_value`/`country`/indicator-key fields into the shape that
function expects, purely for the comparison call) rather than
reimplementing conflict-comparison logic a third time. Every record in
a conflicting group is marked `CONFLICTING` and all are preserved
(test 13).

## Freshness

Computed by this agent from `release_timestamp` + configured
thresholds — never trusted from a caller's own "current"/"real-time"
claim. No timestamp, or no configured threshold, → `UNKNOWN` (test
14). Beyond the aging threshold → `STALE` (test 15). Macro data
freshness needs differ from market prices, so no thresholds are
hard-coded — same discipline as `core/freshness.js` and the other two
agents.

## Central-Bank Handling (`centralBank.js`)

A distinct sub-model: `central_bank, meeting_date, decision,
previous_decision, expected_decision, actual_decision, policy_direction,
guidance, uncertainty`. Only `central_bank` is required for acceptance.
`policy_direction` (`HAWKISH/DOVISH/NEUTRAL/MIXED/UNKNOWN`) is **read
from the input only** — this agent never infers it from `guidance`
text, the same discipline as `impact_direction` elsewhere in this
system. It is an analytical classification, explicitly **not** a
trading instruction (test 18). `buildCentralBankAssessment()`
aggregates multiple events into an `overall_policy_direction` via
simple, deterministic counting — the same pattern as `deriveMacroBias`.

## Upcoming Events (`events.js`)

A distinct sub-model: `event, scheduled_time, country, importance,
expected_value, previous_value, source, verification_status,
freshness_status`. Only `event` is required. `scheduled_time` is never
invented — a missing one stays `UNKNOWN` (test 17). **Limitation**:
`freshness_status` on an upcoming event is validated but not
*computed* here — judging how stale a *schedule entry* is would need a
distinct "when was this schedule confirmed" timestamp that isn't part
of the spec's field list, so this agent doesn't invent that semantic.
If the caller supplies a `freshness_status`, it's checked against the
enum and passed through as-is.

## Macro Risk Flags (`riskFlags.js`)

`HIGH_INFLATION_RISK`, `EMPLOYMENT_RISK`, `GROWTH_RISK`,
`RATE_DECISION_RISK`, `CENTRAL_BANK_RISK`, `POLICY_UNCERTAINTY`,
`DATA_CONFLICT`, `DATA_STALE`, `DATA_UNAVAILABLE` are each activated
by a narrow, documented evidence rule (see `MACRO_RISK_FLAG_DEFINITIONS`
in the module) — never from a vague impression. **`RECESSION_RISK` and
`GEOPOLITICAL_MACRO_RISK` are deliberately never auto-activated by this
agent** — reliably inferring either from a single indicator or event
would be an overreach with no solid evidence rule behind it; they
remain in the vocabulary for a future agent/human to apply with real
justification (tests in `riskFlags.test.js`).

## Market Impact (`impact.js`)

Same discipline as the News Agent: `impact_direction`
(`POSITIVE/NEGATIVE/MIXED/NEUTRAL/UNKNOWN`) is read from each record's
own tagged data, never inferred from the indicator name or its
surprise result. `POSITIVE` does not mean "this asset will rise" —
evidence-based language only (e.g. "potentially supportive if markets
interpret the release as raising tighter-policy expectations" belongs
in the source data's own `potential_market_impact` field, never
generated by this agent as a guaranteed-outcome claim).
`market_impact_assessment` aggregates tagged counts; `macro_bias`
(`BULLISH/BEARISH/MIXED/NEUTRAL/UNKNOWN`) is a deterministic
aggregation of those counts — evidence, **not** a trading instruction
(test 19).

## Output Contract (`report.js` — the Macro Report)

```
{
  agent_name: "macro-agent",
  timestamp, requested_asset,
  macro_records,              // validated records, enriched with market_relevance + importance
  key_indicators,              // importance CRITICAL or HIGH
  upcoming_events,
  economic_surprises,          // records with a real surprise_direction
  central_bank_assessment,
  macro_risks,
  market_impact_assessment,
  macro_bias,
  confidence, uncertainties, conflicts, warnings, sources,
}
```

No `recommendation_type` field exists anywhere in this shape. Status
(`agent_status` on the raw `processMacroData()` result): `FAILED`
(records were supplied but none validated), `CONFLICTING` (any
conflict group), `PARTIAL` (something rejected), `SUCCESS`, or
`UNAVAILABLE` (no data supplied through *any* channel — main records,
upcoming events, or central bank events — the literal phrase `MACRO
DATA UNAVAILABLE` appears in `warnings`, test 20). Status is driven by
the primary macro-records channel only, by design — upcoming/central-
bank event rejections are still surfaced via `warnings` but don't
independently flip `SUCCESS` to `PARTIAL` (a documented scope choice
for this step).

## Anti-Hallucination Protections

- No economic number, release, rate decision, forecast, expected
  value, date, release time, source, or URL is ever invented — missing
  ones stay `UNKNOWN` (tests 21–23).
- Classification is pass-through only (tests 9–12).
- Surprise is never calculated from a missing value (tests 3, 5).
- Conflicting sources are never hidden or auto-resolved (test 13).
- Empty input across all three channels returns `MACRO DATA
  UNAVAILABLE`, never a fabricated example event (test 20).
- The module exports exactly `MACRO_AGENT_STATUS`, `processMacroData`,
  `runMacroAgent` — no live-fetch or external-access function exists
  to falsely imply this agent has API access (test 24).
- No trading recommendation is ever produced (tests 18–19).

## Error Handling (`core/errors.js`)

Structurally ready for `API_UNAVAILABLE`/`TIMEOUT`/`RATE_LIMIT`/
`AUTH_FAILURE` via the provider-error passthrough branch (**NOT
IMPLEMENTED**/**FUTURE** — nothing calls it with a real failure yet).
Directly produces `MISSING_DATA`, `MALFORMED_DATA`, `STALE_DATA`, and
`CONFLICTING_DATA` itself (**IMPLEMENTED**). Never fabricates fallback
economic data on any of these.

## Logging

Every call logs via `logs/logger.js`: `agent: "macro-agent"`, request
shape, aggregated sources, `agent_status`, warnings, errors. Secrets
are redacted by the logger itself (Step 3).

## Testing

Node's built-in `node:test` (no new dependency). Run via `npm test`
(auto-discovers all `*.test.js` files project-wide).

- `macroRecord.test.js`, `surprise.test.js`, `relevance.test.js`,
  `importance.test.js`, `conflicts.test.js`, `centralBank.test.js`,
  `events.test.js`, `riskFlags.test.js` — unit tests per module.
- `macroAgent.test.js` — the 24 required scenarios from the Step 6
  spec (numbered in the test names), plus provider-error and
  non-array-input coverage.

**Note:** this environment has no `node` binary available (same as
Steps 3–5), so the suite could not actually be executed here — only
reviewed by hand, tracing every test path against the implementation.
Run `npm test` yourself to confirm before relying on it.

## Current Limitations

- Untested by execution — see above.
- `market_relevance`'s `HIGH`/`MEDIUM` levels require the caller to
  supply `options.assetCountry`/`options.assetRegion` — this agent has
  no built-in knowledge of which country/region a given asset belongs
  to, and won't guess one.
- Upcoming-event `freshness_status` is validated, not computed (see
  Upcoming Events above).
- `RECESSION_RISK` and `GEOPOLITICAL_MACRO_RISK` are never
  auto-activated — no narrow evidence rule was defined for either.
- No orchestrator wiring — nothing currently calls this agent as part
  of an end-to-end flow.
- No literal bridge from Data Controller's generic Data Record shape
  into a Macro Record — same limitation as the News Agent, for the
  same reason (the contracts' fields don't naturally map without a
  real provider to define that mapping against).
