# Starlight's objective

## The user problem

A developer wants agents to accomplish useful goals across different tools and environments,
without rebuilding routing, execution coordination, cancellation, and result tracking for every
application. Results must explain what ran, who owned it, what happened, and what evidence
supports completion.

The product is a **general-purpose agent platform**. The protocol is its interoperability layer.
Browser testing is one application, alongside data processing, documents, APIs, and model-driven tasks.

## First principles

1. **A goal is a request, not proof of success.** Completion comes from an observed result;
   optional verifiers gate progress. A successful network response alone proves nothing about a goal.
2. **Execution has an owner.** Claims do not cause side effects. One selected agent executes an
   attempt within its capacity. Agents sharing resources must coordinate those resources.
3. **General purpose means extensible implementation.** The runtime coordinates work without
   embedding selectors, providers, domain heuristics, or an ever-growing tool catalog.
4. **Failures remain visible.** Missions preserve completed steps and failure evidence.
   Unexpected errors and timeouts stop platform missions, avoiding silent repetition of ambiguous work.
5. **Boundaries survive composition.** Constraints reach every step, prior results are immutable,
   and cancellation stops future steps. Agent code enforces domain constraints.
6. **Capabilities need runnable evidence.** Examples must produce and verify real results;
   documentation must distinguish implemented behavior from proposed work.

## What was wrong

The 5.x protocol had replaced the browser-oriented 4.x design, but the repository still contained
the old implementation, declarations, tests, obsolete certification documents, recordings, and
generated builds. Some TCK commands referenced missing files. The package was cleaner than the
repository, making it difficult to know what to build on.

Public examples claimed computer-agent completion without implementing computer work. The core
provided routing and transport but no mission lifecycle or useful local execution path. Adding
more protocol features would not solve that developer problem.

## Product boundary

| Layer | Owns | Outside its responsibility |
| --- | --- | --- |
| Mission runtime | Steps, context handoff, progress, cancellation, reports | Universal goal interpretation, automatic crash recovery |
| Agent | Planning, tools, credentials, domain constraints, execution, verification | Global routing, unrelated agents' resources |
| Protocol | Claims, deterministic routing, bounded attempts, capacity, remote interoperability | Browser behavior, LLM prompts, product workflows |
| Host application | UI, permissions, storage, deployment, shared resource isolation | New wire methods for every product feature |

The alpha now provides a local SDK and CLI. Existing core exports remain available. `/platform`
and `starlight` serve the application layer; `/core` and `starlight-core` serve interoperability.
Wire contract 1.0 is unchanged. Historical code has been removed from the versioned tree and
remains available in Git history. The [migration guide](MIGRATION.md) identifies the boundary.

## Acceptance evidence

- A clean checkout runs a real two-agent mission without credentials or browsers.
- An installed package produces a verified file and an inspectable saved report.
- Failure and failed verification prevent downstream work and preserve previous results.
- Cancellation reaches active work; capacity and deadlines remain enforced.
- Mission data cannot be changed behind another agent's back.
- Existing remote protocol checks still pass.
- Default dependencies support only the active implementation and checks.

The [audit](AUDIT.md) records evidence and limitations. The [video](DEMO.md) demonstrates
real CLI execution and a failing constraint, not a proposed graphical interface.

## Next decisions, guided by usage

1. Build a second useful agent integration around an actual user workflow; let it determine tool
   and model integration needs.
2. Add durable storage and recovery with explicit crash, replay, and side-effect semantics.
   Final reports are not resumable workflow checkpoints.
3. Add an operator interface when run volume makes the CLI insufficient.
4. Add planner agents where dynamic decomposition is needed. Keep model choices inside agents.

Each addition should identify the task it unlocks, its execution boundary, its failure behavior,
and how its outcome is verified. Feature counts and additional implementation languages are
not substitutes for that evidence.
