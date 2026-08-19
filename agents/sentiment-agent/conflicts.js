// Sentiment conflict detection — groups validated records by asset;
// within a group, if any two BULLISH/BEARISH records directly oppose
// each other, the whole group is flagged CONFLICTING_SENTIMENT. Never
// picks a winner or averages the disagreement away: every record in
// the group has its verification_status forced to CONFLICTING, and all
// are preserved (index.js never drops them) — same discipline as
// agents/data-controller, agents/news-agent, and agents/macro-agent's
// conflicts.js modules.

const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { SENTIMENT_VALUES } = require("./sentimentRecord");

function groupByAsset(records) {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.asset)) groups.set(record.asset, []);
    groups.get(record.asset).push(record);
  }
  return groups;
}

function directionsOppose(a, b) {
  return (
    (a === SENTIMENT_VALUES.BULLISH && b === SENTIMENT_VALUES.BEARISH) ||
    (a === SENTIMENT_VALUES.BEARISH && b === SENTIMENT_VALUES.BULLISH)
  );
}

function detectSentimentConflicts(records) {
  const groups = groupByAsset(records);
  const conflicts = [];

  for (const [asset, group] of groups) {
    if (group.length < 2) continue;

    const directional = group.filter(
      (r) => r.sentiment === SENTIMENT_VALUES.BULLISH || r.sentiment === SENTIMENT_VALUES.BEARISH
    );

    let hasConflict = false;
    for (let i = 0; i < directional.length; i++) {
      for (let j = i + 1; j < directional.length; j++) {
        if (directionsOppose(directional[i].sentiment, directional[j].sentiment)) hasConflict = true;
      }
    }

    if (hasConflict) {
      for (const record of group) {
        record.verification_status = SOURCE_VERIFICATION_STATES.CONFLICTING;
      }
      conflicts.push({
        asset,
        records: group.map((r) => ({ source: r.source, sentiment: r.sentiment, timestamp: r.timestamp })),
      });
    }
  }

  return conflicts;
}

module.exports = { detectSentimentConflicts };
