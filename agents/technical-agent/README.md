# Technical Analysis Agent

Analyzes validated OHLCV market data using deterministic indicator
math. The fourth of the 8 planned agents to be implemented, after the
Data Controller, News Agent, and Macro Agent.

```
RECEIVE VALIDATED MARKET DATA -> VALIDATE OHLCV -> NORMALIZE
   -> per timeframe: INDICATORS -> MARKET STRUCTURE -> TREND -> MOMENTUM
      -> VOLATILITY -> PATTERNS -> SUPPORT/RESISTANCE
   -> across timeframes: TECHNICAL CONFLICTS
   -> structured Technical Report for future agents
```

## Status

**IMPLEMENTED**: everything described below, driven entirely by
internally-supplied OHLCV candles. **NOT IMPLEMENTED**: any external
market-data provider connection, any orchestration wiring that
actually calls this agent, the remaining 4 agents. **FUTURE**: a real
provider adapter under `providers/` feeding this agent's `input`.

## Responsibilities

Validates candles, computes SMA/EMA/RSI/MACD/ATR/Bollinger Bands/
volume statistics deterministically from supplied data only, detects
market structure/trend/momentum/volatility/patterns/support-resistance,
and flags conflicting technical signals — both within one timeframe and
across timeframes. It does **not** execute trades, connect to a
broker, or recommend a direction — the Technical Report (`report.js`)
has no `recommendation_type` field and never contains
`BUY`/`SELL`/`LONG`/`SHORT` anywhere (test 27 asserts this by
serializing the whole report and scanning for those literal strings).

## Candle Data Model (`technicalRecord.js`)

16 fields. The spec's own candle field bullet list omitted
`timeframe`, but its "OHLCV Validation" and "Primary Input" sections
both explicitly discuss it ("If timeframe is missing: UNKNOWN") — it's
included here as a deliberate reconciliation of the spec's own
sections, not an invented addition. Every unset field defaults to
`UNKNOWN` — **except `volume`**, which reads `NOT_AVAILABLE` when
absent (a confirmed absence the normalizer positively checked for),
per the spec's explicit instruction.

**Required for acceptance** (`validate.js`): `asset, open, high, low,
close, classification`. `timeframe`, `timestamp`, and `volume` are
deliberately **not** required — each is "handled safely" when missing
per the spec (timeframe → `UNKNOWN`, timestamp → `freshness_status
UNKNOWN`, volume → `NOT_AVAILABLE`), not rejected.

## OHLCV Validation

Two tiers: structural (field presence + enum legality) and OHLC logic.
`validateOHLCLogic()` checks every directional rule the spec lists
(`high >= open`, `high >= close`, `high >= low`, `low <= open`, `low
<= close`, `open >= low`, `open <= high`, `close >= low`, `close <=
high`) — a few are mathematically implied by others, but all are kept
literal for direct traceability against the spec. A candle failing any
rule is **rejected outright**; its values are never altered (test 30).

## Timeframe Handling

Candles are grouped by `(requested asset filter) × timeframe` after
validation. If only one timeframe is present in the input, only that
timeframe is analyzed — there's no assumption that multiple timeframes
exist. **Documented limitation**: `agent_status` reflects whether the
*supplied* data validated, not whether anything matched
`options.requestedAsset` — a batch of entirely irrelevant-asset data
can still report `SUCCESS` with an empty `timeframe_analyses`; check
`candles_analyzed`/`timeframes_analyzed` to know whether anything was
actually analyzed for the requested asset.

## Indicator Calculations (`indicators.js`)

SMA, EMA, RSI (Wilder's smoothing), MACD (line/signal/histogram), ATR
(Wilder's smoothing), Bollinger Bands, and volume statistics — all
computed only from supplied candles, all returning `INSUFFICIENT_DATA`
(too few candles for the configured period) or `DATA_UNAVAILABLE`
(invalid parameters) rather than a guessed value. Every result reports
`indicator`, `parameters`, `timeframe`, `current_value`,
`calculation_status`, `data_required`, `confidence`, `notes`, and (for
RSI/MACD/ATR/Bollinger) a `technical_state` observation label —
`OVERBOUGHT_ZONE`/`OVERSOLD_ZONE`/`NEUTRAL` for RSI,
`BULLISH_CROSS`/`BEARISH_CROSS`/`ABOVE_ZERO`/`BELOW_ZERO`/`NEUTRAL` for
MACD, `LOW`/`NORMAL`/`HIGH`/`EXTREME` for ATR-derived volatility (only
when `options.volatilityThresholds` is configured — otherwise
`UNKNOWN`, never assumed), and
`ABOVE_UPPER_BAND`/`BELOW_LOWER_BAND`/`NEAR_UPPER_BAND`/`NEAR_LOWER_BAND`/`WITHIN_BANDS`
for Bollinger (the `NEAR_*` states only reachable with
`options.nearBandThresholdRatio` configured). Default periods (SMA
20/50, EMA 9/20, RSI 14, MACD 12/26/9, ATR 14, Bollinger 20/2) are
industry-standard conventions, not invented — all overridable via
`options.indicatorConfig`.

## Trend and Market Structure

`structure.js` finds swing highs/lows mechanically (a candle is a
swing high if its high is the maximum within a symmetric
`options.swingLookback`-candle window, default 2) and reports the most
recently formed swing's classification
(`HIGHER_HIGH`/`HIGHER_LOW`/`LOWER_HIGH`/`LOWER_LOW`), or `UNKNOWN`
with fewer than `2×lookback+3` candles or fewer than 2 swings found.

`trend.js`'s rule is documented exactly, per the spec's explicit
requirement: `STRONG_UPTREND` = price > fastSMA > slowSMA AND
structure is HIGHER_HIGH/HIGHER_LOW; `UPTREND` = price > fastSMA >
slowSMA without that confirmation; `STRONG_DOWNTREND`/`DOWNTREND`
mirror; `SIDEWAYS` = inconsistent ordering; `UNKNOWN` = price or either
SMA couldn't be calculated. The smallest two configured SMA periods
are used as fast/slow; fewer than 2 SMA periods configured means trend
is always `UNKNOWN`.

## Support/Resistance (`supportResistance.js`)

Clusters swing highs/lows (from `structure.js`) within a configurable
tolerance (default 1.5%) into levels, each reporting `level, type,
timeframe, evidence` (the swing points that produced it), `strength`
(`WEAK`/`MODERATE`/`STRONG` by touch count), and `confidence`. Never
claims a level without real swing evidence, and never claims a
guaranteed reversal — only `"Potential support/resistance"` framing via
the `type`/`evidence` fields, no predictive language anywhere in the
code.

## Momentum and Volatility

`momentum.js` votes from already-calculated RSI (≥60/≤40 — a
conventional threshold distinct from the 70/30 overbought/oversold
zone) and MACD histogram sign; `STRONG_*` requires every available
signal to agree. `volatility.js` is a thin wrapper exposing the ATR
result's `technical_state` under a stable name — no separate threshold
logic, no invented volatility judgment beyond what `indicators.js`
already computed.

## Pattern Detection (`patterns.js`)

`DOUBLE_TOP`/`DOUBLE_BOTTOM` require the last two swing highs/lows to
be within a configurable tolerance (default 2%) of each other.
`HIGHER_HIGH_HIGHER_LOW`/`LOWER_HIGH_LOWER_LOW` require the market
structure evidence to show both swing types moving the same direction.
`RANGE` is reported when swing data exists but no directional pattern
matched; `UNKNOWN` when there isn't enough swing data to judge any of
it. A pattern is only ever reported when its documented criteria are
literally satisfied by the supplied candles — never from visual
impression.

**Limitation**: `patterns.js`, `structure.js`, and
`supportResistance.js` each independently call the same swing-detection
logic with their own configurable lookback (`patternOptions.swingLookback`,
`structureOptions.swingLookback`, `levelOptions.swingLookback`) — all
default to the same value (2), but if a caller overrides one without
the others, DOUBLE_TOP/BOTTOM detection and market-structure evidence
could use different swing points. Keep them consistent, or don't
override one without the others.

## Breakout Detection

`BREAKOUT_CANDIDATE`/`BREAKDOWN_CANDIDATE` fire when the latest close
is beyond the most recent swing high/low — an **observation**, never a
prediction. `CONFIRMED_BREAKOUT`/`CONFIRMED_BREAKDOWN` are only ever
reachable when the caller supplies `options.breakoutConfirmationCandles`
and that many of the most recent candles all closed beyond the level;
without that option, only the `CANDIDATE` state exists, by design.

## Multi-Timeframe Analysis (`conflicts.js`)

Every timeframe present in the input is analyzed independently — if
only one exists, only that one is analyzed. `assessTechnicalConflicts()`
detects three kinds, all preserving both sides rather than picking a
winner: `TIMEFRAME_CONFLICT` (two timeframes' trends point opposite
directions), `TREND_MOMENTUM_CONFLICT`, and `PRICE_MOMENTUM_CONFLICT`
(price above/below the fast MA while momentum reads the opposite
direction) — the two literal examples from the Step 7 spec. States:
`NO_CONFLICT`, `CONFLICTING_SIGNALS`, `INSUFFICIENT_DATA` (no
timeframe analyses at all), `UNKNOWN`.

## Technical Bias

`report.js` aggregates each analyzed timeframe's trend into
`BULLISH`/`BEARISH`/`MIXED`/`NEUTRAL`/`UNKNOWN` — a deterministic count
of bullish vs. bearish trends, evidence only. `BULLISH` never means
`BUY`; there is no field anywhere in the Technical Report that could
hold a trading instruction (test 27 verifies this by scanning the
entire serialized report for `BUY`/`SELL`/`LONG`/`SHORT`).

## Output Contract (`report.js` — the Technical Report)

The spec's field list includes both flat fields (`indicators`,
`trend_analysis`, `market_structure`, ...) and a `timeframe_analysis`
array — to avoid ambiguity this treats `timeframe_analysis` as the
full per-timeframe breakdown, and the flat fields as a convenience
view of one "primary" timeframe (`options.primaryTimeframe` if
supplied and present, else whichever analyzed timeframe has the most
candles). This disambiguation is documented here since the spec itself
doesn't resolve it. No `recommendation_type` field exists anywhere.

## Anti-Hallucination Protections

- No price, OHLC value, volume, timestamp, indicator value, or pattern
  is ever invented — `INSUFFICIENT_DATA`/`DATA_UNAVAILABLE`/`UNKNOWN`/
  `NOT_AVAILABLE` used exactly as the spec specifies per field type.
- Classification is pass-through only (tests 14–17).
- Support/resistance levels only ever come from real swing evidence
  (test 18); trend requires calculable moving averages (test 19).
- Conflicting technical signals are never hidden — both sides
  preserved (tests 22, 29).
- Empty input returns `TECHNICAL DATA UNAVAILABLE` (test 28).
- The module exports exactly `TECHNICAL_AGENT_STATUS`,
  `processTechnicalData`, `runTechnicalAgent` — no live-fetch or
  external-access function exists to falsely imply market access
  (tests 25–26).
- No trading recommendation is ever produced (test 27).

## Error Handling (`core/errors.js`)

Structurally ready for `API_UNAVAILABLE`/`TIMEOUT`/`RATE_LIMIT`/
`AUTH_FAILURE` via the provider-error passthrough branch (**NOT
IMPLEMENTED**/**FUTURE**). Directly produces `MISSING_DATA`,
`MALFORMED_DATA`, `STALE_DATA`, and `CONFLICTING_DATA` itself
(**IMPLEMENTED**). Never fabricates fallback technical data.

## Logging

Every call logs via `logs/logger.js`: `agent: "technical-agent"`,
request shape, aggregated sources, `agent_status`, warnings, errors.
Secrets are redacted by the logger itself (Step 3).

## Testing

Node's built-in `node:test` (no new dependency). Run via `npm test`.

- `technicalRecord.test.js`, `validate.test.js`, `indicators.test.js`,
  `structure.test.js`, `trend.test.js`, `momentum.test.js`,
  `patterns.test.js`, `supportResistance.test.js`, `conflicts.test.js`
  — unit tests per module, with hand-verified exact expected values
  for every indicator calculation (worked by hand and documented
  inline, since execution wasn't possible in this environment — see
  below).
- `technicalAgent.test.js` — the 30 required scenarios from the Step 7
  spec (numbered in the test names), plus provider-error and
  non-array-input coverage.

**Note:** this environment has no `node` binary available (same as
Steps 3–6), so the suite could not actually be executed here — only
reviewed by hand. This step's review caught and fixed a real bug:
`conflicts.js` originally destructured `currentPrice` (camelCase) from
timeframe-analysis objects, but `index.js` actually produces
`current_price` (snake_case, matching this project's field-naming
convention everywhere else) — the mismatch meant `PRICE_MOMENTUM_CONFLICT`
could never fire from the real pipeline, silently defeating part of
the spec's "price above MA but momentum negative" requirement. Fixed,
and a regression-guard test was added specifically to catch a
recurrence. Run `npm test` yourself to confirm before relying on this.

## Current Limitations

- Untested by execution — see above.
- Swing-detection lookback can drift out of sync across
  `patterns.js`/`structure.js`/`supportResistance.js` if configured
  inconsistently (see Pattern Detection above).
- `agent_status` doesn't reflect whether anything matched
  `options.requestedAsset` (see Timeframe Handling above).
- Volatility/Bollinger "near band"/zone classifications require
  explicit caller-supplied thresholds; without them, those states stay
  `UNKNOWN` rather than guessed.
- No orchestrator wiring — nothing currently calls this agent as part
  of an end-to-end flow.
- No literal bridge from Data Controller's generic Data Record shape
  into a candle — same limitation as the News/Macro agents, for the
  same reason (no real provider yet to anchor that mapping against).
