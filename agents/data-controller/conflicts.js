// Groups validated records by asset + data_type and detects disagreement
// between independent sources. Never picks a winner: a conflicting group
// has every member's verification_status forced to CONFLICTING, and all
// records are preserved (see index.js output — nothing is dropped).

const { reconcileSources, SOURCE_VERIFICATION_STATES } = require("../../core/verification");

function groupKey(record) {
  return `${record.asset}::${record.data_type}`;
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
    for (let i = 1; i < group.length; i++) {
      const outcome = reconcileSources(group[0], group[i]);
      if (outcome.status === SOURCE_VERIFICATION_STATES.CONFLICTING) {
        hasConflict = true;
      }
    }

    if (hasConflict) {
      for (const record of group) {
        record.verification_status = SOURCE_VERIFICATION_STATES.CONFLICTING;
      }
      conflicts.push({
        asset: group[0].asset,
        data_type: group[0].data_type,
        records: group.map((r) => ({ source: r.source, value: r.value, timestamp: r.timestamp })),
      });
    } else {
      // Independent sources agreeing upgrades an unconfirmed single
      // source to VERIFIED_SECONDARY — but never downgrades an already
      // stronger claim like VERIFIED_PRIMARY.
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
