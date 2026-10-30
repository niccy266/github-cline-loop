import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const {
  extractIssueNumber,
  findStaleSessions,
  readSessionMessages,
  trimMessages,
  releaseStaleClaim,
  deleteStaleSession,
  recoverStaleSessions,
  resolveSessionsDir,
} = await import("../session-recovery.mjs");

function createFakeSession(sessionsDir, sessionId, opts = {}) {
  const sessionDir = path.join(sessionsDir, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const metadata = {
    sessionId,
    status: opts.status || "running",
    startedAt: opts.startedAt || "2026-01-01T00:00:00Z",
    endedAt: opts.endedAt || null,
    exitCode: opts.exitCode || null,
    prompt: opts.prompt || `Please resolve GitHub Issue #82 in owner/repo.`,
    cwd: opts.cwd || "/app",
  };

  fs.writeFileSync(
    path.join(sessionDir, `${sessionId}.json`),
    JSON.stringify(metadata, null, 2)
  );

  const messages = opts.messages || [
    { id: "1", role: "user", content: [{ type: "text", text: "Hello" }] },
  ];

  fs.writeFileSync(
    path.join(sessionDir, `${sessionId}.messages.json`),
    JSON.stringify({ messages, version: 1 }, null, 2)
  );

  return sessionDir;
}

describe("session-recovery module", () => {
  test("all expected functions should be exported", async () => {
    const mod = await import("../session-recovery.mjs");
    assert.equal(typeof extractIssueNumber, "function");
    assert.equal(typeof findStaleSessions, "function");
    assert.equal(typeof readSessionMessages, "function");
    assert.equal(typeof trimMessages, "function");
    assert.equal(typeof releaseStaleClaim, "function");
    assert.equal(typeof deleteStaleSession, "function");
    assert.equal(typeof recoverStaleSessions, "function");
    assert.equal(typeof resolveSessionsDir, "function");
  });

  test("resolveSessionsDir should return a string path", () => {
    const dir = resolveSessionsDir();
    assert.equal(typeof dir, "string");
    assert.ok(dir.length > 0);
  });

  test("extractIssueNumber should parse 'Issue #N' from prompt", () => {
    const result = extractIssueNumber(
      "Please resolve GitHub Issue #42 in owner/repo."
    );
    assert.deepEqual(result, { issueNumber: 42, repo: "owner/repo" });
  });

  test("extractIssueNumber should handle multi-digit issue numbers", () => {
    const result = extractIssueNumber(
      "Working on Issue #12345 in some-org/some-repo."
    );
    assert.equal(result?.issueNumber, 12345);
    assert.equal(result?.repo, "some-org/some-repo");
  });

  test("extractIssueNumber should return null for prompts without issue reference", () => {
    assert.equal(extractIssueNumber("Some random prompt without issues"), null);
    assert.equal(extractIssueNumber(""), null);
    assert.equal(extractIssueNumber(null), null);
    assert.equal(extractIssueNumber(undefined), null);
    assert.equal(extractIssueNumber(123), null);
  });

  test("extractIssueNumber should handle prompts without repo suffix", () => {
    const result = extractIssueNumber("Fix Issue #7 now");
    assert.equal(result?.issueNumber, 7);
    assert.equal(result?.repo, null);
  });

  test("trimMessages should return empty for null/undefined/empty", () => {
    assert.deepEqual(trimMessages(null), []);
    assert.deepEqual(trimMessages(undefined), []);
    assert.deepEqual(trimMessages([]), []);
  });

  test("trimMessages should not trim when under the limit", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: "user",
      content: [{ type: "text", text: `msg ${i}` }],
    }));
    const result = trimMessages(messages, 50);
    assert.equal(result.length, 10);
  });

  test("trimMessages should keep first + last N when over limit", () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      role: "user",
      content: [{ type: "text", text: `msg ${i}` }],
    }));
    const result = trimMessages(messages, 10);
    assert.equal(result.length, 10);
    assert.equal(result[0].content[0].text, "msg 0");
    assert.equal(result[9].content[0].text, "msg 99");
  });

  test("trimMessages should handle exactly at limit", () => {
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: "user",
      content: [{ type: "text", text: `msg ${i}` }],
    }));
    const result = trimMessages(messages, 50);
    assert.equal(result.length, 50);
  });

  describe("findStaleSessions", () => {
    let tmpDir;

    test.beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-test-"));
    });

    test.afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("should return empty array when sessions dir does not exist", () => {
      const result = findStaleSessions(path.join(tmpDir, "nonexistent"));
      assert.deepEqual(result, []);
    });

    test("should return empty array when sessions dir is null", () => {
      const result = findStaleSessions(null);
      assert.deepEqual(result, []);
    });

    test("should find sessions with status 'running'", () => {
      createFakeSession(tmpDir, "sess-running-1", { status: "running" });
      createFakeSession(tmpDir, "sess-done-1", { status: "complete" });

      const result = findStaleSessions(tmpDir);
      assert.equal(result.length, 1);
      assert.equal(result[0].sessionId, "sess-running-1");
    });

    test("should include messages in stale session result", () => {
      createFakeSession(tmpDir, "sess-1", {
        status: "running",
        messages: [{ id: "1", role: "user", content: [] }],
      });

      const result = findStaleSessions(tmpDir);
      assert.equal(result.length, 1);
      assert.ok(Array.isArray(result[0].messages));
      assert.equal(result[0].messages.length, 1);
    });

    test("should skip directories with unreadable metadata", () => {
      const badDir = path.join(tmpDir, "sess-bad");
      fs.mkdirSync(badDir);
      fs.writeFileSync(path.join(badDir, "sess-bad.json"), "not valid json {");

      const result = findStaleSessions(tmpDir);
      assert.equal(result.length, 0);
    });

    test("should not treat 'failed' or 'complete' sessions as stale", () => {
      createFakeSession(tmpDir, "sess-failed", { status: "failed" });
      createFakeSession(tmpDir, "sess-done", { status: "complete" });
      createFakeSession(tmpDir, "sess-running", { status: "running" });

      const result = findStaleSessions(tmpDir);
      assert.equal(result.length, 1);
      assert.equal(result[0].sessionId, "sess-running");
    });
  });

  describe("readSessionMessages", () => {
    let tmpDir;

    test.beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-test-"));
    });

    test.afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("should read messages from a valid session dir", () => {
      const testMessages = [
        { id: "1", role: "user", content: [{ type: "text", text: "Hello" }] },
        { id: "2", role: "assistant", content: [{ type: "text", text: "Hi" }] },
      ];
      const sessionDir = createFakeSession(tmpDir, "sess-1", {
        messages: testMessages,
      });

      const result = readSessionMessages(sessionDir, "sess-1");
      assert.ok(result);
      assert.equal(result.length, 2);
      assert.equal(result[0].role, "user");
    });

    test("should return null when messages file does not exist", () => {
      const sessionDir = path.join(tmpDir, "sess-no-msg");
      fs.mkdirSync(sessionDir);
      fs.writeFileSync(
        path.join(sessionDir, "sess-no-msg.json"),
        JSON.stringify({ status: "running" })
      );

      const result = readSessionMessages(sessionDir, "sess-no-msg");
      assert.equal(result, null);
    });

    test("should return null for invalid JSON", () => {
      const sessionDir = path.join(tmpDir, "sess-bad");
      fs.mkdirSync(sessionDir);
      fs.writeFileSync(
        path.join(sessionDir, "sess-bad.messages.json"),
        "{ broken"
      );

      const result = readSessionMessages(sessionDir, "sess-bad");
      assert.equal(result, null);
    });
  });

  describe("deleteStaleSession", () => {
    let tmpDir;

    test.beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-test-"));
    });

    test.afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("should remove the session directory", () => {
      const sessionDir = createFakeSession(tmpDir, "sess-1");
      assert.ok(fs.existsSync(sessionDir));

      const result = deleteStaleSession(sessionDir, "sess-1");
      assert.equal(result, true);
      assert.equal(fs.existsSync(sessionDir), false);
    });

    test("should return true even if directory does not exist", () => {
      const result = deleteStaleSession(
        path.join(tmpDir, "nonexistent"),
        "sess-x"
      );
      assert.equal(result, true);
    });
  });

  describe("recoverStaleSessions", () => {
    let tmpDir;

    test.beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-test-"));
    });

    test.afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("should return zeros when no sessions dir exists", () => {
      const result = recoverStaleSessions({
        repo: "owner/repo",
        sessionsDir: path.join(tmpDir, "nonexistent"),
      });
      assert.equal(result.recovered, 0);
      assert.equal(result.cleaned, 0);
      assert.deepEqual(result.staleSessions, []);
      assert.deepEqual(result.skipped, []);
    });

    test("should find and clean up stale running sessions", () => {
      createFakeSession(tmpDir, "sess-run-1", {
        status: "running",
        prompt: "Please resolve GitHub Issue #10 in owner/repo.",
      });
      createFakeSession(tmpDir, "sess-done-1", {
        status: "complete",
        prompt: "Please resolve GitHub Issue #11 in owner/repo.",
      });

      const result = recoverStaleSessions({
        repo: "owner/repo",
        sessionsDir: tmpDir,
        deleteStale: false,
      });

      assert.equal(result.recovered, 1);
      assert.equal(result.cleaned, 1);
      assert.equal(result.staleSessions.length, 1);
      assert.equal(result.staleSessions[0].sessionId, "sess-run-1");
      assert.deepEqual(result.skipped, []);
    });

    test("should skip sessions without issue numbers in prompt", () => {
      createFakeSession(tmpDir, "sess-no-issue", {
        status: "running",
        prompt: "Some random task without an issue number",
      });

      const result = recoverStaleSessions({
        repo: "owner/repo",
        sessionsDir: tmpDir,
      });

      assert.equal(result.recovered, 1);
      assert.equal(result.cleaned, 0);
      assert.equal(result.skipped.length, 1);
      assert.equal(result.skipped[0].reason, "no_issue_number");
    });

    test("should delete stale session dirs by default", () => {
      const sessionDir = createFakeSession(tmpDir, "sess-1", {
        status: "running",
        prompt: "Please resolve GitHub Issue #5 in owner/repo.",
      });
      assert.ok(fs.existsSync(sessionDir));

      recoverStaleSessions({
        repo: "owner/repo",
        sessionsDir: tmpDir,
      });

      assert.equal(fs.existsSync(sessionDir), false);
    });

    test("should handle multiple stale sessions", () => {
      createFakeSession(tmpDir, "sess-1", {
        status: "running",
        prompt: "Please resolve GitHub Issue #100 in owner/repo.",
      });
      createFakeSession(tmpDir, "sess-2", {
        status: "running",
        prompt: "Please resolve GitHub Issue #101 in owner/repo.",
      });

      const result = recoverStaleSessions({
        repo: "owner/repo",
        sessionsDir: tmpDir,
      });

      assert.equal(result.recovered, 2);
      assert.equal(result.cleaned, 2);
    });
  });
});

