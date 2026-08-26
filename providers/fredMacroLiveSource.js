// FRED Live-Source Boundary — implements the design approved in Step 26.
//
// This is the ONLY place process.env.FRED_API_KEY is read anywhere in
// the FRED macro integration. It contains no HTTP/network logic of its
// own — it constructs the existing, unmodified FredMacroAdapter and
// delegates entirely to the existing, unmodified composeMacroData().
//
// It does NOT call processRequest() and is NOT wired into the
// orchestrator — connecting it to the pipeline remains a separate,
// future, separately-authorized step.

const { FredMacroAdapter } = require("./adapters/fredMacroAdapter");
const { composeMacroData } = require("./fredMacroComposer");

// seriesIds: string[] — forwarded to composeMacroData() unchanged.
// options.adapterConfig: optional config merged into the adapter's own
//   constructor (e.g. { fetchImpl } for offline testing) — apiKey is
//   always sourced from process.env here, never overridable via this.
// options.composeOptions: optional, forwarded to composeMacroData()
//   unchanged (e.g. { observationParams }).
async function loadLiveMacroData(seriesIds, options = {}) {
  const apiKey = process.env.FRED_API_KEY;

  if (!apiKey) {
    return { macroData: [], seriesResults: [], warnings: ["FRED_API_KEY not configured."] };
  }

  const adapter = new FredMacroAdapter({ ...(options.adapterConfig || {}), apiKey });
  return composeMacroData(seriesIds, adapter, options.composeOptions || {});
}

module.exports = { loadLiveMacroData };
