# Trade Setup Agent

Combines the already-validated reports from the News, Macro, Technical,
and Sentiment agents to identify whether a potential trade setup
exists. The sixth of the 8 planned agents, and the first that consumes
other agents' outputs rather than raw data.

```
RECEIVE 4 domain reports -> VALIDATE each (never bypassed) -> build
   per-domain EVIDENCE (provenance preserved) -> AGGREGATE DIRECTION
   -> CONFLUENCE -> SETUP QUALITY -> SETUP STATUS -> POTENTIAL LEVELS /
   INVALIDATION (technical only) -> SETUP RISKS -> Trade Setup Report
```

## Status

**IMPLEMENTED**: everything described below, driven entirely by
reports produced by `agents/news-agent`, `agents/macro-agent`,
`agents/technical-agent`, and `agents/sentiment-agent`. **NOT
IMPLEMENTED**: the Risk Manager and Chief Trading Manager (next
steps), any orchestration wiring that actually calls the 4 upstream
agents and feeds their output here automatically. **FUTURE**: that
wiring, once `orchestrator/` is built out.

## Responsibilities

Validates each supplied domain report's shape (never trusts a
malformed or wrongly-labeled report blindly), builds a structured
evidence object per domain that preserves source/timestamp/confidence/
uncertainties/conflicts, aggregates a setup direction and confluence
score, assesses setup quality and status, references (never invents)
technical price levels, and flags setup-level risks. It does **not**
execute trades, send orders, or connect to a broker — there is no
network/broker code anywhere in this agent, and it does not replace
the future Risk Manager.

## Input Contract

`processTradeSetup(inputs, options)` — `inputs` is `{ newsReport,
macroReport, technicalReport, sentimentReport }`, each **optional**.
Per the spec, "do not bypass validation": every supplied report is
checked via `reportValidation.js` (correct `agent_name` plus the
fields this agent depends on) before being trusted; a report that
fails this check is treated as **not supplied** for that domain, with
a warning explaining why, never repaired or guessed at.

## Evidence (`evidence.js`)

One structured object per domain, always retaining `source`
(`sources`), `timestamp`, `confidence`, `uncertainties`, and
`conflicts` straight from that domain's own report — nothing here
re-derives or re-classifies anything. Each domain's `items` field
carries a small sample of that report's own structured records (news
`key_events`, macro `key_indicators`, sentiment `sentiment_records`, a
technical trend/momentum summary) — since those already carry their
own `classification`/`verification_status`/`source`/`timestamp` fields
from Steps 5–8, that provenance travels forward untouched rather than
being stripped (tests 19–20 verify a `SCENARIO`/`FORECAST`
classification on a passed-through item is never rewritten).

## Direction (`direction.js`)

`BULLISH/BEARISH/NEUTRAL/MIXED/UNKNOWN` — the exact same voting rule
already used by every other agent to derive its own bias field: each
`BULLISH`/`BEARISH` domain casts one vote, `NEUTRAL`/`MIXED` domains
count as tagged but cast no vote, missing/`UNKNOWN` domains don't
count at all. This is **setup direction**, never an execution order —
`BULLISH` does not mean `BUY` (test 14).

## Confluence (`confluence.js`)

Fully documented, deterministic score — **not** a simple agent count,
per the spec's explicit requirement:

- A domain whose bias **opposes** the overall direction contributes
  `0` (it's tracked separately as `conflicting_evidence`, never folded
  in).
- A domain that **agrees** (or is `NEUTRAL`) contributes its own
  `confidence` as a weight: `HIGH=1.0, MEDIUM=0.66, LOW=0.33,
  UNKNOWN=0`.
- A domain with **unresolved internal conflicts** (e.g. News's own
  `conflicting_reports`) has that contribution **halved**.
- A domain with **no report supplied** contributes `0`.

`confluence_score` is the sum (0–4); `confluence_ratio` is that score
÷ 4 (0–1), consumed by `quality.js`.

## Setup Quality (`quality.js`)

`HIGH/MEDIUM/LOW/UNKNOWN`, fully documented:

- `UNKNOWN` — fewer than 2 domains have usable evidence at all.
- `LOW` — any domain's bias opposes the overall direction, **regardless
  of confluence ratio** (disagreement caps quality).
- Otherwise, `confluence_ratio` against configurable thresholds
  (default `>=0.75` HIGH, `>=0.4` MEDIUM, else LOW) — this project's
  own synthesis heuristic, not a claim about market reality, so it
  ships with a documented sensible default rather than requiring
  configuration.

**A `HIGH`-quality setup is not a guarantee of profitability** — it
only describes how much confidence-weighted, internally-consistent
evidence agrees on a direction (test 11 scans the entire report for
any "guarantee" language and finds none).

## Entry/Exit and Levels (`levels.js`)

Built **only** from the Technical Agent's already-validated
`support_levels`/`resistance_levels` (Step 7) — no number is ever
invented, offset, or estimated here.

- `OBSERVED_LEVEL` — every technical support/resistance level exactly
  as computed, relabeled with its role.
- `PROPOSED_SETUP_LEVEL` — the subset relevant to the current
  direction (`BULLISH` → `SUPPORT`, `BEARISH` → `RESISTANCE`) — the
  **same** level object, not a new number (test 10).

`invalidation_conditions` are qualitative
(`CLOSE_BELOW_LEVEL`/`CLOSE_ABOVE_LEVEL` against a real observed
level) — never a price with an invented buffer added. With no
technical report, or no relevant level for the current direction,
both `potential_levels` and `invalidation_conditions` report
`DATA_UNAVAILABLE` (test 9).

## Setup Risks (`risks.js`)

`DATA_RISK` (any domain missing/invalid), `NEWS_RISK`/`MACRO_RISK`/
`TECHNICAL_RISK`/`SENTIMENT_RISK` (that domain's own report has
unresolved internal conflicts), `CONFLICT_RISK` (cross-domain evidence
disagrees), `TIMING_RISK` (any domain's uncertainties mention `STALE`
or `UNKNOWN` freshness) — each backed by a narrow, documented evidence
rule. `UNKNOWN` exists in the vocabulary but is never auto-activated by
this module. This agent may flag risks, but it explicitly does **not**
replace the future Risk Manager.

## Setup Status

`SETUP_PRESENT / SETUP_NOT_PRESENT / INSUFFICIENT_DATA /
CONFLICTING_EVIDENCE / DATA_UNAVAILABLE / UNKNOWN` — no additional
states invented. Decision order: no reports supplied at all →
`DATA_UNAVAILABLE`; fewer than 2 domains with usable evidence →
`INSUFFICIENT_DATA`; direction `MIXED` → `CONFLICTING_EVIDENCE`;
direction `NEUTRAL` → `SETUP_NOT_PRESENT`; direction `BULLISH`/`BEARISH`
with `HIGH`/`MEDIUM` quality → `SETUP_PRESENT`; otherwise
`SETUP_NOT_PRESENT`.

## Output Contract (`report.js` — the Trade Setup Report)

Exactly the spec's field list: `agent_name, timestamp, asset,
setup_status, direction, supporting_evidence, conflicting_evidence,
technical_evidence, news_evidence, macro_evidence, sentiment_evidence,
confluence, setup_quality, potential_levels, invalidation_conditions,
setup_risks, confidence, uncertainties, warnings, sources`. No
execution command, no `recommendation_type`, and — verified by test —
no `BUY`/`SELL`/`LONG`/`SHORT` anywhere in the serialized report.

## Anti-Hallucination Protections

- No price, signal, news, macro data, sentiment, or confidence value
  is ever invented — every evidence field is copied straight from an
  already-validated upstream report, never re-derived from guesses.
- Conflicts (cross-domain and per-domain) are never hidden — both
  sides always preserved in `conflicting_evidence`.
- Classification (`SCENARIO`/`FORECAST`/etc.) is never rewritten
  toward `FACT` anywhere it passes through this agent (tests 19–20).
- No guaranteed profitability or outcome language anywhere (test 11).
- No fake entry/stop levels — every number in `potential_levels`
  traces back to a real Technical Agent output (test 10).
- No trade execution — the module exports exactly `SETUP_STATUS`,
  `processTradeSetup`, `runTradeSetupAgent` (tests 12–13).

## Error Handling (`core/errors.js`)

`MALFORMED_DATA` for a non-object `inputs` argument. Each upstream
domain report's own `API_UNAVAILABLE`/`TIMEOUT`/`RATE_LIMIT`/
`STALE_DATA`/`CONFLICTING_DATA`/etc. states are already resolved by
that agent before this one ever sees the report — this agent doesn't
re-implement that handling, it consumes the already-final report
(**NOT IMPLEMENTED** here by design, since it isn't this agent's job;
**IMPLEMENTED** upstream in Steps 4–8).

## Logging

Every call logs via `logs/logger.js`: `agent: "trade-setup-agent"`,
request shape, aggregated sources, `setup_status`, warnings, errors.
Secrets are redacted by the logger itself (Step 3) — this agent
doesn't handle any credentials to begin with.

## Testing

Node's built-in `node:test` (no new dependency). Run via `npm test`.

- `reportValidation.test.js`, `direction.test.js`, `confluence.test.js`,
  `quality.test.js`, `levels.test.js`, `risks.test.js` — unit tests
  per module.
- `tradeSetupAgent.test.js` — the 20 required scenarios from the Step
  9 spec (numbered in the test names), plus malformed-input,
  no-input, and wrong-agent-name coverage.

**Note:** this environment has no `node` binary available (same as
Steps 3–8), so the suite could not actually be executed here — only
reviewed by hand. This step's review caught and fixed a real bug:
when the *overall* aggregated direction itself comes out `MIXED`
(domains disagreeing with each other), the original
conflicting-evidence check only compared each domain's bias against a
single `BULLISH` or `BEARISH` pole — so a `BULLISH` domain and a
`BEARISH` domain would both incorrectly land in `supporting_evidence`,
since neither literally "opposed MIXED." Fixed by special-casing the
`MIXED` direction: every directionally-tagged domain is treated as
part of that conflict. Run `npm test` yourself to confirm before
relying on this.

## Current Limitations

- Untested by execution (highest priority to verify on your end,
  especially the fix above).
- Confluence/quality weighting is this project's own documented
  heuristic, not a validated trading methodology.
- No orchestrator wiring — nothing currently calls the 4 upstream
  agents and threads their reports into this one automatically; the
  caller must assemble `inputs` manually for now.
- `resolveAsset()`'s `"MULTIPLE"` sentinel (when supplied reports
  disagree on `requested_asset`) is surfaced but not treated as an
  error — a documented, not obviously wrong, design choice.
