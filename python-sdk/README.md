# Starlight Protocol Python SDK

Minimal asyncio SDK for Starlight Core Protocol 1.0.

```bash
pip install starlight-protocol
```

## Build a Sentinel

```python
import asyncio
from starlight_protocol import Sentinel


async def execute(intent, execution):
    # Use heuristics, an LLM, Playwright, Appium, computer-use, or any API here.
    return {
        "status": "completed",
        "value": {"handled": intent["goal"]},
        "evidence": ["python-agent-ran"],
    }


async def main():
    sentinel = Sentinel(
        name="python-agent",
        capabilities=["python"],
        capacity=1,
        can_handle=lambda intent: {"score": 0.9},
        handle=execute,
    )
    await sentinel.connect()
    await sentinel.serve_forever()


asyncio.run(main())
```

`can_handle` runs during the non-mutating Offer phase. `handle` runs only after the Coordinator grants an execution attempt.

## Submit intent

```python
from starlight_protocol import Starlight

mission = await Starlight().connect()

await mission.intent("Sign in as the test customer")
await mission.intent(
    "Complete checkout",
    context={"channel": "mobile"},
    constraints={"maxTotal": 100},
)
```

The mission contains no implementation commands. Sentinels own planning, execution, recovery, verification, and evidence.

## Outcomes

A Sentinel returns one status:

- `completed`: the goal is satisfied.
- `failed`: terminal domain failure.
- `unhandled`: try the next claimant.
- `retry`: transient condition; retry within the Coordinator's attempt budget.

## Subclassing

Callbacks are optional. A Sentinel can be implemented as a class:

```python
from starlight_protocol import Sentinel


class MobileSentinel(Sentinel):
    async def can_handle(self, intent):
        return {"score": 1.0} if intent["context"].get("channel") == "mobile" else False

    async def handle(self, intent, execution):
        return {"status": "completed"}
```

The old `SentinelBase` remains exported only to help migrate 4.x implementations. New Sentinels should use `Sentinel`.
