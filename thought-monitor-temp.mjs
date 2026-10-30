import { logger } from "./logger.mjs";

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
  clearThoughts();

  if (timerId) clearInterval(timerId);

  // Print initial status immediately on startup so the operator sees it
  printStatus();

  // Print every 10 seconds for more responsive status updates
  timerId = setInterval(() => {
    printStatus();
  }, STATUS_INTERVAL_MS);

  logger.info(
    { issueNumber: context?.issueNumber },
    "Thought monitor started (10-second status polling)"
  );
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
     logger.info(
       {
         issueNumber: activeContext.issueNumber,
         trace: "heartbeat",
       },
       `Agent working on issue #${activeContext.issueNumber} (no thoughts yet)`
     );
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
       logger.error(
         {
           issueNumber: activeContext.issueNumber,
           trace: "error-block",
         },
         `Error block detected:\n${last.text}`
       );
     } else {
       // There are thoughts after the error - just print the last line normally
       const line = formatThoughtLine(last.text);
       logger.info(
         {
           issueNumber: activeContext.issueNumber,
           trace: "heartbeat",
         },
         `Status: ${line}`
       );
     }
   } else {
     // Last entry is not an error - print the formatted last line
     const line = formatThoughtLine(last.text);
     logger.info(
       {
         issueNumber: activeContext.issueNumber,
         trace: "heartbeat",
       },
       `Status: ${line}`
     );
   }
 }

 /** Stops the status timer and resets state. */
