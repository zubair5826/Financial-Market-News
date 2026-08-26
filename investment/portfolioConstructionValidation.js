// Portfolio Construction Result Validation — implements the contract
// frozen in Step 56. Deterministic invariant-checking only, mirroring
// the exact create/validate two-step split already proven for
// InvestorProfile (investorProfile.js / investorProfileValidation.js).
// Never mutates its input, never re-runs construction, never accesses
// a network/provider/credential.

const { RESULT_STATUS, ASSET_CLASSES, INVESTMENT_VEHICLES } = require("./portfolioConstruction");

const FORBIDDEN_FIELDS = Object.freeze(["instrument", "ticker", "securityIdentifier", "symbol", "isin", "cusip"]);
const EPSILON = 1e-9;

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// Returns { valid: boolean, errors: string[] }. Never throws on a
// malformed result — a malformed result is reported as invalid, not
// crashed on.
function validatePortfolioConstructionResult(result, options = {}) {
  const errors = [];

  if (!result || typeof result !== "object") {
    return { valid: false, errors: ["result must be an object."] };
  }

  if (!Object.values(RESULT_STATUS).includes(result.status)) {
    errors.push(`status must be one of: ${Object.values(RESULT_STATUS).join(", ")}.`);
  }

  if (!Array.isArray(result.allocations)) {
    errors.push("allocations must be an array.");
    return { valid: errors.length === 0, errors };
  }

  const investmentAmount = options.investmentAmount; // optional, a known positive number, for cross-checking
  let totalPercentage = 0;

  result.allocations.forEach((allocation, index) => {
    if (!allocation || typeof allocation !== "object") {
      errors.push(`allocations[${index}] must be an object.`);
      return;
    }

    for (const forbidden of FORBIDDEN_FIELDS) {
      if (forbidden in allocation) {
        errors.push(`allocations[${index}] must not contain a "${forbidden}" field — Portfolio Construction never selects individual securities.`);
      }
    }

    if (!ASSET_CLASSES.includes(allocation.assetClass)) {
      errors.push(`allocations[${index}].assetClass must be one of the frozen Step 54 asset classes.`);
    }
    if (allocation.investmentVehicle !== "UNKNOWN" && !INVESTMENT_VEHICLES.includes(allocation.investmentVehicle)) {
      errors.push(`allocations[${index}].investmentVehicle must be one of the frozen Step 54 vehicles, or UNKNOWN.`);
    }

    if (!isFiniteNumber(allocation.percentage)) {
      errors.push(`allocations[${index}].percentage must be a finite number.`);
    } else {
      if (allocation.percentage < 0) errors.push(`allocations[${index}].percentage must not be negative.`);
      if (allocation.percentage > 1 + EPSILON) errors.push(`allocations[${index}].percentage must not exceed 100%.`);
      totalPercentage += allocation.percentage;
    }

    if (allocation.amount !== "UNKNOWN") {
      if (!isFiniteNumber(allocation.amount)) {
        errors.push(`allocations[${index}].amount must be a finite number or "UNKNOWN".`);
      } else {
        if (allocation.amount < 0) errors.push(`allocations[${index}].amount must not be negative.`);
        if (isFiniteNumber(investmentAmount) && allocation.amount > investmentAmount + EPSILON) {
          errors.push(`allocations[${index}].amount must not exceed the total investment amount.`);
        }
        if (isFiniteNumber(investmentAmount) && isFiniteNumber(allocation.percentage)) {
          const expected = allocation.percentage * investmentAmount;
          if (Math.abs(expected - allocation.amount) > Math.max(0.01, investmentAmount * 1e-6)) {
            errors.push(`allocations[${index}].amount is inconsistent with percentage * investmentAmount.`);
          }
        }
      }
    }

    if (typeof allocation.reason !== "string" || allocation.reason.trim() === "") {
      errors.push(`allocations[${index}].reason must be a non-empty, deterministic explanation.`);
    }
  });

  if (result.unallocatedPercentage !== "UNKNOWN") {
    if (!isFiniteNumber(result.unallocatedPercentage)) {
      errors.push('unallocatedPercentage must be a finite number or "UNKNOWN".');
    } else if (result.unallocatedPercentage < 0 || result.unallocatedPercentage > 1 + EPSILON) {
      errors.push("unallocatedPercentage must be between 0 and 1.");
    } else {
      totalPercentage += result.unallocatedPercentage;
    }
  }

  if (result.allocations.length > 0 || result.unallocatedPercentage !== "UNKNOWN") {
    if (Math.abs(totalPercentage - 1) > 1e-6 && result.status !== RESULT_STATUS.BLOCKED && result.status !== RESULT_STATUS.NEEDS_CLARIFICATION) {
      errors.push(`allocations' percentages plus unallocatedPercentage must sum to 1 (got ${totalPercentage}).`);
    }
  }

  // CASH allocation and unallocated capital must never be conflated —
  // a CASH line is a deliberate decision, unallocatedPercentage is a
  // wholly separate concept.
  const cashLines = result.allocations.filter((a) => a && a.assetClass === "CASH");
  if (cashLines.length > 1) {
    errors.push("at most one CASH allocation line is expected; multiple CASH lines would be ambiguous.");
  }

  for (const conflict of Array.isArray(result.conflicts) ? result.conflicts : []) {
    if (!conflict || !Array.isArray(conflict.fields) || typeof conflict.reason !== "string" || conflict.reason.trim() === "") {
      errors.push('every conflict must be shaped as {fields: string[], reason: non-empty string}.');
    }
  }

  if ((result.status === RESULT_STATUS.BLOCKED || result.status === RESULT_STATUS.NEEDS_CLARIFICATION) && result.allocations.length > 0) {
    errors.push(`a ${result.status} result must not contain any allocations.`);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validatePortfolioConstructionResult };
