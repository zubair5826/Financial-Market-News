// FRED Macro Composition Layer — implements the design frozen in Step 20.
//
// A thin, FRED-specific composition layer sitting between an
// already-constructed provider adapter and a future caller that wants to
// populate request.macroData for orchestrator.processRequest(). It does
// NOT replace, modify, or construct FredMacroAdapter; it does not read
// process.env; it does not know how to build a FRED URL — all of that
// remains entirely the adapter's responsibility. This module only knows
// how to call adapter.fetchData() for one or more series and aggregate
// the results, never fabricating a record for a series that failed.
//
// The composer never mutates its inputs (the caller's seriesIds array,
// the adapter, or any request object) and never returns a request object
// itself — only { macroData, seriesResults, warnings } for the caller to
// spread into its own request: { ...baseRequest, macroData: composition.macroData }.

async function composeMacroData(seriesIds, adapter, options = {}) {
  if (!Array.isArray(seriesIds) || seriesIds.length === 0) {
    return {
      macroData: [],
      seriesResults: [],
      warnings: ["composeMacroData requires a non-empty array of seriesIds."],
    };
  }
  if (!adapter || typeof adapter.fetchData !== "function") {
    return {
      macroData: [],
      seriesResults: [],
      warnings: ["composeMacroData requires an adapter with a fetchData() method."],
    };
  }

  // De-duplicated, never mutates the caller's own array.
  const uniqueSeriesIds = [...new Set(seriesIds)];

  const outcomes = await Promise.allSettled(
    uniqueSeriesIds.map((seriesId) => adapter.fetchData({ seriesId, observationParams: options.observationParams }))
  );

  const macroData = [];
  const seriesResults = [];
  const warnings = [];

  uniqueSeriesIds.forEach((seriesId, index) => {
    const outcome = outcomes[index];

    // The adapter's own contract never throws (proven by its own test
    // suite) — this branch exists only as a defensive fallback for any
    // fetchData()-shaped input, never expected to actually fire against
    // the real FredMacroAdapter. API_UNAVAILABLE (an existing code, not
    // a new one) is the closest honest description of "the request
    // could not be completed."
    if (outcome.status === "rejected") {
      const reason = outcome.reason;
      const message = reason && reason.message ? reason.message : "fetchData() rejected unexpectedly.";
      seriesResults.push({ seriesId, ok: false, code: "API_UNAVAILABLE", message });
      warnings.push(`FRED series '${seriesId}' unavailable: ${message}`);
      return;
    }

    const result = outcome.value;

    if (result && result.ok) {
      // Preserved exactly as returned — no transformation, no
      // normalization, no field mapping. Empty data is success, not a
      // failure.
      const records = Array.isArray(result.data) ? result.data : [];
      macroData.push(...records);
      seriesResults.push({ seriesId, ok: true, recordCount: records.length });
      return;
    }

    // Failure: contributes zero records. The adapter's own code/message
    // are preserved verbatim, never reinterpreted into a different code.
    const code = result && result.code ? result.code : "API_UNAVAILABLE";
    const message = result && result.message ? result.message : "FRED series fetch failed.";
    seriesResults.push({ seriesId, ok: false, code, message });
    warnings.push(`FRED series '${seriesId}' unavailable: ${code}`);
  });

  return { macroData, seriesResults, warnings };
}

module.exports = { composeMacroData };
