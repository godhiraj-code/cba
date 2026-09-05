# Starlight platform audit — 2026-09-05

## Assessment

Starlight is a working general-purpose **agent runtime foundation**: local and remote agents can
claim intents, execute within capacity/deadline budgets, compose ordered missions, verify outcomes,
cancel work, and return inspectable reports. The shipped data/report workflow performs real I/O
and verifies both successful output and a failure boundary.

It is not a universal autonomous assistant. Domain agents still supply planning, tools, and
semantic constraint enforcement. It is not a durable workflow engine, hosted management product,
or security sandbox. Those boundaries are deliberate and visible in the API and documentation.

The audit covered active source, contracts, declarations, CLI behavior, examples, dependency and
package boundaries, documentation, and lifecycle behavior under failures. Passing the original
tests was insufficient: additional concurrency and error-path tests exposed real defects.

## Findings and fixes

| Finding | Impact | Resolution and evidence |
| --- | --- | --- |
| Replay pruning removed the requested record at full capacity | A supposedly repeated request executed twice | Look up retained replay before making room; `core_integrity.test.js` checks execution count and conflicts |
| Nested local data and completed results were mutable | Agents/callers could alter constraints or replayed outcomes | Independent, recursively frozen JSON snapshots; mutation and non-JSON regression tests |
| Per-call limits bypassed constructor validation | Infinite/invalid budgets could escape documented bounds | Validate dispatch limits; constructor and override tests |
| Remote RPC cancellation released capacity before the tool stopped | A second operation could overlap on the same resource | Retain remote execution correlation until settlement/disconnect; local lifecycle tests and two new black-box TCK checks |
| Reconnection reset Hub-side capacity while an old tool could continue | The same Sentinel instance could overlap external operations | SDK execution gate survives reconnect; regression uses a deliberately noncooperative handler |
| Remote SDK had no automatic cancellation signal | Every handler had to invent its own cancellation bookkeeping | Per-execution AbortController; cancellation/disconnect/shutdown propagation tests |
| Concurrent registration raced during asynchronous authentication | One connection could acquire multiple registrations and leak one | Registering/closed guards and strict hook-result validation; race/disconnect regression |
| A second connect call returned before authentication | Callers could submit work while registration was incomplete | Shared connection promise and explicit registered state; delayed-auth regression |
| Reconnect reused mutable caller input | Retried content could conflict with the original intent | Normalize/copy once before submission; reconnect test mutates original nested data |
| A conflicting replay removed active cancellation ownership | The original request could no longer be cancelled | Count active submissions per connection and intent ID; conflict/cancel regression |
| Observer failures/reentrant dispatch affected execution bookkeeping | Metrics/logging could change a result or duplicate execution | Publish the replay record before dispatch; isolate observer exceptions; reentrant regression |
| A stale unregister closure removed a replacement agent | Old cleanup could disconnect current work | Bind cleanup to the registration instance; replacement regression |
| Shutdown lacked complete deadline cleanup | Pending work or close handshakes could outlive shutdown budgets | Abort after drain expiry and bound peer termination; shutdown regression |
| Verifier exceptions lost existing evidence | Failed reports omitted useful diagnostic artifacts | Preserve completed evidence and underlying agent error; verifier-failure regression |
| Repository mixed incompatible implementations and stale claims | Contributors could work on unsupported code or trust nonexistent commands | Remove legacy code/tooling/declarations/recordings from the versioned tree; rewrite docs and migration boundary |
| Windows release scripts concatenated shell arguments | Installation paths with spaces were unreliable | Invoke npm through Node and verify an installed package in a directory containing spaces |
| Clean installation exposed three high-severity development dependency advisories | A production-only audit hid tooling vulnerabilities | Apply compatible transitive fixes and expand the release gate to audit all dependencies |

Tests referenced above are under [`test/unit/`](../test/unit/). Core protocol behavior remains
wire version 1.0; the platform API and remote AbortSignal are SDK features. The core retains
default error fallback, while platform-created Coordinators stop on ambiguous execution errors.

## Verification matrix

| Requirement | Evidence |
| --- | --- |
| Goal/claim/rank/execute/outcome flow | Core unit suite, canonical schema checks, 19 black-box TCK checks |
| Bounded retries and fallback | All four outcomes exercised; failed remains terminal |
| Mission composition and result handoff | Distinct agents, shared constraints, immutable preceding results |
| Cancellation and capacity | Local/remote cancellation, noncooperative timeouts, concurrent missions, reconnect capacity |
| Authentication and ownership | Invalid credentials, wrong role, replay ownership, register race, cancellation conflict |
| Real successful workflow | CLI demo reads three rows, verifies 5500 cents, writes and reads back Markdown |
| Real failure workflow | maxRows=1 prevents writer execution, saves failure, exits 1, leaves destination absent |
| Saved inspection | CLI inspect equals persisted report; prior successful steps survive later failure |
| Extensibility | CommonJS/ESM agent modules and authenticated remote Sentinel integration |
| Consumer contracts | TypeScript positive/negative consumer fixtures and installed root/core/platform exports |
| Packaging | Production artifact contains only supported runtime/docs/examples; installed CLI/demo/E2E proof |
| Video | 216 seconds, H.264/AAC, 1920×1080 at 24 fps, conversational neural narration and speech-aligned captions; six captured execution reports |
| Public website | Explicit static artifact, homepage and asset checks, actual HTTP response/hash verification, missing/stale/corrupt/wrong-type regressions |
| Dependency security | Full npm audit, including development tools, is part of the gate; only ws is a runtime dependency |
| Documentation | README, authoring, objective, migration, security, wire spec, TCK, governance, changelog, demo, contributor guide |

## Environment and final verification

The initial runtime audit on Windows with Node.js 24.18.1 passed after a clean `npm ci`:

- 53 unit/integration tests, including the documented external Hub CLI profile.
- 19 black-box protocol checks, with noncooperative remote capacity quarantine/recovery.
- ESLint, TypeScript consumer fixtures, and 7 valid / 11 invalid schema fixtures.
- 12 active documents and 38 local link targets checked.
- Authenticated multi-process proof with one side effect across replay.
- Installed alpha.2 package: 40 files, root/core/platform exports, both CLI shims, demo,
  saved inspection, and the installed multi-process proof, all in a path containing spaces.
- Full dependency audit: zero vulnerabilities, including development dependencies.
- Complete 63-second video decode and visual inspection of source/success/failure frames.

The implementation commit `9b34f2306a2056f4db0ff18a5dcf87cb6ace4099` passed the
[GitHub Linux Node.js 22/24 release gate](https://github.com/starlight-protocol/starlight/actions/runs/33943471637).
Both jobs completed clean installation, the full gate, and the repository-pollution check.
The automatically triggered [Pages workflow](https://github.com/starlight-protocol/starlight/actions/runs/33943471321)
also succeeded, **but this did not establish public availability**. The root URL was not checked;
the later live HTTP check returned 404. That was an incomplete deployment verification.

## Website and demo follow-up

The Pages API showed `build_type: legacy`, publishing `main:/docs`. The refactor had removed the
homepage from that folder. A successful Jekyll build could therefore publish no root index.
Local Markdown link validation and the recorded video checks did not exercise this public path.

The correction adds a dedicated `website/` source and explicit static artifact, keeps the existing
public URL, and uses the [Pages workflow](../.github/workflows/pages.yml) to build, deploy, and
check the live homepage and all eight public files against their expected hashes and MIME types.
Five HTTP scenarios verify a good deployment and detect a missing homepage, stale commit, corrupt
asset, and incorrect video content type. The build normalizes text line endings so Windows and
Linux compare the same published bytes.

The replacement demo contains real CLI success/failure/inspection/fresh-run results plus SDK
verification rejection, cooperative cancellation, and a token-authenticated local WebSocket agent.
Eight assertions must pass before capture. It is a 200-second explanatory animation with synthetic
narration and WebVTT captions. All 12 chapter frames were inspected and the full video decoded.

The complete local release gate passed: 59 tests including website subtests, 19 TCK checks,
lint/types/schema, the authenticated multi-process proof, all walkthrough assertions, static build,
41-file installed package smoke test, and dependency audit with zero vulnerabilities. Browser
checks cover all six recorded scenarios, report expansion, native playback, chapter seeking,
caption loading, and a 390-pixel mobile viewport without horizontal page overflow.

Live verification on 2026-09-05 at 04:35 UTC confirmed the root URL returns HTTP 200 for
implementation commit `9ad371fb819966d28203cb82916e432bbb41e19f`. All eight public file hashes,
lengths, and MIME types matched the local build; an actual video range GET returned HTTP 206.
The live browser loaded captions and sought directly to the 02:26 chapter. All eight external
source/documentation links returned HTTP 200. Both [Linux Node 22/24 jobs](https://github.com/starlight-protocol/starlight/actions/runs/33944886829)
and the [Pages build, deploy, and live-check jobs](https://github.com/starlight-protocol/starlight/actions/runs/33944886834)
passed for that exact commit.

The current [runtime workflow](../.github/workflows/starlight_ci.yml) and Pages workflow enforce
these checks for subsequent commits. See [website operations](WEBSITE.md) for reproduction and
the deployment record served by the public site for its exact source commit.

The subsequent voice revision replaces libflite with Microsoft's Andrew multilingual neural
voice and a more conversational script. Captions use speech-service sentence boundaries instead
of estimating timings from character counts. The original six reports and execution assertions
are preserved. Video, captions, chapter data, and browser assets share a content-derived URL
revision to prevent browsers mixing old media with the new timing data.
The 216-second replacement passed full audio/video decoding and local browser playback with
captions loaded. Audio is normalized to a −16 LUFS target with a −1.5 dBTP ceiling; the encoded
track's measured true peak was −1.7 dBFS. The six captured report objects are unchanged.

## Remaining limits and risks

1. **No crash-safe resume or durable exactly-once effects.** History is bounded and process-local;
   final CLI reports can be inspected after exit but do not reconstruct live agent state.
2. **Cooperative execution.** JavaScript cannot preempt CPU-bound code or undo external effects.
   A process restart cannot prove an old worker stopped; hard isolation requires external ownership.
3. **Agent-supplied truth.** Constraints and evidence are data. Verifiers improve a domain workflow
   but do not prove arbitrary language goals or protect against malicious trusted code.
4. **Per-registration resource ownership.** Different agents sharing a device/account need a common
   owner or external lock. Capacity alone does not discover shared resources.
5. **Deployment security remains operator work.** TLS termination, credential scope/rotation,
   authorization, storage permissions, retention, and sandboxing require configuration.
6. **No hosted execution UI or general planner is included.** The public website explores recorded
   runs; it does not execute agents. The CLI/SDK support explicit missions and
   arbitrary agent implementations; they do not themselves select an LLM or generate plans.

These are public alpha boundaries, not hidden claims of completed features. The next useful
investment is a second real domain integration, followed by durable execution semantics driven
by that workflow, as described in [the objective](OBJECTIVE.md).
