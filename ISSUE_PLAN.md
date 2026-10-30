## Summary

The agent in Session 1793373078488_zg0ea encountered two types of errors:

### 1. Missing tool: `gh_issue_comment`
- **Time**: 04:11:19
- **Error**: `AI_NoSuchToolError: Model tried to call unavailable tool 'gh_issue_comment'`
- **Root cause**: The agent tried to call a non-existent tool. The available tools are: `web_search`, `skills`, `read_files`, `search_codebase`, `run_commands`, `fetch_web_content`, `editor`.
- **Fix**: The agent should use `run_commands` to execute `gh issue comment` commands instead.

### 2. Multiple `run_commands` failures with "Invalid input"
- **Times**: 04:14:01, 04:16:09, 04:18:33, 04:22:27, 04:24:25
- **Error**: `Invalid input` (no further details)
- **Root cause**: The agent is having trouble formatting the tool call correctly. The error message is too vague to help the agent debug.
- **Fix**: Add better error messages that tell the agent exactly what's wrong with the tool call format.

## Proposed Plan

### Step 1: Add a `gh` helper skill
Create a skill that teaches the agent how to use `run_commands` for GitHub CLI operations, including:
- `gh issue comment <number> --body "..."` - post comments
- `gh issue view <number> --json comments` - view issue details
- `gh pr create` - create pull requests
- `gh pr list` - list pull requests
- `gh issue list` - list issues

### Step 2: Improve `run_commands` validation
Add better error messages that tell the agent exactly what's wrong with the tool call format:
- Validate that `commands` is an array of strings
- Validate that each command is a non-empty string
- Provide specific error messages like "Expected array of strings, got X"

### Step 3: Add `gh_issue_comment` as a wrapper tool (optional)
Could add a new tool that wraps `gh issue comment` to make it easier for the agent to use. This would be a convenience wrapper around `run_commands`.

## Files to modify
- `agent.mjs` - Add or improve the `runTask` function to pass better context
- `thought-monitor.mjs` - Add better error detection
- `poller.mjs` - Improve error handling
- `scripts/commands.py` - Add better validation

## Success criteria
- [ ] Agent can successfully post comments to GitHub issues
- [ ] Agent can successfully execute `run_commands` without "Invalid input" errors
- [ ] Error messages are clear and actionable
- [ ] All existing tests pass