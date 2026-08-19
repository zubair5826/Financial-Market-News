# News Intelligence Agent

Identifies, validates, organizes, and structurally analyzes financial
news. The second of the 8 planned agents to be implemented, after the
Data Controller ([../data-controller](../data-controller)).

```
RECEIVE VALIDATED NEWS DATA -> IDENTIFY RELEVANT NEWS -> CHECK SOURCE/TIMESTAMP
   -> CLASSIFY (pass-through) -> DETECT DUPLICATES -> DETECT CONFLICTS
   -> ASSESS POTENTIAL MARKET IMPACT -> structured News Summary for future agents
```

## Status

**IMPLEMENTED**: everything described below, driven entirely by
internally-supplied news records. **NOT IMPLEMENTED**: any external
news provider connection, any orchestration wiring that actually calls
this agent, the remaining 6 agents. **FUTURE**: a real provider adapter
under `providers/` feeding this agent's `input`.

## Responsibilities

Validates, checks source/timestamp, passes classification through
unmodified, detects likely duplicates, detects conflicting reports,
aggregates already-tagged market-impact evidence, and assesses
relevance/importance relative to a requested asset. It does **not**
execute trades, connect to a broker, or recommend a direction — the
News Summary output (`report.js`) has no `recommendation_type` field
at all; there is structurally nowhere to put a trading call (see test
14).

## Input Contract

`processNews(input, options)` — **IMPLEMENTED** for an array of plain
objects supplied internally. **NOT IMPLEMENTED**: no external API,
still-unselected (NewsAPI, Reuters, Bloomberg, Benzinga, Finnhub,
Google News, Yahoo Finance, or any other — none assumed).
**FUTURE-READY**: a `core/errors.js` `failSafe()` result passed as
`input` is handled directly (the shape a future provider adapter's
failed call would produce), without needing a rewrite once a real
provider exists.

`options.fieldMap` — optional field-name mapping, same pattern as the
Data Controller's normalizer. `options.freshnessThresholds` — a flat
`{ freshMaxMs, agingMaxMs }` or a map keyed by `category`; without it,
`freshness_status` is `UNKNOWN`. `options.requestedAsset` — the asset
relevance is assessed against. `options.sectorCategories` — an
optional list of category names the caller considers relevant to the
requested asset (used only by relevance's `SECTOR` level — see below).

### Data Controller Integration

Per the spec, this agent must not bypass the Data Controller. **NOT
IMPLEMENTED / FUTURE**: no bridge from `core/dataRecord.js`'s generic
Data Contract (asset/value/unit — built for price-like facts) into
this agent's News Record exists yet, because the two contracts' field
sets don't naturally map, and there's no real provider yet to define
that mapping against. Writing a guessed field mapping now would itself
risk inventing structure that isn't grounded in an actual data source.
Once a concrete news provider exists, its adapter is expected to route
through Data Controller validation before being normalized into a News
Record here.

## News Data Model (`newsRecord.js`)

`headline, summary, source, source_type, publication_timestamp,
retrieved_timestamp, url_or_reference, related_assets, related_markets,
country_or_region, category, classification, verification_status,
freshness_status, confidence, potential_market_impact, impact_direction,
impact_confidence, evidence, notes` — `impact_confidence` was added
beyond the spec's literal Data Model list because the separate "Market
Impact" section explicitly calls for a structured impact_confidence
field. Every unset field defaults to `UNKNOWN`, never fabricated.

**Required for acceptance** (`validate.js`): only `headline` and
`classification` — a missing headline leaves nothing to process, and a
missing classification means downstream code can't tell FACT from
FORECAST from SCENARIO, defeating the whole anti-hallucination point.
`source` is deliberately **not** required — a missing source degrades
the item (forced to `UNVERIFIED`, warned) but is still processed, per
the spec's "missing source handled safely" (distinct from the
headline's hard rejection). `publication_timestamp` is also not
required — see Freshness below.

## Classification

Pass-through only — this agent never assigns, infers, or upgrades a
`classification`. `FORECAST`, `SCENARIO`, `MARKET_EXPECTATION`, and
`UNVERIFIED` can never become `FACT` because nothing here ever
rewrites the field (tests 6–8).

## Source Verification

Uses `core/verification.js`'s `VERIFIED_PRIMARY / VERIFIED_SECONDARY /
UNVERIFIED / CONFLICTING / UNKNOWN`. A lone, uncorroborated item
defaults to `UNVERIFIED` (test 5) — a headline is never assumed true
merely because it exists. A missing source forces `UNVERIFIED`
regardless of any caller-supplied claim (test 3), since a verification
claim with no named source can't be trusted.

## Timestamps

`publication_timestamp` is never invented — missing it leaves
`freshness_status` as `UNKNOWN` (test 4), computed by this agent from
`publication_timestamp` + configured thresholds, never trusted from a
caller's own "breaking"/"real-time" claim. `retrieved_timestamp` is
different: if not supplied, this agent stamps it with its own
processing time — that's a fact the system genuinely knows about
itself (when it processed this record), not an invented external fact
like `publication_timestamp` would be.

## Duplicate Detection (`duplicates.js`)

Reliably judging that two differently-worded headlines describe the
same real-world event requires semantic/NLP understanding this system
doesn't have — inventing that judgment from raw text would itself be a
form of fabrication. So the **primary, deterministic signal** is
structured metadata overlap: shared `related_assets` **and** matching
`category`. Headline token overlap (Jaccard similarity) is computed
only as a secondary, reported `text_similarity` score for review, not
as the deciding signal. **Limitation**: duplicate-detection quality
depends entirely on `related_assets`/`category` actually being tagged
on the input — pure headline-text semantic matching (as in the spec's
illustrative "Fed holds rates steady" / "Fed keeps interest rates
unchanged" example) is **NOT IMPLEMENTED**; it would need either
disciplined input tagging (as used in this agent's own tests) or a
future NLP/embedding provider. Nothing is ever deleted or merged —
grouping only annotates (test 10).

## Conflict Detection (`conflicts.js`)

Within a likely-same-event group, if members' own tagged
`impact_direction` values materially disagree (`POSITIVE` vs
`NEGATIVE`), the group is flagged `CONFLICTING`. Never picks a winner —
every involved record's `verification_status` is forced to
`CONFLICTING` and all are preserved (test 9).

## Relevance (`relevance.js`)

`DIRECT / INDIRECT / MACRO / SECTOR / LOW_RELEVANCE / UNKNOWN`. `DIRECT`
requires `related_assets` to name the requested asset; `INDIRECT`
requires `related_markets`; `MACRO` requires a macro/macroeconomic
category. `SECTOR` requires the category to be explicitly listed in
`options.sectorCategories` — this agent does not assume on its own
which categories matter to which assets (there's no such taxonomy
built in), so an unrelated category (e.g. "sports") correctly falls to
`LOW_RELEVANCE` rather than being guessed as sector-relevant. No
`requestedAsset`, or no tagging data at all on the item, → `UNKNOWN`.

## Importance (`importance.js`)

`CRITICAL / HIGH / MEDIUM / LOW / UNKNOWN`, driven only by relevance +
source verification + classification + freshness — **never** by how
sensational the headline text reads (this module never inspects
headline wording at all). See `IMPORTANCE_DEFINITIONS` in the module
for exact criteria per level.

## Market Impact (`impact.js`)

`potential_market_impact`, `impact_direction`
(`POSITIVE/NEGATIVE/MIXED/NEUTRAL/UNKNOWN`), and `impact_confidence`
are read from each item's own tagged data — **this agent never infers
impact_direction from headline wording**; doing so would require
semantic judgment it doesn't have. `POSITIVE` does not mean "price
will rise" and `NEGATIVE` does not mean "price will fall" — both
describe a possible market implication of the evidence, never a
guaranteed movement. `market_impact_assessment` aggregates counts per
direction; `overall_news_bias` (`BULLISH/BEARISH/MIXED/NEUTRAL/UNKNOWN`)
is a deterministic aggregation of those counts — evidence, **not** a
trading instruction (`BULLISH` does not mean `BUY`; tests 14–15).

## Output Contract (`report.js` — the News Summary)

```
{
  agent_name: "news-agent",
  timestamp, requested_asset,
  news_items,            // validated items, enriched with relevance + importance
  key_events,             // importance CRITICAL or HIGH
  relevant_events,        // relevance DIRECT or INDIRECT
  conflicting_reports,    // from conflicts.js
  unverified_reports,     // verification_status or classification UNVERIFIED
  market_impact_assessment,
  overall_news_bias,
  confidence, uncertainties, warnings, sources,
}
```

This is a sibling contract to `core/agentMessage.js`, not that generic
envelope reused verbatim — the Step 5 spec defined its own News
Summary field list rather than pointing at `core/agentMessage.js` the
way the Data Controller's spec did. There is **no** `recommendation_type`
field anywhere in this shape.

`processNews()`'s internal `agent_status`: `FAILED` (nothing validated),
`CONFLICTING` (any conflict group), `PARTIAL` (something rejected),
`SUCCESS`, or `UNAVAILABLE` (no input at all — the literal phrase
`NEWS DATA UNAVAILABLE` appears in `warnings`, per the anti-hallucination
section). A provider-shaped `failSafe()` error passed as `input` maps
`API_UNAVAILABLE`/`TIMEOUT`/`RATE_LIMIT`/`AUTH_FAILURE` → `UNAVAILABLE`,
anything else → `FAILED`.

## Anti-Hallucination Protections

- No headline, article, journalist, source, or URL is ever invented —
  missing ones stay `UNKNOWN` (tests 16–17).
- No publication timestamp is ever invented (test 4).
- Classification is pass-through only (tests 6–8).
- Conflicting reports are never hidden or auto-resolved (test 9).
- Empty input returns `NEWS DATA UNAVAILABLE`, never a fabricated
  example story presented as real (test 13).
- The module exports exactly `NEWS_AGENT_STATUS`, `processNews`,
  `runNewsAgent` — no live-fetch or external-access function exists to
  falsely imply this agent has internet/API access (test 18).
- No trading recommendation is ever produced (tests 14–15).

## Error Handling (`core/errors.js`)

Structurally ready for `API_UNAVAILABLE`/`TIMEOUT`/`RATE_LIMIT`/
`AUTH_FAILURE` via the provider-error passthrough branch (**NOT
IMPLEMENTED**/**FUTURE** — nothing calls it with a real failure yet).
Directly produces `MISSING_DATA` (required field absent),
`MALFORMED_DATA` (invalid enum values, non-array input),
`STALE_DATA`, and `CONFLICTING_DATA` itself (**IMPLEMENTED**). Never
fabricates fallback news on any of these.

## Logging

Every call logs via `logs/logger.js`: `agent: "news-agent"`, request
shape, aggregated sources, `agent_status`, warnings, errors. Secrets
are redacted by the logger itself (Step 3) — this agent doesn't handle
any credentials to begin with.

## Testing

Node's built-in `node:test` (no new dependency). Run via `npm test`.

- `newsRecord.test.js`, `relevance.test.js`, `importance.test.js`,
  `impact.test.js`, `duplicates.test.js`, `conflicts.test.js` — unit
  tests per module.
- `newsAgent.test.js` — the 18 required scenarios from the Step 5
  spec (numbered in the test names), plus provider-error and
  non-array-input coverage.

**Note:** this environment has no `node` binary available (same as
Steps 3–4), so the suite could not actually be executed here — only
reviewed by hand, including tracing through a real logic bug found
this way (relevance's `SECTOR` level was originally reachable for any
category at all, which would have wrongly called an unrelated "sports"
story sector-relevant to an unrelated asset — fixed to require
`options.sectorCategories`). Run `npm test` yourself to confirm before
relying on it.

## Current Limitations

- Untested by execution — see above.
- Duplicate/conflict detection depends on `related_assets`/`category`
  tagging discipline in the input; it cannot semantically compare raw
  headline text the way a human (or an NLP-equipped provider) could.
- `SECTOR` relevance requires caller-supplied `sectorCategories`; with
  none given, only `DIRECT`/`INDIRECT`/`MACRO`/`LOW_RELEVANCE`/`UNKNOWN`
  are reachable.
- No orchestrator wiring — nothing currently calls this agent as part
  of an end-to-end flow.
- No literal bridge from Data Controller's generic Data Record shape
  into a News Record (see "Data Controller Integration" above).
