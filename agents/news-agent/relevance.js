// Structured relevance assessment relative to a requested asset. Never
// invents a relevance level when evidence is insufficient — returns
// UNKNOWN instead.

const { UNKNOWN } = require("../../core/constants");

const RELEVANCE_LEVELS = Object.freeze({
  DIRECT: "DIRECT",
  INDIRECT: "INDIRECT",
  MACRO: "MACRO",
  SECTOR: "SECTOR",
  LOW_RELEVANCE: "LOW_RELEVANCE",
  UNKNOWN: "UNKNOWN",
});

const RELEVANCE_DEFINITIONS = Object.freeze({
  DIRECT: "The item's related_assets explicitly names the requested asset.",
  INDIRECT: "The item is tagged with related_markets that plausibly affect the requested asset, without naming it directly.",
  MACRO: "The item is macroeconomic in category — not asset-specific, but could affect broad markets including the requested asset.",
  SECTOR: "The item's category is explicitly configured (via options.sectorCategories) as relevant to the requested asset, with no direct asset or market match. This agent does not assume on its own which categories matter to which assets — that mapping must come from the caller.",
  LOW_RELEVANCE: "The item's tagged assets/markets/category show no meaningful connection to the requested asset.",
  UNKNOWN: "No requested asset was given, or the item has no related_assets/related_markets/category data to judge relevance from.",
});

const MACRO_CATEGORIES = new Set(["macro", "macroeconomic"]);

// `options.sectorCategories` — an optional list of category names the
// caller considers relevant to the requested asset (e.g. ["technology"]
// for AAPL). Without it, SECTOR is never reached and an item with only
// an unrelated category (e.g. "sports") correctly falls through to
// LOW_RELEVANCE, rather than this agent guessing that any category at
// all implies sector relevance.
function assessRelevance(newsItem, requestedAsset, options = {}) {
  if (!requestedAsset || requestedAsset === UNKNOWN) {
    return RELEVANCE_LEVELS.UNKNOWN;
  }

  const hasAssetData = Array.isArray(newsItem.related_assets);
  const hasMarketData = Array.isArray(newsItem.related_markets);
  const hasCategory = typeof newsItem.category === "string" && newsItem.category !== UNKNOWN;

  if (!hasAssetData && !hasMarketData && !hasCategory) {
    return RELEVANCE_LEVELS.UNKNOWN;
  }

  if (hasAssetData && newsItem.related_assets.includes(requestedAsset)) {
    return RELEVANCE_LEVELS.DIRECT;
  }
  if (hasMarketData && newsItem.related_markets.length > 0) {
    return RELEVANCE_LEVELS.INDIRECT;
  }
  if (hasCategory && MACRO_CATEGORIES.has(newsItem.category.toLowerCase())) {
    return RELEVANCE_LEVELS.MACRO;
  }
  if (hasCategory && Array.isArray(options.sectorCategories) && options.sectorCategories.includes(newsItem.category)) {
    return RELEVANCE_LEVELS.SECTOR;
  }

  return RELEVANCE_LEVELS.LOW_RELEVANCE;
}

module.exports = { RELEVANCE_LEVELS, RELEVANCE_DEFINITIONS, assessRelevance };
