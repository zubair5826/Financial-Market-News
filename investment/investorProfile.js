// Investor Profile Data Model — implements the contract frozen in
// Step 51/52. A sibling contract to core/dataRecord.js,
// agents/news-agent/newsRecord.js, agents/macro-agent/macroRecord.js,
// and agents/technical-agent/technicalRecord.js: every field defaults
// to UNKNOWN, never fabricated, never omitted.
//
// This module represents the INVESTOR only — who, how much, why, how
// long, how much risk. It must never contain market data, provider
// data, agent output, or a portfolio recommendation; nothing here
// reaches into any of that, by construction.
//
// This module does NOT validate values (see investorProfileValidation.js
// for that) — it only builds the canonical, fully-defaulted shape from
// whatever structured fields a caller supplies. It does not parse
// natural language; the caller (a future extraction layer, or a test)
// supplies already-structured field values.

const { UNKNOWN } = require("../core/constants");

// Every field that can carry user-derived information distinguishes
// how it came to have its value — never an arbitrary numeric
// confidence score.
const PROVENANCE_STATES = Object.freeze({
  PROVIDED: "PROVIDED",
  INFERRED: "INFERRED",
  UNKNOWN: "UNKNOWN",
  INVALID: "INVALID",
});

const CURRENCY_CODES = Object.freeze(["CAD", "USD", "EUR", "GBP"]);

const RISK_TOLERANCE_VALUES = Object.freeze(["CONSERVATIVE", "MODERATE", "AGGRESSIVE"]);

const INVESTMENT_OBJECTIVE_VALUES = Object.freeze([
  "CAPITAL_PRESERVATION",
  "INCOME",
  "BALANCED_GROWTH",
  "CAPITAL_GROWTH",
  "SPECULATION",
]);

const HORIZON_BANDS = Object.freeze(["SHORT_TERM", "MEDIUM_TERM", "LONG_TERM"]);

// UNKNOWN is itself one of the four allowed liquidityRequirement
// *values* (a real, disclosed "I'm not sure" answer), distinct from
// the field's own provenance UNKNOWN (the field was never addressed
// at all) — the two are independent axes.
const LIQUIDITY_VALUES = Object.freeze(["UNKNOWN", "IMMEDIATE", "SHORT_TERM", "FLEXIBLE"]);

const REQUIRED_FIELDS = Object.freeze(["investmentAmount", "investmentHorizon", "riskTolerance"]);
const RECOMMENDED_FIELDS = Object.freeze(["investmentCurrency", "investmentObjective"]);

function defaultScalarField(field) {
  return { value: field && field.value !== undefined ? field.value : UNKNOWN, provenance: field && field.provenance !== undefined ? field.provenance : UNKNOWN, reason: field && field.reason !== undefined ? field.reason : UNKNOWN };
}

function defaultHorizonField(field) {
  const f = field || {};
  return {
    minimumYears: f.minimumYears !== undefined ? f.minimumYears : UNKNOWN,
    maximumYears: f.maximumYears !== undefined ? f.maximumYears : UNKNOWN,
    band: f.band !== undefined ? f.band : UNKNOWN,
    provenance: f.provenance !== undefined ? f.provenance : UNKNOWN,
    reason: f.reason !== undefined ? f.reason : UNKNOWN,
  };
}

function defaultEmergencyCashField(field) {
  const f = field || {};
  return {
    value: f.value !== undefined ? f.value : UNKNOWN,
    currency: f.currency !== undefined ? f.currency : UNKNOWN,
    provenance: f.provenance !== undefined ? f.provenance : UNKNOWN,
    reason: f.reason !== undefined ? f.reason : UNKNOWN,
  };
}

function defaultAssetClassRestrictions(field) {
  const f = field || {};
  return {
    excluded: Array.isArray(f.excluded) ? [...f.excluded] : [],
    includedOnly: Array.isArray(f.includedOnly) ? [...f.includedOnly] : [],
    maximumByClass: f.maximumByClass && typeof f.maximumByClass === "object" ? { ...f.maximumByClass } : {},
  };
}

// input: a plain object of already-structured field values (never raw
// prose). Never mutates input. Every unset field defaults to its own
// UNKNOWN-shaped default — nothing is ever fabricated.
function createInvestorProfile(input = {}) {
  return {
    investmentAmount: defaultScalarField(input.investmentAmount),
    investmentCurrency: defaultScalarField(input.investmentCurrency),
    investmentHorizon: defaultHorizonField(input.investmentHorizon),
    riskTolerance: defaultScalarField(input.riskTolerance),
    investmentObjective: defaultScalarField(input.investmentObjective),
    liquidityRequirement: defaultScalarField(input.liquidityRequirement),
    emergencyCashRequirement: defaultEmergencyCashField(input.emergencyCashRequirement),
    assetClassRestrictions: defaultAssetClassRestrictions(input.assetClassRestrictions),
    maximumConcentration: defaultScalarField(input.maximumConcentration),
  };
}

module.exports = {
  PROVENANCE_STATES,
  CURRENCY_CODES,
  RISK_TOLERANCE_VALUES,
  INVESTMENT_OBJECTIVE_VALUES,
  HORIZON_BANDS,
  LIQUIDITY_VALUES,
  REQUIRED_FIELDS,
  RECOMMENDED_FIELDS,
  createInvestorProfile,
};
