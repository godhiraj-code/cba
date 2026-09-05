# Starlight Core Security Profile

This profile defines production deployment requirements without choosing an identity provider or secret format.

## Transport

- Internet or untrusted-network deployments MUST use WebSocket over TLS (`wss`).
- TLS termination MAY happen in a reverse proxy, service mesh, or the process hosting the Hub.
- The Hub MUST enforce a finite message-size limit. The reference default is 1 MiB.
- The Hub SHOULD use ping/pong heartbeats and evict stale connections.

## Authentication

Every Client and Sentinel MUST authenticate during `starlight.register`. The only exception is
explicit anonymous loopback development mode, which cannot bind to a non-loopback host.

Registration is serialized per connection. A peer that disconnects while an asynchronous
authentication hook runs cannot become registered afterward. Hooks must return `true`, a nonempty
principal string, or an object with a nonempty `principalId`; other values are rejected.

The reference Hub accepts SHA-256 token digests through `tokenDigests`; it hashes presented
secrets and compares fixed-size digests with a timing-safe comparison. Plaintext bearer tokens
are not retained. Tokens must be at least 16 characters.

```js
const { ProtocolHub, digestToken } = require('@starlight-protocol/starlight');

const hub = new ProtocolHub({
  tokenDigests: [digestToken(process.env.STARLIGHT_AUTH_TOKEN)]
});
```

The `authenticate(registration, context)` hook supports external JWT, mTLS, or workload identity
verification and receives the HTTP upgrade request through `context.request`. It SHOULD return a
stable principal string or `{ principalId }`. Returning boolean `true` remains supported; the
reference Hub derives a stable principal from the presented token when available and otherwise
falls back to the verified registration name.

```js
const hub = new ProtocolHub({
  authenticate: (registration, { request }) =>
    verifyIdentity(registration.token, request.socket.remoteAddress)
});
```

An implementation MUST NOT log registration tokens, authorization headers, cookie material, or
credential-derived values. Rotate keys by accepting old and new verifiers during a bounded overlap,
then removing the old verifier. Keep secrets outside source control and command history.

## Authorization

Authentication does not grant permission to execute every Intent. The reference `authorize(request)` hook receives the authenticated registration metadata, method, Intent parameters, role, and upgrade request.

```js
const hub = new ProtocolHub({
  authorize: ({ registration, params }) =>
    policy.allows(registration.name, params.goal, params.constraints)
});
```

Deployments SHOULD authorize declared constraints and target scope before an Intent is offered to Sentinels.
Reverse proxies MUST overwrite, not append, trusted identity headers and the Hub MUST trust them
only from an authenticated proxy hop. TLS/WSS termination and certificate validation are deployment
responsibilities. Starlight does not provide a certificate authority.

## Rate and resource limits

- Deployments SHOULD configure an Intent rate limit per Client connection.
- Offer, scheduling, and execution deadlines MUST remain finite.
- Sentinel capacity MUST reflect genuinely isolated execution slots.
- Idempotency history MUST be bounded by count and time.
- Timed-out remote work retains capacity until it replies or its connection closes. The Sentinel
  SDK preserves local capacity across reconnects; process restarts require external resource fencing.
- Large evidence objects SHOULD be stored externally and returned as access-controlled references.

The reference fixed-window limiter is configured with:

```js
new ProtocolHub({ rateLimit: { max: 60, windowMs: 60_000 } });
```

## Evidence and privacy

Sentinels are responsible for avoiding secrets and unnecessary personal data in Outcome evidence. Deployments SHOULD apply a redaction or artifact-ingestion policy before evidence enters long-term storage. Artifact references SHOULD expire and SHOULD be scoped to the requesting identity.

## Error behavior

Authentication and authorization failures use `UNAUTHORIZED`. Rate-limit failures use `RATE_LIMITED` and include `retryAfterMs` in error details. Error responses MUST NOT reveal token contents or internal policy rules.

## Threat-model limits

The local AgentPlatform and CLI execute trusted JavaScript modules. They do not authenticate
local calls or sandbox imports, models, filesystem access, or tools. Constraints are immutable
data whose meaning agents and verifiers must enforce. Saved reports include context and evidence
and require appropriate filesystem access controls.

Cancellation is cooperative. CPU-bound code can block Node's event loop, and external effects
can continue after cancellation. Hard isolation requires separate processes/containers and an
external resource owner. Final reports are not crash-safe checkpoints or resumable agent state.

Authentication does not sandbox a Sentinel or prove that its evidence is truthful. A compromised
authenticated Sentinel can misuse every capability granted to its process. Operators must isolate
Sentinels, scope credentials, validate target authorization, and apply evidence retention policy.
The reference rate limiter is per connection, replay history is process-local, and no compliance or
enterprise certification is claimed.
