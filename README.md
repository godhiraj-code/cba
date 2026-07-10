# Starlight Protocol

Starlight is a small, open protocol for intent-driven automation.

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

## Run the reference implementation

Requires Node.js 18 or newer.

```bash
npm install
npm test
```

Start a coordinator:

```js
const { ProtocolHub } = require('@starlight-protocol/starlight');

const hub = new ProtocolHub({ port: 8080 });
await hub.start();
```

Connect an independently implemented Sentinel:

```js
const { Sentinel } = require('@starlight-protocol/starlight');

const sentinel = new Sentinel({
  name: 'computer-agent',
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

The reference transport is JSON-RPC 2.0 over WebSocket, so a Sentinel can be written in any language without using this JavaScript SDK.

Python uses the same contract:

```python
from starlight_protocol import Sentinel

sentinel = Sentinel(
    name="mobile-agent",
    capabilities=["mobile"],
    can_handle=lambda intent: {"score": 0.9},
    handle=lambda intent, execution: {
        "status": "completed",
        "evidence": ["mobile-driver-ran"],
    },
)

await sentinel.connect()
await sentinel.serve_forever()
```

## Design guarantees

- The core has no dependency on browsers, devices, or AI providers.
- Offers run concurrently and cannot mutate the environment.
- Exactly one Sentinel owns each execution attempt.
- Sentinel capacity prevents simultaneous use of a shared browser, device, or account.
- Replayed intent IDs reuse the original result instead of repeating side effects.
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
node tck/src/core_tck.js --url=ws://host:8080
```

The previous browser-specific implementation remains in this repository only as migration source. It is excluded from the 5.x package and is not part of the core protocol.

## License

MIT
