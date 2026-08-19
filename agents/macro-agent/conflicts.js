// Groups validated macro records by indicator + country + period and
// detects disagreement between independent sources, reusing
// core/verification.js's reconcileSources() (per the Step 6 instruction
// to use the existing core contracts) rather than reimplementing
// comparison logic a third time. reconcileSources() expects
// { asset, data_type, value } — macro records use different field
// names (country/indicator/actual_value), so each pair is mapped into
// that shape purely for the comparison call; the mapping never leaves
// this function and never touches the real records except to set
// verification_status on a conflict. Never picks a winner: a
// conflicting group has every member's verification_status forced to
// CONFLICTING, and all records are preserved by the caller (index.js
// never drops them).

const { reconcileSources, SOURCE_VERIFICATION_STATES } = require("../../core/verification");

function groupKey(record) {
  const code = record.indicator_code && record.indicator_code !== "UNKNOWN" ? record.indicator_code : record.indicator;
  return `${code}::${record.country}::${record.period}`;
}

function toReconciliationShape(record) {
  return { asset: record.country, data_type: groupKey(record), value: record.actual_value };
}

function detectConflicts(records) {
  const groups = new Map();
  for (const record of records) {
    const key = groupKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const conflicts = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    let hasConflict = false;
    const shapeA = toReconciliationShape(group[0]);
    for (let i = 1; i < group.length; i++) {
      const outcome = reconcileSources(shapeA, toReconciliationShape(group[i]));
      if (outcome.status === SOURCE_VERIFICATION_STATES.CONFLICTING) hasConflict = true;
    }

    if (hasConflict) {
      for (const record of group) {
        record.verification_status = SOURCE_VERIFICATION_STATES.CONFLICTING;
      }
      conflicts.push({
        indicator: group[0].indicator,
        country: group[0].country,
        period: group[0].period,
        records: group.map((r) => ({ source: r.source, actual_value: r.actual_value, release_timestamp: r.release_timestamp })),
      });
    } else {
      for (const record of group) {
        if (record.verification_status === SOURCE_VERIFICATION_STATES.UNVERIFIED) {
          record.verification_status = SOURCE_VERIFICATION_STATES.VERIFIED_SECONDARY;
        }
      }
    }
  }

  return conflicts;
}

module.exports = { detectConflicts, groupKey };
