// Portfolio Intelligence Entrypoint — implements the design frozen in
// Step 62. The smallest possible orchestration boundary over the
// existing, unmodified chain:
//
//   extractInvestorProfile(text)
//     -> validateInvestorProfile(profile)
//       -> constructPortfolio(validationResult, options)
//         -> validatePortfolioConstructionResult(result)
//
// This file duplicates NO logic from any of the four functions above
// — it only calls them, in order, and reshapes their already-computed
// outputs into one caller-facing response. It never calls a provider,
// never calls Market Intelligence, never performs FX conversion, and
// never introduces conversational/multi-turn state.
//
// Lives at the project root, a sibling to app.js/runIntelligence.js —
// not inside investment/ (reserved for pure domain modules) or
// providers/ — mirroring how app.js sits outside providers/ despite
// orchestrating provider code (Step 62 §1).

const { extractInvestorProfile } = require("./investment/investorProfileExtraction");
const { validateInvestorProfile } = require("./investment/investorProfileValidation");
const { constructPortfolio, RESULT_STATUS } = require("./investment/portfolioConstruction");
const { validatePortfolioConstructionResult } = require("./investment/portfolioConstructionValidation");

function concatArrays(...lists) {
  const merged = [];
  for (const list of lists) {
    if (Array.isArray(list)) merged.push(...list);
  }
  return merged;
}

// Used only when the final safety-net check
// (validatePortfolioConstructionResult) unexpectedly reports an
// invalid result — should never happen if every layer is correct, but
// the caller must never see a broken portfolio, a stack trace, or any
// internal detail if it somehow does. Reuses the existing BLOCKED
// shape rather than inventing a new status or error framework.
function safeFailureResponse() {
  return {
    status: RESULT_STATUS.BLOCKED,
    portfolio: null,
    missingInformation: [],
    unknowns: [],
    ambiguities: [],
    contradictions: [],
    assumptions: [],
    warnings: ["Portfolio Construction produced an internally inconsistent result and was suppressed for safety."],
  };
}

// request: { text, options? }. text is the ONLY raw natural-language
// input anywhere in this function — it is passed straight into
// extractInvestorProfile() unchanged; malformed/missing text is never
// special-cased here because extractInvestorProfile() already
// degrades safely for non-string/empty input (Step 55), which then
// flows through the existing status machinery as
// missing-required-information, not a separate error path.
// options, when present, are forwarded to constructPortfolio()
// unchanged — never filtered, never defaulted, never used to
// automatically populate marketIntelligence/existingPortfolio (this
// function never touches those keys itself at all).
// Never mutates request or options — nothing here assigns into either;
// every downstream function it calls is already independently proven
// non-mutating (Steps 55/57/58/60), so no defensive copy is needed.
function runPortfolioIntelligenceRequest(request) {
  const text = request && typeof request.text === "string" ? request.text : undefined;
  const options = (request && request.options) || {};

  const extraction = extractInvestorProfile(text);
  const validation = validateInvestorProfile(extraction.profile);
  const construction = constructPortfolio(validation, options);

  const constructionCheck = validatePortfolioConstructionResult(construction, {
    investmentAmount: typeof validation.profile.investmentAmount.value === "number" ? validation.profile.investmentAmount.value : undefined,
  });
  if (!constructionCheck.valid) {
    return safeFailureResponse();
  }

  const portfolio =
    construction.status === RESULT_STATUS.READY || construction.status === RESULT_STATUS.INCOMPLETE
      ? {
          allocations: construction.allocations,
          unallocatedPercentage: construction.unallocatedPercentage,
          unallocatedAmount: construction.unallocatedAmount,
          currency: construction.currency,
          constraintsApplied: construction.constraintsApplied,
        }
      : null;

  return {
    status: construction.status,
    portfolio,
    missingInformation: validation.missingRequiredFields,
    unknowns: construction.unknowns,
    ambiguities: extraction.ambiguities,
    contradictions: concatArrays(extraction.contradictions, validation.contradictions, construction.conflicts),
    assumptions: construction.assumptions,
    warnings: concatArrays(validation.warnings, construction.warnings),
  };
}

module.exports = { runPortfolioIntelligenceRequest };
