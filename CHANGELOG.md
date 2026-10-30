# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-10-31

### Added
- Thought monitor with 10-second status updates (down from 60s)
- Real-time status display showing latest agent thought
- Error block detection and display
- Session recovery on container restart
- Robust retry logic with socket disconnect handling
- Docker update guide with multiple deployment methods

### Changed
- Polling log output: data stub printed once per issue
- Thought monitor: no repo field in output, more frequent status updates
- Import from `@cline/core` ^0.2.0

### Fixed
- Socket error detection and recovery
- Tool result error logging
- Session recovery stale claim handling

## [0.9.0] - 2026-10-30

### Added
- Initial agent loop with GitHub issue polling
- Thought monitoring with one-minute status updates
- Session recovery on container restart
- Structured logging with pino
- Test suite with 69 tests

## [0.8.0] - 2026-10-29

### Added
- Basic agent loop implementation
- GitHub API integration
- Issue labeling and claim management
