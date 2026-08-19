// Position sizing — per the Step 10 spec, real-money sizing is NEVER
// computed unless every one of the six listed parameters (account
// balance, risk percentage, leverage, entry price, stop price,
// contract size) is explicitly supplied as a real number. Missing any
// one of them returns POSITION SIZE: DATA_UNAVAILABLE — none are ever
// assumed, defaulted, or estimated. `leverage` is included in the
// output for context even though this module's formula (a standard
// fixed-fractional risk sizing calculation) doesn't multiply by it —
// its absence still forces DATA_UNAVAILABLE per the spec's literal
// instruction, since inventing a leverage-adjusted formula this system
// isn't confident about would itself be a fabrication risk.

const { UNKNOWN } = require("../../core/constants");

const REQUIRED_SIZING_PARAMS = Object.freeze([
  "accountBalance",
  "riskPercentage",
  "leverage",
  "entryPrice",
  "stopPrice",
  "contractSize",
]);

function isNumeric(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function calculatePositionSize(params = {}) {
  const missing = REQUIRED_SIZING_PARAMS.filter((p) => !isNumeric(params[p]));
  if (missing.length > 0) {
    return {
      status: "DATA_UNAVAILABLE",
      position_size: UNKNOWN,
      missing_parameters: missing,
      notes: "One or more required sizing parameters were not supplied — never assumed.",
    };
  }

  const { accountBalance, riskPercentage, leverage, entryPrice, stopPrice, contractSize } = params;
  const perUnitRisk = Math.abs(entryPrice - stopPrice);

  if (perUnitRisk === 0) {
    return {
      status: "DATA_UNAVAILABLE",
      position_size: UNKNOWN,
      missing_parameters: [],
      notes: "entryPrice and stopPrice are identical — per-unit risk is zero, position size cannot be computed.",
    };
  }

  const riskAmount = accountBalance * riskPercentage;
  const units = riskAmount / perUnitRisk;
  const positionSize = units * contractSize;

  return {
    status: "CALCULATED",
    position_size: positionSize,
    units,
    risk_amount: riskAmount,
    leverage_supplied: leverage,
    missing_parameters: [],
    notes: "Deterministic fixed-fractional risk sizing from explicitly supplied parameters only.",
  };
}

module.exports = { REQUIRED_SIZING_PARAMS, calculatePositionSize };
