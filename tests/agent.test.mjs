import { test, describe } from "node:test";
import assert from "node:assert/strict";

/**
 * Verify that agent.mjs exports the expected utilities for agent
 * lifecycle management without creating a real ClineCore instance.
 */
describe("agent module", () => {
  test("should export the expected named bindings", async () => {
    const mod = await import("../agent.mjs");
    const expectedExports = new Set([
      "MAX_ATTEMPTS",
      "RETRY_DELAY_MS",
      "isSocketError",
      "disposeAgent",
      "createAgent",
      "runTask",
    ]);
    const actualExports = new Set(
      Object.keys(mod).filter((k) => !k.startsWith("default"))
    );

    for (const name of expectedExports) {
      assert.ok(
        actualExports.has(name),
        `Expected export missing from agent.mjs: ${name}`
      );
    }
  });

  test("MAX_ATTEMPTS should be a reasonable retry count", async () => {
    const { MAX_ATTEMPTS } = await import("../agent.mjs");
    assert.equal(typeof MAX_ATTEMPTS, "number");
    assert.ok(MAX_ATTEMPTS >= 1 && MAX_ATTEMPTS <= 20);
  });

  test("RETRY_DELAY_MS should be a positive number", async () => {
    const { RETRY_DELAY_MS } = await import("../agent.mjs");
    assert.equal(typeof RETRY_DELAY_MS, "number");
    assert.ok(RETRY_DELAY_MS > 0);
  });

  test("isSocketError should detect socket-related errors", async () => {
    const { isSocketError } = await import("../agent.mjs");

    const socketErrors = [
      new Error("getaddrinfo UND_ERR_SOCKET getaddrinfo"),
      new Error("SocketError: other side closed"),
      new Error("Connection terminated unexpectedly"),
      new Error("socket hang up"),
    ];

    for (const err of socketErrors) {
      assert.equal(
        isSocketError(err),
        true,
        `Should detect socket error: ${err.message}`
      );
    }
  });

  test("isSocketError should return false for non-socket errors", async () => {
    const { isSocketError } = await import("../agent.mjs");

    const otherErrors = [
      new Error("Unauthorized"),
      new Error("API key invalid"),
      new Error("Model not found"),
      new Error("Rate limit exceeded"),
    ];

    for (const err of otherErrors) {
      assert.equal(
        isSocketError(err),
        false,
        `Should not flag as socket error: ${err.message}`
      );
    }
  });

  test("isSocketError should handle non-Error inputs", async () => {
    const { isSocketError } = await import("../agent.mjs");

    assert.equal(isSocketError(null), false);
    assert.equal(isSocketError(undefined), false);
    assert.equal(isSocketError("some string"), false);
    assert.equal(isSocketError({}), false);
  });

  test("disposeAgent should be safe to call with null/undefined", async () => {
    const { disposeAgent } = await import("../agent.mjs");

    // Should not throw
    await disposeAgent(null);
    await disposeAgent(undefined);
  });

  test("disposeAgent should be safe to call on objects without dispose()", async () => {
    const { disposeAgent } = await import("../agent.mjs");

    await disposeAgent({});
    await disposeAgent({ foo: "bar" });
  });

  test("disposeAgent should call dispose() on valid objects", async () => {
    const { disposeAgent } = await import("../agent.mjs");

    let disposed = false;
    const fakeAgent = {
      dispose: async (reason) => {
        disposed = true;
        assert.equal(typeof reason, "string");
      },
    };

    await disposeAgent(fakeAgent);
    assert.equal(disposed, true, "dispose() should have been called");
  });

  test("createAgent and runTask should be functions", async () => {
    const { createAgent, runTask } = await import("../agent.mjs");
    assert.equal(typeof createAgent, "function");
    assert.equal(typeof runTask, "function");
  });
});

