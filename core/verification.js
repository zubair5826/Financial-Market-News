// Section 4 — Source Verification. If two sources disagree, this module
// never silently picks one — it flags CONFLICTING and preserves both
// records for the Chief Trading Manager to review later.

const SOURCE_VERIFICATION_STATES = Object.freeze({
  VERIFIED_PRIMARY: "VERIFIED_PRIMARY",
  VERIFIED_SECONDARY: "VERIFIED_SECONDARY",
  UNVERIFIED: "UNVERIFIED",
  CONFLICTING: "CONFLICTING",
  UNKNOWN: "UNKNOWN",
});

const VERIFICATION_DEFINITIONS = Object.freeze({
  VERIFIED_PRIMARY: "Confirmed directly from the authoritative/original source (e.g. the exchange itself, the issuing agency).",
  VERIFIED_SECONDARY: "Confirmed by a non-primary source, or by agreement between two independent sources.",
  UNVERIFIED: "Reported by a single source with no independent confirmation.",
  CONFLICTING: "Two or more sources disagree on the same fact — must not be auto-resolved; both must be preserved for human/Chief Trading Manager review.",
  UNKNOWN: "Verification status could not be determined (e.g. one of the sources is missing).",
});

// Compares two data records for the SAME asset + data_type. Never mutates
// or discards either input, and never picks a "winner" on disagreement.
function reconcileSources(recordA, recordB) {
  if (!recordA || !recordB) {
    return {
      status: SOURCE_VERIFICATION_STATES.UNKNOWN,
      records: [recordA, recordB].filter(Boolean),
      notes: "Cannot reconcile — one or both records are missing.",
    };
  }

  if (recordA.asset !== recordB.asset || recordA.data_type !== recordB.data_type) {
    throw new Error("reconcileSources requires two records for the same asset and data_type.");
  }

  if (recordA.value === recordB.value) {
    return {
      status: SOURCE_VERIFICATION_STATES.VERIFIED_SECONDARY,
      records: [recordA, recordB],
      notes: "Independent sources agree.",
    };
  }

  return {
    status: SOURCE_VERIFICATION_STATES.CONFLICTING,
    records: [recordA, recordB],
    notes: "Sources disagree — both preserved for Chief Trading Manager review, not auto-resolved.",
  };
}

module.exports = { SOURCE_VERIFICATION_STATES, VERIFICATION_DEFINITIONS, reconcileSources };
