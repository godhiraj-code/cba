# Migration to the agent platform

## Browser-era applications

The previous browser Hub, adapter, intent runner, NLI, recorder, telemetry, warp tools, and their
fixtures are no longer supported or present in the versioned tree. Old Python builds, obsolete
compliance documents, and broken TCK commands have also been removed. Git history before the
platform refinement preserves that implementation.

There is no automatic compatibility layer for 4.x commands or its pre-check/clear/wait/hijack
state machine. Wrap useful behavior in an agent with `canHandle` and `run`; keep selectors,
browser lifecycle, model calls, and tools inside the agent. Return explicit outcomes and evidence.
Add a verifier where the domain supports an independent completion check.

The [data-report agents](../examples/data-report/agents.cjs) demonstrate the contract. The
[authoring guide](AGENTS.md) covers context handoff, constraints, failure, and cancellation.

## Existing core users

`Coordinator`, `ProtocolHub`, `Sentinel`, and `Starlight` remain available from the root and `/core`.
The root also exports `AgentPlatform`; `/platform` provides the application layer. Wire version
1.0 is unchanged. `starlight-core` starts the Hub; `starlight` runs local agents and missions.
`npm start` delegates to the protocol CLI, which accepts host/port environment variables and
explicit deadline flags.

The core preserves its default error fallback. Platform-created Coordinators use
`fallbackOnError: false`; explicit retry/unhandled outcomes still work. Local intent data, claims,
execution history, and completed results are immutable. Supply JSON-compatible values rather
than functions, Dates, cycles, or non-finite numbers.

Remote `Sentinel.handle` now receives `execution.signal`; forward it to tools. `onCancel` remains
supported. Timed-out handlers retain capacity until settlement; workloads that previously overlapped
cancelled work now wait or fail at their scheduling deadline.

`Starlight({ requestTimeoutMs })` configures client wait per submission. Retries use the original
content even if caller-owned data changes. Closing a client stops its automatic reconnect loop.
Coordinator observer exceptions no longer change outcomes; subscribe to `observer.error` to report them.

## Reports and storage

Each submission gets a new run UUID. History retains 100 runs by default; the CLI saves final
reports in `.starlight/runs/`. These are inspection records, not durable resume checkpoints.
Repeated missions can repeat external effects. The included writer refuses to overwrite an
existing report. Keep credentials in agent configuration, outside submitted context and evidence.
