// Minimal User-Facing Intelligence Runner — Step 37. The smallest
// possible manual entry point on top of the existing app.js. It adds
// no new intelligence logic of its own: it calls the existing
// runApplicationRequest() with FRED enabled and formats the existing
// pipelineResult into a concise, human-readable summary. No new
// request schema, no new pipeline/response contract — pipelineResult
// and fredDiagnostics are returned exactly as app.js already produces
// them; summarize() only reads fields the pipeline already produces.

const { runApplicationRequest } = require("./app");

// query/asset: the two fields a manual caller actually needs.
// options: forwarded to runApplicationRequest() unchanged (e.g.
//   adapterConfig for offline test injection, exactly mirroring every
//   other layer in this project) — macro.enabled is always true here,
//   as required; a caller-supplied options.macro is spread on top so
//   things like seriesIds can still be overridden without re-enabling
//   a second FRED configuration layer.
async function runIntelligence({ query, asset } = {}, options = {}) {
  const request = { query, asset };
  return runApplicationRequest(request, { ...options, macro: { ...(options.macro || {}), enabled: true } });
}

// Builds a concise, human-readable object from an existing
// pipelineResult/fredDiagnostics pair. Reads only fields the pipeline
// already produces — never invents one.
function summarize({ pipelineResult, fredDiagnostics }) {
  const summary = pipelineResult.pipeline_summary || {};
  return {
    asset: pipelineResult.asset,
    ok: pipelineResult.ok,
    macro_status: summary.macro_status,
    news_status: summary.news_status,
    technical_status: summary.technical_status,
    sentiment_status: summary.sentiment_status,
    trade_setup_status: summary.trade_setup_status,
    risk_decision: summary.risk_decision,
    final_assessment: summary.final_assessment,
    decision_status: summary.decision_status,
    fred_status: fredDiagnostics ? "ENABLED" : "DISABLED",
    warnings: pipelineResult.warnings,
    errors: pipelineResult.errors,
  };
}

module.exports = { runIntelligence, summarize };

// Manual run: `node runIntelligence.js "<query>" "<asset>"`. Plain
// process.argv — no CLI framework, matching the "smallest possible
// runner" requirement.
if (require.main === module) {
  const [, , query, asset] = process.argv;
  runIntelligence({ query, asset })
    .then((result) => {
      console.log(JSON.stringify(summarize(result), null, 2));
    })
    .catch((err) => {
      console.error("Runner failed:", err.message);
      process.exitCode = 1;
    });
}
