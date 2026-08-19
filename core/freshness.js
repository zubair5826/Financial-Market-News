// Section 3 — Data Freshness. No default thresholds are hard-coded here
// on purpose: freshness periods are legitimately different per data type
// (a live price quote vs. a quarterly earnings figure), and no data
// types or providers have been chosen yet (still UNKNOWN — see
// providers/). Hard-coding a number now would just be an invented
// assumption. Callers must supply { freshMaxMs, agingMaxMs } explicitly;
// without them, freshness is honestly reported as UNKNOWN rather than
// guessed.

const FRESHNESS_STATES = Object.freeze({
  FRESH: "FRESH",
  AGING: "AGING",
  STALE: "STALE",
  UNKNOWN: "UNKNOWN",
});

const FRESHNESS_DEFINITIONS = Object.freeze({
  FRESH: "Within the freshMaxMs threshold for this data type — safe to describe as current.",
  AGING: "Older than freshMaxMs but within agingMaxMs — still usable, but must be labeled as aging, not real-time.",
  STALE: "Older than agingMaxMs for this data type — must not be presented as current or real-time.",
  UNKNOWN: "No timestamp, an unparsable timestamp, or no thresholds were supplied — freshness cannot be honestly determined.",
});

// Computes freshness from an ISO timestamp and per-data-type thresholds.
// Returns UNKNOWN (never a guess) whenever it can't be determined safely.
function computeFreshness(timestampIso, thresholds) {
  if (!timestampIso) return FRESHNESS_STATES.UNKNOWN;

  const ts = Date.parse(timestampIso);
  if (Number.isNaN(ts)) return FRESHNESS_STATES.UNKNOWN;

  const ageMs = Date.now() - ts;
  if (ageMs < 0) return FRESHNESS_STATES.UNKNOWN; // timestamp in the future — suspicious, don't guess

  if (!thresholds || typeof thresholds.freshMaxMs !== "number" || typeof thresholds.agingMaxMs !== "number") {
    return FRESHNESS_STATES.UNKNOWN;
  }

  if (ageMs <= thresholds.freshMaxMs) return FRESHNESS_STATES.FRESH;
  if (ageMs <= thresholds.agingMaxMs) return FRESHNESS_STATES.AGING;
  return FRESHNESS_STATES.STALE;
}

module.exports = { FRESHNESS_STATES, FRESHNESS_DEFINITIONS, computeFreshness };
