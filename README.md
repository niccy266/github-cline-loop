# Cline Agent Loop

An agent loop system for automated GitHub issue resolution, featuring a thought monitor, session recovery, and robust retry logic with socket disconnect handling.

## Architecture Overview

```
┌─────────────────┐
│   poller.mjs    │  Polls GitHub for issues with the "cline-todo" label
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ agent.mjs       │  Manages agent lifecycle, retry, and socket recovery
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ thought-monitor │  One-minute heartbeat, error blocks, status display
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ session-recovery│  Restores stale sessions, releases stale claims
└─────────────────┘
```

## File Structure

| File | Purpose |
|------|---------|
| `agent.mjs` | Agent lifecycle management, retry logic, socket recovery |
| `poller.mjs` | GitHub issue polling with label filtering |
| `thought-monitor.mjs` | Status display, thought buffer, error detection |
| `session-recovery.mjs` | Stale session detection and cleanup |
| `logger.mjs` | Structured logging with pino |
| `index.mjs` | Entry point for the agent loop |

## Quick Start

### Prerequisites

- Node.js 18+
- GitHub CLI (`gh`) configured with auth
- Docker (for containerized execution)

### Setup

```bash
# Install dependencies
npm install

# Run tests
npm test

# Lint check
npm run lint
```

### Development

```bash
# Run specific test file
node --test tests/poller.test.mjs

# Check syntax
npm run lint
```

## Configuration

| File | Purpose |
|------|---------|
| `package.json` | Dependencies and scripts |
| `Dockerfile` | Production container build |
| `docker-compose.yml` | Development container setup |
| `.dockerignore` | Docker build context |
| `.env` | Environment variables (git-ignored) |

## Git Workflow

All changes follow this pattern:

1. Create feature branch: `git checkout -b feat/your-feature`
2. Make changes
3. Run tests: `npm test`
4. Commit with clear messages
5. Push and open PR

## License

MIT
