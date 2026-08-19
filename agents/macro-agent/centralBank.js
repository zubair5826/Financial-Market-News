// Central bank event handling — a distinct sub-model from the main
// macro indicator record (per the Step 6 spec's own "Central Bank
// Events" section), since its fields (meeting_date, decision, guidance)
// don't fit the indicator/actual/expected shape of macroRecord.js.
//
// policy_direction is read from the input only — this agent never
// infers HAWKISH/DOVISH from guidance text itself; that would require
// semantic judgment this system doesn't have, the same discipline as
// impact_direction in impact.js. HAWKISH/DOVISH is an analytical
// classification, never a trading instruction (not BUY/SELL) — see
// README.md.

const { UNKNOWN } = require("../../core/constants");

const POLICY_DIRECTIONS = Object.freeze({
  HAWKISH: "HAWKISH",
  DOVISH: "DOVISH",
  NEUTRAL: "NEUTRAL",
  MIXED: "MIXED",
  UNKNOWN: "UNKNOWN",
});

const POLICY_DIRECTION_DEFINITIONS = Object.freeze({
  HAWKISH: "Guidance/decision leans toward tighter monetary policy (e.g. rate hikes, reduced stimulus). Analytical classification only — NOT a trading instruction.",
  DOVISH: "Guidance/decision leans toward looser monetary policy (e.g. rate cuts, added stimulus). Analytical classification only — NOT a trading instruction.",
  NEUTRAL: "No clear directional lean in the available guidance.",
  MIXED: "Guidance contains both hawkish and dovish elements.",
  UNKNOWN: "No guidance/decision evidence was supplied for this event.",
});

const CENTRAL_BANK_EVENT_FIELDS = Object.freeze([
  "central_bank",
  "meeting_date",
  "decision",
  "previous_decision",
  "expected_decision",
  "actual_decision",
  "policy_direction",
  "guidance",
  "uncertainty",
]);

function createCentralBankEvent(fields = {}) {
  const event = {};
  for (const f of CENTRAL_BANK_EVENT_FIELDS) event[f] = fields[f] !== undefined ? fields[f] : UNKNOWN;
  return event;
}

function normalizeCentralBankEvent(raw, fieldMap = {}) {
  if (!raw || typeof raw !== "object") return createCentralBankEvent({});
  const mapped = {};
  for (const f of CENTRAL_BANK_EVENT_FIELDS) {
    const key = fieldMap[f] || f;
    if (raw[key] !== undefined) mapped[f] = raw[key];
  }
  return createCentralBankEvent(mapped);
}

function validateCentralBankEventStructure(event) {
  const errors = [];
  if (!event || typeof event !== "object") return { valid: false, errors: ["event must be an object"] };
  for (const f of CENTRAL_BANK_EVENT_FIELDS) if (!(f in event)) errors.push(`Missing field: ${f}`);
  if (event.policy_direction !== undefined && !Object.values(POLICY_DIRECTIONS).includes(event.policy_direction)) {
    errors.push(`Invalid policy_direction: ${event.policy_direction}`);
  }
  return { valid: errors.length === 0, errors };
}

const REQUIRED_CENTRAL_BANK_FIELDS = Object.freeze(["central_bank"]);

function isMissing(value) {
  return value === undefined || value === null || value === UNKNOWN || value === "";
}

function validateCentralBankEventInput(event) {
  const structural = validateCentralBankEventStructure(event);
  const missingFields = REQUIRED_CENTRAL_BANK_FIELDS.filter((f) => isMissing(event[f]));
  return { valid: structural.valid && missingFields.length === 0, structuralErrors: structural.errors, missingFields };
}

function processCentralBankEvents(rawEvents, options = {}) {
  if (!Array.isArray(rawEvents)) return { validated: [], rejected: [] };

  const validated = [];
  const rejected = [];

  for (const raw of rawEvents) {
    const event = normalizeCentralBankEvent(raw, options.fieldMap || {});
    const validation = validateCentralBankEventInput(event);
    if (!validation.valid) {
      rejected.push({
        record: event,
        errors: [
          ...validation.missingFields.map((f) => `Missing required field: ${f} (DATA UNAVAILABLE).`),
          ...validation.structuralErrors,
        ],
      });
      continue;
    }
    validated.push(event);
  }

  return { validated, rejected };
}

function deriveOverallPolicyDirection(events) {
  const counts = { HAWKISH: 0, DOVISH: 0, NEUTRAL: 0, MIXED: 0, UNKNOWN: 0 };
  for (const e of events) {
    const direction = Object.values(POLICY_DIRECTIONS).includes(e.policy_direction) ? e.policy_direction : "UNKNOWN";
    counts[direction] += 1;
  }
  const tagged = counts.HAWKISH + counts.DOVISH + counts.NEUTRAL + counts.MIXED;
  if (tagged === 0) return "UNKNOWN";
  // Majority rules first — a lopsided batch (e.g. 3 HAWKISH vs 1
  // DOVISH) is HAWKISH, not MIXED. MIXED is reserved for a genuine
  // tie between real HAWKISH/DOVISH signals, or explicit MIXED tags
  // with no HAWKISH/DOVISH signal at all.
  if (counts.HAWKISH > counts.DOVISH) return "HAWKISH";
  if (counts.DOVISH > counts.HAWKISH) return "DOVISH";
  if (counts.HAWKISH > 0) return "MIXED";
  if (counts.MIXED > 0) return "MIXED";
  return "NEUTRAL";
}

function buildCentralBankAssessment(events) {
  return {
    events,
    overall_policy_direction: deriveOverallPolicyDirection(events),
  };
}

module.exports = {
  POLICY_DIRECTIONS,
  POLICY_DIRECTION_DEFINITIONS,
  CENTRAL_BANK_EVENT_FIELDS,
  createCentralBankEvent,
  normalizeCentralBankEvent,
  validateCentralBankEventStructure,
  validateCentralBankEventInput,
  processCentralBankEvents,
  deriveOverallPolicyDirection,
  buildCentralBankAssessment,
};
