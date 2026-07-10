# Starlight Core Security Profile

This profile defines production deployment requirements without choosing an identity provider or secret format.

## Transport

- Internet or untrusted-network deployments MUST use WebSocket over TLS (`wss`).
- TLS termination MAY happen in a reverse proxy, service mesh, or the process hosting the Hub.
- The Hub MUST enforce a finite message-size limit. The reference default is 1 MiB.
- The Hub SHOULD use ping/pong heartbeats and evict stale connections.

## Authentication

Every production Client and Sentinel MUST authenticate during `starlight.register`. A deployment may use bearer tokens, signed JWTs, mutual TLS identity, workload identity, or another mechanism.

The reference Hub's `authenticate(registration, context)` hook returns a boolean and receives the HTTP upgrade request through `context.request`. Authentication secrets are removed from the registration metadata retained for later authorization.

```js
const hub = new ProtocolHub({
  authenticate: (registration, { request }) =>
    verifyIdentity(registration.token, request.socket.remoteAddress)
});
```

An implementation MUST NOT log registration tokens.

## Authorization

Authentication does not grant permission to execute every Intent. The reference `authorize(request)` hook receives the authenticated registration metadata, method, Intent parameters, role, and upgrade request.

```js
const hub = new ProtocolHub({
  authorize: ({ registration, params }) =>
    policy.allows(registration.name, params.goal, params.constraints)
});
```

Deployments SHOULD authorize declared constraints and target scope before an Intent is offered to Sentinels.

## Rate and resource limits

- Deployments SHOULD configure an Intent rate limit per Client connection.
- Offer, scheduling, and execution deadlines MUST remain finite.
- Sentinel capacity MUST reflect genuinely isolated execution slots.
- Idempotency history MUST be bounded by count and time.
- Large evidence objects SHOULD be stored externally and returned as access-controlled references.

The reference fixed-window limiter is configured with:

```js
new ProtocolHub({ rateLimit: { max: 60, windowMs: 60_000 } });
```

## Evidence and privacy

Sentinels are responsible for avoiding secrets and unnecessary personal data in Outcome evidence. Deployments SHOULD apply a redaction or artifact-ingestion policy before evidence enters long-term storage. Artifact references SHOULD expire and SHOULD be scoped to the requesting identity.

## Error behavior

Authentication and authorization failures use `UNAUTHORIZED`. Rate-limit failures use `RATE_LIMITED` and include `retryAfterMs` in error details. Error responses MUST NOT reveal token contents or internal policy rules.
