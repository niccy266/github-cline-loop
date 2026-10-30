# Implementation Plan: Enhanced Thought Monitoring & Logging

## Goal
On container restart, first try to restore sessions from local files. Then,
while an agent is actively working on an issue, print one-minute status updates
showing the agent's last thought, and surface full error blocks for visibility.

## Part A: Session Recovery (DONE)
- `session-recovery.mjs` — scans persisted Cline session files on disk,
  extracts issue numbers from stale "running" sessions, releases stale
  GitHub issue claims, deletes stale session directories.
- `index.mjs` — calls `recoverStaleSessions()` before polling begins.
- `Dockerfile` / `package.json` — updated for new module.
- Tests: 26 tests in `tests/session-recovery.test.mjs`.

## Part B: False-Positive Error Detection Fix (DONE)
- `poller.mjs` — exported `isTaskFailed()` that strips backtick-enclosed code
  (e.g. `-W error::DeprecationWarning`) before checking for error keywords.
- Tests: 5 new tests in `tests/poller.test.mjs`.

## Part C: Thought Monitor (IN PROGRESS)

### 1. Create `thought-monitor.mjs` (DONE)
Exports:
- `addThought(text)` — split multi-line text, add non-blank lines to buffer (max 20)
- `addErrorBlock(text)` — add a multi-line error block starting with "Error:"
- `startMonitoring(context)` — start 1-min timer that prints status
- `stopMonitoring()` — stop timer, clear state
- `clearThoughts()` — reset buffer
- `formatThoughtLine(text)` — `...<text>...` unless text ends with `.`
- `getLastNonBlankThought()` — last non-blank entry (whitespace cleared)
- `checkForErrorBlock()` — returns `{ isError, text }` if last entry is error

### 2. Update `agent.mjs`
- Import `addThought`, `addErrorBlock` from `thought-monitor.mjs`
- In `onEvent` callback:
  - message/assistant-message → `addThought(event.text)`
  - tool-result with error → `addErrorBlock(...)` including error output

### 3. Update `poller.mjs`
- Import `startMonitoring`, `stopMonitoring`
- Before `runTask`: print initial context block (4 lines + data stub +
  description + comments), then `startMonitoring(...)`
- In `finally`: `stopMonitoring()`

### 4. Update Dockerfile / package.json / syntax.test.mjs

### 5. Create `tests/thought-monitor.test.mjs`

### 6. Run tests + lint, commit
