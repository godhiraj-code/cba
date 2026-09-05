# Starlight 5.x Wire Contract 1.0

Status: normative launch contract for Starlight 5.x.

## 1. Purpose

Starlight separates intent from implementation. A mission says what must become true. Sentinels decide whether they can achieve it and use any implementation they choose: deterministic code, an LLM, browser automation, computer use, a mobile driver, a human approval flow, or a composition of these.

The protocol deliberately does not define clicks, selectors, screenshots, model providers, device APIs, or test-framework syntax.

## 2. Roles

- A **Client** submits an Intent and receives its Outcome.
- The **Coordinator** offers the Intent to Sentinels, selects a claimant, and supervises execution.
- A **Sentinel** claims Intents it can handle and owns their implementation.

A process may implement more than one role, but each connection registers one role.

## 3. Intent

An Intent is the only executable object authored by a mission:

```json
{
  "goal": "Complete checkout using the saved address",
  "context": { "channel": "mobile" },
  "constraints": { "currency": "USD", "maxTotal": 100 }
}
```

`goal` is required. `context` supplies facts. `constraints` defines boundaries that must remain true. The protocol treats their contents as opaque data.

The Coordinator assigns an `id` when the Client does not provide one. Wire IDs are non-empty
strings of at most 128 characters and cannot contain control characters. `goal` is at most
10,000 characters. Intent objects reject unknown top-level fields. An Intent is immutable after
submission.

The local JavaScript implementation copies and recursively freezes Intent data and completed
results. Local inputs must contain JSON-compatible values; cycles, functions, non-finite numbers,
and class instances are rejected so local agents observe the same data model as remote agents.

An Intent ID is an idempotency key scoped to the authenticated principal. A Coordinator MUST execute
the first submission at most once within its documented history window. A concurrent or later
submission by the same principal with the same ID and identical content MUST observe the same
result. Another principal using that ID MUST receive `FORBIDDEN`. Reusing the ID with different
`goal`, `context`, or `constraints` MUST fail with `INTENT_CONFLICT`.

## 4. Lifecycle

For each Intent, the Coordinator MUST perform this lifecycle:

1. **Offer** the immutable Intent to all currently registered Sentinels concurrently.
2. Collect a Claim or pass from each Sentinel until the offer deadline.
3. Rank Claims by descending `score`, then ascending `priority`, then registration order.
4. **Execute** with the highest-ranked claimant.
5. Return a completed Outcome, return a terminal failure, retry when requested, or fall through to the next claimant when unhandled.

One Sentinel owns an execution attempt. This prevents competing agents from mutating the same environment at the same time.

A Sentinel declares a positive integer `capacity` at registration. The default is `1`. The Coordinator MUST NOT assign more simultaneous Execute operations than this capacity. Capacity describes independent execution slots, such as isolated devices or browser contexts; it is not a performance hint.

## 5. Claim

A Sentinel answers an Offer with one of:

```json
false
```

```json
{ "score": 0.92, "reason": "I control the requested mobile application" }
```

`score` MUST be between 0 and 1. `true` is shorthand for a score of `0.5`; a number is shorthand for `{ "score": number }`. A missing response, invalid response, exception, or offer timeout is a pass. This failure isolation prevents one unhealthy Sentinel from stopping the constellation.

`priority` is a stable operator preference and is only a tie-breaker. Lower values win. It MUST NOT override a more confident Claim.

## 6. Outcome

Execution MUST return exactly one status:

- `completed`: the goal and constraints are satisfied. It MAY include `value` and `evidence`.
- `failed`: the Sentinel handled the Intent and proved it cannot or must not complete. It MUST include `error` and MAY include `evidence`. Failure is terminal.
- `unhandled`: the Claim was optimistic, but the Sentinel made no terminal decision. The Coordinator tries the next claimant.
- `retry`: the Sentinel encountered a transient condition. It MAY include integer `retryAfterMs`
  from 0 through 60,000. The Coordinator retries within its configured attempt budget (maximum
  10 in the reference implementation), then tries the next claimant.

Outcome objects reject unknown fields. `retryAfterMs` is invalid on any other status. A final
successful IntentResult contains `intentId`, `goal`, `status: "completed"`, the selected Sentinel
description, ordered `attempts`, and non-negative `durationMs`; `value` and `evidence` are optional.

Evidence is opaque, structured data. It can contain assertions, logs, artifact references, screenshots, receipts, model traces, or domain-specific proof. Large artifacts SHOULD be referenced rather than embedded.

## 7. Cancellation and deadlines

The Coordinator MUST apply finite Offer, scheduling, and Execute deadlines. A registered Client
may request cancellation with `{ "intentId": "..." }`. When a deadline or caller cancellation
occurs, the Coordinator SHOULD send `starlight.cancel` to the active remote Sentinel. A Sentinel
SHOULD stop related work promptly. A Coordinator MUST ignore a late Outcome for the caller and
clear caller-facing deadlines. It retains only execution correlation needed to observe settlement
and release quarantined capacity, bounded by registered execution capacity. It MUST NOT reuse
the Sentinel capacity slot until the timed-out handler actually
settles; an implementation that cannot force-stop work must quarantine that slot rather than exceed
declared capacity.

The reference WebSocket transport MUST use ping/pong or an equivalent heartbeat to evict stale
peers. A reconnecting Client MAY safely resubmit an interrupted request only with the same Intent
ID and identical content. A Hub shutting down SHOULD stop accepting new Intents, allow a bounded
drain period, cancel remaining work, and close peer connections within a bounded interval.

## 8. Reference wire protocol

The normative Starlight 5.x transport is JSON-RPC 2.0 over WebSocket. Alternate transports are
extensions and cannot claim wire conformance.

There are only five methods:

| Method | Direction | Meaning |
| --- | --- | --- |
| `starlight.register` | Client/Sentinel → Coordinator | Declare one connection role and Sentinel metadata |
| `starlight.intent` | Client → Coordinator | Submit one Intent and wait for its Outcome |
| `starlight.offer` | Coordinator → Sentinel | Ask whether the Sentinel should handle an Intent |
| `starlight.execute` | Coordinator → Sentinel | Give one claimant an execution attempt |
| `starlight.cancel` | Client → Coordinator; Coordinator → Sentinel | Cancel active work |

The canonical wire schema is [`schemas/starlight.core.schema.json`](../schemas/starlight.core.schema.json).

Every connection MUST successfully authenticate before receiving a role. The reference Hub is
authenticated by default. Anonymous development requires `allowAnonymousLoopback: true` and an
explicit loopback bind; it cannot be enabled on a non-loopback bind. Unknown methods, malformed
envelopes, unsolicited/ambiguous responses, and malformed JSON receive a JSON-RPC error when
possible and close with WebSocket policy code 1008.

Requests contain only `jsonrpc`, optional string `id`, `method`, and object `params`. Responses
contain exactly one of `result` or `error`. Unknown or ambiguous fields are rejected where defined
by the canonical schema.

### Error codes

- `INVALID_REQUEST`: malformed envelope, parameters, role, IDs, ranges, or payload.
- `INTENT_CONFLICT`: an idempotency key was reused with different content.
- `DUPLICATE_SENTINEL`: a live Sentinel ID is already registered.
- `NO_SENTINEL`: no claimant completed the Intent.
- `INTENT_FAILED`: a Sentinel returned a terminal failed Outcome.
- `TIMEOUT`: a finite protocol deadline expired.
- `DISCONNECTED`: the peer disappeared while work was pending.
- `DRAINING`: the Hub no longer accepts new work.
- `RATE_LIMITED`: the connection exceeded its configured request budget.
- `RESOURCE_EXHAUSTED`: bounded coordinator capacity is occupied by active work.
- `UNAUTHORIZED`: authentication or policy authorization failed.
- `FORBIDDEN`: the authenticated role cannot invoke that method.
- `CANCELLED`: the Client cancelled active work.
- `UNSUPPORTED_VERSION`: the registered major wire version is incompatible.
- `INTERNAL`: an unexpected implementation failure occurred.

## 9. Conformance

A conforming Coordinator MUST:

- accept Intent-only clients;
- isolate Offer failures;
- use deterministic Claim ranking;
- ensure only one active owner per attempt;
- implement all four Outcome states;
- enforce deadlines and ignore late results;
- preserve attempt history and Sentinel identity in the final result.
- enforce Sentinel capacity across concurrent Intents;
- provide bounded idempotency history and reject conflicting replays.
- authenticate before assigning a role and enforce the method/role matrix.

A conforming Sentinel MUST:

- register a unique name;
- answer Offers without mutating the target environment;
- mutate the environment only after Execute;
- return a valid Outcome;
- treat duplicate execution of the same Intent and attempt as idempotent whenever possible;
- avoid claiming Intents it cannot reasonably handle.

## 10. What moved out of the protocol

The Starlight 4.x pre-check/clear/wait/hijack/action state machine encoded browser behavior in the coordination layer. In 5.x those concepts are Sentinel implementation details:

| 4.x concept | 5.x owner |
| --- | --- |
| Browser commands and selectors | Browser Sentinel |
| DOM stability and obstacle clearing | The Sentinel executing the Intent, or a composite Sentinel |
| LLM goal resolution | LLM Sentinel |
| Mobile emulation and device selection | Mobile Sentinel |
| Screenshots, traces, and assertions | Outcome evidence |
| `clear`, `wait`, `hijack`, `resume` | `completed`, `retry`, internal Sentinel logic |

This is the compatibility boundary: old components can be wrapped as one Sentinel, but they do not expand the core protocol.

The optional `AgentPlatform` SDK sits above this contract. Missions, run reports, and agent
verification are application features; they add no wire methods. Its default Coordinator sets
`fallbackOnError: false` to stop on execution exceptions and timeouts with attempt history.
The standalone Coordinator retains error fallback by default. Explicit `failed`, `retry`, and
`unhandled` outcomes retain their wire semantics under either policy.

## 11. Idempotency boundary

The reference history is bounded, in-memory, process-local, and removed after its configured TTL
or capacity pruning. It prevents duplicate execution only while that record remains in the same
Hub process. It is not durable exactly-once delivery. Deployments needing crash-safe deduplication
must provide a durable idempotency store outside this reference implementation.
