// Detects conflicting reports about the same likely event: within each
// duplicate/likely-same-event group (see duplicates.js), if the
// items' own tagged impact_direction values materially disagree
// (POSITIVE vs NEGATIVE), the group is flagged CONFLICTING. Never
// picks a winner — every record involved is preserved and its
// verification_status is forced to CONFLICTING, mirroring
// agents/data-controller/conflicts.js's price-conflict handling.

const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { IMPACT_DIRECTIONS } = require("./impact");

function directionsConflict(a, b) {
  return (
    (a === IMPACT_DIRECTIONS.POSITIVE && b === IMPACT_DIRECTIONS.NEGATIVE) ||
    (a === IMPACT_DIRECTIONS.NEGATIVE && b === IMPACT_DIRECTIONS.POSITIVE)
  );
}

function detectConflictingReports(newsItems, duplicateGroups) {
  const conflicts = [];

  for (const group of duplicateGroups) {
    const indices = group.items.map((i) => i.index);
    const tagged = indices
      .map((idx) => ({ idx, direction: newsItems[idx].impact_direction }))
      .filter((entry) => entry.direction && entry.direction !== IMPACT_DIRECTIONS.UNKNOWN);

    let conflict = false;
    for (let i = 0; i < tagged.length; i++) {
      for (let j = i + 1; j < tagged.length; j++) {
        if (directionsConflict(tagged[i].direction, tagged[j].direction)) conflict = true;
      }
    }

    if (conflict) {
      indices.forEach((idx) => {
        newsItems[idx].verification_status = SOURCE_VERIFICATION_STATES.CONFLICTING;
      });
      conflicts.push({
        basis: "likely_same_event_disagreeing_impact_direction",
        items: indices.map((idx) => ({
          headline: newsItems[idx].headline,
          source: newsItems[idx].source,
          impact_direction: newsItems[idx].impact_direction,
          publication_timestamp: newsItems[idx].publication_timestamp,
        })),
      });
    }
  }

  return conflicts;
}

module.exports = { detectConflictingReports };
