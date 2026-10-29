import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { logger } from "../logger.mjs";

describe("logger module", () => {
  test("logger should be exported as an object", () => {
    assert.ok(logger, "logger should be truthy");
    assert.equal(typeof logger, "object");
  });

  test("logger should expose a child() method", () => {
    assert.equal(typeof logger.child, "function");
  });

  test("logger should expose standard pino log methods", () => {
    for (const method of ["info", "warn", "error", "debug", "fatal", "trace"]) {
      assert.equal(
        typeof logger[method],
        "function",
        `logger.${method} should be a function`
      );
    }
  });

  test("logger.child() should return a functioning child logger", () => {
    const child = logger.child({ test: true });
    assert.ok(child, "child logger should be truthy");
    assert.equal(typeof child.info, "function");
    assert.equal(typeof child.error, "function");
  });
});
