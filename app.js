// Application Entrypoint — Step 35. The minimal, thin boundary a caller
// uses to invoke the existing intelligence pipeline. It duplicates
// nothing: it calls the existing, unmodified runFredAwareRequest()
// (Step 32), which itself calls the existing, unmodified
// processRequest() and, only when explicitly enabled via
// options.macro.enabled === true, the existing loadLiveMacroData()
// FRED boundary (Step 27). This file adds no logic of its own beyond a
// single passthrough call — no new request schema, no new response
// shape, no new FRED configuration layer.

const { runFredAwareRequest } = require("./providers/fredMacroApplicationService");

// request: the same shape processRequest() already accepts (see
// README.md's "Data Flow" section) — { query, asset?, marketData?,
// newsData?, macroData?, technicalCandles?, sentimentData?, ... }.
// options: forwarded unchanged to runFredAwareRequest(); FRED stays
// disabled unless options.macro.enabled === true (existing default).
// Returns { pipelineResult, fredDiagnostics } unchanged.
async function runApplicationRequest(request, options = {}) {
  return runFredAwareRequest(request, options);
}

module.exports = { runApplicationRequest };
