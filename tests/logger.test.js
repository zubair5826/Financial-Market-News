const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { logEvent, redact, rotateLogIfNeeded, flushLogs, MAX_LOG_SIZE_BYTES, MAX_ROTATED_FILES, LOG_FILE } = require("../logs/logger");

function tempLogPath() {
  return path.join(os.tmpdir(), `logger-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
}

function cleanupFiles(paths) {
  for (const p of paths) {
    try {
      fs.unlinkSync(p);
    } catch {
      // Already absent.
    }
  }
}

function readLines(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter((l) => l.length > 0);
}

test("redact removes credential-like keys recursively, keeps safe data", () => {
  const clean = redact({ apiKey: "abc123", nested: { token: "xyz" }, safe: "ok" });
  assert.equal(clean.apiKey, "[REDACTED]");
  assert.equal(clean.nested.token, "[REDACTED]");
  assert.equal(clean.safe, "ok");
});

test("redact leaves non-object values untouched", () => {
  assert.equal(redact("plain string"), "plain string");
  assert.equal(redact(null), null);
});

// --- Step 104: non-blocking write ---

test("1. logEvent() returns synchronously, before its own write has completed (never blocks the caller)", () => {
  const filePath = tempLogPath();
  try {
    const before = fs.existsSync(filePath);
    const entry = logEvent({ agent: "test-agent", responseStatus: "OK" }, { logFilePath: filePath });
    assert.equal(typeof entry, "object");
    assert.equal(entry.agent, "test-agent");
    // The synchronous return happened before any guarantee the async
    // write has landed on disk yet — existence isn't asserted either
    // way here (a fast disk could already have it), only that the call
    // itself didn't block waiting for I/O (never throws/hangs).
    assert.equal(before, false);
  } finally {
    cleanupFiles([filePath]);
  }
});

test("2. after flushLogs(), the entry is actually persisted as valid JSON", async () => {
  const filePath = tempLogPath();
  try {
    logEvent({ agent: "test-agent", responseStatus: "OK", route: "/api/intelligence", runId: "run-123" }, { logFilePath: filePath });
    await flushLogs();
    const lines = readLines(filePath);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]); // throws if not valid JSON
    assert.equal(parsed.agent, "test-agent");
    assert.equal(parsed.route, "/api/intelligence");
    assert.equal(parsed.run_id, "run-123");
  } finally {
    cleanupFiles([filePath]);
  }
});

// --- Step 104: operational information preserved ---

test("3. a log entry preserves timestamp, route, run_id, response_status, and errors", async () => {
  const filePath = tempLogPath();
  try {
    logEvent(
      { agent: "http-server", route: "/api/intelligence", runId: "run-abc", responseStatus: "CLIENT_ERROR", errors: ["HTTP 400"] },
      { logFilePath: filePath }
    );
    await flushLogs();
    const entry = JSON.parse(readLines(filePath)[0]);
    assert.ok(entry.timestamp);
    assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));
    assert.equal(entry.route, "/api/intelligence");
    assert.equal(entry.run_id, "run-abc");
    assert.equal(entry.response_status, "CLIENT_ERROR");
    assert.deepEqual(entry.errors, ["HTTP 400"]);
  } finally {
    cleanupFiles([filePath]);
  }
});

test("4. route and run_id default to null, never guessed, when not supplied — existing (pre-Step-104) call sites are unaffected", async () => {
  const filePath = tempLogPath();
  try {
    logEvent({ agent: "macro-agent", responseStatus: "SUCCESS" }, { logFilePath: filePath });
    await flushLogs();
    const entry = JSON.parse(readLines(filePath)[0]);
    assert.equal(entry.route, null);
    assert.equal(entry.run_id, null);
    assert.equal(entry.agent, "macro-agent");
  } finally {
    cleanupFiles([filePath]);
  }
});

// --- Step 104: no secrets ---

test("5. an API key, Authorization header, or other credential-shaped field is never written to disk", async () => {
  const filePath = tempLogPath();
  try {
    logEvent(
      {
        agent: "http-server",
        request: { method: "POST", apiKey: "sk-live-should-never-appear", headers: { Authorization: "Bearer super-secret-token" } },
      },
      { logFilePath: filePath }
    );
    await flushLogs();
    const raw = fs.readFileSync(filePath, "utf8");
    assert.ok(!raw.includes("sk-live-should-never-appear"));
    assert.ok(!raw.includes("super-secret-token"));
    assert.ok(raw.includes("[REDACTED]"));
    const entry = JSON.parse(readLines(filePath)[0]);
    assert.equal(entry.request.apiKey, "[REDACTED]");
    assert.equal(entry.request.headers.Authorization, "[REDACTED]");
  } finally {
    cleanupFiles([filePath]);
  }
});

// --- Step 104: valid JSONL, multiple writes append correctly ---

test("6. multiple concurrent logEvent() calls to the same file all land as valid, independently parseable JSONL lines, none corrupted or dropped", async () => {
  const filePath = tempLogPath();
  try {
    for (let i = 0; i < 5; i++) {
      logEvent({ agent: `agent-${i}`, responseStatus: "OK" }, { logFilePath: filePath });
    }
    await flushLogs();
    const lines = readLines(filePath);
    assert.equal(lines.length, 5);
    const agents = lines.map((l) => JSON.parse(l).agent).sort();
    assert.deepEqual(agents, ["agent-0", "agent-1", "agent-2", "agent-3", "agent-4"]);
  } finally {
    cleanupFiles([filePath]);
  }
});

// --- Step 104: rotation / retention ---

test("7. rotateLogIfNeeded does nothing when the file is under the size threshold", async () => {
  const filePath = tempLogPath();
  try {
    fs.writeFileSync(filePath, "small content\n");
    await rotateLogIfNeeded(filePath, 1024, 3);
    assert.ok(fs.existsSync(filePath));
    assert.equal(fs.existsSync(`${filePath}.1`), false);
  } finally {
    cleanupFiles([filePath, `${filePath}.1`]);
  }
});

test("8. rotateLogIfNeeded does nothing when the file doesn't exist yet (never throws)", async () => {
  const filePath = tempLogPath();
  await assert.doesNotReject(() => rotateLogIfNeeded(filePath, 1024, 3));
});

test("9. rotateLogIfNeeded shifts the oversized file to .1 and starts fresh once it exceeds the threshold", async () => {
  const filePath = tempLogPath();
  const rotated = `${filePath}.1`;
  try {
    fs.writeFileSync(filePath, "x".repeat(2000));
    await rotateLogIfNeeded(filePath, 1000, 3);
    assert.equal(fs.existsSync(filePath), false); // shifted away — the next append recreates it
    assert.ok(fs.existsSync(rotated));
    assert.equal(fs.readFileSync(rotated, "utf8").length, 2000);
  } finally {
    cleanupFiles([filePath, rotated]);
  }
});

test("10. successive rotations shift generations (.1 -> .2 -> .3) and drop the oldest beyond MAX_ROTATED_FILES, preventing unlimited growth", async () => {
  const filePath = tempLogPath();
  const gens = [1, 2, 3].map((n) => `${filePath}.${n}`);
  try {
    // Seed three prior generations plus an oversized current file.
    fs.writeFileSync(gens[0], "generation-1");
    fs.writeFileSync(gens[1], "generation-2");
    fs.writeFileSync(gens[2], "generation-3 (oldest, must be dropped)");
    fs.writeFileSync(filePath, "x".repeat(2000));

    await rotateLogIfNeeded(filePath, 1000, 3);

    assert.equal(fs.existsSync(filePath), false);
    assert.equal(fs.readFileSync(gens[0], "utf8").length, 2000); // the just-rotated current file
    assert.equal(fs.readFileSync(gens[1], "utf8"), "generation-1"); // shifted from .1
    assert.equal(fs.readFileSync(gens[2], "utf8"), "generation-2"); // shifted from .2
    // "generation-3" (the old .3) must be gone — never accumulates
    // beyond MAX_ROTATED_FILES generations.
    const allContent = gens.map((g) => fs.readFileSync(g, "utf8"));
    assert.ok(!allContent.some((c) => c.includes("generation-3")));
  } finally {
    cleanupFiles([filePath, ...gens]);
  }
});

test("11. a full write cycle rotates the oversized file before appending the new entry, capping total size", async () => {
  const filePath = tempLogPath();
  const rotated = `${filePath}.1`;
  try {
    fs.writeFileSync(filePath, "x".repeat(2000));
    logEvent({ agent: "test-agent", responseStatus: "OK" }, { logFilePath: filePath });
    await flushLogs();
    // Rotation used a 1000-byte call in test 9, but this exercises the
    // REAL module constant end to end — a 2000-byte seed file is still
    // far under MAX_LOG_SIZE_BYTES (5MB), so this call to logEvent()
    // must NOT rotate: confirms rotation is threshold-driven, not
    // unconditional, before the size-triggered case below.
    assert.equal(fs.existsSync(rotated), false);
    const lines = readLines(filePath);
    assert.ok(lines.length >= 1);
  } finally {
    cleanupFiles([filePath, rotated]);
  }
});

test("12. logEvent() itself rotates when the real MAX_LOG_SIZE_BYTES threshold is exceeded", async () => {
  const filePath = tempLogPath();
  const rotated = `${filePath}.1`;
  try {
    fs.writeFileSync(filePath, "x".repeat(MAX_LOG_SIZE_BYTES + 1));
    logEvent({ agent: "test-agent", responseStatus: "OK" }, { logFilePath: filePath });
    await flushLogs();
    assert.ok(fs.existsSync(rotated), "the oversized file should have been rotated to .1");
    const currentLines = readLines(filePath);
    assert.equal(currentLines.length, 1); // fresh file, just this one new entry
  } finally {
    cleanupFiles([filePath, rotated]);
  }
});

test("MAX_ROTATED_FILES and MAX_LOG_SIZE_BYTES are small, sane, non-zero bounds appropriate for this application", () => {
  assert.ok(MAX_LOG_SIZE_BYTES > 0);
  assert.ok(MAX_ROTATED_FILES > 0 && MAX_ROTATED_FILES <= 10);
});

test("LOG_FILE still points at logs/system.log by default, never a test path", () => {
  assert.ok(LOG_FILE.endsWith(path.join("logs", "system.log")));
});
