// Minimal Portfolio Scenario Comparison CLI Caller — implements the
// design frozen in Step 88, mirroring runPortfolioIntelligence.js's
// established pattern exactly. A thin wrapper around the existing,
// unmodified comparePortfolioScenarios() — it adds no logic of its
// own beyond reconstructing a single JSON request argument from argv
// and printing the already-computed response verbatim. No new
// request schema, no new response contract, no reshaping, no
// business validation, no new scenario semantics.
//
// Unlike runPortfolioIntelligence.js (which reconstructs free-form
// natural-language text), this wrapper reconstructs a single JSON
// blob — Scenario Comparison's input is already fully structured, not
// prose, so the CLI argument IS the request, JSON-encoded.
//
// No try/catch around the comparison call itself:
// comparePortfolioScenarios() is synchronous and, by its own frozen
// contract, never throws — any malformed request (including a raw,
// unparsed string when JSON.parse fails) already resolves safely to
// its own BLOCKED safeFailureResponse(), since that function's first
// check rejects any non-object input. The one try/catch this file
// contains only guards the best-effort JSON.parse of the CLI
// argument — a parse failure there is expected, ordinary input shape,
// not a defect to propagate as an exception.

const { comparePortfolioScenarios } = require("./investment/portfolioScenarioComparison");

// Best-effort only — never validates or reshapes the result. A
// successful parse is forwarded exactly as parsed (object, array,
// string, number — whatever it is); a failed parse forwards the raw
// string unchanged. Either way, comparePortfolioScenarios()'s own
// existing, unmodified malformed-request handling (its `typeof
// request !== "object"` guard) is solely responsible for whatever
// happens next — no new business validation is added here.
function parseRequest(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// argv: the same array process.argv would provide (index 0/1 are the
// node binary and script path). Reassembles whatever the shell split
// on whitespace back into one string — the most literal, non-
// interpretive way to reconstruct what the user typed — then attempts
// to parse it as the structured Scenario Comparison request. Never
// alters, sanitizes, or enriches the input, and never mutates argv.
function runFromArgv(argv) {
  const text = argv.slice(2).join(" ");
  const request = parseRequest(text);
  return comparePortfolioScenarios(request);
}

module.exports = { runFromArgv };

if (require.main === module) {
  console.log(JSON.stringify(runFromArgv(process.argv), null, 2));
}
