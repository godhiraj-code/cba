# Protocol Objective Evidence Report

Date: 2026-07-03

## Objective

Make Starlight protocol objectives production-grade: a user can provide a mission file, URL, or natural-language intent; the Hub starts; Sentinels run in the background; each browser action is guarded by `starlight.pre_check`; and evidence is generated from real websites.

## Protocol Invariants Audited

From `spec/STARLIGHT_PROTOCOL_SPEC_v1.0.0.md`:

- Sentinels must connect over WebSocket and register with `starlight.registration`.
- Sentinel priority is `1-10`, lower number means higher priority.
- Before actions, the Hub must broadcast `starlight.pre_check`.
- Sentinels must answer with `starlight.clear`, `starlight.wait`, or `starlight.hijack`.
- Any `hijack` wins; any `wait` pauses if no hijack exists; all clear/required consensus lets execution proceed.
- Sentinels release control with `starlight.resume` after hijack.
- The Hub must validate incoming messages against protocol schemas.

## Hardening Changes

- Added first-class objective runner: `src/protocol_objective.js`.
- Wired CLI entry point: `bin/starlight.js`.
- `IntentRunner` now registers as an `intent` client before commands.
- Hub `/health` now reports `starting` until the WebSocket server, browser, page, and handlers are ready.
- Hub pre-checks now broadcast to all connected Sentinels, not only selector-matching Sentinels.
- Restored protocol priority contract: schema maximum is `10`, `DataSentinel` priority is `10`, and tests reject priority `20`.
- Pulse soft-veto tolerance now clears on the final Hub retry instead of one retry too late.
- Removed the `forceProceedOnSoftVeto` escape hatch; exhausted `wait` retries now fail the objective instead of bypassing Sentinel vetoes.
- Legacy Python `run` command no longer uses fixed startup sleeps; it polls observable Hub health and Sentinel registration.

## Real Website Evidence

All external runs required network access outside the workspace sandbox. The runs below were refreshed after removing the force-proceed bypass.

### www.dhirajdas.dev

Command:

```powershell
node bin\starlight.js --url www.dhirajdas.dev --headless --all-sentinels --timeout 180000 --sentinel-timeout 30000 --verbose --json --port 8100
```

Result: PASS

- Registered Sentinels: A11ySentinel, DataSentinel, JanitorSentinel, PIISentinel, PulseSentinel, ResponsiveSentinel, VisionSentinel.
- Objective URL normalized to `https://www.dhirajdas.dev`.
- Page title: `Dhiraj Das | Automation Consultant | Agentic AI Reliability`.
- Page context: 14 buttons, 0 inputs, 20 links, 5 headings.
- Pulse vetoed the first `goto` pre-check, then cleared on retry.
- DataSentinel injected command/environment context.
- A11ySentinel injected accessibility context: score 0, 317 violations.
- VisionSentinel responded clear.
- Final checkpoint consensus: `7.0/7.0`.
- Runtime generated `report.html` and `mission_trace.json` for the run.

### login.salesforce.com

Command:

```powershell
node bin\starlight.js --url https://login.salesforce.com --headless --all-sentinels --timeout 180000 --sentinel-timeout 30000 --verbose --json --port 8101
```

Result: PASS

- Registered Sentinels: A11ySentinel, DataSentinel, JanitorSentinel, PIISentinel, PulseSentinel, ResponsiveSentinel, VisionSentinel.
- Page title: `Login | Salesforce`.
- Page context: 7 buttons, 4 inputs, 7 links, 1 heading.
- Checkpoint pre-check was vetoed twice by Pulse while the page settled.
- Hub retried via protocol pre-checks; no force-proceed was used.
- DataSentinel injected context on each pre-check.
- A11ySentinel injected accessibility context: score 0, 15 violations.
- Final checkpoint consensus: `7.0/7.0`.
- Runtime generated `report.html` and `mission_trace.json` for the run.

### SauceDemo Natural-Language Flow

Command:

```powershell
node bin\starlight.js --intent "Go to https://www.saucedemo.com and fill Username with standard_user and fill Password with secret_sauce and click Login" --headless --all-sentinels --timeout 180000 --sentinel-timeout 30000 --verbose --json --port 8102
```

Result: PASS

- Registered Sentinels: A11ySentinel, DataSentinel, JanitorSentinel, PIISentinel, PulseSentinel, ResponsiveSentinel, VisionSentinel.
- NLI fallback parsed 4 steps: `goto`, `fill Username`, `fill Password`, `click Login`.
- Semantic resolution:
  - Username -> `#user-name`
  - Password -> `#password`
  - Login -> `input[type="submit"][value="Login"]`
- Each real browser action went through `starlight.pre_check`.
- Pulse vetoed settling states before `fill` and `click`, then cleared on protocol retry.
- DataSentinel and A11ySentinel injected context during the flow.
- A11ySentinel reported 8 violations on the login form.
- Final click completed successfully with `7.0/7.0` Sentinel consensus.
- Latest runtime artifacts in this workspace are from this run: `mission_trace.json`, `report.html`, and screenshots under `screenshots/`.

## Test Evidence

Commands:

```powershell
npm.cmd test
npm.cmd run lint
node --check src\protocol_objective.js
python -m py_compile cli\commands\run_cmd.py sentinels\data_sentinel.py sentinels\pulse_sentinel.py
```

Results:

- `npm.cmd test`: PASS
  - Node unit tests: 14 passed.
  - Python SDK action tests: 10 passed.
  - Python Sentinel structural tests: 14 passed.
- `npm.cmd run lint`: PASS with 0 errors and 35 existing warnings.
- `node --check src\protocol_objective.js`: PASS.
- `python -m py_compile ...`: PASS.

## Timer Boundary

Sentinels own page readiness and environmental judgment. The Hub can use bounded timeouts for transport, process startup, cleanup, and consensus budgets, but it should not mark an application ready merely because time elapsed.

What changed:

- Removed fixed `time.sleep()` startup/registration guesses from `cli/commands/run_cmd.py`.
- Removed forced proceed after repeated Sentinel `wait` responses.
- Startup now waits for `/health` to become healthy.
- Sentinel startup now waits for registered Sentinels to appear in `/health`.
- Browser actions still require `starlight.pre_check` when Sentinels are connected.

Remaining intentional timers:

- Hub handshake and consensus budgets.
- Intent registration and command timeouts.
- Process cleanup timeout.
- Screenshot/report settling after an action.
- Sentinel-local remediation delays, such as Janitor exploration and Responsive animation checks.

These timers bound orchestration and reporting. They do not replace Sentinel consensus for passing an objective.

## Current Status

The protocol objective workflow is working against real external websites and a real natural-language browser flow with all production Sentinels registered in the background. The evidence above was generated after fixing the priority-schema drift, so the pass does not rely on violating the v1.0.0 protocol priority range.
