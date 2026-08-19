// Invalidation assessment — per the Step 10 spec, this agent never
// invents a stop-loss price; it only evaluates the already-validated
// levels the Trade Setup Agent derived from real Technical Agent
// support/resistance data (see agents/trade-setup-agent/levels.js).
// This module adds no new price, only a qualitative read of whether
// real invalidation levels are actually available to reason about.

function assessInvalidation(tradeSetupReport) {
  if (!tradeSetupReport || !Array.isArray(tradeSetupReport.invalidation_conditions) || tradeSetupReport.invalidation_conditions.length === 0) {
    return {
      status: "DATA_UNAVAILABLE",
      conditions: [],
      notes: "No trade setup reference or invalidation conditions supplied.",
    };
  }

  const hasRealLevels = tradeSetupReport.invalidation_conditions.some((c) => c.condition !== "DATA_UNAVAILABLE");
  if (!hasRealLevels) {
    return {
      status: "DATA_UNAVAILABLE",
      conditions: tradeSetupReport.invalidation_conditions,
      notes: "The Trade Setup Agent reported no validated technical levels available for this direction.",
    };
  }

  return {
    status: "AVAILABLE",
    conditions: tradeSetupReport.invalidation_conditions,
    notes: "Referenced directly from the Trade Setup Agent's validated technical levels — no level invented here.",
  };
}

module.exports = { assessInvalidation };
