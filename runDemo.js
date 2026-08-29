// Demo runner — feeds hand-built, CLEARLY-LABELED sample data (not live
// market data) through the full, unmodified 8-agent pipeline via the
// existing processRequest(). This proves the actual reasoning chain
// (Data Controller -> News/Macro/Technical/Sentiment -> Trade Setup ->
// Risk Manager -> Chief Trading Manager) runs end to end and produces a
// real structured report — it does NOT claim to reflect real market
// conditions. All prices/headlines/indicators below are illustrative
// round numbers, invented for this demo run only.

const { processRequest } = require("./orchestrator");

const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

// 20 daily SAMPLE candles, mildly uptrending, for a fictional "DEMO" asset.
const technicalCandles = [];
let price = 500;
for (let i = 19; i >= 0; i--) {
  const open = price;
  const drift = (Math.sin(i / 3) * 1.5) + 0.6;
  const close = +(open + drift).toFixed(2);
  const high = +(Math.max(open, close) + 1.2).toFixed(2);
  const low = +(Math.min(open, close) - 1.0).toFixed(2);
  technicalCandles.push({
    asset: "DEMO",
    timeframe: "1D",
    timestamp: iso(i * 24 * 3600 * 1000),
    open,
    high,
    low,
    close,
    volume: 75000000 + i * 500000,
    unit: "USD",
    source: "Illustrative sample data (not live)",
    source_type: "SAMPLE",
    verification_status: "UNVERIFIED",
    freshness_status: i === 0 ? "FRESH" : "AGING",
    classification: "FACT",
    confidence: "MEDIUM",
    notes: "Synthetic demo candle, not a real market observation.",
  });
  price = close;
}

const newsData = [
  {
    headline: "[SAMPLE] Central bank signals patience on rate path",
    summary: "Illustrative example headline used only to exercise the News Agent.",
    source: "Illustrative sample data (not live)",
    source_type: "OTHER",
    publication_timestamp: iso(6 * 3600 * 1000),
    retrieved_timestamp: iso(1 * 3600 * 1000),
    url_or_reference: "sample://demo/news/1",
    related_assets: ["DEMO"],
    related_markets: ["US_EQUITY"],
    country_or_region: "US",
    category: "MACRO",
    classification: "UNVERIFIED",
    verification_status: "UNVERIFIED",
    freshness_status: "FRESH",
    confidence: "MEDIUM",
    potential_market_impact: "MODERATE",
    impact_direction: "POSITIVE",
    impact_confidence: "MEDIUM",
    evidence: ["Sample headline text only — invented for this demo."],
    notes: "Demo record, not a real news item.",
  },
  {
    headline: "[SAMPLE] Sector earnings beat expectations broadly",
    summary: "Illustrative example headline used only to exercise the News Agent.",
    source: "Illustrative sample data (not live)",
    source_type: "OTHER",
    publication_timestamp: iso(20 * 3600 * 1000),
    retrieved_timestamp: iso(2 * 3600 * 1000),
    url_or_reference: "sample://demo/news/2",
    related_assets: ["DEMO"],
    related_markets: ["US_EQUITY"],
    country_or_region: "US",
    category: "EARNINGS",
    classification: "UNVERIFIED",
    verification_status: "UNVERIFIED",
    freshness_status: "AGING",
    confidence: "MEDIUM",
    potential_market_impact: "MODERATE",
    impact_direction: "POSITIVE",
    impact_confidence: "MEDIUM",
    evidence: ["Sample headline text only — invented for this demo."],
    notes: "Demo record, not a real news item.",
  },
  {
    headline: "[SAMPLE] Regional manufacturing index softens",
    summary: "Illustrative example headline used only to exercise the News Agent.",
    source: "Illustrative sample data (not live)",
    source_type: "OTHER",
    publication_timestamp: iso(30 * 3600 * 1000),
    retrieved_timestamp: iso(3 * 3600 * 1000),
    url_or_reference: "sample://demo/news/3",
    related_assets: ["DEMO"],
    related_markets: ["US_EQUITY"],
    country_or_region: "US",
    category: "MANUFACTURING",
    classification: "UNVERIFIED",
    verification_status: "UNVERIFIED",
    freshness_status: "STALE",
    confidence: "LOW",
    potential_market_impact: "LOW",
    impact_direction: "NEGATIVE",
    impact_confidence: "LOW",
    evidence: ["Sample headline text only — invented for this demo."],
    notes: "Demo record, not a real news item.",
  },
];

const macroData = [
  {
    indicator: "[SAMPLE] Consumer Price Index (YoY)",
    indicator_code: "SAMPLE_CPI",
    country: "US",
    region: "US",
    currency: "USD",
    category: "INFLATION",
    actual_value: 3.1,
    previous_value: 3.2,
    expected_value: 3.0,
    forecast_value: "UNKNOWN",
    unit: "PERCENT",
    period: "2026-07",
    release_timestamp: iso(2 * 24 * 3600 * 1000),
    retrieved_timestamp: iso(1 * 24 * 3600 * 1000),
    source: "Illustrative sample data (not live)",
    source_type: "SAMPLE",
    classification: "UNVERIFIED",
    verification_status: "UNVERIFIED",
    freshness_status: "AGING",
    confidence: "MEDIUM",
    surprise_value: "UNKNOWN",
    surprise_direction: "UNKNOWN",
    market_relevance: "HIGH",
    potential_market_impact: "MODERATE",
    impact_direction: "NEGATIVE",
    evidence: ["Sample indicator, invented for this demo — actual came in above expected."],
    notes: "Demo record, not a real economic release.",
  },
  {
    indicator: "[SAMPLE] Unemployment Rate",
    indicator_code: "SAMPLE_UNRATE",
    country: "US",
    region: "US",
    currency: "USD",
    category: "EMPLOYMENT",
    actual_value: 4.0,
    previous_value: 4.1,
    expected_value: 4.1,
    forecast_value: "UNKNOWN",
    unit: "PERCENT",
    period: "2026-07",
    release_timestamp: iso(5 * 24 * 3600 * 1000),
    retrieved_timestamp: iso(4 * 24 * 3600 * 1000),
    source: "Illustrative sample data (not live)",
    source_type: "SAMPLE",
    classification: "UNVERIFIED",
    verification_status: "UNVERIFIED",
    freshness_status: "STALE",
    confidence: "MEDIUM",
    surprise_value: "UNKNOWN",
    surprise_direction: "UNKNOWN",
    market_relevance: "HIGH",
    potential_market_impact: "MODERATE",
    impact_direction: "POSITIVE",
    evidence: ["Sample indicator, invented for this demo — actual came in below expected (fewer unemployed)."],
    notes: "Demo record, not a real economic release.",
  },
];

const sentimentData = [
  {
    asset: "DEMO",
    timestamp: iso(3 * 3600 * 1000),
    source: "Illustrative sample data (not live)",
    source_type: "OTHER",
    content_reference: "sample://demo/sentiment/1",
    sentiment: "BULLISH",
    sentiment_score: 0.4,
    sentiment_strength: "MODERATE",
    classification: "UNVERIFIED",
    verification_status: "UNVERIFIED",
    freshness_status: "FRESH",
    confidence: "LOW",
    volume: 1200,
    engagement: "UNKNOWN",
    related_topics: ["earnings", "rates"],
    evidence: ["Sample sentiment record, invented for this demo."],
    notes: "Demo record, not real sentiment data.",
  },
  {
    asset: "DEMO",
    timestamp: iso(10 * 3600 * 1000),
    source: "Illustrative sample data (not live)",
    source_type: "OTHER",
    content_reference: "sample://demo/sentiment/2",
    sentiment: "NEUTRAL",
    sentiment_score: 0.05,
    sentiment_strength: "WEAK",
    classification: "UNVERIFIED",
    verification_status: "UNVERIFIED",
    freshness_status: "AGING",
    confidence: "LOW",
    volume: 800,
    engagement: "UNKNOWN",
    related_topics: ["macro"],
    evidence: ["Sample sentiment record, invented for this demo."],
    notes: "Demo record, not real sentiment data.",
  },
];

const request = {
  query: "Assess DEMO asset using sample data",
  asset: "DEMO",
  technicalCandles,
  newsData,
  macroData,
  sentimentData,
  options: {
    freshnessThresholds: { freshMaxMs: 24 * 3600 * 1000, agingMaxMs: 7 * 24 * 3600 * 1000 },
    positionSizingParams: {
      accountBalance: 10000,
      riskPercentage: 0.01,
      leverage: 1,
      entryPrice: price,
      stopPrice: +(price - 5).toFixed(2),
      contractSize: 1,
    },
  },
};

const result = processRequest(request);
console.log(JSON.stringify(result, null, 2));
