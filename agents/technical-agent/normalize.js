// Same field-mapping pattern as the other three agents' normalize.js —
// no real market-data provider's field names are assumed or hard-coded.
//
// Volume gets special handling per the Step 7 spec: a candle with no
// volume field reads NOT_AVAILABLE, not the usual UNKNOWN — this is a
// confirmed absence (the normalizer positively checked and found
// nothing), distinct from a value that was simply never determined.

const { createCandle, CANDLE_FIELDS } = require("./technicalRecord");
const { UNKNOWN } = require("../../core/constants");

function normalizeCandle(raw, fieldMap = {}) {
  if (!raw || typeof raw !== "object") {
    const candle = createCandle({});
    candle.volume = "NOT_AVAILABLE";
    return candle;
  }

  const mapped = {};
  for (const field of CANDLE_FIELDS) {
    const sourceKey = fieldMap[field] || field;
    if (raw[sourceKey] !== undefined) {
      mapped[field] = raw[sourceKey];
    }
  }

  const candle = createCandle(mapped);
  if (candle.volume === UNKNOWN) {
    candle.volume = "NOT_AVAILABLE";
  }
  return candle;
}

module.exports = { normalizeCandle };
