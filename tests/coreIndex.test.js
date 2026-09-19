// The core/ barrel (core/index.js) re-exports every shared contract so a
// consumer can `require("../core")` instead of reaching into each file.
// Nothing in the repository imports it today, which is exactly why it
// needs a test: without one, a new module added under core/ can be left
// out of the barrel indefinitely and nobody finds out (core/dedupe.js
// was, until this test was added). This asserts the barrel stays a
// complete, faithful re-export — it does not test any contract's own
// behavior, which each module's own suite already covers.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CORE_DIR = path.join(__dirname, "..", "core");
const barrel = require("../core");

function coreModuleFiles() {
  return fs
    .readdirSync(CORE_DIR)
    .filter((name) => name.endsWith(".js") && !name.endsWith(".test.js") && name !== "index.js")
    .sort();
}

test("core barrel re-exports every module under core/", () => {
  const missing = [];
  for (const file of coreModuleFiles()) {
    const moduleExports = require(path.join(CORE_DIR, file));
    for (const name of Object.keys(moduleExports)) {
      if (!(name in barrel)) missing.push(`${file}:${name}`);
    }
  }
  assert.deepEqual(missing, [], `core/index.js is missing re-exports: ${missing.join(", ")}`);
});

test("core barrel re-exports the identical binding, never a copy", () => {
  for (const file of coreModuleFiles()) {
    const moduleExports = require(path.join(CORE_DIR, file));
    for (const [name, value] of Object.entries(moduleExports)) {
      assert.equal(barrel[name], value, `core/index.js's ${name} is not the same binding as ${file}'s`);
    }
  }
});

test("core barrel exports no name that no core module actually defines", () => {
  const defined = new Set();
  for (const file of coreModuleFiles()) {
    for (const name of Object.keys(require(path.join(CORE_DIR, file)))) defined.add(name);
  }
  for (const name of Object.keys(barrel)) {
    assert.ok(defined.has(name), `core/index.js exports "${name}", which no core module defines`);
  }
});
