// Portfolio Construction — implements the contract frozen in Step 56.
// A pure, deterministic function: (validationResult, options) ->
// PortfolioConstructionResult. Consumes ONLY the existing, unmodified
// validateInvestorProfile() result — never raw text, never raw
// extraction output. Never calls a provider, never selects individual
// securities/tickers, never fabricates market data. No Date.now(),
// Math.random(), network access, or hidden state anywhere.
//
// WEIGHTING-BANDS DESIGN DECISION (Step 57, made against the frozen
// Step 56 architecture only):
//
// Step 56 deliberately deferred exact numeric weighting to this step,
// warning explicitly against false precision (e.g. "CONSERVATIVE =
// 70% bonds" presented as if empirically derived) and against letting
// objective alone determine an allocation (e.g. "SPECULATION = 100%
// crypto"). The v1 decision here is:
//
//   1. Three simple, round-number BASE ARCHETYPES (5%-increment
//      weights across all 8 frozen asset classes), one per
//      riskTolerance value. These are presented — in every reason
//      string that cites them — as "a simple reference starting
//      point, not empirically optimized and not investment advice",
//      exactly mirroring the disclaimer language this project already
//      uses for FRED/Alpha Vantage's own "commonly used convention"
//      framings (e.g. Step 51's horizon-band thresholds).
//   2. Small, fixed, CAPPED nudges (never exceeding 10 percentage
//      points moved in total) applied on top of the base archetype for
//      horizon and, separately, for objective — chosen so no single
//      qualitative signal can dominate the outcome by itself. Horizon
//      and risk tolerance together form ONE combined bias (Step 56's
//      explicit "no double weighting" rule): the archetype is already
//      keyed by risk tolerance, and horizon only ever nudges it,
//      never re-derives it from scratch.
//   3. Liquidity applies its own small, separately-capped nudge after
//      objective, per the frozen precedence (tier 5, after risk/
//      objective at tier 4).
//   4. Hard constraints (exclusions, included-only, concentration
//      caps — tiers 1-3) are applied LAST, as a clamp over whatever
//      the soft-preference weights above produced, with any capacity
//      freed by clamping proportionally redistributed among the
//      remaining eligible, non-capped classes. Applying hard
//      constraints as a final clamp is mathematically equivalent to
//      giving them top precedence: the result always obeys them
//      exactly regardless of what the softer signals wanted — the
//      soft signals only ever shape the outcome *within* whatever room
//      the hard constraints leave. If clamping still leaves capacity
//      with nowhere eligible left to go, that capacity is disclosed as
//      unallocatedPercentage/unallocatedAmount (a controlled, always-
//      explained outcome — never silently dropped, never a
//      NEEDS_CLARIFICATION unless the eligible universe itself is
//      empty; see below).
//   5. Diversification (tier 6, the softest factor) is satisfied
//      implicitly by the proportional-redistribution rule itself,
//      which naturally spreads freed capacity across every remaining
//      eligible class rather than dumping it into one — no separate
//      explicit diversification formula is added, per Step 56's own
//      "avoid arbitrary diversification formulas" instruction.
//
// This is a reasoned, disclosed v1 decision — not claimed to be
// empirically optimal, not investment advice, and explicitly revisable.

const { PROVENANCE_STATES } = require("./investorProfile");
const { VALIDATION_STATUS } = require("./investorProfileValidation");

const ASSET_CLASSES = Object.freeze(["EQUITIES", "BONDS", "CASH", "COMMODITIES", "GOLD", "CRYPTO", "FX", "ALTERNATIVES"]);
const INVESTMENT_VEHICLES = Object.freeze(["INDIVIDUAL_SECURITY", "ETF", "MUTUAL_FUND"]);

const RESULT_STATUS = Object.freeze({
  READY: "READY",
  INCOMPLETE: "INCOMPLETE",
  BLOCKED: "BLOCKED",
  NEEDS_CLARIFICATION: "NEEDS_CLARIFICATION",
});

const UNKNOWN = "UNKNOWN";

// ---- Base archetypes (v1 disclosed design decision, see header) ----
const BASE_ARCHETYPES = Object.freeze({
  CONSERVATIVE: { CASH: 0.15, BONDS: 0.55, EQUITIES: 0.2, GOLD: 0.05, COMMODITIES: 0, CRYPTO: 0, FX: 0, ALTERNATIVES: 0.05 },
  MODERATE: { CASH: 0.1, BONDS: 0.35, EQUITIES: 0.4, GOLD: 0.05, COMMODITIES: 0.05, CRYPTO: 0, FX: 0, ALTERNATIVES: 0.05 },
  AGGRESSIVE: { CASH: 0.05, BONDS: 0.1, EQUITIES: 0.55, GOLD: 0.05, COMMODITIES: 0.05, CRYPTO: 0.15, FX: 0, ALTERNATIVES: 0.05 },
});

const DEFENSIVE_CLASSES = Object.freeze(["CASH", "BONDS"]);
const GROWTH_CLASSES = Object.freeze(["EQUITIES", "CRYPTO"]);

function cloneWeights(weights) {
  return { ...weights };
}

// Moves `points` (a fraction, e.g. 0.10) proportionally FROM the
// `fromClasses` group INTO the `toClasses` group, never pushing a
// weight below 0. Deterministic, no rounding beyond float arithmetic.
function shiftWeight(weights, fromClasses, toClasses, points) {
  const result = cloneWeights(weights);
  const fromTotal = fromClasses.reduce((sum, c) => sum + result[c], 0);
  if (fromTotal <= 0) return result;
  const actualShift = Math.min(points, fromTotal);
  for (const c of fromClasses) {
    result[c] -= actualShift * (result[c] / fromTotal);
  }
  const toTotal = toClasses.reduce((sum, c) => sum + weights[c], 0);
  for (const c of toClasses) {
    // If the target group starts at zero weight, split the shift evenly.
    const share = toTotal > 0 ? weights[c] / toTotal : 1 / toClasses.length;
    result[c] += actualShift * share;
  }
  return result;
}

function applyHorizonNudge(weights, horizonField) {
  if (horizonField.band === "SHORT_TERM") return shiftWeight(weights, GROWTH_CLASSES, DEFENSIVE_CLASSES, 0.1);
  if (horizonField.band === "LONG_TERM") return shiftWeight(weights, DEFENSIVE_CLASSES, GROWTH_CLASSES, 0.1);
  return cloneWeights(weights);
}

function applyObjectiveNudge(weights, objectiveField) {
  switch (objectiveField.value) {
    case "CAPITAL_PRESERVATION":
      return shiftWeight(weights, GROWTH_CLASSES, DEFENSIVE_CLASSES, 0.1);
    case "INCOME":
      return shiftWeight(weights, ["EQUITIES"], ["BONDS"], 0.1);
    case "CAPITAL_GROWTH":
      return shiftWeight(weights, DEFENSIVE_CLASSES, ["EQUITIES"], 0.05);
    case "SPECULATION":
      // Deliberately small — Step 56 explicitly forbids objective
      // alone determining the allocation (never "100% crypto").
      return shiftWeight(weights, DEFENSIVE_CLASSES, ["CRYPTO"], 0.05);
    default:
      return cloneWeights(weights);
  }
}

function applyLiquidityNudge(weights, liquidityField) {
  if (liquidityField.value === "IMMEDIATE") return shiftWeight(weights, ["CRYPTO", "ALTERNATIVES", "COMMODITIES"], ["CASH"], 0.1);
  if (liquidityField.value === "SHORT_TERM") return shiftWeight(weights, ["CRYPTO", "ALTERNATIVES", "COMMODITIES"], ["CASH"], 0.05);
  return cloneWeights(weights);
}

// Effective eligible universe from hard restrictions: includedOnly (if
// non-empty) narrows the universe; excluded always removes. Returns
// null if the resulting universe is empty (a genuine impossibility).
function effectiveUniverse(assetClassRestrictions) {
  const included =
    Array.isArray(assetClassRestrictions.includedOnly) && assetClassRestrictions.includedOnly.length > 0
      ? assetClassRestrictions.includedOnly
      : ASSET_CLASSES;
  const excluded = new Set(Array.isArray(assetClassRestrictions.excluded) ? assetClassRestrictions.excluded : []);
  const universe = ASSET_CLASSES.filter((c) => included.includes(c) && !excluded.has(c));
  return universe.length > 0 ? universe : null;
}

// Aggregates a raw options.existingPortfolio array into a per-class
// market-value basis, implementing the contract frozen in Step 75. A
// line is structurally valid only when it has a recognized assetClass
// and a finite, non-negative marketValue; any other field (including a
// ticker/symbol/isin/cusip/investmentVehicle) is never read. A line's
// currency must match currencyValue exactly to participate — no FX
// conversion is ever performed, and a missing/UNKNOWN/mismatched
// currency excludes ONLY that line, never the whole array. Never
// mutates existingPortfolio or its lines.
function aggregateExistingPortfolio(existingPortfolio, currencyValue) {
  const byClass = {};
  let total = 0;
  let invalidLineCount = 0;
  let currencyMismatchCount = 0;
  let matchedCount = 0;

  for (const line of existingPortfolio) {
    const isStructurallyValid =
      line &&
      typeof line === "object" &&
      typeof line.assetClass === "string" &&
      ASSET_CLASSES.includes(line.assetClass) &&
      typeof line.marketValue === "number" &&
      Number.isFinite(line.marketValue) &&
      line.marketValue >= 0;

    if (!isStructurallyValid) {
      invalidLineCount += 1;
      continue;
    }

    const lineCurrency = typeof line.currency === "string" ? line.currency : UNKNOWN;
    if (lineCurrency !== currencyValue) {
      currencyMismatchCount += 1;
      continue;
    }

    matchedCount += 1;
    byClass[line.assetClass] = (byClass[line.assetClass] || 0) + line.marketValue;
    total += line.marketValue;
  }

  return { byClass, total, invalidLineCount, currencyMismatchCount, matchedCount };
}

// Clamps weights to the eligible universe and to any concentration
// caps, redistributing freed capacity proportionally among the
// remaining uncapped eligible classes. One redistribution pass plus
// one re-cap pass — bounded and deterministic, never an unbounded
// loop. Any leftover after that becomes disclosed unallocated weight.
// existingPortfolioBasis: null (no effect — today's exact behavior) or
// { byClass, total } from aggregateExistingPortfolio(), in the same
// currency as investmentAmountValue. When present, an EXPLICIT cap
// (class-level or portfolio-wide — never a cap this function invents)
// is enforced against the COMBINED (existing + new) exposure for that
// class, and the new-money weight is clamped to whatever headroom
// remains — reusing this exact redistribution mechanism, never a
// separate rebalancing algorithm, per the contract frozen in Step 75.
function applyHardConstraints(weights, universe, assetClassRestrictions, maximumConcentrationField, existingPortfolioBasis, investmentAmountValue) {
  const combinedCapNotes = [];

  const capFor = (cls) => {
    const classCap = assetClassRestrictions.maximumByClass && assetClassRestrictions.maximumByClass[cls];
    const portfolioCap = maximumConcentrationField.provenance === PROVENANCE_STATES.PROVIDED ? maximumConcentrationField.value : null;
    const caps = [classCap, portfolioCap].filter((v) => typeof v === "number");
    return caps.length > 0 ? Math.min(...caps) : null;
  };

  // Converts a flat fractional cap into the maximum NEW-MONEY weight
  // that keeps existing-plus-new exposure for `cls` within that cap.
  // Returns the flat cap unchanged whenever no existing-portfolio
  // basis is available or the class has no existing exposure — an
  // existingPortfolio can only ever TIGHTEN an ALREADY-explicit cap,
  // never create one (Step 75 §6: no implicit caps) and never loosen
  // one beyond its stated flat value. Without the final Math.min, a
  // large existing holding in an unrelated class (even one excluded
  // from new money entirely) can inflate combinedTotal enough to make
  // the raw quotient exceed flatCap — silently permitting a new-money
  // weight the investor's own explicit cap forbids (Step 77 audit
  // finding). The Math.min is the sole fix: it cannot change any
  // already-tightening case, since there maxNewWeight < flatCap already.
  const effectiveCapFor = (cls, flatCap) => {
    if (flatCap === null || !existingPortfolioBasis || !(investmentAmountValue > 0)) return flatCap;
    const existingInClass = existingPortfolioBasis.byClass[cls] || 0;
    if (existingInClass <= 0) return flatCap;
    const combinedTotal = existingPortfolioBasis.total + investmentAmountValue;
    if (!(combinedTotal > 0)) return flatCap;
    const maxNewWeight = Math.min(flatCap, Math.max(0, (flatCap * combinedTotal - existingInClass) / investmentAmountValue));
    if (maxNewWeight < flatCap) {
      combinedCapNotes.push(
        `${cls} concentration cap of ${(flatCap * 100).toFixed(2)}% is enforced against the combined portfolio (including existing ${cls} holdings), reducing the maximum new-money allocation for ${cls} to ${(maxNewWeight * 100).toFixed(2)}%.`
      );
    }
    return maxNewWeight;
  };

  let baseline = {};
  for (const c of ASSET_CLASSES) baseline[c] = universe.includes(c) ? weights[c] : 0;

  // Weight belonging to classes outside the eligible universe is not
  // discarded — it is freed capacity, exactly like weight trimmed by a
  // concentration cap, and must be redistributed the same way.
  const excludedMass = ASSET_CLASSES.reduce((sum, c) => sum + (universe.includes(c) ? 0 : weights[c]), 0);

  const capAndCollectFreed = (input) => {
    let freed = 0;
    const output = { ...input };
    const uncapped = [];
    for (const c of universe) {
      const cap = effectiveCapFor(c, capFor(c));
      if (cap !== null && output[c] > cap) {
        freed += output[c] - cap;
        output[c] = cap;
      } else if (cap === null || output[c] < cap) {
        uncapped.push(c);
      }
    }
    return { output, freed, uncapped };
  };

  const pass0 = capAndCollectFreed(baseline);
  const freedTotal = pass0.freed + excludedMass;
  const output1 = { ...pass0.output };
  if (freedTotal > 0 && pass0.uncapped.length > 0) {
    const uncappedTotal = pass0.uncapped.reduce((sum, c) => sum + output1[c], 0);
    for (const c of pass0.uncapped) {
      const share = uncappedTotal > 0 ? output1[c] / uncappedTotal : 1 / pass0.uncapped.length;
      output1[c] += freedTotal * share;
    }
  }

  const pass2 = capAndCollectFreed(output1);
  const unallocated = freedTotal > 0 && pass0.uncapped.length === 0 ? freedTotal : pass2.freed;

  // capAndCollectFreed runs twice (pass0, pass2); effectiveCapFor is
  // deterministic per class, so a class that triggers the note in both
  // passes would otherwise report it twice — de-duplicated here rather
  // than tracked with extra state inside the pure per-class function.
  const dedupedCombinedCapNotes = [...new Set(combinedCapNotes)];

  return { weights: pass2.output, unallocatedFromCaps: unallocated, combinedCapNotes: dedupedCombinedCapNotes };
}

function reasonForAllocation(assetClass, riskField, horizonField, objectiveField, liquidityField) {
  const parts = [`based on a ${riskField.value} risk tolerance`];
  if (horizonField.band !== UNKNOWN) parts.push(`a ${horizonField.band} horizon`);
  if (objectiveField.provenance === PROVENANCE_STATES.PROVIDED || objectiveField.provenance === PROVENANCE_STATES.INFERRED) {
    parts.push(`an investment objective of ${objectiveField.value}`);
  }
  if (liquidityField.value !== UNKNOWN) parts.push(`a ${liquidityField.value} liquidity requirement`);
  return `Allocation to ${assetClass} ${parts.join(", ")}. This is a simple reference starting point, not empirically optimized and not investment advice.`;
}

function emptyResult(status, extra = {}) {
  return {
    status,
    allocations: [],
    unallocatedPercentage: UNKNOWN,
    unallocatedAmount: UNKNOWN,
    currency: UNKNOWN,
    constraintsApplied: [],
    assumptions: [],
    unknowns: [],
    warnings: [],
    conflicts: [],
    ...extra,
  };
}

// validationResult: the full, unmodified output of validateInvestorProfile().
// options.eligibleAssetUniverse: optional array of asset-class strings
//   known to be available; if omitted, all 8 frozen classes are
//   treated as hypothetically eligible (disclosed as an assumption).
// options.investmentVehicleRestrictions: optional {excluded,
//   includedOnly} from extraction — honored as a hard vehicle-label
//   constraint, never smuggled into the InvestorProfile schema.
// options.marketIntelligence: accepted but deliberately unused in v1
//   (deferred, per Step 56).
// options.existingPortfolio: optional Array<{assetClass, marketValue,
//   currency}> (Step 75/76). Informs concentration-cap enforcement
//   ONLY (maximumConcentration / assetClassRestrictions.maximumByClass)
//   against the combined existing+new exposure for a class that
//   already has an explicit cap — it never creates a cap by itself,
//   never alters base/horizon/objective/liquidity weighting, never
//   affects eligibleAssetUniverse or excluded/includedOnly
//   restrictions, and never performs FX conversion (only lines whose
//   currency matches investmentCurrency participate). No ticker/
//   symbol/isin/cusip/investmentVehicle field is ever read.
// Never mutates validationResult or options.
function constructPortfolio(validationResult, options = {}) {
  const assumptions = [];
  const warnings = [];
  const unknowns = [];
  const constraintsApplied = [];

  if (!validationResult || typeof validationResult !== "object") {
    return emptyResult(RESULT_STATUS.BLOCKED, { warnings: ["A validated investor profile result is required."] });
  }

  if (validationResult.status === VALIDATION_STATUS.INSUFFICIENT_INFORMATION) {
    return emptyResult(RESULT_STATUS.BLOCKED, {
      warnings: [`Cannot construct a portfolio: the investor profile is missing required information (${validationResult.missingRequiredFields.join(", ") || "see invalidFields"}).`],
    });
  }
  if (validationResult.status === VALIDATION_STATUS.NEEDS_CLARIFICATION) {
    return emptyResult(RESULT_STATUS.NEEDS_CLARIFICATION, {
      conflicts: validationResult.contradictions.map((c) => ({ fields: c.fields, reason: c.reason })),
      warnings: ["Cannot construct a portfolio: the investor profile contains unresolved contradictions."],
    });
  }
  if (validationResult.status !== VALIDATION_STATUS.VALID && validationResult.status !== VALIDATION_STATUS.INCOMPLETE) {
    return emptyResult(RESULT_STATUS.BLOCKED, { warnings: [`Unrecognized investor profile validation status: ${validationResult.status}.`] });
  }

  const profile = validationResult.profile;
  const { investmentAmount, investmentCurrency, investmentHorizon, riskTolerance, investmentObjective, liquidityRequirement, emergencyCashRequirement, assetClassRestrictions, maximumConcentration } = profile;

  // Ambiguous/contradictory restriction inputs are never silently
  // resolved: if a class is both excluded and included-only, that is
  // itself an unresolved contradiction.
  const restrictionContradiction =
    Array.isArray(assetClassRestrictions.excluded) &&
    Array.isArray(assetClassRestrictions.includedOnly) &&
    assetClassRestrictions.excluded.some((c) => assetClassRestrictions.includedOnly.includes(c));
  if (restrictionContradiction) {
    return emptyResult(RESULT_STATUS.NEEDS_CLARIFICATION, {
      conflicts: [{ fields: ["assetClassRestrictions"], reason: "The same asset class appears in both excluded and includedOnly — this cannot be resolved automatically." }],
      warnings: ["Cannot construct a portfolio: asset-class restrictions are self-contradictory."],
    });
  }

  const universe = effectiveUniverse(assetClassRestrictions);
  if (!universe) {
    return emptyResult(RESULT_STATUS.NEEDS_CLARIFICATION, {
      conflicts: [{ fields: ["assetClassRestrictions"], reason: "The combination of excluded and includedOnly restrictions leaves no eligible asset class at all." }],
      warnings: ["Cannot construct a portfolio: no asset class remains eligible under the stated restrictions."],
    });
  }

  const vehicleRestrictions = (options && options.investmentVehicleRestrictions) || { excluded: [], includedOnly: [] };
  let vehicleLabel = UNKNOWN;
  if (Array.isArray(vehicleRestrictions.includedOnly) && vehicleRestrictions.includedOnly.length === 1) {
    vehicleLabel = vehicleRestrictions.includedOnly[0];
    constraintsApplied.push(`Investment vehicle restricted to ${vehicleLabel} only.`);
  } else if (Array.isArray(vehicleRestrictions.includedOnly) && vehicleRestrictions.includedOnly.length > 1) {
    unknowns.push("Multiple investment vehicles were included-only; a single vehicle label could not be determined for each line.");
  }
  if (Array.isArray(vehicleRestrictions.excluded) && vehicleRestrictions.excluded.length > 0) {
    constraintsApplied.push(`Investment vehicle(s) excluded: ${vehicleRestrictions.excluded.join(", ")}.`);
  }

  if (Array.isArray(options.eligibleAssetUniverse) && options.eligibleAssetUniverse.length > 0) {
    constraintsApplied.push("Restricted to the supplied eligible asset universe.");
  } else {
    assumptions.push("No eligible asset universe was supplied; all Step 54 asset classes were treated as hypothetically available.");
  }
  if (!options.marketIntelligence) {
    assumptions.push("No market intelligence was supplied; allocation reflects investor constraints only, not current market conditions.");
  }

  // investmentCurrency must be known before existingPortfolio lines can
  // be matched to it — computed here so both the existingPortfolio
  // disclosure below and the allocation-building section further down
  // share the same single computation.
  const currencyKnown = investmentCurrency.value !== UNKNOWN && investmentCurrency.provenance !== PROVENANCE_STATES.UNKNOWN;

  // --- existingPortfolio (Step 75/76): concentration-cap enforcement
  // ONLY — see applyHardConstraints/effectiveCapFor above. Never
  // touches weighting, eligibleAssetUniverse, or excluded/includedOnly
  // restrictions. No FX conversion; only currency-matching lines
  // participate. A malformed shape or unusable currency degrades to
  // today's exact existing-portfolio-absent behavior, disclosed rather
  // than silently dropped.
  const rawExistingPortfolio = options.existingPortfolio;
  let existingPortfolioBasis = null;
  if (rawExistingPortfolio === undefined || rawExistingPortfolio === null) {
    assumptions.push("No existing portfolio was supplied; concentration was computed on new capital only.");
  } else if (!Array.isArray(rawExistingPortfolio)) {
    warnings.push("existingPortfolio was supplied but was not shaped as an array of holdings; it was ignored and concentration was computed on new capital only.");
  } else if (rawExistingPortfolio.length === 0) {
    assumptions.push("An existing portfolio was supplied confirming no current holdings; concentration was computed on new capital only.");
  } else if (!currencyKnown) {
    assumptions.push("investmentCurrency is unknown; the supplied existingPortfolio could not be used for concentration-cap calculations.");
  } else {
    const aggregation = aggregateExistingPortfolio(rawExistingPortfolio, investmentCurrency.value);
    if (aggregation.invalidLineCount > 0) {
      warnings.push(`${aggregation.invalidLineCount} existing holding line(s) were excluded because they were missing a recognized assetClass or a valid, non-negative marketValue.`);
    }
    if (aggregation.currencyMismatchCount > 0) {
      warnings.push(`${aggregation.currencyMismatchCount} existing holding line(s) were excluded from the concentration calculation because their currency did not match ${investmentCurrency.value}; no FX conversion is performed.`);
    }
    if (aggregation.matchedCount === 0) {
      warnings.push("No existing holdings could be matched to the investment currency; concentration was computed on new capital only.");
    } else {
      existingPortfolioBasis = { byClass: aggregation.byClass, total: aggregation.total };
    }
  }

  // Emergency cash is never part of investmentAmount, never converted
  // into a CASH percentage, and never calculated/inferred — it is only
  // ever disclosed here, exactly as frozen in Step 56.
  if (emergencyCashRequirement.provenance === PROVENANCE_STATES.PROVIDED) {
    const amountText = emergencyCashRequirement.value !== UNKNOWN ? `${emergencyCashRequirement.value} ${emergencyCashRequirement.currency}` : "an unspecified amount";
    assumptions.push(`An emergency cash reserve of ${amountText} was noted separately by the investor and is excluded from this allocation's investmentAmount — it is not represented as a CASH allocation line.`);
  }

  if (assetClassRestrictions.excluded && assetClassRestrictions.excluded.length > 0) {
    constraintsApplied.push(`Excluded asset class(es): ${assetClassRestrictions.excluded.join(", ")}.`);
  }
  if (assetClassRestrictions.includedOnly && assetClassRestrictions.includedOnly.length > 0) {
    constraintsApplied.push(`Restricted to included-only asset class(es): ${assetClassRestrictions.includedOnly.join(", ")}.`);
  }
  if (assetClassRestrictions.maximumByClass && Object.keys(assetClassRestrictions.maximumByClass).length > 0) {
    for (const [cls, cap] of Object.entries(assetClassRestrictions.maximumByClass)) {
      constraintsApplied.push(`${cls} capped at ${(cap * 100).toFixed(2)}% of the portfolio.`);
    }
  }
  if (maximumConcentration.provenance === PROVENANCE_STATES.PROVIDED) {
    constraintsApplied.push(`No single asset class exceeds ${(maximumConcentration.value * 100).toFixed(2)}% (portfolio-wide maximum concentration).`);
  }

  // --- Weighting: base archetype -> horizon nudge -> objective nudge -> liquidity nudge ---
  let weights = cloneWeights(BASE_ARCHETYPES[riskTolerance.value]);
  weights = applyHorizonNudge(weights, investmentHorizon);
  weights = applyObjectiveNudge(weights, investmentObjective);
  weights = applyLiquidityNudge(weights, liquidityRequirement);

  if (investmentHorizon.band === UNKNOWN) unknowns.push("investmentHorizon band is unknown; no horizon-based tilt was applied beyond the base risk-tolerance archetype.");
  if (investmentObjective.provenance !== PROVENANCE_STATES.PROVIDED && investmentObjective.provenance !== PROVENANCE_STATES.INFERRED) {
    unknowns.push("investmentObjective is unknown; no objective-based tilt was applied.");
  }
  if (liquidityRequirement.value === UNKNOWN) unknowns.push("liquidityRequirement is unknown; no liquidity-based tilt was applied.");

  const { weights: constrainedWeights, unallocatedFromCaps, combinedCapNotes } = applyHardConstraints(
    weights,
    universe,
    assetClassRestrictions,
    maximumConcentration,
    existingPortfolioBasis,
    investmentAmount.value
  );
  constraintsApplied.push(...combinedCapNotes);

  if (!currencyKnown) {
    unknowns.push("investmentCurrency is unknown; percentages were computed, but absolute amounts could not be.");
  }

  const amountKnown = investmentAmount.provenance === PROVENANCE_STATES.PROVIDED || investmentAmount.provenance === PROVENANCE_STATES.INFERRED;

  const allocations = [];
  for (const cls of ASSET_CLASSES) {
    const pct = constrainedWeights[cls];
    if (!pct || pct <= 0) continue;
    allocations.push({
      assetClass: cls,
      investmentVehicle: vehicleLabel,
      percentage: pct,
      amount: currencyKnown && amountKnown ? pct * investmentAmount.value : UNKNOWN,
      currency: currencyKnown ? investmentCurrency.value : UNKNOWN,
      reason: reasonForAllocation(cls, riskTolerance, investmentHorizon, investmentObjective, liquidityRequirement),
    });
  }

  const unallocatedPercentage = unallocatedFromCaps;
  const unallocatedAmount = currencyKnown && amountKnown ? unallocatedPercentage * investmentAmount.value : UNKNOWN;
  if (unallocatedPercentage > 0) {
    warnings.push(`${(unallocatedPercentage * 100).toFixed(2)}% of the portfolio remains unallocated because active constraints left no eligible class able to absorb it.`);
  }

  // Only the profile's own INCOMPLETE status or an unknown currency
  // downgrade this result's status — optional fields (liquidity,
  // horizon band nuance, restrictions) being unset is entirely normal
  // and is disclosed via `unknowns`/`assumptions` without downgrading
  // an otherwise-READY result.
  const status = validationResult.status === VALIDATION_STATUS.INCOMPLETE || !currencyKnown ? RESULT_STATUS.INCOMPLETE : RESULT_STATUS.READY;

  return {
    status,
    allocations,
    unallocatedPercentage,
    unallocatedAmount,
    currency: currencyKnown ? investmentCurrency.value : UNKNOWN,
    constraintsApplied,
    assumptions,
    unknowns,
    warnings,
    conflicts: [],
  };
}

module.exports = { constructPortfolio, RESULT_STATUS, ASSET_CLASSES, INVESTMENT_VEHICLES };
