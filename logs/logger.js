// Section 9 — Logging Foundation. Structured, append-only JSON-lines
// logging to logs/system.log. Never logs secrets: any key that looks
// credential-like is redacted before the entry is written, regardless
// of where in the object it appears.

const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "system.log");

const REDACTED_KEYS = new Set([
  "apikey",
  "api_key",
  "key",
  "token",
  "secret",
  "password",
  "authorization",
  "credential",
  "credentials",
]);

function redact(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redact);
  const clean = {};
  for (const [k, v] of Object.entries(value)) {
    clean[k] = REDACTED_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : redact(v);
  }
  return clean;
}

// Structured log entry covering: timestamp, agent, request, data
// source, response status, warnings, errors, final decision — per the
// Step 3 spec. Unsupplied fields are recorded as UNKNOWN/empty, never
// guessed.
function logEvent({ agent, request, dataSource, responseStatus, warnings, errors, finalDecision } = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    agent: agent ?? "UNKNOWN",
    request: request !== undefined ? redact(request) : null,
    data_source: dataSource ?? "UNKNOWN",
    response_status: responseStatus ?? "UNKNOWN",
    warnings: warnings ?? [],
    errors: errors ?? [],
    final_decision: finalDecision ?? null,
  };

  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch (err) {
    // Logging must never crash the system it's observing.
    console.error("Failed to write log entry:", err.message);
  }

  return entry;
}

module.exports = { logEvent, redact, LOG_FILE };
