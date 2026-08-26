// FRED-Aware Application Service — implements the design frozen in
// Step 31. The smallest safe bridge between a caller and the existing,
// unmodified processRequest(): optionally obtains live FRED macro data
// through the existing loadLiveMacroData() boundary, merges it into a
// processRequest()-compatible request, and returns the pipeline result
// alongside separated FRED diagnostics. This is NOT a second
// orchestrator — it duplicates no FRED HTTP logic, no macro composition
// logic, and no pipeline logic; every one of those remains exactly
// where it already lives.

const { loadLiveMacroData } = require("./fredMacroLiveSource");
const { processRequest } = require("../orchestrator");
const { failSafe, ERROR_CODES } = require("../core/errors");

const DEFAULT_SERIES_IDS = ["GNPCA"];

// request: the same shape processRequest() already accepts.
// options.macro: { enabled?: boolean, seriesIds?: string[] } — FRED is
//   disabled unless enabled === true (frozen, non-negotiable default).
// options.adapterConfig / options.composeOptions: forwarded verbatim to
//   loadLiveMacroData() — production callers never need these; they
//   exist solely for offline test injection, exactly mirroring
//   loadLiveMacroData()'s own existing design.
async function runFredAwareRequest(request, options = {}) {
  const macroOptions = (options && options.macro) || {};

  if (macroOptions.enabled !== true) {
    // FRED disabled (the default): no network access, no credential
    // access, request.macroData (if any) passes through untouched.
    const pipelineResult = processRequest(request);
    return { pipelineResult, fredDiagnostics: null };
  }

  // FRED enabled — but refuse to guess if the caller already supplied
  // their own macroData. Never silently overwrite, never silently
  // merge. loadLiveMacroData() and processRequest() are both skipped
  // entirely in this case.
  if (Array.isArray(request.macroData) && request.macroData.length > 0) {
    return {
      pipelineResult: failSafe(
        ERROR_CODES.MALFORMED_DATA,
        "request.macroData was already supplied while options.macro.enabled is true — ambiguous merge, refusing to guess which source should win."
      ),
      fredDiagnostics: null,
    };
  }

  const seriesIds =
    Array.isArray(macroOptions.seriesIds) && macroOptions.seriesIds.length > 0 ? macroOptions.seriesIds : DEFAULT_SERIES_IDS;

  // Fully await before processRequest() is ever called — no race.
  const composition = await loadLiveMacroData(seriesIds, {
    adapterConfig: options.adapterConfig,
    composeOptions: options.composeOptions,
  });

  const mergedRequest = { ...request, macroData: composition.macroData };
  const pipelineResult = processRequest(mergedRequest);

  return {
    pipelineResult,
    fredDiagnostics: { seriesResults: composition.seriesResults, warnings: composition.warnings },
  };
}

module.exports = { runFredAwareRequest };
