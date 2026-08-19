# Sentiment Analysis Agent

Analyzes validated market sentiment supplied internally by the system.
The fifth of the 8 planned agents to be implemented, after the Data
Controller, News Agent, Macro Agent, and Technical Agent.

```
RECEIVE VALIDATED SENTIMENT DATA -> VALIDATE -> CLASSIFY SOURCES
   -> ANALYZE DIRECTION -> ASSESS STRENGTH -> DETECT CONFLICTS
   -> DETECT LOW-CONFIDENCE/UNVERIFIED -> AGGREGATE BY ASSET
   -> structured Sentiment Report for future agents
```

## Status

**IMPLEMENTED**: everything described below, driven entirely by
internally-supplied sentiment records. **NOT IMPLEMENTED**: any
external sentiment/social-media provider connection, any orchestration
wiring that actually calls this agent, the remaining 3 agents.
**FUTURE**: a real provider adapter under `providers/` feeding this
agent's `input`.

## Responsibilities

Validates sentiment records, passes classification through unmodified,
derives sentiment strength deterministically (never from wording),
detects conflicting sentiment for the same asset, and aggregates
sentiment into a bias and market-impact assessment. It does **not**
execute trades, connect to a broker, or recommend a direction — the
Sentiment Report (`report.js`) has no `recommendation_type` field and
never contains `BUY`/`SELL`/`LONG`/`SHORT` anywhere (test 20 verifies
this by serializing the whole report and scanning for those literal
strings).

## Sentiment Data Model (`sentimentRecord.js`)

17 fields exactly as specified: `asset, timestamp, source, source_type,
content_reference, sentiment, sentiment_score, sentiment_strength,
classification, verification_status, freshness_status, confidence,
volume, engagement, related_topics, evidence, notes`. Every unset
field defaults to `UNKNOWN`, never fabricated. `sentiment_score` is
explicitly optional per the spec — structurally validated as "a number
or UNKNOWN," never required, never invented.

**Required for acceptance** (`validate.js`): `asset`, `sentiment`, and
`classification` — without an asset there's nothing to attribute the
opinion to, without a sentiment value there's no opinion at all, and
without a classification downstream code can't tell FACT-tier
sentiment from FORECAST/SCENARIO/UNVERIFIED. `source` is deliberately
**not** required — a missing source degrades the record (forced to
`UNVERIFIED`, warned) but is still processed, same "handled safely"
discipline as the News Agent's missing-source case (test 3).
`timestamp` is also not required — a missing one just means
`freshness_status` stays `UNKNOWN`.

## Source Types

`NEWS, SOCIAL_MEDIA, ANALYST, MARKET_COMMENTARY, SURVEY, OTHER,
UNKNOWN`. `source_type` is purely descriptive — nothing in this agent
infers or assumes credibility from it; credibility is entirely a
function of `verification_status`, tracked separately.

## Classification

Pass-through only — this agent never assigns, infers, or upgrades a
`classification`. `FORECAST`, `SCENARIO`, `MARKET_EXPECTATION`, and
`UNVERIFIED` can never become `FACT` because nothing here ever
rewrites the field (tests 6–8).

## Source Verification

Uses `core/verification.js`. A lone, uncorroborated record defaults to
`UNVERIFIED` (test 5) — sentiment is never assumed verified merely
because it exists. **Documented design note**: unlike the Data
Controller/News/Macro agents' `conflicts.js`, this module does **not**
auto-upgrade agreeing `UNVERIFIED` sources to `VERIFIED_SECONDARY` on
agreement — the Step 8 spec only asked for conflict detection, not an
agreement-based upgrade, so none was added to avoid inventing scope
beyond what was requested.

## Sentiment Strength (`strength.js`)

`VERY_STRONG, STRONG, MODERATE, WEAK, UNKNOWN`. Never inferred from
emotional wording — this module never inspects any free-text field. If
the source already tagged a valid `sentiment_strength`, that's trusted
as-is. Otherwise, strength is derived only from a numeric
`sentiment_score`'s magnitude against caller-configured
`options.strengthThresholds` — with none configured, strength stays
`UNKNOWN` rather than guessed, the same discipline as every other
threshold in this project.

## Sentiment Aggregation (`aggregation.js`)

Fully documented, deterministic rule: each record casts a vote
(`BULLISH=+1, BEARISH=-1, NEUTRAL=0, MIXED=0`) weighted by a
configurable `options.sentimentWeights` scheme (default weight `1` —
every record counts equally unless the caller configures otherwise).
`UNKNOWN`-sentiment records are excluded from the weighted calculation
entirely. `weighted_sentiment` is `UNKNOWN` when there's no weighted
evidence at all (test 13's aggregation-level case, and
`aggregation.test.js`'s direct unit test). Aggregate `confidence`
scales with `source_count` via a documented, fully-overridable
conventional default (`{ lowMax: 1, mediumMax: 4 }`) — more
independent sources is a standard notion of higher confidence, not an
invented project-specific rule.

## Conflict Detection (`conflicts.js`)

Groups validated records by `asset`; if any two `BULLISH`/`BEARISH`
records for the same asset directly oppose each other, the whole group
is flagged `CONFLICTING_SENTIMENT`. Never picks a winner or averages
the disagreement away — every record's `verification_status` is forced
to `CONFLICTING` and all are preserved (test 9).

## Sentiment Bias and Market Impact (`impact.js`)

`sentiment_bias` (`BULLISH/BEARISH/MIXED/NEUTRAL/UNKNOWN`) is a
deterministic aggregation of `aggregation.js`'s counts. The Sentiment
Data Model has no separate per-record `impact_direction` field to
aggregate (unlike the News/Macro agents), so
`market_impact_assessment` is a **direct, documented relabeling** of
`sentiment_bias` into the cross-agent-consistent
`POSITIVE/NEGATIVE/MIXED/NEUTRAL/UNKNOWN` vocabulary (`BULLISH` →
`POSITIVE`, etc.) — not a new inference. Its `notes` field always uses
evidence-based language (`"Sentiment evidence is currently positive."`)
and never a price guarantee — neither `sentiment_bias` nor
`market_impact_assessment` is ever a trading instruction (tests 18,
20).

## Output Contract (`report.js` — the Sentiment Report)

```
{
  agent_name: "sentiment-agent",
  timestamp, requested_asset,
  sentiment_records,       // validated records, scoped to requested_asset if given
  source_breakdown,         // tally per source_type
  sentiment_distribution,   // aggregation.js output
  sentiment_bias,
  sentiment_strength,       // distribution of strength levels, not a single guessed value
  conflicts,
  unverified_sentiment,
  market_impact_assessment,
  confidence, uncertainties, warnings, sources,
}
```

`processSentimentData()`'s internal `validated_records`/`conflicts`
hold the **complete** validated set (matching the field-naming
convention used by every other agent in this project); `report.js`
filters down to `options.requestedAsset` at the point of use, so a
report scoped to `"BTC"` never mixes in another asset's sentiment. No
`recommendation_type` field exists anywhere.

## Anti-Hallucination Protections

- No sentiment, post, comment, source, score, engagement number, or
  timestamp is ever invented — missing ones stay `UNKNOWN` (tests
  15–17).
- Classification is pass-through only (tests 6–8).
- Conflicting sentiment is never hidden or averaged away (test 9).
- Empty input returns `SENTIMENT DATA UNAVAILABLE`, never a fabricated
  opinion presented as real (test 14).
- The module exports exactly `SENTIMENT_AGENT_STATUS`,
  `processSentimentData`, `runSentimentAgent` — no live-fetch or
  external-access function exists to falsely imply live sentiment
  access (test 19).
- No trading recommendation is ever produced (tests 18, 20).

## Error Handling (`core/errors.js`)

Structurally ready for `API_UNAVAILABLE`/`TIMEOUT`/`RATE_LIMIT`/
`AUTH_FAILURE` via the provider-error passthrough branch (**NOT
IMPLEMENTED**/**FUTURE**). Directly produces `MISSING_DATA`,
`MALFORMED_DATA`, `STALE_DATA`, and `CONFLICTING_DATA` itself
(**IMPLEMENTED**). Never fabricates fallback sentiment.

## Logging

Every call logs via `logs/logger.js`: `agent: "sentiment-agent"`,
request shape, aggregated sources, `agent_status`, warnings, errors.
Secrets are redacted by the logger itself (Step 3).

## Testing

Node's built-in `node:test` (no new dependency). Run via `npm test`.

- `sentimentRecord.test.js`, `strength.test.js`, `aggregation.test.js`,
  `conflicts.test.js`, `impact.test.js` — unit tests per module.
- `sentimentAgent.test.js` — the 20 required scenarios from the Step 8
  spec (numbered in the test names), plus provider-error and
  non-array-input coverage.

**Note:** this environment has no `node` binary available (same as
Steps 3–7), so the suite could not actually be executed here — only
reviewed by hand, tracing every scenario against the implementation.
Run `npm test` yourself to confirm before relying on this.

## Current Limitations

- Untested by execution — see above.
- No agreement-based verification upgrade (see Source Verification
  above) — a deliberate scope decision, not an oversight.
- Aggregate `confidence` thresholds are a conventional default based
  on `source_count`, not a rigorous statistical measure.
- No orchestrator wiring — nothing currently calls this agent as part
  of an end-to-end flow.
- No literal bridge from Data Controller's generic Data Record shape
  into a sentiment record — same limitation as the News/Macro/
  Technical agents, for the same reason (no real provider yet to
  anchor that mapping against).
