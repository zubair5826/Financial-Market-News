# LLM Reasoning Layer — Design Proposal (Step 107)

**Status: DESIGN ONLY. Nothing in this document is implemented. No
production code is modified by this step.**

## 0. Purpose and Non-Negotiable Boundary

This proposes an **optional, additive** Claude/Anthropic reasoning
layer that explains and contextualizes what the existing deterministic
pipeline already decided. It never decides anything itself.

The deterministic system remains the sole source of truth for:
instrument identity, provider data, freshness, data quality,
validation, risk constraints, risk veto, and final safety decisions.
The LLM layer:

- runs **strictly after** the full deterministic pipeline
  (`processRequest()` → Risk Manager → Chief Trading Manager) has
  already produced its final, complete result;
- receives that result as **read-only, immutable input**;
- can only add narrative/explanatory annotation **alongside** the
  existing response — it never replaces, mutates, re-runs, or is
  consulted by any deterministic stage;
- is invoked **zero times** unless a caller explicitly enables it
  (mirrors `options.macro.enabled`/`options.market.enabled` — disabled
  by default, per-request opt-in via `options.llm.enabled === true`);
- on any failure of any kind, leaves `pipelineResult` **byte-for-byte
  unchanged** — exactly the precedent already set for FRED/Alpha
  Vantage failures (Step 46A) and run-store persistence failures (Step
  102).

Proposed module boundary: a new top-level `llm/` directory, a sibling
to `agents/`, `providers/`, `core/` — never imported by any of them.
`llm/` may read a *completed* `pipelineResult` object; it has no
import path to `orchestrator/`, `agents/risk-manager/`, any provider
adapter, or `data/runStore.js`'s write path. This is enforced the same
way "no execution capability" is enforced elsewhere in this codebase:
by the module simply never containing that code, not by a runtime
check hoping it isn't misused.

Proposed wiring point (future step, not now): `app.js` gains one more
optional post-processing call, in the same place and style as Step
102's persistence hook — after `runFredAwareRequest()` resolves, before
the response is returned.

---

## 1. LLM Input Contract

A single, versioned **Evidence Package** — a plain JSON object built by
a pure function `buildEvidencePackage(pipelineResult, request)`, never
hand-assembled, never containing anything the pipeline didn't already
compute:

```js
{
  input_schema_version: "llm-input-v1",
  run_id: "<from Step 102's run store, when available>",
  as_of: "<pipelineResult.timestamp>",
  requested_instrument: "<pipelineResult.asset>",
  original_query: "<request.query, verbatim — context only, never a data source>",

  freshness_status: "<risk_summary.data_quality.freshnessStatus>",
  data_quality_status: "<risk_summary.data_quality.qualityStatus>",

  domain_evidence: {
    news:      { bias, confidence, key_events, conflicts, warnings, sources },
    macro:     { bias, confidence, key_indicators, conflicts, warnings, sources },
    technical: { bias, confidence, trend_analysis, momentum, conflicts, warnings, sources },
    sentiment: { bias, confidence, conflicts, warnings, sources },
  },

  trade_setup: { setup_status, direction, setup_quality, confidence, uncertainties },

  // Read-only fact, never a question posed to the model.
  risk_decision: {
    risk_level, risk_decision, risk_categories, risk_factors,
    position_size_status, invalidation_assessment,
  },

  final_decision: { final_assessment, decision_status, confidence },
  uncertainties: [ /* verbatim from the Chief Trading Manager report */ ],
  warnings: [ /* verbatim */ ],
}
```

Rules:
- Every field is copied verbatim from an already-validated report
  field — never recomputed, reformatted, or summarized before sending.
- No raw provider payload (Alpha Vantage/FRED JSON) is ever included —
  only already-classified agent-report fields, consistent with "the
  Data Controller/each agent is the source of truth for its own
  domain," never bypassed by handing raw data to the model.
- No credentials, headers, or internal diagnostics (`fredDiagnostics`,
  `timeframeResults`, adapter internals) are included.
- The package is capped in size (a hard byte ceiling, e.g. 16KB) by
  truncating list fields (e.g. `key_events`) to their existing
  "key/high-importance" subsets, which the pipeline already computes —
  never by inventing a summary.

## 2. LLM Output Schema

Strict, versioned, **allow-list** schema — a field not on this list is
a validation failure, not ignorable extra content:

```js
{
  output_schema_version: "llm-output-v1",
  narrative_summary: "string, <= ~800 chars",
  key_factors: [
    { factor: "string", direction: "SUPPORTIVE|CONTRARY|NEUTRAL", evidence_ref: "string" }
  ],
  risk_commentary: "string — explains the existing risk_decision, never a counter-decision",
  uncertainties_acknowledged: [ "string" ],  // must be drawn from input `uncertainties`/`warnings`
  caveats: [ "string" ],
}
```

Deliberately absent, by construction, matching the "no `recommendation_type`
field exists anywhere" pattern already used by every agent report in
this codebase: `risk_decision`, `override`, `recommendation`,
`action`, `confidence_score`, any BUY/SELL/LONG/SHORT vocabulary, any
price/quantity/target field. The model has structurally nowhere to put
an execution instruction or a revised decision.

## 3. Evidence Format

- JSON only, generated exclusively by `buildEvidencePackage()` — never
  free text, never hand-edited, never containing a second copy of the
  same fact reformatted differently (single source per fact).
- Every domain evidence block carries its own already-computed
  `freshness_status`/`confidence` labels; the model is told to read
  and cite them, never to (re-)judge freshness or verification itself.
- Each atomic fact usable as an `evidence_ref` target has a stable,
  deterministic id (e.g. a JSON-pointer-style path like
  `domain_evidence.macro.key_indicators[0]`) so a citation can be
  mechanically resolved back to the input for validation (§9).

## 4. Prompt Versioning

- Prompt templates live as immutable files, e.g.
  `llm/prompts/reasoning-v1.md`. A change to wording, instructions, or
  the requested schema is always a **new** file/version — an existing
  version is never edited in place, the same discipline already
  applied to `config/freshness.js`'s frozen policy values.
- A small `llm/promptRegistry.js` maps `promptVersion -> { templatePath, outputSchemaVersion }`.
  The active version is one config value (§5), changeable without
  touching template content.
- Every persisted annotation (§12) records the exact `prompt_version`
  and a content hash of the template actually used, so a past run
  stays reproducible/auditable even after the prompt evolves.

## 5. Model Configuration

A single small config module, `llm/config.js`, mirroring
`config/freshness.js`'s shape:

```js
{
  model: "claude-sonnet-5",       // pinned, never "latest" in production — reproducibility
  maxOutputTokens: 600,           // bounds worst-case cost and narrative length
  temperature: 0.2,               // low — this is analysis/explanation, not creative writing
  timeoutMs: 15000,
  promptVersion: "v1",
}
```

Only the API key is a secret (§ below); the model id, token cap, and
temperature are not secrets and default in code, overridable via env
vars (`ANTHROPIC_MODEL`, etc.) only where an operator genuinely needs
to tune them — never required for the system to function.

**Credential handling**: `ANTHROPIC_API_KEY`, read **only** inside
`llm/anthropicLiveSource.js` — the same single-reader-module rule
already enforced for `FRED_API_KEY` (`fredMacroLiveSource.js`) and
`ALPHAVANTAGE_API_KEY` (`alphaVantageMarketLiveSource.js`/
`alphaVantageNewsLiveSource.js`). The adapter class itself never reads
`process.env`; it only accepts `config.apiKey` from its caller — same
pattern as `FredMacroAdapter`/`AlphaVantageMarketAdapter`. Never
hardcoded, never logged (already covered structurally by
`logs/logger.js`'s `redact()`, which already strips any `apikey`/
`api_key`/`key`/`authorization` field regardless of source).

## 6. Timeout Behavior

`llm/anthropicAdapter.js` reuses the exact `AbortController` +
`setTimeout` pattern already implemented identically in
`FredMacroAdapter`/`AlphaVantageMarketAdapter`. On timeout: return
`failSafe(ERROR_CODES.TIMEOUT, ...)`. Because the LLM call happens
strictly after the deterministic result is already final, a timeout
here **never blocks or delays the caller's actual decision** — at
worst it delays only the optional annotation, which the composition
layer (§ below) can itself bound with its own outer timeout so a slow
Anthropic response can never meaningfully stall a response.

## 7. Provider Failure Behavior

Identical philosophy to every existing provider integration:

- Disabled by default; only touched when explicitly enabled.
- Every failure mode (auth, rate limit (`429`), network error, non-2xx,
  malformed JSON body) maps to an existing `ERROR_CODES` value via the
  same classification logic already in `FredMacroAdapter`/
  `AlphaVantageMarketAdapter` — no new error taxonomy invented.
- No automatic retries (matches the explicit "not a retry mechanism"
  stance already documented for the Alpha Vantage rate-limit gap).
- A failure produces `llmAnnotation: { status: "UNAVAILABLE", code, message }`
  — the caller's `pipelineResult` is returned exactly as if the LLM
  layer didn't exist. This is a structural requirement, verified the
  same way Step 102 verified it: a dedicated test asserting the
  deterministic result is identical whether the LLM call succeeds,
  fails, or is disabled.

## 8. Schema Validation

- Recommend using Anthropic's **tool-use (forced function-call)**
  feature to constrain the model's response to the exact JSON shape in
  §2 at the API level — this reduces, but does not replace,
  application-level validation (the API's structural guarantee says
  nothing about whether the *content* is grounded — see §9/§10).
- `llm/validateOutput.js` (mirroring every agent's own
  `validate.js`): checks required fields present, correct types,
  `direction` values from the closed enum, array lengths within
  bounds, and — critically — **rejects the entire output** if any
  field outside the §2 allow-list is present.
- No partial trust: a single validation failure discards the whole
  output (`status: "INVALID_OUTPUT"`), never a "best effort" partial
  application of the fields that happened to validate.

## 9. Evidence Validation (Grounding)

Enforced in `llm/hallucinationGuard.js`, run only on output that
already passed schema validation:

- Every `key_factors[].evidence_ref` must resolve to a real path that
  existed in the Evidence Package actually sent for this call. An
  unresolvable reference invalidates that factor; if any reference is
  unresolvable the safest default is to reject the whole output rather
  than silently drop just that factor (a model that cites a
  nonexistent fact has demonstrated it isn't reliably grounded this
  turn).
- Every entry in `uncertainties_acknowledged` must string-match (or
  fuzzy-subset-match) an entry already present in the input's own
  `uncertainties`/`warnings` arrays — the model may select and
  paraphrase, never introduce a new uncertainty with no basis in the
  supplied evidence.
- A numeric-token sweep over `narrative_summary`/`risk_commentary`:
  every number found (prices, percentages, counts) must also appear
  somewhere in the serialized Evidence Package. A number that doesn't
  is treated as a suspected fabrication and rejects the output.

## 10. Hallucination Protection (Defense in Depth)

Layered, never relying on any single control:

1. **Structural** — the output schema (§2) has no field capable of
   holding a new fact, price, or decision at all.
2. **Prompt-level** — the versioned system prompt explicitly instructs:
   reason only over the supplied JSON; if evidence is insufficient,
   say so in `caveats` rather than infer; never state a number not
   present in the input.
3. **API-level** — forced tool-use/schema constraint (§8).
4. **Code-level grounding checks** — §9, run unconditionally,
   regardless of how well-behaved the model is expected to be. This is
   the layer that actually matters; 1–3 reduce how often it has to
   reject something, they are not trusted alone.
5. **Any failure at any layer** → `status: "REJECTED"`, reason
   recorded, `pipelineResult` unaffected, nothing surfaced to the
   caller as if trustworthy.

## 11. Risk-Manager Boundary

The single most safety-critical property, enforced multiple ways:

- **Ordering**: the LLM call happens only after
  `detectRiskCategories()`/`assessRiskLevel()`/`assessRiskDecision()`
  have already run and produced a final `risk_decision`. The Evidence
  Package (§1) hands this to the model as an already-decided fact
  ("the Risk Manager decided X because Y — explain this"), never as an
  open question.
- **Structural**: the output schema (§2) has no field that could
  represent a different or revised decision — same technique as "no
  `recommendation_type` field exists" used throughout the deterministic
  agents.
- **Explicit boundary guard**: `llm/assertNoRiskOverride(output, riskDecision)`
  scans `risk_commentary`/`narrative_summary` for direct contradiction
  patterns (e.g. asserting the setup is safe when `risk_decision` is
  `RISK_TOO_HIGH`/rejects) as a defense-in-depth check even though the
  schema shouldn't structurally allow it; a match rejects the output.
- **Veto framing**: when `risk_decision` is a rejection, the prompt
  explicitly instructs the model to explain the rejection only — never
  to suggest how to work around it, size around it, or proceed anyway.
- This mirrors the same "fix only what's needed, never let a new layer
  quietly gain authority an existing one has" discipline already
  applied when Step 101 refused to let text-based detection influence
  risk categories, and when Step 99 refused to let a provider mismatch
  silently substitute data.

## 12. Persistence of LLM Output

Purely additive to the Step 102 run record — **no existing field
changes**. One new, optional field:

```js
run_record.llm_annotation = {
  status: "PERSISTED" | "UNAVAILABLE" | "INVALID_OUTPUT" | "REJECTED" | null,
  prompt_version: "v1",
  model: "claude-sonnet-5",
  output: { /* the validated §2 object */ } | null,
  rejected_raw_output: "<string, only when status is INVALID_OUTPUT/REJECTED>",
  validation_errors: [ "string" ],
  token_usage: { input_tokens, output_tokens },
  latency_ms: 1234,
}
```

- `output` is populated **only** when the result passed every check in
  §8–§11 — a rejected output is never stored in the trusted `output`
  field, only in `rejected_raw_output`, clearly separated, for
  debugging the integration itself, never mistakenly re-surfaced as
  trustworthy later.
- Written through the existing `persistRun()`/`redact()` path
  unchanged — the same credential-shaped-key redaction already applies
  automatically.
- `llm_annotation` is `null` whenever the LLM layer wasn't enabled for
  a run — indistinguishable from "not yet built" for every existing
  consumer of the run store, satisfying "do not modify existing
  production code yet."

## 13. Cost / Token Tracking

- Every call's `usage.input_tokens`/`usage.output_tokens` (returned
  directly by the Anthropic Messages API) is captured verbatim into
  `llm_annotation.token_usage` — no estimation, no invented numbers.
- `maxOutputTokens` (§5) bounds worst-case output cost per call
  structurally, independent of tracking.
- A minimal `llm/costTracker.js` (in-memory counters, reset per
  process — no new dependency, no database) can sum tokens per
  day/run for basic observability. It deliberately does **not**
  hardcode a `$` conversion (pricing changes independently of this
  code); it reports raw token counts only, leaving cost computation to
  whatever reporting layer wants it.
- No token/cost concern gates or degrades the deterministic pipeline —
  this tracking is purely observational.

---

## Summary Table

| Concern | Mechanism |
|---|---|
| Can't invent market data | Structural: input is the only data source; output schema has no data fields |
| Can't override risk veto | Structural: no decision field in output schema + ordering + boundary guard |
| Can't leak secrets | Single-reader env var module (`ANTHROPIC_API_KEY`) + existing `redact()` |
| Can't block the real decision | LLM runs after the fact; every failure mode leaves `pipelineResult` untouched |
| Can't silently drift | Versioned prompts + versioned schema, both frozen once used |
| Can't be partially trusted | All-or-nothing validation at schema, grounding, and boundary layers |

## Explicitly Out of Scope for This Design

- No implementation code (adapter, prompts, schema validators) is
  written in this step.
- No live tool-use/function-calling back to providers by the model —
  single-shot reasoning over a static, pre-built Evidence Package only.
- No conversational/multi-turn state.
- No change to `app.js`, any agent, the orchestrator, `data/runStore.js`,
  or `server.js` — wiring is proposed, not built.
