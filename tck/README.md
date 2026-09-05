# Starlight Core TCK

The Technology Compatibility Kit verifies a Hub only through its public WebSocket interface.

Against the reference implementation:

```bash
npm run tck
```

Against another implementation:

```bash
node tck/src/core_tck.js --url=ws://host:8080 --token=your-token
```

For an external Hub, configure 100 ms offer, scheduling, and execution deadlines and two attempts.
The deadline scenarios require this conformance profile:

```bash
node bin/starlight-core.js --offer-timeout-ms=100 --execution-timeout-ms=100 --scheduling-timeout-ms=100 --max-attempts=2
```

Set `STARLIGHT_AUTH_TOKEN` in that Hub's environment. Use an isolated test Hub without unrelated
Sentinels. The kit deliberately sends invalid credentials, malformed messages, cancellations, and
timed-out work. It does not certify production deployment readiness.

The TCK checks:

- protocol-version negotiation;
- registration and role enforcement;
- Offer, Claim, Execute, and completed Outcome flow;
- Sentinel identity and evidence in results;
- idempotent Intent replay;
- conflicting replay rejection;
- declared Sentinel capacity.
- invalid credentials and anonymous/wrong-role rejection;
- malformed JSON-RPC policy closure;
- all four Outcome states and bounded retry;
- cancellation propagation and execution timeout cleanup.
- quarantine of noncooperative remote work and recovery after its late outcome.

A successful run emits a machine-readable JSON report and exits with code zero.

There are 19 black-box checks. Local mission behavior, reconnect races, shutdown, and CLI packaging
are covered by the repository's unit/integration suite, rather than this wire kit.
