// Investor Profile Validation — implements the contract frozen in
// Step 51/52. Deterministic validation, contradiction detection, and
// validation-status derivation only. No natural-language parsing, no
// portfolio logic, no market data, no network access, no fabricated
// values. Every reclassification (e.g. a malformed value downgraded
// to INVALID) is deterministic and reason-carrying — never an
// arbitrary numeric confidence score.

const { UNKNOWN } = require("../core/constants");
const {
  PROVENANCE_STATES,
  CURRENCY_CODES,
  RISK_TOLERANCE_VALUES,
  INVESTMENT_OBJECTIVE_VALUES,
  HORIZON_BANDS,
  LIQUIDITY_VALUES,
  REQUIRED_FIELDS,
  RECOMMENDED_FIELDS,
} = require("./investorProfile");

const VALIDATION_STATUS = Object.freeze({
  VALID: "VALID",
  INCOMPLETE: "INCOMPLETE",
  INSUFFICIENT_INFORMATION: "INSUFFICIENT_INFORMATION",
  NEEDS_CLARIFICATION: "NEEDS_CLARIFICATION",
});

function isPositiveFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFraction(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1;
}

// A scalar {value, provenance, reason} field validated against an
// arbitrary predicate + an optional enum. UNKNOWN provenance passes
// through unchanged (simply missing, not invalid). PROVIDED/INFERRED
// provenance is re-checked here regardless of what the caller claimed
// — this module never trusts an unverified claim of validity.
function validateScalarField(field, { isValid, invalidReason }) {
  const result = { ...field };
  if (result.provenance === PROVENANCE_STATES.UNKNOWN) return result;
  if (result.provenance === PROVENANCE_STATES.INVALID) {
    result.reason = result.reason !== UNKNOWN ? result.reason : invalidReason;
    return result;
  }
  if (!isValid(result.value)) {
    return { value: result.value, provenance: PROVENANCE_STATES.INVALID, reason: invalidReason };
  }
  return result;
}

function validateInvestmentAmount(field) {
  return validateScalarField(field, {
    isValid: isPositiveFiniteNumber,
    invalidReason: "investmentAmount must be a positive, finite number (not missing, zero, negative, NaN, Infinity, or non-numeric).",
  });
}

function validateCurrency(field) {
  return validateScalarField(field, {
    isValid: (v) => CURRENCY_CODES.includes(v),
    invalidReason: `investmentCurrency must be one of: ${CURRENCY_CODES.join(", ")}.`,
  });
}

function validateRiskTolerance(field) {
  return validateScalarField(field, {
    isValid: (v) => RISK_TOLERANCE_VALUES.includes(v),
    invalidReason: `riskTolerance must be one of: ${RISK_TOLERANCE_VALUES.join(", ")}.`,
  });
}

function validateObjective(field) {
  return validateScalarField(field, {
    isValid: (v) => INVESTMENT_OBJECTIVE_VALUES.includes(v),
    invalidReason: `investmentObjective must be one of: ${INVESTMENT_OBJECTIVE_VALUES.join(", ")}.`,
  });
}

function validateLiquidityRequirement(field) {
  return validateScalarField(field, {
    isValid: (v) => LIQUIDITY_VALUES.includes(v),
    invalidReason: `liquidityRequirement must be one of: ${LIQUIDITY_VALUES.join(", ")}.`,
  });
}

function validateMaximumConcentration(field) {
  return validateScalarField(field, {
    isValid: isFraction,
    invalidReason: "maximumConcentration must be a decimal fraction greater than 0 and at most 1.",
  });
}

function validateEmergencyCashRequirement(field) {
  const result = { ...field };
  if (result.provenance === PROVENANCE_STATES.UNKNOWN) return result;
  if (result.provenance !== PROVENANCE_STATES.INVALID) {
    if (!isPositiveFiniteNumber(result.value)) {
      return {
        value: result.value,
        currency: result.currency,
        provenance: PROVENANCE_STATES.INVALID,
        reason: "emergencyCashRequirement.value must be a positive, finite number when provided.",
      };
    }
    if (result.currency !== UNKNOWN && !CURRENCY_CODES.includes(result.currency)) {
      return {
        value: result.value,
        currency: result.currency,
        provenance: PROVENANCE_STATES.INVALID,
        reason: `emergencyCashRequirement.currency must be one of: ${CURRENCY_CODES.join(", ")}.`,
      };
    }
  }
  return result;
}

// Derives a band from a fully-known numeric range, per the frozen
// Step 52 thresholds. Returns UNKNOWN if the range isn't fully known
// and minimumYears alone can't determine LONG_TERM — never a fabricated
// guess for an ambiguous open-ended range below the long-term cutoff.
function deriveBandFromRange(minimumYears, maximumYears) {
  if (typeof minimumYears !== "number") return UNKNOWN;
  if (minimumYears > 10) return "LONG_TERM"; // true regardless of maximumYears, per the frozen rule
  if (typeof maximumYears !== "number") return UNKNOWN; // ambiguous without an upper bound
  if (minimumYears >= 0 && maximumYears < 3) return "SHORT_TERM";
  if (minimumYears >= 3 && maximumYears <= 10) return "MEDIUM_TERM";
  return UNKNOWN;
}

// Returns { field, contradiction } — contradiction is null unless a
// genuine internal band-vs-range mismatch is found; the field itself
// is never silently resolved to one side.
function validateHorizon(field) {
  const result = { ...field };

  if (result.provenance === PROVENANCE_STATES.UNKNOWN) return { field: result, contradiction: null };
  if (result.provenance === PROVENANCE_STATES.INVALID) {
    result.reason = result.reason !== UNKNOWN ? result.reason : "investmentHorizon is invalid.";
    return { field: result, contradiction: null };
  }

  const hasMin = typeof result.minimumYears === "number";
  const hasMax = typeof result.maximumYears === "number";
  const hasBand = result.band !== UNKNOWN && HORIZON_BANDS.includes(result.band);

  if (result.band !== UNKNOWN && !HORIZON_BANDS.includes(result.band)) {
    return {
      field: { ...result, provenance: PROVENANCE_STATES.INVALID, reason: `investmentHorizon.band must be one of: ${HORIZON_BANDS.join(", ")}.` },
      contradiction: null,
    };
  }

  if (hasMin && !isFiniteNonNegativeNumber(result.minimumYears)) {
    return {
      field: { ...result, provenance: PROVENANCE_STATES.INVALID, reason: "investmentHorizon.minimumYears must be a finite number >= 0." },
      contradiction: null,
    };
  }
  if (hasMin && hasMax && result.minimumYears > result.maximumYears) {
    return {
      field: { ...result, provenance: PROVENANCE_STATES.INVALID, reason: "investmentHorizon.minimumYears must not exceed maximumYears (reversed range)." },
      contradiction: null,
    };
  }

  if (hasMin || hasMax) {
    const derivedBand = deriveBandFromRange(hasMin ? result.minimumYears : UNKNOWN, hasMax ? result.maximumYears : UNKNOWN);
    if (hasBand && derivedBand !== UNKNOWN && derivedBand !== result.band) {
      // Genuine internal conflict: a qualitative band and a numeric
      // range were both explicitly given and disagree. Neither side
      // is discarded — both are preserved on the field unchanged, and
      // the conflict is surfaced as a structured contradiction.
      return {
        field: result,
        contradiction: {
          fields: ["investmentHorizon"],
          reason: `investmentHorizon.band ("${result.band}") does not match the band implied by the given numeric range (minimumYears=${result.minimumYears}, maximumYears=${hasMax ? result.maximumYears : "UNKNOWN"}, implied "${derivedBand}").`,
        },
      };
    }
    if (!hasBand) {
      result.band = derivedBand;
    }
  }

  return { field: result, contradiction: null };
}

function validateAssetClassRestrictions(field) {
  const errors = [];
  const excluded = Array.isArray(field.excluded) ? field.excluded : [];
  const includedOnly = Array.isArray(field.includedOnly) ? field.includedOnly : [];
  const maximumByClass = field.maximumByClass && typeof field.maximumByClass === "object" ? field.maximumByClass : {};

  excluded.forEach((v, i) => {
    if (typeof v !== "string" || v.trim() === "") errors.push(`assetClassRestrictions.excluded[${i}] must be a non-empty string.`);
  });
  includedOnly.forEach((v, i) => {
    if (typeof v !== "string" || v.trim() === "") errors.push(`assetClassRestrictions.includedOnly[${i}] must be a non-empty string.`);
  });
  for (const [assetClass, fraction] of Object.entries(maximumByClass)) {
    if (!isFraction(fraction)) {
      errors.push(`assetClassRestrictions.maximumByClass.${assetClass} must be a decimal fraction greater than 0 and at most 1.`);
    }
  }

  return { field: { excluded: [...excluded], includedOnly: [...includedOnly], maximumByClass: { ...maximumByClass } }, errors };
}

// profile: the output of createInvestorProfile() (or an equivalent
// shape). Never mutates it — returns a fresh, independently-validated
// profile inside the result. Resolves to a deterministic structured
// result: { status, profile, missingRequiredFields, invalidFields,
// contradictions, warnings }. No market data, no provider data, no
// credentials, no network access, no recommendations.
function validateInvestorProfile(profile) {
  const validated = {
    investmentAmount: validateInvestmentAmount(profile.investmentAmount),
    investmentCurrency: validateCurrency(profile.investmentCurrency),
    riskTolerance: validateRiskTolerance(profile.riskTolerance),
    investmentObjective: validateObjective(profile.investmentObjective),
    liquidityRequirement: validateLiquidityRequirement(profile.liquidityRequirement),
    emergencyCashRequirement: validateEmergencyCashRequirement(profile.emergencyCashRequirement),
    maximumConcentration: validateMaximumConcentration(profile.maximumConcentration),
  };

  const horizonResult = validateHorizon(profile.investmentHorizon);
  validated.investmentHorizon = horizonResult.field;

  const restrictionsResult = validateAssetClassRestrictions(profile.assetClassRestrictions);
  validated.assetClassRestrictions = restrictionsResult.field;

  const contradictions = [];
  if (horizonResult.contradiction) contradictions.push(horizonResult.contradiction);

  const missingRequiredFields = REQUIRED_FIELDS.filter((f) => validated[f].provenance === PROVENANCE_STATES.UNKNOWN);
  const invalidFields = [];
  for (const f of [...REQUIRED_FIELDS, ...RECOMMENDED_FIELDS, "liquidityRequirement", "emergencyCashRequirement", "maximumConcentration"]) {
    if (validated[f].provenance === PROVENANCE_STATES.INVALID) invalidFields.push(f);
  }
  for (const err of restrictionsResult.errors) invalidFields.push(err);

  const warnings = [];
  for (const f of RECOMMENDED_FIELDS) {
    if (validated[f].provenance === PROVENANCE_STATES.UNKNOWN) {
      warnings.push(`${f} was not provided — this is recommended but non-blocking; the eventual recommendation must disclose this limitation.`);
    } else if (validated[f].provenance === PROVENANCE_STATES.INVALID) {
      warnings.push(`${f} was provided but is invalid and was not used: ${validated[f].reason}`);
    }
  }

  const requiredInvalidOrMissing =
    missingRequiredFields.length > 0 || REQUIRED_FIELDS.some((f) => validated[f].provenance === PROVENANCE_STATES.INVALID);

  let status;
  if (contradictions.length > 0) {
    status = VALIDATION_STATUS.NEEDS_CLARIFICATION;
  } else if (requiredInvalidOrMissing) {
    status = VALIDATION_STATUS.INSUFFICIENT_INFORMATION;
  } else if (RECOMMENDED_FIELDS.some((f) => validated[f].provenance !== PROVENANCE_STATES.PROVIDED && validated[f].provenance !== PROVENANCE_STATES.INFERRED)) {
    status = VALIDATION_STATUS.INCOMPLETE;
  } else {
    status = VALIDATION_STATUS.VALID;
  }

  return { status, profile: validated, missingRequiredFields, invalidFields, contradictions, warnings };
}

module.exports = { VALIDATION_STATUS, validateInvestorProfile };
