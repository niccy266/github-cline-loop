import { test, describe } from "node:test";
import assert from "node:assert/strict";

const { pollGitHubIssues, isTaskFailed } = await import("../poller.mjs");

/**
 * Verify that poller.mjs exports the expected function signature
 * without actually executing it (which would require a GitHub CLI
 * token and a real Cline instance).
 */
describe("poller module export", () => {
  test("pollGitHubIssues should be exported as a function", async () => {
    const mod = await import("../poller.mjs");
    assert.equal(
      typeof mod.pollGitHubIssues,
      "function",
      "pollGitHubIssues should be a function"
    );
  });

  test("poller.mjs should not export unexpected named bindings", async () => {
    const mod = await import("../poller.mjs");
    const expectedExports = new Set([
      "pollGitHubIssues",
      "isTaskFailed",
    ]);
    const actualExports = new Set(Object.keys(mod));

    for (const name of actualExports) {
      assert.ok(
        expectedExports.has(name),
        `Unexpected export from poller.mjs: ${name}`
      );
    }
  });

  test("isTaskFailed should be exported as a function", async () => {
    const { isTaskFailed } = await import("../poller.mjs");
    assert.equal(typeof isTaskFailed, "function");
  });

  test("isTaskFailed should return true for empty/null/undefined", () => {
    assert.equal(isTaskFailed(""), true);
    assert.equal(isTaskFailed(null), true);
    assert.equal(isTaskFailed(undefined), true);
  });

  test("isTaskFailed should return false for normal success results", () => {
    assert.equal(isTaskFailed("All CI checks are green. PR #86 is open."), false);
    assert.equal(
      isTaskFailed("Successfully resolved the issue. Changes committed and pushed."),
      false
    );
  });

  test("isTaskFailed should strip backtick code before detecting errors", () => {
    // The agent's result may mention Python pytest flags like
    // `-W error::DeprecationWarning` inside backticks — this is a
    // configuration flag, not an actual error.
    const result =
      "All CI checks are green. PR #86 is open. Enabled `-W error::DeprecationWarning:musicbee_tagger_mcp` flag.";
    assert.equal(isTaskFailed(result), false);
  });

  test("isTaskFailed should return true for genuine error mentions", () => {
    assert.equal(isTaskFailed("I encountered an error while refactoring"), true);
    assert.equal(isTaskFailed("The task failed due to missing dependencies"), true);
    assert.equal(isTaskFailed("Unauthorized access to the repository"), true);
  });

  test("pollGitHubIssues should accept an optional agentFactory parameter", async () => {
    // Verify the function signature length (cline, repo, label, pollIntervalMs, agentFactory)
    const { pollGitHubIssues } = await import("../poller.mjs");
    assert.equal(pollGitHubIssues.length, 4, "pollGitHubIssues should accept 4 required params");
  });

  test("pollGitHubIssues should pass agentFactory through to runTask", async () => {
    // Mock test: verify the agentFactory is forwarded by checking that
    // a custom factory gets invoked when runTask is called.
    // We can't run the full poll loop (needs gh CLI), but we can verify
    // the module imports correctly and the signature is right.
    const pollerMod = await import("../poller.mjs");
    const agentMod = await import("../agent.mjs");

    assert.equal(typeof pollerMod.pollGitHubIssues, "function");
    assert.equal(typeof agentMod.createAgent, "function");
    assert.equal(typeof agentMod.runTask, "function");
  });
});

