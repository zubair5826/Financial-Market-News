// Section 9 — Logging Foundation, hardened in Step 104. Structured,
// append-only JSON-lines logging to logs/system.log. Never logs
// secrets: any key that looks credential-like is redacted before the
// entry is written, regardless of where in the object it appears.
//
// Step 104 audit found three concerns, all fixed entirely within this
// one file — no agent, orchestrator, or existing call site had to
// change to pick up the fix (server.js gained new, additive
// request-level log calls of its own; see its own comments):
//
//   1. Blocking synchronous writes: every one of this project's ~9
//      logEvent() call sites (every agent, the orchestrator) fires
//      this function synchronously and never awaits or reads its
//      return value. logEvent() itself now performs its actual disk
//      write with fs.promises.appendFile() (non-blocking to Node's
//      event loop) instead of fs.appendFileSync(), while still
//      returning the built entry synchronously and immediately — every
//      existing call site is unaffected. Writes are serialized through
//      one internal promise chain (writeQueue) so concurrent calls
//      (several agents logging within the same request) can never
//      interleave a rotation with another call's append — a small,
//      self-contained queue, not a logging framework.
//   2/3. Unlimited growth / rotation: system.log had grown to ~16MB
//      with no cap and no rotation. Before every write,
//      rotateLogIfNeeded() checks the target file's size; once it
//      exceeds MAX_LOG_SIZE_BYTES, the file is shifted
//      system.log -> system.log.1 -> system.log.2 (up to
//      MAX_ROTATED_FILES generations), the oldest generation deleted,
//      and a fresh system.log started. This is a simple, size-based
//      rotation appropriate for this application's actual log volume
//      (a handful of structured lines per request) — not a
//      time-based/external tool (logrotate, a rotating-file-stream
//      dependency), which would be more machinery than this Node
//      application currently needs. A stat/rotation failure is treated
//      as "don't rotate this time," never as a reason to drop or block
//      the log write itself.
//   4. Secrets: redact() (pre-existing, unchanged) strips any
//      apikey/api_key/key/token/secret/password/authorization/
//      credential/credentials-named field recursively and
//      case-insensitively — covering both this project's own naming
//      conventions and "Authorization" HTTP headers. Every entry's
//      `request` field passes through it before being serialized;
//      nothing here ever logs a raw header block or full request body.

const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "system.log");
const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB — see module comment.
const MAX_ROTATED_FILES = 3; // system.log.1 .. system.log.3, oldest dropped beyond this

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

// Shifts logFilePath -> logFilePath.1 -> ... -> logFilePath.maxRotated,
// dropping whatever already occupies the oldest generation, but only
// when logFilePath currently exceeds maxSizeBytes. Exported directly
// (path-parameterized, no dependency on the module's own LOG_FILE) so
// it can be exercised against a throwaway temp file in tests, exactly
// like data/runStore.js's own injectable-path convention. A missing
// file (nothing to rotate yet) or a stat/rename failure is treated as
// "no rotation this time" — this must never throw and block a log
// write over a rotation problem.
async function rotateLogIfNeeded(logFilePath, maxSizeBytes, maxRotated) {
  let stats;
  try {
    stats = await fs.promises.stat(logFilePath);
  } catch {
    return; // file doesn't exist yet — nothing to rotate
  }
  if (stats.size < maxSizeBytes) return;

  for (let generation = maxRotated; generation >= 1; generation--) {
    const source = generation === 1 ? logFilePath : `${logFilePath}.${generation - 1}`;
    const destination = `${logFilePath}.${generation}`;
    try {
      if (generation === maxRotated) {
        await fs.promises.unlink(destination).catch(() => {});
      }
      await fs.promises.rename(source, destination);
    } catch {
      // Source for this generation doesn't exist yet (fewer than
      // maxRotated rotations have happened so far) — nothing to shift.
    }
  }
}

// Serializes every write (a possible rotation, then the append) through
// one promise chain so concurrent logEvent() calls can never race a
// rotation against another call's append. Returned so tests can await
// a specific write's completion (see flushLogs() below) — no caller
// outside this file and its own tests ever needs this promise.
let writeQueue = Promise.resolve();

function writeLogLine(logFilePath, line) {
  writeQueue = writeQueue
    .then(() => rotateLogIfNeeded(logFilePath, MAX_LOG_SIZE_BYTES, MAX_ROTATED_FILES))
    .then(() => fs.promises.appendFile(logFilePath, line))
    .catch((err) => {
      // Logging must never crash the system it's observing.
      console.error("Failed to write log entry:", err.message);
    });
  return writeQueue;
}

// Lets a test wait for every log write queued so far (including
// whatever rotation it triggered) to actually finish before asserting
// file contents — logEvent() itself stays synchronous-returning for
// every real call site, exactly as before Step 104.
function flushLogs() {
  return writeQueue;
}

// Structured log entry covering: timestamp, agent, request, data
// source, response status, warnings, errors, final decision — per the
// Step 3 spec, extended in Step 104 with `route`/`runId` for
// HTTP-level operational visibility (see server.js). Unsupplied fields
// are recorded as UNKNOWN/empty/null, never guessed.
//
// testOptions.logFilePath: overrides the target file — exists solely
// for offline test injection (mirrors data/runStore.js's own
// persistRun(record, { filePath })); no real call site anywhere in
// this project ever supplies it.
function logEvent(
  { agent, request, dataSource, responseStatus, warnings, errors, finalDecision, route, runId } = {},
  testOptions = {}
) {
  const entry = {
    timestamp: new Date().toISOString(),
    agent: agent ?? "UNKNOWN",
    route: route ?? null,
    run_id: runId ?? null,
    request: request !== undefined ? redact(request) : null,
    data_source: dataSource ?? "UNKNOWN",
    response_status: responseStatus ?? "UNKNOWN",
    warnings: warnings ?? [],
    errors: errors ?? [],
    final_decision: finalDecision ?? null,
  };

  const logFilePath = testOptions.logFilePath || LOG_FILE;
  writeLogLine(logFilePath, JSON.stringify(entry) + "\n");

  return entry;
}

module.exports = {
  logEvent,
  redact,
  LOG_FILE,
  MAX_LOG_SIZE_BYTES,
  MAX_ROTATED_FILES,
  rotateLogIfNeeded,
  flushLogs,
};
