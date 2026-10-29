import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Collect every .mjs source file in the project root (excluding
 * node_modules and the tests/ directory whose files are the
 * test suite itself).
 */
function collectSourceFiles() {
  const root = process.cwd();
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".mjs")
    )
    .map((entry) => entry.name);
}

describe("syntax validation", () => {
  const files = collectSourceFiles();

  test("all source .mjs files should be syntactically valid", () => {
    const errors = [];
    for (const file of files) {
      try {
        execFileSync("node", ["--check", file], {
          cwd: process.cwd(),
          encoding: "utf8",
          stdio: "pipe",
        });
      } catch (err) {
        errors.push(`${file}: ${err.message}`);
      }
    }
    assert.equal(
      errors.length,
      0,
      `Syntax errors found:\n${errors.join("\n")}`
    );
  });

  test("should include expected source modules", () => {
    assert.ok(
      files.includes("index.mjs"),
      "index.mjs should be found"
    );
    assert.ok(
      files.includes("poller.mjs"),
      "poller.mjs should be found"
    );
    assert.ok(
      files.includes("agent.mjs"),
      "agent.mjs should be found"
    );
    assert.ok(
      files.includes("logger.mjs"),
      "logger.mjs should be found"
    );
  });
});
