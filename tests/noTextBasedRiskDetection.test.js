// Step 101 — static guard: no production risk-detection logic may
// determine stale/unverified risk by pattern-matching a human-readable
// explanation string. Source (not built output) is read directly and
// scanned for the specific fragile patterns this step removed; a
// regression here means someone reintroduced text-based detection.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RISK_DETECTION_FILES = [
  path.join(__dirname, "..", "agents", "risk-manager", "dataQuality.js"),
  path.join(__dirname, "..", "agents", "trade-setup-agent", "risks.js"),
];

// Matches `<something>.includes("STALE")` / `.includes('STALE')` and the
// old case-normalized UNVERIFIED substring check
// (`.toUpperCase().includes("UNVERIFIED")`) — the exact fragile
// mechanisms Step 101 replaced with structured-field checks.
const TEXT_BASED_STALE_PATTERN = /\.includes\(\s*["']STALE["']\s*\)/;
const TEXT_BASED_UNVERIFIED_PATTERN = /\.toUpperCase\(\)\s*\.includes\(\s*["']UNVERIFIED["']\s*\)/;

test("6. no production risk-detection file depends on text.includes(\"STALE\") or a normalized UNVERIFIED substring check", () => {
  for (const file of RISK_DETECTION_FILES) {
    const source = fs.readFileSync(file, "utf8");
    assert.equal(
      TEXT_BASED_STALE_PATTERN.test(source),
      false,
      `${path.basename(file)} still contains a text.includes("STALE") style check`
    );
    assert.equal(
      TEXT_BASED_UNVERIFIED_PATTERN.test(source),
      false,
      `${path.basename(file)} still contains a text-based UNVERIFIED substring check`
    );
  }
});
