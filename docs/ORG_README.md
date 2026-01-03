# ✨ Starlight Protocol

**Resilient browser automation through autonomous Sentinel coordination.**

---

## What is Starlight?

Starlight is an open protocol for building **self-healing browser automation** systems. Instead of brittle scripts that break when the DOM changes, Starlight uses a constellation of autonomous **Sentinels** that detect and clear obstacles in real-time.

### The Problem
- 🔴 Flaky tests fail randomly due to popups, spinners, network delays
- 🔴 Hardcoded waits slow down execution and still fail
- 🔴 Selector changes break entire test suites

### The Solution
- ✅ **Autonomous Sentinels** handle popups, cookies, modals automatically
- ✅ **Entropy-based stability** waits only as long as needed
- ✅ **Self-healing** learns to clear new obstacles without code changes

---

## Quick Start

### Python SDK
```bash
pip install starlight-protocol
```

```python
from starlight_protocol import SentinelBase

class MySentinel(SentinelBase):
    async def on_pre_check(self, params, msg_id):
        # Your obstacle detection logic
        await self.send_clear()

sentinel = MySentinel()
sentinel.run()
```

---

## Repositories

| Repo | Description |
|------|-------------|
| [starlight](https://github.com/starlight-protocol/starlight) | Reference implementation (Node.js Hub + Python SDK) |

---

## Resources

- 📖 [Protocol Specification v1.0.0](https://github.com/starlight-protocol/starlight/blob/main/spec/STARLIGHT_PROTOCOL_SPEC_v1.0.0.md)
- 📦 [Python SDK on PyPI](https://pypi.org/project/starlight-protocol/)
- 🏆 [TCK Validator](https://github.com/starlight-protocol/starlight/tree/main/validator)
- 📋 [Governance](https://github.com/starlight-protocol/starlight/blob/main/GOVERNANCE.md)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        INTENT LAYER                             │
│                   (Your Test Script)                            │
└─────────────────────────────────────────────────────────────────┘
                              │ starlight.intent
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          HUB                                    │
│              (Orchestrator + Browser Control)                   │
└─────────────────────────────────────────────────────────────────┘
        ▲                     ▲                     ▲
        │                     │                     │
┌───────────────┐     ┌─────────────┐     ┌─────────────┐
│    Pulse      │     │   Janitor   │     │   Vision    │
│  (Stability)  │     │ (Obstacles) │     │    (AI)     │
│  Priority: 1  │     │ Priority: 5 │     │ Priority: 7 │
└───────────────┘     └─────────────┘     └─────────────┘
```

---

## License

MIT - Created by [Dhiraj Das](https://dhirajdas.dev)
