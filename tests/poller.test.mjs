import { test, describe } from "node:test";
import assert from "node:assert/strict";

/**
 * Verify that poller.mjs exports the expected function signature
 * without actually executing it (which would require a GitHub CLI
 * token and a real Cline instance).
 */
describe("poller module export", () => {
  test("pollGitHubIssues should be exported as a function", async () => {
    // Dynamically import so that if the module fails to load the
    // test reports the error rather than crashing the whole suite.
    const mod = await import("../poller.mjs");
    assert.equal(
      typeof mod.pollGitHubIssues,
      "function",
      "pollGitHubIssues should be a function"
    );
  });

  test("poller.mjs should not export unexpected named bindings", async () => {
    const mod = await import("../poller.mjs");
    const expectedExports = new Set(["pollGitHubIssues"]);
    const actualExports = new Set(Object.keys(mod));

    for (const name of actualExports) {
      assert.ok(
        expectedExports.has(name),
        `Unexpected export from poller.mjs: ${name}`
      );
    }
  });
});
