# Building with Starlight

## Agent contract

`AgentPlatform.register(agent)` accepts:

| Field | Meaning |
| --- | --- |
| `name` | Required nonempty name; default registration ID |
| `canHandle(intent, execution)` | Required side-effect-free claim: `false`, `true`, score 0–1, or `{ score, reason }` |
| `run(intent, execution)` | Required function returning a protocol Outcome |
| `verify(intent, outcome, execution)` | Optional completion check; must return exactly `true` |
| `capacity` | Independent concurrent slots; default 1 |
| `priority` | Lower wins tied scores; default 100 |
| `id`, `version`, `capabilities` | Optional registration metadata |

`execution` includes an `AbortSignal`; execution and verification also receive the attempt,
claim, and prior attempt history. Forward the signal to tools and check it before more work.
Agents must bound their own model and tool loops.

Return an explicit Outcome:

- `{ status: 'completed', value?, evidence? }`: goal and constraints satisfied.
- `{ status: 'failed', error, evidence? }`: terminal failure.
- `{ status: 'unhandled', evidence? }`: safe to let another claimant try.
- `{ status: 'retry', retryAfterMs?, error?, evidence? }`: request another bounded attempt.

Agent exceptions become terminal failures. The platform's default Coordinator uses
`fallbackOnError: false`, so timeouts and invalid results also stop missions. An explicitly
supplied Coordinator retains its own policy. The standalone core keeps its error-fallback
default for compatibility; opt out when ambiguous side effects are possible.

Verification runs within the execution deadline and capacity slot. A false/non-boolean return
or exception prevents downstream steps. Agent-supplied verification is not an independent
platform guarantee that arbitrary natural-language goals have been satisfied.

## Mission contract

A mission is a string or `{ goal, context?, constraints?, steps? }`. Omit steps for one intent;
otherwise supply 1–100 strings or `{ goal, context?, constraints? }` objects. The whole plan is
validated before work begins. Extra fields and caller-assigned step IDs are rejected. All data
must contain finite, acyclic JSON values.

Steps run sequentially. Step context overrides shared context. Mission constraints reach every
step; steps may add new constraint keys but cannot redefine mission constraint keys. Agents
still enforce their semantic meaning.

The reserved `intent.context.mission` contains:

```js
{
  id: 'run UUID',
  goal: 'overall goal',
  step: 2, // one-based
  results: [/* complete IntentResults from previous steps */]
}
```

Inputs and results are copied and frozen recursively. Keep results small and reference large
artifacts in evidence. Missions are explicit sequences; agents may implement their own planning.

## Execution and inspection

```js
const { AgentPlatform } = require('@starlight-protocol/starlight');
const platform = new AgentPlatform({
  maxRuns: 100,
  coordinatorOptions: {
    offerTimeoutMs: 2000,
    executionTimeoutMs: 30000,
    schedulingTimeoutMs: 30000,
    maxAttempts: 2
  }
});
// Register agents before submitting work.
const handle = platform.submit('Your goal');
console.log(platform.getRun(handle.id));
const report = await handle.done;
if (report.status !== 'completed') console.error(report.error);
```

`run(mission)` is the convenience form of `submit(mission).done`. `submit` returns an ID
immediately. `handle.cancel()`, `platform.cancel(id)`, or an external `AbortSignal` requests
cooperative cancellation. `getRun(id)` and `listRuns()` return snapshots. `agents()` lists
registrations and capacity. Registering returns an unregister function.

Reports contain the mission, timestamps, statuses, successful IntentResults, and terminal error.
Only started steps appear. Failed/cancelled missions resolve to reports. Invalid definitions or
exhausted active-run capacity reject/throw. History defaults to 100 runs; new runs evict the
oldest settled run when full, never active work.

Each submission is a fresh execution. There is no mission-level replay or resume API. Core
step IDs derive from the run UUID and step number.

## CLI modules and reports

Export an agent or nonempty agent array from CommonJS or an ESM default export. `--agents`
loads trusted code with the process's permissions. All paths resolve from the working directory.

```bash
starlight agents --agents ./agents.cjs
starlight run ./mission.json --agents ./agents.cjs --output-dir ./runs
starlight inspect <run-id> --output-dir ./runs
```

Reports are saved to `<output-dir>/<run-id>.json`. Failed and cancelled missions exit with code
1. SIGINT/SIGTERM request cancellation. Final reports survive exit; a crash may leave an
incomplete file. Reports do not checkpoint agents or make external effects transactional.
Keep credentials out of mission context and evidence.

## Remote agents

Share the platform's Coordinator with an authenticated Hub:

```js
const { AgentPlatform, ProtocolHub, digestToken } = require('@starlight-protocol/starlight');
const platform = new AgentPlatform();
const hub = new ProtocolHub({
  coordinator: platform.coordinator,
  tokenDigests: [digestToken(process.env.STARLIGHT_AUTH_TOKEN)]
});
async function main() {
  await hub.start();
  // Connect remote Sentinels, then submit missions through platform.run(...).
  // On shutdown, await hub.close().
}
main().catch(console.error);
```

A remote Sentinel uses `canHandle` and `handle`; `handle` performs its own verification before
returning completed. See [the remote example](../examples/remote-sentinel.js). Remote `Starlight`
clients submit individual intents. Mission management is a host SDK/CLI feature, not a new
wire method. See the [security profile](../spec/SECURITY_PROFILE.md) for network deployment.

Remote `handle(intent, execution)` receives `execution.signal`, which aborts on cancellation,
disconnect, or Sentinel shutdown. `onCancel(intentId)` remains an optional additional notification.
The SDK holds capacity until the real handler settles, including across reconnects of the same
Sentinel instance. A new process cannot know whether an old external tool stopped; isolate workers
and resources accordingly. Remote handlers perform their own verification before returning completed.

`Starlight({ requestTimeoutMs })` controls client wait per submission (default 30 seconds, maximum
24 hours). Set it above the scheduling and attempt budget for long tasks. Reconnect attempts are
bounded; client timeouts do not undo server-side effects. Retries use a frozen snapshot of the
original submission.

Coordinator event listeners are observational. Listener exceptions reach optional `observer.error`
listeners and cannot change execution outcomes. Treat agents, callbacks, and injected Coordinators
as trusted application code.
