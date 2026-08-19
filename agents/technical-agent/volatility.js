// Thin wrapper around indicators.js's ATR-derived volatility zone — a
// separate module so report.js and future agents have a stable,
// clearly-named place to read "the" volatility assessment from, without
// needing to know it's sourced from ATR specifically. No threshold is
// invented here — see indicators.js's classifyVolatilityZone(), which
// this defers to entirely.

const { VOLATILITY_STATES } = require("./indicators");

function assessVolatility(atrResult) {
  if (!atrResult || atrResult.calculation_status !== "CALCULATED") {
    return { volatility: VOLATILITY_STATES.UNKNOWN, basis: "ATR", atr_value: atrResult ? atrResult.current_value : "UNKNOWN" };
  }
  return {
    volatility: atrResult.technical_state || VOLATILITY_STATES.UNKNOWN,
    basis: "ATR",
    atr_value: atrResult.current_value,
  };
}

module.exports = { assessVolatility };
