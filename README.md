# Starlight

**Current platform release: [v5.0.0-alpha.2](https://github.com/starlight-protocol/starlight/releases/tag/v5.0.0-alpha.2)**
— a preview release for Node.js 22+. The older 1.x releases belong to the legacy browser implementation.

**A general-purpose agent platform for turning goals into inspectable outcomes.**

Starlight runs agents that work with code, data, APIs, browsers, devices, or language models.
You supply a goal and its boundaries. Agents decide whether they can handle it and own the
implementation. The platform routes work, bounds execution, coordinates mission steps, and
returns a report with agent identity, attempts, results, and evidence.

This JavaScript/Node.js alpha includes an embeddable runtime, a local CLI, and an authenticated
protocol for remote agents. You supply domain agents; arbitrary natural-language planning
requires an agent that implements it. No model provider or browser is required.

[![Watch the narrated execution walkthrough](assets/demo-poster.png)](https://starlight-protocol.github.io/starlight/#demo)

[Website and interactive report explorer](https://starlight-protocol.github.io/starlight/) ·
[Video and reproduction instructions](docs/DEMO.md) · [Technical audit](docs/AUDIT.md)

## Run something real

Requires Node.js 22 or newer. From this checkout:

```bash
npm ci
npm run demo
```

Two agents read the included order data, independently verify its total, write a Markdown
summary, and read the file back to verify it. The expected result is **3 orders, 5500 cents**.
Each run creates a fresh artifact and JSON report under `.starlight/runs/`.
The CLI prints the run ID, results, evidence, and report path.

```bash
node bin/starlight-platform.js inspect <run-id>
node bin/starlight-platform.js agents --agents examples/data-report/agents.cjs
node bin/starlight-platform.js run examples/data-report/mission.json --agents examples/data-report/agents.cjs
```

The last command writes `.starlight/order-summary.md` and fails if it already exists. Change
the mission's output path for another run, or use `npm run demo` for a fresh path each time.
After installing a package built from this checkout, the equivalent commands are `starlight demo`,
`starlight run`, `starlight agents`, and `starlight inspect`.

## Write an agent

```js
const { AgentPlatform } = require('@starlight-protocol/starlight');
const platform = new AgentPlatform();

platform.register({
  name: 'word-counter',
  capabilities: ['text'],
  canHandle: intent => intent.goal === 'Count the words',
  run: async intent => {
    if (typeof intent.context.text !== 'string') {
      return { status: 'failed', error: 'context.text must be a string' };
    }
    const words = intent.context.text.match(/\S+/g) || [];
    return { status: 'completed', value: { words: words.length } };
  }
});

async function main() {
  const report = await platform.run({
    goal: 'Count the words',
    context: { text: 'Goals become observable results' }
  });
  console.log(report.status, report.steps[0].result?.value);
}
main().catch(console.error);
```

`canHandle` offers a claim without changing anything; `run` does the work. Optional `verify`
checks a completed outcome before the mission continues. Agents may use deterministic code,
tools, models, or their own planning. The platform does not interpret goals on their behalf.

## Compose a mission

Register the agents exported by [the data-report example](examples/data-report/agents.cjs), then:

```js
const handle = platform.submit({
  goal: 'Produce a verified summary of the order data',
  context: { inputPath: './orders.json', outputPath: './summary.md' },
  constraints: { maxRows: 1000 },
  steps: ['Summarize the order data', 'Write the verified order summary']
});

// platform.getRun(handle.id) returns a snapshot of progress.
// handle.cancel() cooperatively cancels work and stops later steps.
const report = await handle.done;
```

Steps run in order and are routed independently. Agents receive preceding results in
`intent.context.mission.results`. Mission constraints apply to every step and cannot be
redefined by a step. Failure, verification failure, cancellation, or a deadline stops the mission.

**Inspect the report status:** completed, failed, and cancelled missions return a report with
their history. Invalid mission definitions throw before execution. Calling `run` again creates
a new execution with a new ID.

## The protocol underneath

```text
Mission → AgentPlatform → Coordinator → selected agent → outcome → run report
                             │
                             └── ProtocolHub ↔ remote Sentinels
```

“Sentinel” is the protocol name for an agent. Existing `Coordinator`, `ProtocolHub`, `Sentinel`,
and `Starlight` exports remain available, including through `/core`. The language-neutral
JSON-RPC/WebSocket wire contract remains **1.0**.

Local agents need no server. Remote agents connect through a `ProtocolHub` sharing
`platform.coordinator`; see the [agent guide](docs/AGENTS.md). Network authentication is mandatory
by default. The protocol CLI remains `starlight-core`, requiring `STARLIGHT_AUTH_TOKEN` unless
anonymous loopback development is explicitly enabled.

## Boundaries that matter

- Agents are trusted code with the host's permissions. Starlight is not a sandbox.
- Constraints are passed intact; agents and verifiers enforce their meaning.
- Capacity applies per registration. Different agents sharing a resource need a common owner or external lock.
- Agents must honor `execution.signal`. Cancellation cannot forcibly stop or undo external work.
- The platform stops on ambiguous errors and timeouts. Explicit `retry` or `unhandled` outcomes authorize another attempt or agent.
- The SDK retains 100 runs by default in memory. CLI reports are final records, not durable workflow checkpoints; there is no automatic crash recovery.
- Core intent replay is bounded and process-local, not durable exactly-once delivery.
- Remote handlers receive an AbortSignal. Timed-out work retains capacity until settlement or disconnection; the Sentinel SDK preserves local capacity across reconnects.
- Reports include context and evidence. Keep secrets in agent configuration rather than mission data.

## Project map

| Area | Purpose |
| --- | --- |
| [`src/platform/`](src/platform/) | Mission runtime and agent registration |
| [`src/core/`](src/core/) | Routing, capacity, deadlines, authentication, remote transport |
| [`examples/data-report/`](examples/data-report/) | Working agents and verified file output |
| [`docs/OBJECTIVE.md`](docs/OBJECTIVE.md) | Product objective, design decisions, next steps |
| [`docs/AGENTS.md`](docs/AGENTS.md) | Agent, mission, CLI, and remote integration guide |
| [`spec/STARLIGHT_CORE_PROTOCOL.md`](spec/STARLIGHT_CORE_PROTOCOL.md) | Normative wire contract |
| [`schemas/starlight.core.schema.json`](schemas/starlight.core.schema.json) | Canonical wire schema |
| [`spec/SECURITY_PROFILE.md`](spec/SECURITY_PROFILE.md) | Network deployment responsibilities |
| [`tck/`](tck/) | Black-box protocol compatibility kit |
| [`docs/MIGRATION.md`](docs/MIGRATION.md) | Moving from the browser-era implementation |
| [`docs/AUDIT.md`](docs/AUDIT.md) | Findings, fixes, coverage, and limits |

## Validate changes

```bash
npm test
npm run proof:e2e
npm run release:gate
```

The release gate runs runtime/CLI tests, lint, declarations, schema checks, the TCK, an
authenticated multi-process proof, installed-package CLI/demo verification, and a production
and development dependency audit. It does not publish anything.

The old browser implementation, recordings, obsolete declarations, and generated artifacts have
been removed from the versioned project. Git history preserves the previous implementation.
See [CONTRIBUTING.md](CONTRIBUTING.md) for development and release checks.

MIT licensed. This is alpha software; passing checks is not a production-readiness or certification claim.
