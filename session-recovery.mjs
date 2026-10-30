import { resolveSessionDataDir } from "@cline/shared/storage";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { logger } from "./logger.mjs";

/**
 * Regex to extract the GitHub issue number from a session prompt.
 * The prompts we generate contain patterns like "Issue #82".
 */
const ISSUE_NUMBER_RE = /Issue #(\d+)/i;

/**
 * Maximum number of messages to include when seeding a restored session.
 * Prevents excessively long context windows when the conversation has
 * hundreds of turns. The first message (initial user prompt) is always kept.
 */
const MAX_RESTORE_MESSAGES = 50;

/**
 * Returns the Cline session data directory where session metadata
 * (`<sessionId>.json`) and message transcripts (`<sessionId>.messages.json`)
 * are persisted to disk by the local runtime backend.
 *
 * The path resolves (in order of precedence) from:
 *   $CLINE_SESSION_DATA_DIR
 *   $CLINE_DATA_DIR/data/sessions
 *   $CLINE_DIR/data/sessions
 *   $HOME/.cline/data/sessions
 *
 * In the Docker container the host mount `${USERPROFILE}/.cline-docker`
 * is mapped to `/home/app/.cline`, so this directory survives restarts.
 */
export function resolveSessionsDir() {
  return resolveSessionDataDir();
}

/**
 * Extracts the GitHub issue number from a session's prompt text.
 *
 * @param {string} prompt - The session prompt, expected to contain "Issue #N"
 * @returns {{ issueNumber: number, repo: string } | null}
 */
export function extractIssueNumber(prompt) {
  if (!prompt || typeof prompt !== "string") return null;
  const match = prompt.match(ISSUE_NUMBER_RE);
  if (!match) return null;

  // Try to also extract the repo (e.g. "Issue #82 in owner/repo")
  const repoMatch = prompt.match(/Issue #\d+\s+in\s+([^\s,.]+)/i);
  return {
    issueNumber: parseInt(match[1], 10),
    repo: repoMatch ? repoMatch[1] : null,
  };
}

/**
 * Reads and parses a session's metadata JSON file from disk.
 *
 * @param {string} sessionDir - Full path to the session directory
 * @param {string} sessionId - The session ID (same as the directory name)
 * @returns {{ metadata: object | null, messages: object[] | null, error: Error | null }}
 */
function readSessionFiles(sessionDir, sessionId) {
  const metaPath = path.join(sessionDir, `${sessionId}.json`);
  const msgPath = path.join(sessionDir, `${sessionId}.messages.json`);

  let metadata = null;
  let messages = null;

  try {
    const metaContent = fs.readFileSync(metaPath, "utf8");
    metadata = JSON.parse(metaContent);
  } catch (e) {
    return { metadata: null, messages: null, error: e };
  }

  try {
    if (fs.existsSync(msgPath)) {
      const msgContent = fs.readFileSync(msgPath, "utf8");
      const parsed = JSON.parse(msgContent);
      messages = parsed.messages || [];
    }
  } catch {
    // Messages file may not exist or be temporarily invalid — not fatal
  }

  return { metadata, messages, error: null };
}

/**
 * Scans the sessions directory for stale sessions — sessions whose
 * `status` is `"running"`, indicating the container was killed or
 * restarted without properly ending them.
 *
 * @param {string} sessionsDir - Path to the sessions directory (from resolveSessionsDir())
 * @returns {Array<{ sessionId: string, dir: string, metadata: object, messages: object[] }>}
 */
export function findStaleSessions(sessionsDir) {
  if (!sessionsDir || !fs.existsSync(sessionsDir)) {
    return [];
  }

  const staleSessions = [];

  for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const sessionId = entry.name;
    const fullSessionPath =
      entry.fullPath || path.join(sessionsDir, sessionId);
    const { metadata, messages, error } = readSessionFiles(
      fullSessionPath,
      sessionId
    );

    if (error || !metadata) {
      logger.debug(
        { sessionId, err: error?.message },
        "Skipping session with unreadable metadata"
      );
      continue;
    }

    if (metadata.status === "running") {
      staleSessions.push({
        sessionId,
        dir: fullSessionPath,
        metadata,
        messages: messages || [],
      });
    }
  }

  return staleSessions;
}

/**
 * Reads the message transcript from a session's `messages.json` file
 * on disk — used when the in-memory session is lost (e.g. container
 * restart). The returned messages are compatible with the
 * `initialMessages` parameter of `cline.start()`.
 *
 * @param {string} sessionDir - Full path to the session directory
 * @param {string} sessionId - The session ID
 * @returns {object[] | null} Array of messages, or null if unreadable
 */
export function readSessionMessages(sessionDir, sessionId) {
  const msgPath = path.join(sessionDir, `${sessionId}.messages.json`);
  try {
    if (!fs.existsSync(msgPath)) return null;
    const content = fs.readFileSync(msgPath, "utf8");
    const parsed = JSON.parse(content);
    return parsed.messages || [];
  } catch {
    return null;
  }
}

/**
 * Trims a message history to a reasonable size for seeding a restored
 * session via `initialMessages`. Always preserves the first message
 * (the initial user prompt) and keeps the most recent messages.
 *
 * @param {object[]} messages - The full message history
 * @param {number} maxMessages - Maximum number of messages to keep
 * @returns {object[]} Trimmed messages array
 */
export function trimMessages(messages, maxMessages = MAX_RESTORE_MESSAGES) {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return [];
  }
  if (messages.length <= maxMessages) return messages;

  // Keep the first message (initial user prompt) + the last (maxMessages - 1)
  return [messages[0], ...messages.slice(-maxMessages + 1)];
}

/**
 * Removes the assignee and "in-progress" label from a GitHub issue
 * to release a stale claim left behind by a dead agent. This allows
 * the polling mechanism to re-claim the issue.
 *
 * @param {string} repo - The GitHub repository (e.g. "owner/repo")
 * @param {number} issueNumber - The issue number
 * @returns {boolean} True if the cleanup succeeded
 */
export function releaseStaleClaim(repo, issueNumber) {
  try {
    execSync(
      `gh issue edit ${issueNumber} --repo ${repo} --remove-assignee "*" --remove-label "cline-in-progress"`,
      { stdio: "ignore" }
    );
    logger.info(
      { issueNumber, repo },
      "Released stale GitHub issue claim"
    );
    return true;
  } catch (e) {
    logger.warn(
      { err: e, issueNumber, repo },
      "Could not release stale claim (issue may not be assigned)"
    );
    return false;
  }
}

/**
 * Deletes a stale session directory from disk so it is not picked up
 * again on the next restart.
 *
 * @param {string} sessionDir - Full path to the session directory
 * @param {string} sessionId - The session ID
 * @returns {boolean} True if deletion succeeded
 */
export function deleteStaleSession(sessionDir, sessionId) {
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    logger.debug({ sessionId }, "Deleted stale session directory");
    return true;
  } catch (e) {
    logger.warn(
      { err: e, sessionId },
      "Could not delete stale session directory; it will be ignored on next scan"
    );
    return false;
  }
}

/**
 * Main entry point for session recovery on container restart.
 *
 * Scans the local filesystem for stale sessions (status: "running" from
 * a crash/restart), extracts issue numbers from their prompts, releases
 * stale GitHub issue claims, and reads their message transcripts for
 * potential re-seeding.
 *
 * Stale session directories are deleted after recovery so they do not
 * interfere with future restarts.
 *
 * @param {object} opts
 * @param {string} opts.repo - The GitHub repo (e.g. "owner/repo")
 * @param {string} [opts.sessionsDir] - Override for sessions directory
 * @param {boolean} [opts.deleteStale=true] - Whether to delete recovered session dirs
 * @returns {{ recovered: number, cleaned: number, staleSessions: Array, skipped: Array }}
 */
export function recoverStaleSessions({
  repo,
  sessionsDir: overrideDir,
  deleteStale = true,
}) {
  const sessionsDir = overrideDir || resolveSessionsDir();
  logger.info(
    { sessionsDir },
    "Scanning for stale sessions from previous run..."
  );

  const staleSessions = findStaleSessions(sessionsDir);

  if (staleSessions.length === 0) {
    logger.info("No stale sessions found");
    return {
      recovered: 0,
      cleaned: 0,
      staleSessions: [],
      skipped: [],
    };
  }

  logger.info(
    { count: staleSessions.length },
    `Found ${staleSessions.length} stale session(s) from previous run`
  );

  const skipped = [];
  let cleanedCount = 0;

  for (const { sessionId, dir, metadata } of staleSessions) {
    const prompt = metadata?.prompt || "";
    const info = extractIssueNumber(prompt);

    if (info === null) {
      logger.warn(
        { sessionId, prompt: prompt?.slice(0, 120) },
        "Could not extract issue number from stale session; skipping cleanup"
      );
      skipped.push({ sessionId, reason: "no_issue_number" });
    } else {
      logger.info(
        { sessionId, issueNumber: info.issueNumber },
        `Stale session references Issue #${info.issueNumber}`
      );
      releaseStaleClaim(repo, info.issueNumber);
      cleanedCount++;
    }

    // Remove the stale session directory so it doesn't accumulate or
    // get re-discovered on the next restart.
    if (deleteStale) {
      deleteStaleSession(dir, sessionId);
    }
  }

  logger.info(
    { recovered: staleSessions.length, cleaned: cleanedCount },
    "Session recovery complete"
  );

  return {
    recovered: staleSessions.length,
    cleaned: cleanedCount,
    staleSessions,
    skipped,
  };
}