// Portfolio Scenario Comparison — implements the contract frozen in
// Step 73. A pure, deterministic function that compares exactly two
// Portfolio Construction scenarios derived from ONE shared base
// investor profile. It duplicates NO allocation mathematics, NO
// extraction logic, and NO validation logic from any existing module
// — it only calls the existing, unmodified chain
// (extractInvestorProfile -> validateInvestorProfile ->
// constructPortfolio -> validatePortfolioConstructionResult) once per
// scenario and diffs the already-computed outputs.
//
// Deliberately independent of portfolioIntelligence.js (avoids
// coupling to its frozen 8-field contract) and of Market Intelligence
// (no provider, no network, no FX, no live data of any kind).
//
// v1 scope, frozen in Step 73, extended in Step 80/81:
//   - baseText is extracted/validated exactly ONCE; both scenarios
//     share that one result and only override specific fields.
//   - Overridable profile fields: riskTolerance, investmentObjective,
//     liquidityRequirement, maximumConcentration, assetClassRestrictions.
//     No other field may be overridden (investmentAmount,
//     investmentCurrency, and investmentHorizon are deliberately
//     excluded from v1 — see Step 73 §2).
//   - Forwarded construction options: eligibleAssetUniverse,
//     investmentVehicleRestrictions only. marketIntelligence is never
//     populated by this module.
//   - request.existingPortfolio (Step 80/81): an OPTIONAL, SHARED,
//     top-level field — the same value is supplied to BOTH scenarios'
//     constructPortfolio() calls, since it represents a fact about the
//     investor's current holdings, not a per-scenario choice. It is
//     deliberately NOT a constructionOptions key: a scenario's own
//     constructionOptions.existingPortfolio, if supplied, is silently
//     ignored (ALLOWED_CONSTRUCTION_OPTION_KEYS is unchanged). Each
//     scenario receives its own independent clone. All Step 75-79
//     existingPortfolio semantics (concentration-cap-only effect, no
//     implicit cap, no cap ever loosened, no FX, currency-matching
//     only, malformed-line safety) are entirely owned by the
//     unmodified constructPortfolio() and are not reimplemented here.
//   - Exactly two scenarios — no more, no fewer.

const { PROVENANCE_STATES } = require("./investorProfile");
const { extractInvestorProfile } = require("./investorProfileExtraction");
const { validateInvestorProfile } = require("./investorProfileValidation");
const { constructPortfolio, RESULT_STATUS, ASSET_CLASSES } = require("./portfolioConstruction");
const { validatePortfolioConstructionResult } = require("./portfolioConstructionValidation");

const UNKNOWN = "UNKNOWN";

const ALLOWED_PROFILE_OVERRIDE_KEYS = Object.freeze([
  "riskTolerance",
  "investmentObjective",
  "liquidityRequirement",
  "maximumConcentration",
  "assetClassRestrictions",
]);

const ALLOWED_CONSTRUCTION_OPTION_KEYS = Object.freeze(["eligibleAssetUniverse", "investmentVehicleRestrictions"]);

const FIXED_DISCLAIMER =
  "This reflects a difference in the deterministic allocation output only — it is not a prediction that one portfolio will perform better.";

// Worst-wins precedence over the existing RESULT_STATUS vocabulary —
// no new status is ever introduced.
const STATUS_SEVERITY = Object.freeze({
  [RESULT_STATUS.READY]: 0,
  [RESULT_STATUS.INCOMPLETE]: 1,
  [RESULT_STATUS.BLOCKED]: 2,
  [RESULT_STATUS.NEEDS_CLARIFICATION]: 3,
});

function concatArrays(...lists) {
  const merged = [];
  for (const list of lists) {
    if (Array.isArray(list)) merged.push(...list);
  }
  return merged;
}

function cloneAssetClassRestrictions(restrictions) {
  const r = restrictions && typeof restrictions === "object" ? restrictions : {};
  return {
    excluded: Array.isArray(r.excluded) ? [...r.excluded] : [],
    includedOnly: Array.isArray(r.includedOnly) ? [...r.includedOnly] : [],
    maximumByClass: r.maximumByClass && typeof r.maximumByClass === "object" ? { ...r.maximumByClass } : {},
  };
}

// Deep-clones only the fields this module ever reads or writes on a
// validated InvestorProfile — never mutates the shared base profile.
function cloneValidatedProfile(profile) {
  return {
    investmentAmount: { ...profile.investmentAmount },
    investmentCurrency: { ...profile.investmentCurrency },
    investmentHorizon: { ...profile.investmentHorizon },
    riskTolerance: { ...profile.riskTolerance },
    investmentObjective: { ...profile.investmentObjective },
    liquidityRequirement: { ...profile.liquidityRequirement },
    emergencyCashRequirement: { ...profile.emergencyCashRequirement },
    assetClassRestrictions: cloneAssetClassRestrictions(profile.assetClassRestrictions),
    maximumConcentration: { ...profile.maximumConcentration },
  };
}

// Applies ONLY the frozen, allowed override keys onto a clone of the
// shared base validated profile. Scalar overrides are represented in
// the exact {value, provenance, reason} shape validateInvestorProfile()
// already expects, with provenance forced to PROVENANCE_STATES.PROVIDED
// — never smuggling in a new field shape or a new provenance state.
// assetClassRestrictions is replaced wholesale, per the frozen design.
// Never mutates baseProfile or overrides.
function applyProfileOverrides(baseProfile, overrides) {
  const profile = cloneValidatedProfile(baseProfile);
  if (!overrides || typeof overrides !== "object") return profile;

  for (const key of ALLOWED_PROFILE_OVERRIDE_KEYS) {
    if (!(key in overrides)) continue;
    if (key === "assetClassRestrictions") {
      profile.assetClassRestrictions = cloneAssetClassRestrictions(overrides.assetClassRestrictions);
    } else {
      profile[key] = {
        value: overrides[key],
        provenance: PROVENANCE_STATES.PROVIDED,
        reason: "Scenario override supplied for comparison.",
      };
    }
  }
  return profile;
}

// Forwards ONLY the two frozen, allowed construction-option keys,
// verbatim, exactly as portfolioIntelligence.js already forwards
// options to constructPortfolio() unfiltered-but-for these keys. Never
// mutates the caller's constructionOptions object. A scenario's own
// constructionOptions.existingPortfolio, if supplied, is never
// forwarded — existingPortfolio has exactly one path in (the shared
// top-level request field), per the Step 80 frozen design.
function sanitizeConstructionOptions(constructionOptions) {
  const options = {};
  if (constructionOptions && typeof constructionOptions === "object") {
    for (const key of ALLOWED_CONSTRUCTION_OPTION_KEYS) {
      if (key in constructionOptions) options[key] = constructionOptions[key];
    }
  }
  return options;
}

// A shallow, one-level defensive clone of the shared
// request.existingPortfolio array (and each of its holding-line
// objects) — never the original reference. Non-array/undefined/null
// input passes through unchanged; constructPortfolio() itself already
// handles every malformed shape safely (Step 76), so no validation is
// duplicated here. Each call produces an independent clone, so
// scenario A's processing can never affect what scenario B observes,
// even though both originate from the same caller-supplied value.
function cloneExistingPortfolio(existingPortfolio) {
  if (!Array.isArray(existingPortfolio)) return existingPortfolio;
  return existingPortfolio.map((line) => (line && typeof line === "object" ? { ...line } : line));
}

// Mirrors portfolioIntelligence.js's own safety net: never let an
// internally-inconsistent construction result reach the caller.
function safeConstructionFallback() {
  return {
    status: RESULT_STATUS.BLOCKED,
    allocations: [],
    unallocatedPercentage: UNKNOWN,
    unallocatedAmount: UNKNOWN,
    currency: UNKNOWN,
    constraintsApplied: [],
    assumptions: [],
    unknowns: [],
    warnings: ["Portfolio Construction produced an internally inconsistent result and was suppressed for safety."],
    conflicts: [],
  };
}

// Runs ONE scenario through the existing, unmodified validation and
// construction layers. Never reimplements allocation mathematics and
// never bypasses either layer. sharedExistingPortfolio: the caller's
// request.existingPortfolio, forwarded identically (via an independent
// clone) to every scenario — see Step 80/81 header notes.
function processScenario(baseValidatedProfile, scenarioInput, sharedExistingPortfolio) {
  const scenario = scenarioInput && typeof scenarioInput === "object" ? scenarioInput : {};
  const overriddenProfile = applyProfileOverrides(baseValidatedProfile, scenario.profileOverrides);
  const validation = validateInvestorProfile(overriddenProfile);
  const constructionOptions = sanitizeConstructionOptions(scenario.constructionOptions);
  constructionOptions.existingPortfolio = cloneExistingPortfolio(sharedExistingPortfolio);
  const rawConstruction = constructPortfolio(validation, constructionOptions);

  const constructionCheck = validatePortfolioConstructionResult(rawConstruction, {
    investmentAmount: typeof validation.profile.investmentAmount.value === "number" ? validation.profile.investmentAmount.value : undefined,
  });
  const construction = constructionCheck.valid ? rawConstruction : safeConstructionFallback();

  return { validation, construction };
}

function scenarioLabel(scenarioInput, fallback) {
  return scenarioInput && typeof scenarioInput.label === "string" && scenarioInput.label.trim() !== "" ? scenarioInput.label : fallback;
}

function buildScenarioResult(label, validation, construction) {
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
    label,
    status: construction.status,
    portfolio,
    unknowns: construction.unknowns,
    assumptions: construction.assumptions,
    warnings: concatArrays(validation.warnings, construction.warnings),
    contradictions: concatArrays(validation.contradictions, construction.conflicts),
  };
}

function combineStatus(statusA, statusB) {
  return STATUS_SEVERITY[statusA] >= STATUS_SEVERITY[statusB] ? statusA : statusB;
}

function buildAllocationDifferences(portfolioA, portfolioB, amountsComparable) {
  const mapA = new Map(portfolioA.allocations.map((a) => [a.assetClass, a]));
  const mapB = new Map(portfolioB.allocations.map((a) => [a.assetClass, a]));
  const classes = ASSET_CLASSES.filter((c) => mapA.has(c) || mapB.has(c));

  return classes.map((assetClass) => {
    const allocA = mapA.get(assetClass);
    const allocB = mapB.get(assetClass);
    const percentageA = allocA ? allocA.percentage : 0;
    const percentageB = allocB ? allocB.percentage : 0;
    const amountA = amountsComparable ? (allocA ? allocA.amount : 0) : UNKNOWN;
    const amountB = amountsComparable ? (allocB ? allocB.amount : 0) : UNKNOWN;

    return {
      assetClass,
      percentageA,
      percentageB,
      percentagePointDelta: percentageB - percentageA,
      amountA,
      amountB,
      amountDelta: amountsComparable ? amountB - amountA : UNKNOWN,
    };
  });
}

function buildUnallocatedDifference(portfolioA, portfolioB, amountsComparable) {
  const percentageA = portfolioA.unallocatedPercentage;
  const percentageB = portfolioB.unallocatedPercentage;
  const amountA = amountsComparable ? portfolioA.unallocatedAmount : UNKNOWN;
  const amountB = amountsComparable ? portfolioB.unallocatedAmount : UNKNOWN;

  return {
    percentageA,
    percentageB,
    percentagePointDelta: percentageB - percentageA,
    amountA,
    amountB,
    amountDelta: amountsComparable ? amountB - amountA : UNKNOWN,
  };
}

function safeFailureResponse(note) {
  return {
    status: RESULT_STATUS.BLOCKED,
    baseProfile: { missingInformation: [], ambiguities: [], contradictions: [] },
    scenarios: [],
    allocationDifferences: null,
    unallocatedDifference: null,
    currencyMismatch: UNKNOWN,
    notes: [note],
  };
}

// request: { baseText: string, existingPortfolio?: Array, scenarios:
// [scenarioA, scenarioB] }. scenarios must contain EXACTLY two entries
// — the frozen v1 scope. existingPortfolio, when supplied, is shared
// identically by both scenarios (Step 80/81) — a malformed or
// otherwise unusable existingPortfolio is never validated here; it is
// forwarded as-is (via an independent clone per scenario) and handled
// entirely by constructPortfolio()'s own existing, unmodified safety
// rules. Never mutates request, request.scenarios, request.
// existingPortfolio, or any nested override/options/holding object.
// Never reimplements extraction, validation, or allocation
// mathematics — every number in the output traces back to an
// unmodified call into an existing pure function.
function comparePortfolioScenarios(request) {
  if (
    !request ||
    typeof request !== "object" ||
    typeof request.baseText !== "string" ||
    !Array.isArray(request.scenarios) ||
    request.scenarios.length !== 2
  ) {
    return safeFailureResponse(
      "A request shaped as { baseText: string, scenarios: [scenarioA, scenarioB] } with exactly two scenarios is required."
    );
  }

  const extraction = extractInvestorProfile(request.baseText);
  const baseValidation = validateInvestorProfile(extraction.profile);

  const [scenarioAInput, scenarioBInput] = request.scenarios;
  const labelA = scenarioLabel(scenarioAInput, "A");
  const labelB = scenarioLabel(scenarioBInput, "B");

  const scenarioA = processScenario(baseValidation.profile, scenarioAInput, request.existingPortfolio);
  const scenarioB = processScenario(baseValidation.profile, scenarioBInput, request.existingPortfolio);

  const scenarioResultA = buildScenarioResult(labelA, scenarioA.validation, scenarioA.construction);
  const scenarioResultB = buildScenarioResult(labelB, scenarioB.validation, scenarioB.construction);

  const status = combineStatus(scenarioResultA.status, scenarioResultB.status);

  const notes = [];
  if (scenarioResultA.status !== scenarioResultB.status) {
    notes.push(`Scenario "${labelA}" resolved to ${scenarioResultA.status} while scenario "${labelB}" resolved to ${scenarioResultB.status}.`);
  }

  const bothHavePortfolios = scenarioResultA.portfolio !== null && scenarioResultB.portfolio !== null;

  let allocationDifferences = null;
  let unallocatedDifference = null;
  let currencyMismatch = UNKNOWN;

  if (!bothHavePortfolios) {
    notes.push("A percentage/amount comparison is not available because at least one scenario did not produce a portfolio.");
  } else {
    const currencyA = scenarioResultA.portfolio.currency;
    const currencyB = scenarioResultB.portfolio.currency;
    const currencyAKnown = currencyA !== UNKNOWN;
    const currencyBKnown = currencyB !== UNKNOWN;

    let amountsComparable;
    if (currencyAKnown && currencyBKnown && currencyA === currencyB) {
      currencyMismatch = false;
      amountsComparable = true;
    } else if (currencyAKnown && currencyBKnown) {
      currencyMismatch = true;
      amountsComparable = false;
      notes.push(
        `Scenario "${labelA}" is denominated in ${currencyA} and scenario "${labelB}" is denominated in ${currencyB}; no FX conversion is performed, so amount deltas are not computed across currencies.`
      );
    } else {
      currencyMismatch = UNKNOWN;
      amountsComparable = false;
      notes.push("At least one scenario's investment currency is unknown; amount deltas could not be computed (percentage deltas were still computed).");
    }

    allocationDifferences = buildAllocationDifferences(scenarioResultA.portfolio, scenarioResultB.portfolio, amountsComparable);
    unallocatedDifference = buildUnallocatedDifference(scenarioResultA.portfolio, scenarioResultB.portfolio, amountsComparable);
    notes.push(FIXED_DISCLAIMER);
  }

  return {
    status,
    baseProfile: {
      missingInformation: baseValidation.missingRequiredFields,
      ambiguities: extraction.ambiguities,
      contradictions: concatArrays(extraction.contradictions, baseValidation.contradictions),
    },
    scenarios: [scenarioResultA, scenarioResultB],
    allocationDifferences,
    unallocatedDifference,
    currencyMismatch,
    notes,
  };
}

module.exports = { comparePortfolioScenarios };
