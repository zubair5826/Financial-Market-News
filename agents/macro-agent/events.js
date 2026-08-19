// Upcoming scheduled economic events — a distinct sub-model from the
// main macro indicator record (per the Step 6 "Upcoming Events"
// section), since a not-yet-released event has no actual_value and
// tracks a scheduled_time instead of a release_timestamp.
//
// scheduled_time is NEVER invented — a missing one simply stays
// UNKNOWN. `freshness_status`, if the caller supplies one, is validated
// but not computed here: computing "how stale is this schedule entry"
// would need a distinct "when was this schedule confirmed" timestamp
// that isn't part of the spec's field list, so this agent doesn't
// invent that semantic — see README.md limitations.

const { UNKNOWN } = require("../../core/constants");
const { SOURCE_VERIFICATION_STATES } = require("../../core/verification");
const { FRESHNESS_STATES } = require("../../core/freshness");
const { IMPORTANCE_LEVELS } = require("./importance");

const UPCOMING_EVENT_FIELDS = Object.freeze([
  "event",
  "scheduled_time",
  "country",
  "importance",
  "expected_value",
  "previous_value",
  "source",
  "verification_status",
  "freshness_status",
]);

function createUpcomingEvent(fields = {}) {
  const event = {};
  for (const f of UPCOMING_EVENT_FIELDS) event[f] = fields[f] !== undefined ? fields[f] : UNKNOWN;
  return event;
}

function normalizeUpcomingEvent(raw, fieldMap = {}) {
  if (!raw || typeof raw !== "object") return createUpcomingEvent({});
  const mapped = {};
  for (const f of UPCOMING_EVENT_FIELDS) {
    const key = fieldMap[f] || f;
    if (raw[key] !== undefined) mapped[f] = raw[key];
  }
  return createUpcomingEvent(mapped);
}

function validateUpcomingEventStructure(event) {
  const errors = [];
  if (!event || typeof event !== "object") return { valid: false, errors: ["event must be an object"] };
  for (const f of UPCOMING_EVENT_FIELDS) if (!(f in event)) errors.push(`Missing field: ${f}`);
  if (event.importance !== undefined && !Object.values(IMPORTANCE_LEVELS).includes(event.importance)) {
    errors.push(`Invalid importance: ${event.importance}`);
  }
  if (
    event.verification_status !== undefined &&
    !Object.values(SOURCE_VERIFICATION_STATES).includes(event.verification_status)
  ) {
    errors.push(`Invalid verification_status: ${event.verification_status}`);
  }
  if (event.freshness_status !== undefined && !Object.values(FRESHNESS_STATES).includes(event.freshness_status)) {
    errors.push(`Invalid freshness_status: ${event.freshness_status}`);
  }
  return { valid: errors.length === 0, errors };
}

const REQUIRED_EVENT_FIELDS = Object.freeze(["event"]);

function isMissing(value) {
  return value === undefined || value === null || value === UNKNOWN || value === "";
}

function validateUpcomingEventInput(event) {
  const structural = validateUpcomingEventStructure(event);
  const missingFields = REQUIRED_EVENT_FIELDS.filter((f) => isMissing(event[f]));
  return { valid: structural.valid && missingFields.length === 0, structuralErrors: structural.errors, missingFields };
}

function processUpcomingEvents(rawEvents, options = {}) {
  if (!Array.isArray(rawEvents)) return { validated: [], rejected: [] };

  const validated = [];
  const rejected = [];

  for (const raw of rawEvents) {
    const event = normalizeUpcomingEvent(raw, options.fieldMap || {});
    const validation = validateUpcomingEventInput(event);
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

    if (event.verification_status === UNKNOWN) {
      event.verification_status = SOURCE_VERIFICATION_STATES.UNVERIFIED;
    }

    validated.push(event);
  }

  return { validated, rejected };
}

module.exports = {
  UPCOMING_EVENT_FIELDS,
  createUpcomingEvent,
  normalizeUpcomingEvent,
  validateUpcomingEventStructure,
  validateUpcomingEventInput,
  processUpcomingEvents,
};
