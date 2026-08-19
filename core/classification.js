// Section 2 — Information Classification. Every important piece of
// information handled by any future agent must carry exactly one of
// these labels so that speculative content can never be silently
// mistaken for a confirmed fact.

const INFORMATION_CLASSIFICATIONS = Object.freeze({
  FACT: "FACT",
  HISTORICAL: "HISTORICAL",
  SCHEDULED_EVENT: "SCHEDULED_EVENT",
  MARKET_EXPECTATION: "MARKET_EXPECTATION",
  FORECAST: "FORECAST",
  SCENARIO: "SCENARIO",
  UNVERIFIED: "UNVERIFIED",
  UNKNOWN: "UNKNOWN",
});

const CLASSIFICATION_DEFINITIONS = Object.freeze({
  FACT: "A value directly observed or reported from a verifiable source, current as of its timestamp (e.g. a confirmed closing price, a published CPI number). Never a prediction or assumption.",
  HISTORICAL: "A FACT about a past period, presented purely as historical record with no implication that it still holds now (e.g. last quarter's earnings).",
  SCHEDULED_EVENT: "A known future event with a confirmed date/time (e.g. an earnings call date, a central bank meeting date). The event's occurrence is scheduled; its outcome is not implied or predicted.",
  MARKET_EXPECTATION: "A consensus or implied expectation derived from market pricing or analyst surveys (e.g. 'market is pricing in a 25bps cut'). Describes what the market currently believes, not what has happened.",
  FORECAST: "A model-, agent-, or analyst-generated projection of a future value or outcome. Explicitly speculative — must never be presented as a FACT.",
  SCENARIO: "A hypothetical 'what if' outcome used for planning or risk analysis (e.g. 'if inflation surprises to the upside...'). Never a prediction of what will actually happen.",
  UNVERIFIED: "Information from a source that has not been cross-checked or confirmed as VERIFIED_PRIMARY or VERIFIED_SECONDARY (see core/verification.js).",
  UNKNOWN: "The classification could not be determined from the information available.",
});

// These classifications describe belief, expectation, or hypothesis, not
// confirmed reality — they must never be presented to the user or passed
// downstream as if they were FACT. Used by validators in this project;
// enforcement inside a live conversation is each agent's responsibility.
const NEVER_PRESENT_AS_FACT = Object.freeze([
  INFORMATION_CLASSIFICATIONS.SCENARIO,
  INFORMATION_CLASSIFICATIONS.FORECAST,
  INFORMATION_CLASSIFICATIONS.MARKET_EXPECTATION,
]);

function canBePresentedAsFact(classification) {
  return !NEVER_PRESENT_AS_FACT.includes(classification);
}

module.exports = {
  INFORMATION_CLASSIFICATIONS,
  CLASSIFICATION_DEFINITIONS,
  NEVER_PRESENT_AS_FACT,
  canBePresentedAsFact,
};
