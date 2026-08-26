// Minimal Portfolio Intelligence CLI Caller — implements the design
// frozen in Step 68, extended in Step 84/85 with one optional flag. A
// thin wrapper around the existing, unmodified
// runPortfolioIntelligenceRequest() — it adds no logic of its own
// beyond reconstructing the free-text field from argv, optionally
// lifting out one --existing-portfolio value, and printing the
// already-computed response verbatim. No new response contract, no
// reshaping, no validation, no math.
//
// Deliberately does NOT mirror runIntelligence.js's summarize() step:
// that function exists to curate Market Intelligence's large, deeply
// nested pipeline report for the console. Portfolio Intelligence's
// response is already a small, exactly-8-field object by design
// (Steps 62-64) — there is no bloat left to trim, and adding a second
// reshaping layer here would itself be the "reinterpretation" this
// step's own design explicitly forbids.
//
// No try/catch around the request call itself:
// runPortfolioIntelligenceRequest() is synchronous and, by its own
// frozen contract, never throws — every input, however malformed,
// resolves to one of its four safe statuses. The one try/catch this
// file does contain (below) only guards a best-effort JSON.parse of a
// single CLI argument — a parse failure there is expected, ordinary
// input shape, not a defect to propagate as an exception.

const { runPortfolioIntelligenceRequest } = require("./portfolioIntelligence");

const EXISTING_PORTFOLIO_FLAG = "--existing-portfolio";

// tokens: the free-text portion of argv (already past the node binary
// and script path). Finds the FIRST occurrence of the flag only; a
// later literal occurrence of the same string is never re-parsed and
// passes through as ordinary text. If the flag is absent, or is the
// very last token (no value to pair with it), it is treated as fully
// absent — the tokens are returned completely unchanged (the literal
// flag text, if present as a final dangling token, is left in place
// exactly like any other word) and no value is extracted. Otherwise
// the flag and its one following token are both removed and that
// token's raw string is returned. Never mutates the input array.
function extractExistingPortfolioToken(tokens) {
  const flagIndex = tokens.indexOf(EXISTING_PORTFOLIO_FLAG);
  if (flagIndex === -1 || flagIndex === tokens.length - 1) {
    return { tokens, rawValue: undefined };
  }
  const rawValue = tokens[flagIndex + 1];
  const remaining = [...tokens.slice(0, flagIndex), ...tokens.slice(flagIndex + 2)];
  return { tokens: remaining, rawValue };
}

// Best-effort only — never validates or reshapes the result. A
// successful parse is forwarded exactly as parsed (array, object,
// string, number — whatever it is); a failed parse forwards the raw
// string unchanged. Either way, constructPortfolio()'s own existing,
// unmodified malformed-existingPortfolio handling (Steps 75-79) is
// solely responsible for whatever happens next.
function parseExistingPortfolioValue(rawValue) {
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

// argv: the same array process.argv would provide (index 0/1 are the
// node binary and script path). Reassembles whatever the shell split
// on whitespace back into one string — the most literal, non-
// interpretive way to reconstruct what the user typed — after lifting
// out at most one --existing-portfolio value. Never alters, sanitizes,
// or enriches the free text itself, and never mutates argv.
function runFromArgv(argv) {
  const { tokens, rawValue } = extractExistingPortfolioToken(argv.slice(2));
  const text = tokens.join(" ");
  if (rawValue === undefined) {
    return runPortfolioIntelligenceRequest({ text });
  }
  return runPortfolioIntelligenceRequest({ text, options: { existingPortfolio: parseExistingPortfolioValue(rawValue) } });
}

module.exports = { runFromArgv };

if (require.main === module) {
  console.log(JSON.stringify(runFromArgv(process.argv), null, 2));
}
