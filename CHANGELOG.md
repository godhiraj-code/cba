# Changelog

All notable changes to Starlight are documented here. The project follows Semantic Versioning.

## Unreleased — website and demo correction

- Fixed the public GitHub Pages 404 caused by publishing a `/docs` folder without a homepage.
- Added a general-purpose platform website with a read-only explorer for six real execution reports.
- Replaced the basic demo with a 3:20 narrated 1080p walkthrough covering verified output, constraint failure, rejected verification, cancellation, authenticated remote execution, and fresh recovery.
- Added captions, chapter controls, reproducible media, and an explicit Pages build/deploy/live-verification workflow.
- Added HTTP regression coverage for missing, stale, corrupt, and incorrectly served deployments; the release gate now executes all demo scenarios and builds the site.

## [5.0.0-alpha.2] - 2026-09-05

### Added

- General-purpose `AgentPlatform` runtime with agent registration, optional completion verification, sequential missions, result handoff, cancellation, bounded run history, and inspectable reports.
- `starlight` CLI for loading CommonJS/ESM agents, running missions, and inspecting saved reports.
- A working two-agent data/report demo, including real file output and read-back verification, exercised from the installed npm artifact.
- Product objective, agent/migration guides, technical audit, and an initial reproducible CLI demo (superseded by the narrated walkthrough above).

### Fixed

- Replaying an intent at full history capacity no longer evicts its own result and repeats execution.
- Nested local intent data and completed results are copied and frozen; non-JSON data is rejected.
- Per-dispatch limits now validate the same bounds as Coordinator defaults.
- Platform missions stop on ambiguous execution failures and timeouts; the core's default fallback behavior remains compatible.
- Removed unused browser/LLM/telemetry development dependencies and broken legacy TCK commands.

- Remote slots remain quarantined until operation settlement; the Sentinel SDK propagates AbortSignal cancellation and enforces capacity across reconnects.
- Serialized registration, rejected invalid authentication results, and prevented registration after disconnect.
- Client connects wait for authentication, replay immutable submitted data, and support configurable wait limits.
- Bounded shutdown, cancellation after conflicting replay, reentrant replay, stale unregister callbacks, and observer isolation.
- Verification exceptions retain evidence; terminal failures preserve the underlying error and attempt history.
- Windows release checks invoke npm without shell concatenation and install into a path containing spaces.
- Updated vulnerable brace-expansion, fast-uri, and js-yaml development dependency resolutions; the release gate now audits the full dependency tree.

### Removed

- Browser-era code, tests, obsolete specifications, recordings, and stale tools from the versioned tree; Git history preserves them.
- Duplicate Hub startup code; npm start uses the supported protocol CLI.

## [5.0.0-alpha.1] - Protocol foundation

### Added

- One supported JavaScript/Node.js reference implementation for the language-neutral Starlight Core Protocol 1.0.
- Authenticated WebSocket Hub, remote Sentinel and intent-only Client.
- Principal-scoped replay and cancellation isolation.
- Deterministic claim ranking, bounded retries, cancellation, deadlines and capacity controls.
- Canonical JSON Schema, TypeScript declarations and black-box compatibility kit.
- `npm run proof:e2e` for authenticated process-boundary Hub → Sentinel → Client proof.
- `npm run release:gate` for tests, lint, type checks, schema alignment, TCK, E2E and neutral installed-artifact verification.

### Security

- Authentication is required by default.
- Malformed JSON-RPC peers fail closed.
- Production package audit currently reports zero vulnerabilities.

### Removed

- Unsupported Python, Go, Java and Rust implementations.
- Legacy browser launcher, Python CLI, old schemas and generated build artifacts.
- Unsupported compliance, durable exactly-once and production-readiness claims.

### Known limits

- This is alpha software.
- Replay state and rate limiting are process-local.
- WSS termination, durable storage, authorization policy, secret rotation, Sentinel sandboxing and observability remain deployment responsibilities.
