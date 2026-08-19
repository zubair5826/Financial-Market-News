const test = require("node:test");
const assert = require("node:assert/strict");
const { processUpcomingEvents } = require("./events");

test("processUpcomingEvents accepts a valid event with a scheduled_time", () => {
  const { validated } = processUpcomingEvents([{ event: "CPI Release", scheduled_time: "2026-09-01T12:30:00Z", country: "US" }]);
  assert.equal(validated.length, 1);
  assert.equal(validated[0].scheduled_time, "2026-09-01T12:30:00Z");
});

test("processUpcomingEvents keeps scheduled_time as UNKNOWN when not supplied, never invents one", () => {
  const { validated } = processUpcomingEvents([{ event: "CPI Release" }]);
  assert.equal(validated.length, 1);
  assert.equal(validated[0].scheduled_time, "UNKNOWN");
});

test("processUpcomingEvents rejects an event with no event name", () => {
  const { validated, rejected } = processUpcomingEvents([{ scheduled_time: "2026-09-01T12:30:00Z" }]);
  assert.equal(validated.length, 0);
  assert.equal(rejected.length, 1);
});

test("processUpcomingEvents defaults verification_status to UNVERIFIED for a lone source", () => {
  const { validated } = processUpcomingEvents([{ event: "CPI Release" }]);
  assert.equal(validated[0].verification_status, "UNVERIFIED");
});
