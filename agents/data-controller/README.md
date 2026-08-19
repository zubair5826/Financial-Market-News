# Data Controller

The system's data truth layer — the first of the 8 planned agents to be
implemented, per the pipeline in the project root [README.md](../../README.md).

```
RECEIVE DATA -> VALIDATE -> CLASSIFY (pass-through) -> CHECK FRESHNESS
             -> CHECK SOURCE VERIFICATION -> DETECT CONFLICTS
             -> NORMALIZE -> hand validated data to other agents
```

## Status

**IMPLEMENTED**: everything described below. **NOT IMPLEMENTED**: any
external provider connection, any of the other 7 agents, any
orchestration wiring that actually calls this agent from
`orchestrator/`. **FUTURE**: real provider adapters under `providers/`
feeding this agent's `input`.

## Responsibility

Validates, classifies (pass-through only, never assigns or changes a
classification), checks freshness, checks source verification, detects
conflicts, and normalizes data into the standard Data Contract
(`core/dataRecord.js`) shape — nothing else.

It does **not**: analyze markets, predict prices, recommend a
direction (long/short/buy/sell), or make any trading decision. Its
`core/agentMessage.js` report always sets `recommendation_type` to
`NOT_AVAILABLE` and `bias` to `"NOT_APPLICABLE"` — see
`report.js`/test 12 in `dataController.test.js`.

## Inputs

`processMarketData(input, options)` — **IMPLEMENTED** for data supplied
internally by the system (an array of plain objects). **NOT
IMPLEMENTED**: no external API, broker, or exchange is connected.
**FUTURE-READY**: if `input` is instead a `core/errors.js` `failSafe()`
result (the shape a future provider adapter's failed call would
produce), the controller handles it directly — see the
`provider-error` branch in `index.js` — without needing a rewrite once
a real provider exists.

`options.fieldMap` — optional field-name mapping applied by
`normalize.js` before validation, so a future provider's own response
shape doesn't need to match the internal Data Contract's field names.
No provider's actual field names are assumed here.

`options.freshnessThresholds` — either a single `{ freshMaxMs,
agingMaxMs }` applied to every `data_type`, or an object keyed by
`data_type`. Not supplying it means every record's `freshness_status`
is `UNKNOWN`, per `core/freshness.js`'s design (Step 3) — the
controller never assumes a threshold.

## Validation (`validate.js`)

`core/dataRecord.js`'s `validateDataRecord()` checks structural shape
and enum legality, but deliberately allows `UNKNOWN` as a valid
placeholder. On top of that, the Data Controller enforces that
`asset`, `data_type`, `value`, `source`, and `classification` must be
**substantively present** (not `UNKNOWN`/empty) for a record to be
usable — a record failing this is rejected into `rejected_data`, never
silently repaired or passed through with a guessed value.

`timestamp` is deliberately **not** in that required set: a missing
timestamp doesn't make a record unusable, it just means
`freshness_status` becomes `UNKNOWN` (per the Step 3/Step 4 spec) —
handled by freshness checking below, not by rejection.

## Classification

Pass-through only — the controller never assigns, infers, or upgrades
a `classification`. Whatever classification the source data carries
in (`FACT`, `HISTORICAL`, `SCHEDULED_EVENT`, `MARKET_EXPECTATION`,
`FORECAST`, `SCENARIO`, `UNVERIFIED`, `UNKNOWN`) is what comes out.
`FORECAST`, `SCENARIO`, and `MARKET_EXPECTATION` can never become
`FACT` because nothing in this agent ever rewrites the field at all
(see tests 8–9).

## Freshness

Computed by the controller itself via `core/freshness.js`'s
`computeFreshness()` — **never trusted from the caller's own claim**.
A source calling its own data "real-time" without a timestamp is
exactly the unchecked claim this step exists to catch. No timestamp,
or no configured threshold for that `data_type` → `UNKNOWN`. Beyond
the aging threshold → `STALE` (logged via `core/errors.js`'s
`STALE_DATA` code, message includes the literal phrase `STALE DATA`).

## Source Verification & Conflict Handling (`conflicts.js`)

Records are grouped by `asset + data_type`. A lone record defaults to
`UNVERIFIED` (a single, uncorroborated source — never silently
upgraded). Two or more independent sources agreeing upgrades
`UNVERIFIED` to `VERIFIED_SECONDARY`. Two or more sources disagreeing
never picks a winner — every record in that group is marked
`CONFLICTING`, all of them (with source, value, timestamp) are
preserved in the result's `conflicts` array for the future Chief
Trading Manager to review, and a `CONFLICTING_DATA`-coded warning
(literal phrase `CONFLICTING DATA`) is added.

## Output Contract

`processMarketData()` returns:

```
{
  controller_status: "SUCCESS" | "PARTIAL" | "FAILED" | "CONFLICTING" | "UNAVAILABLE",
  validated_data: DataRecord[],
  rejected_data: [{ record, errors, reason }],
  warnings: [...],
  errors: [...],
  conflicts: [{ asset, data_type, records }],
  timestamp: ISOString,
}
```

`controller_status` decision order: no records validated → `FAILED`;
else if any conflict group exists → `CONFLICTING`; else if anything
was rejected → `PARTIAL`; else `SUCCESS`. No input at all (empty
array) → `UNAVAILABLE`. A provider-shaped `failSafe()` error passed in
as `input` maps `API_UNAVAILABLE`/`TIMEOUT`/`RATE_LIMIT`/`AUTH_FAILURE`
→ `UNAVAILABLE`, anything else → `FAILED`.

`runDataController(input, options)` runs the full pipeline and also
returns `report` — a validated `core/agentMessage.js` message
(`agent_name: "data-controller"`) for downstream agents. It throws
rather than returning a malformed report if `validateAgentMessage()`
ever fails on its own output.

## Error Handling (`core/errors.js`)

The controller is structurally ready to handle `API_UNAVAILABLE`,
`TIMEOUT`, `RATE_LIMIT`, and `AUTH_FAILURE` (via the provider-error
passthrough branch — **NOT IMPLEMENTED**/**FUTURE**, since nothing
calls it yet with a real provider failure), and directly produces
`MALFORMED_DATA` (bad/rejected records, non-array input),
`MISSING_DATA` (batch had records but zero survived validation —
`INSUFFICIENT DATA`), `STALE_DATA`, and `CONFLICTING_DATA` itself
(**IMPLEMENTED**). It never fabricates a fallback value for any of
these.

## Logging

Every call logs via `logs/logger.js`'s `logEvent()`: `agent:
"data-controller"`, the request shape, aggregated data sources,
`controller_status`, warnings, and errors. Secrets are redacted by the
logger itself (Step 3) — this agent never logs API keys, tokens, or
credentials because it doesn't handle any.

## Testing

Node's built-in `node:test` (no new dependency). Run via `npm test`
(auto-discovers all `*.test.js` files project-wide, including these).

- `normalize.test.js` — field mapping, defaults to `UNKNOWN`.
- `validate.test.js` — required-field enforcement, timestamp exemption.
- `conflicts.test.js` — conflict detection, agreement upgrade, single-source no-op.
- `dataController.test.js` — the 12 required scenarios from the Step 4
  spec (numbered in the test names), plus empty-input and
  provider-error-passthrough coverage.

**Note:** this environment has no `node` binary available, so the
suite could not actually be executed here — only reviewed by hand.
Run `npm test` yourself to confirm before relying on it.
