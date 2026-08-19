// Aggregates setup direction from the four domains' own bias fields —
// the exact same counting rule already used by every prior agent to
// derive its own bias (News/Macro/Sentiment's *_bias, Technical's
// technical_bias): each BULLISH/BEARISH domain casts one vote;
// NEUTRAL/MIXED count as "tagged" but cast no directional vote;
// UNKNOWN domains (including ones with no report supplied at all)
// don't count at all. This is setup DIRECTION, never an execution
// order — BULLISH does not mean BUY. See README.md.

const DIRECTIONS = Object.freeze({
  BULLISH: "BULLISH",
  BEARISH: "BEARISH",
  NEUTRAL: "NEUTRAL",
  MIXED: "MIXED",
  UNKNOWN: "UNKNOWN",
});

function aggregateDirection(domainEvidenceList) {
  let bullish = 0;
  let bearish = 0;
  let tagged = 0;

  for (const evidence of domainEvidenceList) {
    if (!evidence) continue;
    if (evidence.bias === "BULLISH") {
      bullish += 1;
      tagged += 1;
    } else if (evidence.bias === "BEARISH") {
      bearish += 1;
      tagged += 1;
    } else if (evidence.bias === "NEUTRAL" || evidence.bias === "MIXED") {
      tagged += 1;
    }
  }

  // Majority rules first — a lopsided batch (e.g. 3 domains bullish
  // vs 1 bearish) is BULLISH, not MIXED. MIXED is reserved for a
  // genuine tie between opposing domains, or an untagged domain
  // whose own bias is itself MIXED (tagged but neither direction).
  let direction;
  if (tagged === 0) direction = DIRECTIONS.UNKNOWN;
  else if (bullish > bearish) direction = DIRECTIONS.BULLISH;
  else if (bearish > bullish) direction = DIRECTIONS.BEARISH;
  else if (bullish > 0) direction = DIRECTIONS.MIXED;
  else direction = DIRECTIONS.NEUTRAL;

  return { direction, taggedDomains: tagged, bullishDomains: bullish, bearishDomains: bearish };
}

module.exports = { DIRECTIONS, aggregateDirection };
