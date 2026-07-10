# Starlight 5.x Roadmap

Starlight 5.x is intentionally smaller than the browser-specific 4.x system. Features belong in Sentinels unless they are necessary for safe coordination between every kind of Sentinel.

## Phase 1 — Minimal core protocol: complete

- Intent-only client contract
- Offer, Claim, Execute, Outcome lifecycle
- Deterministic claim arbitration
- `completed`, `failed`, `unhandled`, and `retry` outcomes
- JSON-RPC 2.0 WebSocket reference transport
- Canonical schema and normative specification

## Phase 2 — Execution correctness: complete

- Offer and execution deadlines
- Caller and remote cancellation propagation
- Failure isolation and bounded retry
- Per-Sentinel capacity and execution serialization
- Intent-ID idempotency and conflict detection
- Bounded replay history

## Phase 3 — Open interoperability: complete

- JavaScript in-process and remote SDKs
- Python asynchronous Sentinel and intent client
- Black-box Hub Technology Compatibility Kit
- Cross-language Python → Node → Python verification

## Phase 4 — Connection resilience: complete

- Transport heartbeat and stale-peer eviction
- Configurable Sentinel reconnect with jittered backoff
- Idempotent JavaScript and Python client replay after reconnect
- Sentinel re-registration without duplicate execution
- Graceful Hub draining during shutdown
- Explicit failure/fallback semantics for interrupted attempts

## Phase 5 — Security profile: foundation complete

- Normative TLS deployment profile
- Pluggable registration authentication
- Per-Intent authorization policy hook
- Per-client rate and payload limits
- Secret-handling and evidence-redaction guidance

Security remains deployment policy rather than domain logic in the core lifecycle.

## Phase 6 — Protocol observability

- Stable lifecycle event vocabulary
- OpenTelemetry adapter outside the core runtime
- Intent latency, queue time, retries, and Sentinel health metrics
- Evidence/artifact reference conventions

## Phase 7 — Ecosystem

- Go, Java, and Rust 5.x SDKs generated from the core contract
- Sentinel TCK in addition to the Hub TCK
- Certified browser, computer-use, mobile, LLM, API, and human-approval Sentinels
- Migration wrapper for selected 4.x browser fleets

## Non-goals

The core protocol will not acquire selectors, browser actions, device APIs, model-provider APIs, test syntax, dashboards, marketplaces, or application-specific planning. Those are Sentinel or product concerns.
