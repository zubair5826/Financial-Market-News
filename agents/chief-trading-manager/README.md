# Chief Trading Manager

The system's highest-level decision-intelligence component. Combines
the News, Macro, Technical, Sentiment, Trade Setup, and Risk Manager
reports into one final assessment for the user. This is the eighth
and last of the 8 planned agents.

```
RECEIVE 6 reports -> VALIDATE each (never bypassed) -> per-domain
   SUMMARIES (provenance preserved) -> FINAL ASSESSMENT (from the 4
   specialists only) -> CONFLICT EXPLANATION -> DECISION STATUS (Risk
   Manager's RISK_TOO_HIGH is an absolute override) -> final report
```

## Status

**IMPLEMENTED**: everything described below, driven entirely by the
six reports supplied to it. **NOT IMPLEMENTED**: any orchestration
wiring that automatically runs the other 7 agents and threads their
output into this one — the caller must assemble `inputs` manually for
now. **FUTURE**: that end-to-end wiring, once `orchestrator/` is built
out; this step explicitly does not proceed to that integration work.

## Responsibilities

Validates every supplied report's shape (never trusts a malformed or
wrongly-labeled report blindly), builds a structured summary per
domain that preserves source/timestamp/confidence/uncertainties/
conflicts/classification, synthesizes a final market-direction
assessment from the four specialists, explains any disagreement in
full, and determines whether the evidence supports acting on the
trade setup — with the Risk Manager's verdict as a hard, un-overridable
gate. It does **not** execute trades, does not connect to a broker,
and never treats any single agent's output as automatically correct.

## Input Contract

`processChiefDecision(inputs, options)` — `inputs` is `{ newsReport,
macroReport, technicalReport, sentimentReport, tradeSetupReport,
riskReport }`, all optional. Every supplied report is validated via
`reportValidation.js` (correct `agent_name` plus the fields this agent
depends on) before being trusted — a report that fails this check is
treated as **not supplied**, with a warning, never repaired or
guessed at.

## Summaries (`evidence.js`)

One structured summary per domain, retaining `bias`/`direction`/
`risk_level` (whichever applies), `confidence`, `uncertainties`,
`conflicts`, `warnings`, `sources`, and `timestamp` straight from that
domain's own report — nothing here is re-derived or re-classified.
Where a domain's report exposes structured records with their own
`classification` field (news `key_events`, macro `key_indicators`),
those are carried through into the summary's own `items`-style field
untouched, so `FORECAST`/`SCENARIO`/`MARKET_EXPECTATION` classifications
survive intact (tests 10–12).

## Final Assessment (`finalAssessment.js`)

**Synthesized only from the four specialist reports** (News, Macro,
Technical, Sentiment) — deliberately **not** from the Trade Setup
Agent's own `direction`, which is itself already derived from these
same four specialists (Step 9). Counting it as a fifth vote here would
double-count the same evidence and make the synthesis circular. Trade
Setup and Risk Manager are surfaced in their own summary fields and
drive `decision_status` instead — a genuinely separate question
("should this be acted on") from what the specialist evidence itself
says about direction. This scoping also matches the spec's own
language: the CONFLICT HANDLING section says "if **specialist agents**
disagree," not "if any agent disagrees."

Documented, deterministic rule (see the module's own header comment
for the exact criteria): `UNKNOWN` (nothing supplied at all),
`NO_DECISION` (something supplied, nothing valid), `INSUFFICIENT_DATA`
(fewer than 2 valid specialists tagged), `CONFLICTING_EVIDENCE` (direct
BULLISH-vs-BEARISH opposition), `MIXED` (no opposition, but a
specialist's own bias is itself `MIXED`), `NEUTRAL`, or `BULLISH`/
`BEARISH` by majority.

## Information Hierarchy

Classification is pass-through only, everywhere in this agent —
`FORECAST`, `SCENARIO`, `MARKET_EXPECTATION`, and `UNVERIFIED` can
never become `FACT`/`ACTUAL`/`VERIFIED` because nothing here ever
rewrites a classification field (tests 10–12).

## Conflict Handling (`conflicts.js`)

When `final_assessment` is `CONFLICTING_EVIDENCE`, disagreement is
never hidden — the spec's exact four requirements are met literally:
**which agents disagree** (`bullish_agents`/`bearish_agents`), **why**
(`reason`), **what evidence supports each side**
(`supporting_evidence_bullish`/`supporting_evidence_bearish`), and
**what information is missing** (`missing_information`, i.e. which
specialists weren't supplied at all). Disagreement detection is scoped
to the 4 specialists only (they're the only summaries with a
comparable `.bias` field); a **separate** internal-conflict scan
covers all 6 summaries, since Trade Setup and Risk can each carry
their own internal conflicts worth surfacing even when they aren't
part of a specialist disagreement. Disagreeing specialists are never
also listed in `supporting_evidence` — a side can't "support" a
conflict it's half of; only a genuinely uninvolved `NEUTRAL`/`MIXED`
specialist counts as supporting when the assessment itself is
`CONFLICTING_EVIDENCE`.

## Decision Status (`decisionStatus.js`) — the Risk Override

`TRADE_SETUP_SUPPORTED / TRADE_SETUP_NOT_SUPPORTED /
WAIT_FOR_MORE_DATA / HIGH_RISK_REVIEW_REQUIRED / NO_DECISION` — this is
**decision-intelligence output only**; no state here is or becomes a
broker/exchange instruction. Checked in this exact order (see the
module's own header comment): **the Risk Manager's `RISK_TOO_HIGH` is
checked first and is an absolute override** — it forces
`HIGH_RISK_REVIEW_REQUIRED` regardless of how bullish or bearish the
specialist evidence looks, exactly as the spec's RISK OVERRIDE section
requires (test 8: `final_assessment` stays `BULLISH`, honestly
reflecting what the evidence says, while `decision_status` is
independently gated to `HIGH_RISK_REVIEW_REQUIRED` — these are
deliberately different fields answering different questions). Missing
or unresolved risk/setup data always routes to `WAIT_FOR_MORE_DATA`
rather than guessing.

## Output Contract (the Chief Trading Manager Report)

Exactly the spec's field list: `agent_name, timestamp, asset,
final_assessment, decision_status, news_summary, macro_summary,
technical_summary, sentiment_summary, trade_setup_summary,
risk_summary, supporting_evidence, conflicting_evidence,
missing_information, key_assumptions, confidence, uncertainties,
warnings, sources`. `key_assumptions` lists only **methodological**
assumptions this agent's own logic makes (e.g. "each input's own
confidence/classification/verification is trusted as computed by that
agent, not independently re-verified here") — never an assumption
about market behavior or outcomes. No execution command, no
`recommendation_type`, and — verified by test — no
`BUY`/`SELL`/`LONG`/`SHORT` anywhere in the serialized report.

## Confidence

Weighs more than presence/absence: per the CORE PRINCIPLE section's
explicit instruction to consider confidence, `HIGH` overall confidence
requires **every present specialist to itself report `HIGH`
confidence**, not just complete data with no conflicts — four
low-confidence but agreeing specialists ("weak confluence," test 7)
correctly yield `MEDIUM`, not `HIGH`.

## Anti-Hallucination Protections

- No evidence, market data, news, macro release, sentiment, technical
  signal, or risk value is ever invented — every summary field copies
  straight from an already-validated upstream report.
- No conflict is ever hidden — both cross-domain and internal
  conflicts are always surfaced.
- No safety or profitability guarantee anywhere (scanned in tests).
- No live/provider access is claimed — the module exports exactly
  `FINAL_ASSESSMENTS`, `DECISION_STATUS`, `processChiefDecision`,
  `runChiefTradingManager`.
- No trade execution — no broker/exchange/order code path exists
  anywhere in this agent.

## Error Handling (`core/errors.js`)

`MALFORMED_DATA` for a non-object `inputs` argument. Each upstream
report's own error states are already resolved by that agent before
this one ever sees it — this agent consumes the already-final reports
rather than re-implementing that handling.

## Logging

Every call logs via `logs/logger.js`: `agent: "chief-trading-manager"`,
request shape, aggregated sources, `decision_status`, warnings,
errors. Secrets are redacted by the logger itself (Step 3).

## Testing

Node's built-in `node:test` (no new dependency). Run via `npm test`.

- `reportValidation.test.js`, `finalAssessment.test.js`,
  `conflicts.test.js`, `decisionStatus.test.js` — unit tests per
  module.
- `chiefTradingManager.test.js` — the 20 required scenarios from the
  Step 11 spec (numbered in the test names), plus malformed-input and
  wrong-agent-name coverage.

**Note:** this environment has no `node` binary available (same as
every prior step), so the suite could not actually be executed here —
only reviewed by hand. This step's review caught and fixed two real
issues before any tests were even written: (1) the cross-domain
disagreement check was originally being passed all 6 summaries
instead of just the 4 specialists — Trade Setup and Risk don't carry a
`.bias` field, so this wouldn't have crashed but would have silently
done nothing useful with 2 of the 6 inputs; (2) `supporting_evidence`
originally let *every* specialist through even during a
`CONFLICTING_EVIDENCE` assessment, meaning the same BULLISH and
BEARISH evidence would incoherently appear in both `supporting_evidence`
and `conflicting_evidence` at once. Both fixed before the test suite
was written, and confirmed correct by hand-tracing every numbered
scenario against the fixed implementation. A third gap — `confidence`
never actually weighing each specialist's own confidence rating — was
also caught and fixed the same way. Run `npm test` yourself to confirm
before relying on this.

## Current Limitations

- Untested by execution (highest priority to verify on your end,
  especially the three fixes above).
- Final-assessment/confidence thresholds are this project's own
  documented heuristic, not a validated decision-making methodology.
- No orchestrator wiring — the caller must assemble all 6 reports
  manually; this step explicitly stops before that integration.
- `key_assumptions` is a fixed, short, methodological list — it does
  not dynamically enumerate every judgment call made per request
  beyond noting validation failures.
