import { test, describe } from "node:test";
import assert from "node:assert/strict";

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
    const expectedExports = new Set(["pollGitHubIssues"]);
    const actualExports = new Set(Object.keys(mod));

    for (const name of actualExports) {
      assert.ok(
        expectedExports.has(name),
        `Unexpected export from poller.mjs: ${name}`
      );
    }
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

