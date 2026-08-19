// Indicator categories are a closed vocabulary only — not a data source,
// not an assumption that every category is available for every country.

const INDICATOR_CATEGORIES = Object.freeze({
  INFLATION: "INFLATION",
  EMPLOYMENT: "EMPLOYMENT",
  GDP: "GDP",
  INTEREST_RATES: "INTEREST_RATES",
  CENTRAL_BANK: "CENTRAL_BANK",
  MANUFACTURING: "MANUFACTURING",
  SERVICES: "SERVICES",
  CONSUMER: "CONSUMER",
  HOUSING: "HOUSING",
  TRADE: "TRADE",
  GOVERNMENT: "GOVERNMENT",
  COMMODITIES: "COMMODITIES",
  OTHER: "OTHER",
  UNKNOWN: "UNKNOWN",
});

module.exports = { INDICATOR_CATEGORIES };
