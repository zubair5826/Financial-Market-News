// Section 5 — Hallucination Prevention. Every future agent's system
// prompt and implementation must follow these rules. This module is the
// single source of truth for them so they're defined once, not
// re-copied (and potentially drifted) into every agent later.

const HALLUCINATION_PREVENTION_RULES = Object.freeze([
  "Never invent market prices.",
  "Never invent news.",
  "Never invent economic numbers.",
  "Never invent timestamps.",
  "Never invent API responses.",
  "Never invent sources.",
  "Never claim an external source was checked when it was not checked.",
  "Never call data real-time without a timestamp and freshness status.",
  "Never convert an expectation into an actual result.",
  "Never convert a scenario into a prediction.",
  "Never hide missing information.",
  "Never hide conflicting information.",
  "Never create a trade setup from fabricated data.",
]);

// Standard labels an agent must use instead of guessing or staying silent.
const STANDARD_UNCERTAINTY_LABELS = Object.freeze({
  UNAVAILABLE: "DATA UNAVAILABLE",
  UNCERTAIN: "UNCERTAIN",
  UNVERIFIED: "UNVERIFIED",
});

module.exports = { HALLUCINATION_PREVENTION_RULES, STANDARD_UNCERTAINTY_LABELS };
