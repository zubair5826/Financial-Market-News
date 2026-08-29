// One-off runner: pulls real live data (FRED macro + Alpha Vantage
// SPY technical candles + Alpha Vantage SPY news) through the full
// 8-agent pipeline via the existing runMarketIntelligenceRequest().
const { runMarketIntelligenceRequest } = require("./providers/marketIntelligenceApplicationService");

async function main() {
  const request = { query: "Assess SPY", asset: "SPY" };
  const options = {
    macro: { enabled: true },
    market: { enabled: true },
    news: { enabled: true },
  };
  const { pipelineResult, diagnostics } = await runMarketIntelligenceRequest(request, options);
  console.log("=== PIPELINE RESULT ===");
  console.log(JSON.stringify(pipelineResult, null, 2));
  console.log("\n=== DIAGNOSTICS ===");
  console.log(JSON.stringify(diagnostics, null, 2));
}

main().catch((err) => {
  console.error("Run failed:", err);
  process.exitCode = 1;
});
