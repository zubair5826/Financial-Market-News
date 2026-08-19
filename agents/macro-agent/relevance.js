// Structured macro relevance relative to a requested asset. Never
// invents an asset-to-indicator relationship: DIRECT/HIGH/MEDIUM only
// trigger on literal matches against the requested asset itself or
// against caller-supplied options (assetCurrency/assetCountry/
// assetRegion) — this agent has no built-in knowledge of which country
// or currency a given asset belongs to (e.g. that AAPL is a US company),
// and inventing that mapping would be exactly the kind of unfounded
// assumption this system exists to avoid.

const { UNKNOWN } = require("../../core/constants");

const RELEVANCE_LEVELS = Object.freeze({
  DIRECT: "DIRECT",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  UNKNOWN: "UNKNOWN",
});

const RELEVANCE_DEFINITIONS = Object.freeze({
  DIRECT: "The record's currency matches the requested asset itself, or matches options.assetCurrency if the caller supplied one.",
  HIGH: "The record's country matches options.assetCountry (same economy, without an explicit currency match).",
  MEDIUM: "The record's region matches options.assetRegion (broader regional exposure, no country/currency match).",
  LOW: "The record carries country/region/currency data, but none of it matches the requested asset given the options supplied.",
  UNKNOWN: "No requested asset was given, or the record has no country/region/currency data to judge relevance from.",
});

function assessMacroRelevance(record, requestedAsset, options = {}) {
  if (!requestedAsset || requestedAsset === UNKNOWN) {
    return RELEVANCE_LEVELS.UNKNOWN;
  }

  const hasCurrency = record.currency && record.currency !== UNKNOWN;
  const hasCountry = record.country && record.country !== UNKNOWN;
  const hasRegion = record.region && record.region !== UNKNOWN;

  if (!hasCurrency && !hasCountry && !hasRegion) {
    return RELEVANCE_LEVELS.UNKNOWN;
  }

  // Only a literal string match — either the requested asset name IS the
  // currency code, or the caller explicitly told us which currency it
  // maps to. No mapping is guessed.
  const targetCurrency = options.assetCurrency || requestedAsset;
  if (hasCurrency && record.currency === targetCurrency) {
    return RELEVANCE_LEVELS.DIRECT;
  }
  if (hasCountry && options.assetCountry && record.country === options.assetCountry) {
    return RELEVANCE_LEVELS.HIGH;
  }
  if (hasRegion && options.assetRegion && record.region === options.assetRegion) {
    return RELEVANCE_LEVELS.MEDIUM;
  }

  return RELEVANCE_LEVELS.LOW;
}

module.exports = { RELEVANCE_LEVELS, RELEVANCE_DEFINITIONS, assessMacroRelevance };
