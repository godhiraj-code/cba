# Changelog

All notable changes to Starlight are documented here. The project follows Semantic Versioning.

## [5.0.0-alpha.1] - Unreleased

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
