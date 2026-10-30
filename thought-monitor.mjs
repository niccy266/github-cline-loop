import { logger } from "./logger.mjs";
import fs from "node:fs";
import path from "node:path";

function resolveSessionsDir() {
  const envDir = process.env.CLINE_SESSION_DATA_DIR || process.env.CLINE_DATA_DIR || process.env.CLINE_DIR;
  if (envDir) return path.join(envDir, "data", "sessions");
  const home = process.env.HOME || "/home/app";
  return path.join(home, ".cline", "data", "sessions");
}

let activeSessionId = null;
let seenThoughts = new Set();
/**
 * Maximum number of thought lines to retain in the in-memory buffer.
 * Every minute the monitor prints the last thought; this limit bounds
 * how far back we can search for error blocks.
 */
const MAX_THOUGHT_LINES = 20;

/** Interval (ms) at which the status line is printed while an agent runs. */
const STATUS_INTERVAL_MS = 10_000;

let thoughtBuffer = [];
let timerId = null;
let activeContext = null;

/**
 * Splits a block of text into non-blank lines and appends each line
 * to the in-memory thought buffer as a "thought" entry.
 *
 * @param {string} text - Raw thought text from the agent (may contain newlines)
 */
export function addThought(text) {
  if (!text || typeof text !== "string") return;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    thoughtBuffer.push({ type: "thought", text: line, ts: Date.now() });
  }
  trimBuffer();
}

/**
 * Adds a multi-line error block to the thought buffer. The text should
 * start with the "Error:" keyword so that the monitor can detect the
 * beginning of the block when searching backwards.
 *
 * @param {string} text - The full error block text (starts with "Error:")
 */
export function addErrorBlock(text) {
  if (!text || typeof text !== "string") return;
  const trimmed = text.trim();
  if (!trimmed) return;
  thoughtBuffer.push({ type: "error", text: trimmed, ts: Date.now() });
  trimBuffer();
}

/** Trims the buffer to the last MAX_THOUGHT_LINES entries. */
function trimBuffer() {
  if (thoughtBuffer.length > MAX_THOUGHT_LINES) {
    thoughtBuffer = thoughtBuffer.slice(-MAX_THOUGHT_LINES);
  }
}

/** Clears all buffered thoughts. Called when a new agent session starts. */
export function clearThoughts() {
  thoughtBuffer = [];
}

/**
 * Formats a thought line for the one-minute status output.
 * Appends "..." suffix unless the line already ends with a period.
 *
 * @param {string} text - The thought text
 * @returns {string} Formatted status string
 */
export function formatThoughtLine(text) {
  const trimmed = text.trim();
  if (!trimmed) return "";
  // Take the last non-blank line when text contains newlines, so the
  // status line always shows the most recent thought.
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1] || trimmed;
  const endsWithPeriod = lastLine.endsWith(".");
  const suffix = endsWithPeriod ? "" : "...";
  return `...${lastLine}${suffix}`;
}

/**
 * Returns the last non-blank entry from the thought buffer.
 * Clears whitespace before selection so blank lines are skipped.
 *
 * @returns {{ type: string, text: string } | null}
 */
export function getLastNonBlankThought() {
  const nonBlank = thoughtBuffer
    .filter((t) => t.text && t.text.trim())
    .slice(-MAX_THOUGHT_LINES);

  if (nonBlank.length === 0) return null;
  return nonBlank[nonBlank.length - 1];
}

/**
 * Checks if the last non-blank thought is part of an error block.
 * Searches back up to MAX_THOUGHT_LINES entries; if the last entry
 * is an "error" type, the entire block is returned.
 *
 * @returns {{ isError: boolean, text: string | null }}
 */
export function checkForErrorBlock() {
  const last = getLastNonBlankThought();
  if (last && last.type === "error") {
    return { isError: true, text: last.text };
  }
  return { isError: false, text: null };
}

/**
 * Starts the one-minute status timer. Each tick prints the latest thought
 * (with ellipsis) and, if the last entry is an error block, prints the
 * entire block.
 *
 * @param {{ issueNumber: number, repo: string, workspaceDir: string }} context
 */
export function startMonitoring(context) {
  activeContext = context;
  activeSessionId = null;
  clearThoughts();
  seenThoughts = new Set();

  if (timerId) clearInterval(timerId);

  // Seed seen set with existing thoughts
  pollSessionFile(true);

  // Print every 10 seconds
  timerId = setInterval(() => {
    pollSessionFile(false);
  }, STATUS_INTERVAL_MS);

  logger.info("Thought monitor started (10-second status polling)");
}

function pollSessionFile(seedOnly = false) {
  if (!activeContext) return;
  // resolve session dir
  let sessionId = activeSessionId;
  const base = resolveSessionsDir();
  if (!sessionId) {
    try {
      const dirs = fs.readdirSync(base).filter((d) => {
        try { return fs.statSync(path.join(base, d)).isDirectory(); } catch { return false; }
      }).sort();
      if (dirs.length) sessionId = dirs[dirs.length - 1];
    } catch {}
  }
  if (!sessionId) return;
  const msgFile = path.join(base, sessionId, `${sessionId}.messages.json`);
  try {
    if (!fs.existsSync(msgFile)) return;
    const data = JSON.parse(fs.readFileSync(msgFile, "utf8"));
    let latest = null;
    for (const m of data.messages || []) {
      for (const c of m.content || []) {
        if (c.type === "thinking" && c.thinking) {
          if (!seenThoughts.has(c.thinking)) {
            seenThoughts.add(c.thinking);
            if (!seedOnly) {
              logger.agent(c.thinking.trim() + (c.thinking.trim().endsWith(".") ? "" : "..."));
            }
          }
          latest = c.thinking;
        }
      }
    }
    if (!seedOnly && seenThoughts.size === 0) {
      logger.agent(`Agent working on issue #${activeContext.issueNumber} (no thoughts yet)`);
    }
  } catch {}
}

/**
  * Called every 10 seconds: prints the last thought with proper formatting,
  * or the full error block if detected.
  *
  * Window for error detection is 20 lines (MAX_THOUGHT_LINES).
  * Error trace is printed in full if:
  *   - The last non-blank entry is an "error" type
  *   - There are NO non-error thoughts AFTER the error (within the window)
  * If there is normal output after the error, just print the last line as normal.
  */
 function printStatus() {
   if (!activeContext) return;

   const nonBlank = thoughtBuffer
     .filter((t) => t.text && t.text.trim())
     .slice(-MAX_THOUGHT_LINES);

   if (nonBlank.length === 0) {
     // No thoughts yet
     logger.agent(`Agent working on issue #${activeContext.issueNumber} (no thoughts yet)`);
     return;
   }

   const last = nonBlank[nonBlank.length - 1];

   // Check if the last entry is an error block
   if (last.type === "error") {
     // Check if there are any non-error thoughts after this error
     // (search backwards from the end, excluding the error itself)
     const entriesBeforeError = nonBlank.slice(0, -1);
     const hasThoughtsAfterError = entriesBeforeError.some(t => t.type !== "error");

     if (!hasThoughtsAfterError) {
       // No thoughts after error - print the full error block
       logger.error(`Error block detected:\n${last.text}`);
     } else {
       // There are thoughts after the error - just print the last line normally
       const line = formatThoughtLine(last.text);
       logger.agent(line);
     }
   } else {
     // Last entry is not an error - print the formatted last line
     const line = formatThoughtLine(last.text);
     logger.agent(line);
   }
 }

 /** Stops the status timer and resets state. */
export function stopMonitoring() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  activeContext = null;
  clearThoughts();
  logger.info("Thought monitor stopped");
}
