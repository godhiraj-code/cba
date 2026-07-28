# Starlight Protocol 5.x

Starlight is a small, open protocol for routing Intent to autonomous Sentinels. This alpha release
ships one reference implementation and support surface: JavaScript on Node.js.

Your mission contains only intent. Sentinels own everything else: planning, browser control, computer use, mobile control, heuristics, LLM calls, verification, recovery, and evidence.

```js
const { Starlight } = require('@starlight-protocol/starlight');

const mission = await new Starlight().connect();

await mission.intent('Open the store and sign in as the test customer');
await mission.intent('Buy the least expensive blue shirt', { channel: 'mobile' });
await mission.intent('Verify the receipt total is below $100');
```

No selectors. No waits. No browser commands. No model choice. The test states what must become true.

## The complete protocol

```text
intent → offer to Sentinels → best claim → execute → outcome
```

A Sentinel can be anything that implements two operations:

```js
const { Coordinator } = require('@starlight-protocol/starlight');

const protocol = new Coordinator();

protocol.register({
  name: 'checkout-heuristic',
  priority: 10,

  offer: intent =>
    intent.goal.toLowerCase().includes('checkout')
      ? { score: 0.95, reason: 'checkout is my domain' }
      : false,

  execute: async intent => {
    // Use Playwright, Appium, an LLM, computer-use, an API, or plain code.
    return {
      status: 'completed',
      value: { orderId: 'ORDER-42' },
      evidence: [{ kind: 'receipt', ref: 'artifact://receipt-42' }]
    };
  }
});

await protocol.dispatch('Complete checkout');
```

Four outcomes cover the complete execution lifecycle:

- `completed` — goal achieved, optionally with value and evidence
- `failed` — terminal, meaningful failure
- `unhandled` — try the next claiming Sentinel
- `retry` — retry a transient failure within the attempt budget

## Five-minute authenticated quickstart

Requires Node.js 22 or newer.

```bash
npm install @starlight-protocol/starlight
set STARLIGHT_AUTH_TOKEN=a-long-random-development-token
npx starlight-core
```

On macOS/Linux use `export` instead of `set`. The CLI refuses to start without a token unless
`--allow-anonymous-loopback` is explicitly supplied.

Programmatic Hub:

```js
const { ProtocolHub, digestToken } = require('@starlight-protocol/starlight');

const token = process.env.STARLIGHT_AUTH_TOKEN;
const hub = new ProtocolHub({ port: 8080, tokenDigests: [digestToken(token)] });
await hub.start();
```

Connect an independently implemented Sentinel:

```js
const { Sentinel } = require('@starlight-protocol/starlight');

const sentinel = new Sentinel({
  name: 'computer-agent',
  token: process.env.STARLIGHT_AUTH_TOKEN,
  capabilities: ['computer-use'],
  capacity: 1, // one real desktop; executions are automatically serialized
  canHandle: intent => ({ score: 0.8 }),
  handle: async intent => ({
    status: 'completed',
    evidence: []
  })
});

await sentinel.connect();
```

The normative JSON-RPC 2.0 over WebSocket protocol and JSON Schema are language-neutral. The
repository, package, tests, TCK, CI, and supported SDK are JavaScript-only for this release.

Lifecycle:

```text
authenticated Client ──Intent──> Hub ──Offer──> Sentinels
                              deterministic rank
authenticated Client <─Result── Hub ──Execute──> selected Sentinel
```

## Design guarantees

- The core has no dependency on browsers, devices, or AI providers.
- Offers run concurrently and cannot mutate the environment.
- Exactly one Sentinel owns each execution attempt.
- Sentinel capacity prevents simultaneous use of a shared browser, device, or account.
- Replayed intent IDs reuse the original result while the bounded in-memory record exists.
- Claim ranking is deterministic: score, operator priority, registration order.
- Broken or slow Sentinels are isolated by deadlines.
- Retry and fallback behavior is explicit and bounded.
- Results carry Sentinel identity, attempt history, values, and evidence.

## Specification and examples

- [Core protocol specification](spec/STARLIGHT_CORE_PROTOCOL.md)
- [Canonical wire schema](schemas/starlight.core.schema.json)
- [Production security profile](spec/SECURITY_PROFILE.md)
- [Intent-only in-process example](examples/intent-only.js)
- [Remote Sentinel example](examples/remote-sentinel.js)

Run the black-box compatibility kit against the reference Hub:

```bash
npm run tck
```

Or test another Hub implementation:

```bash
node tck/src/core_tck.js --url=ws://host:8080 --token=your-token
```

Run the real authenticated process/WebSocket proof:

```bash
npm run proof:e2e
```

It starts a Hub, remote Sentinel, and Client in separate processes, submits an Intent, verifies
the value, Sentinel identity, attempt history, and evidence, then replays the Intent and proves
the Sentinel side effect occurred only once.

Run every launch check, including the production dependency audit, packing and installing the npm
artifact in a neutral temporary project, exercising the installed proof and CLI, and rejecting
forbidden tarball contents:

```bash
npm run release:gate
```

The npm package contains only the JavaScript core, CLI, declarations, canonical schema, current
specification, security profile, examples, and the installed-package E2E proof. No other runtime
implementation is shipped or supported.

## Security and limits

Authentication is mandatory by default. Anonymous mode is an explicit loopback-only development
option. Use WSS/TLS for untrusted networks; the operator owns TLS termination, proxy identity
headers, authorization policy, secret rotation, Sentinel isolation, and evidence retention.

Replay/idempotency storage is bounded, process-local memory. It is not durable exactly-once
delivery and does not survive Hub restart. The fixed-window rate limiter is per connection.
Starlight does not sandbox Sentinels or make compliance/certification claims.

This is alpha software, not a production-readiness or compliance claim. Passing
`npm run release:gate` is necessary evidence, not sufficient deployment assurance. Operators must
configure WSS, authentication, authorization, secret rotation, persistence, observability,
Sentinel isolation, and resource limits for their environment.

## License

MIT
