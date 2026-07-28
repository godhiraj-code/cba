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

A successful run emits a machine-readable JSON report and exits with code zero.
