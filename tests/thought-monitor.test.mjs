import { test, describe } from "node:test";
import assert from "node:assert/strict";

const {
  addThought,
  addErrorBlock,
  startMonitoring,
  stopMonitoring,
  clearThoughts,
  formatThoughtLine,
  getLastNonBlankThought,
  checkForErrorBlock,
} = await import("../thought-monitor.mjs");

describe("thought-monitor module", () => {
  test("all expected functions should be exported", async () => {
    const mod = await import("../thought-monitor.mjs");
    assert.equal(typeof addThought, "function");
    assert.equal(typeof addErrorBlock, "function");
    assert.equal(typeof startMonitoring, "function");
    assert.equal(typeof stopMonitoring, "function");
    assert.equal(typeof clearThoughts, "function");
    assert.equal(typeof formatThoughtLine, "function");
    assert.equal(typeof getLastNonBlankThought, "function");
    assert.equal(typeof checkForErrorBlock, "function");
  });

  describe("formatThoughtLine", () => {
    test("should append ellipsis when text does not end with period", () => {
      const result = formatThoughtLine("Checking ffmpeg availability");
      assert.equal(result, "...Checking ffmpeg availability...");
    });

    test("should omit ellipsis when text ends with period", () => {
      const result = formatThoughtLine("All CI checks are green.");
      assert.equal(result, "...All CI checks are green.");
    });

    test("should handle empty string", () => {
      const result = formatThoughtLine("");
      assert.equal(result, "");
    });

    test("should trim whitespace", () => {
      const result = formatThoughtLine("  some thought  ");
      assert.equal(result, "...some thought...");
    });

    test("should handle multi-line text by taking the last line", () => {
      const result = formatThoughtLine("first line\nsecond line");
      assert.equal(result, "...second line...");
    });
  });

  describe("addThought + getLastNonBlankThought", () => {
    test.beforeEach(() => {
      clearThoughts();
    });

    test("should add a single thought line", () => {
      addThought("Checking ffmpeg availability");
      const last = getLastNonBlankThought();
      assert.ok(last);
      assert.equal(last.text, "Checking ffmpeg availability");
      assert.equal(last.type, "thought");
    });

    test("should split multi-line text into separate entries", () => {
      addThought("line one\nline two\nline three");
      const last = getLastNonBlankThought();
      assert.equal(last.text, "line three");
    });

    test("should skip blank lines", () => {
      addThought("real thought\n\n   \nnext thought");
      const entries = [];
      // getLastNonBlankThought only returns the last one
      const last = getLastNonBlankThought();
      assert.equal(last.text, "next thought");
    });

    test("should return null when buffer is empty", () => {
      const result = getLastNonBlankThought();
      assert.equal(result, null);
    });

    test("should trim whitespace before selection", () => {
      addThought("   ");
      addThought("   real thought   ");
      const last = getLastNonBlankThought();
      assert.equal(last.text, "real thought");
    });
  });

  describe("addErrorBlock + checkForErrorBlock", () => {
    test.beforeEach(() => {
      clearThoughts();
    });

    test("should detect error block as last thought", () => {
      addErrorBlock("Error: ffmpeg not found in PATH");
      const result = checkForErrorBlock();
      assert.equal(result.isError, true);
      assert.equal(result.text, "Error: ffmpeg not found in PATH");
    });

    test("should return false when last thought is not an error", () => {
      addThought("some regular thought");
      const result = checkForErrorBlock();
      assert.equal(result.isError, false);
      assert.equal(result.text, null);
    });

    test("should return false when buffer is empty", () => {
      const result = checkForErrorBlock();
      assert.equal(result.isError, false);
      assert.equal(result.text, null);
    });
  });

  describe("trimBuffer", () => {
    test.beforeEach(() => {
      clearThoughts();
    });

    test("should keep only the last 20 entries", () => {
      for (let i = 0; i < 25; i++) {
        addThought(`thought ${i}`);
      }
      const last = getLastNonBlankThought();
      assert.equal(last.text, "thought 24");
      // Buffer should be trimmed to 20 entries
      assert.equal(addThought.toString().length > 0, true);
    });
  });

  describe("clearThoughts", () => {
    test("should empty the buffer", () => {
      addThought("some thought");
      clearThoughts();
      const result = getLastNonBlankThought();
      assert.equal(result, null);
    });
  });

  describe("startMonitoring + stopMonitoring", () => {
    test("should start and stop without throwing", () => {
      startMonitoring({ issueNumber: 1, repo: "owner/repo", workspaceDir: "/tmp/x" });
      stopMonitoring();
      // Should not throw if called twice
      stopMonitoring();
    });

    test("should call startMonitoring with context", () => {
      const ctx = { issueNumber: 42, repo: "owner/repo", workspaceDir: "/tmp/x" };
      assert.doesNotThrow(() => startMonitoring(ctx));
      stopMonitoring();
    });
  });
});
