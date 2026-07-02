# ✨ Starlight Protocol

**Resilient, secure browser automation through autonomous Sentinel coordination.**

---

## What is Starlight?

Starlight is an open protocol for building **self-healing browser automation** systems. Instead of brittle scripts that break when the DOM changes, Starlight uses a constellation of autonomous **Sentinels** that detect and clear obstacles in real-time.

### The Problem
- 🔴 Flaky tests fail randomly due to popups, spinners, network delays
- 🔴 Hardcoded waits slow down execution and still fail
- 🔴 Selector changes break entire test suites
- 🔴 Security vulnerabilities in automation frameworks

### The Solution
- ✅ **Autonomous Sentinels** handle popups, cookies, modals automatically
- ✅ **Entropy-based stability** waits only as long as needed
- ✅ **True Self-Healing**: Hub learns and persists element selectors automatically
- ✅ **Semantic Perception**: Resolves goals like "Buy something" dynamically without hardcoded selectors
- ✅ **Sentinel Store** and **Visual Editor** for no-code agent creation
- ✅ **Enterprise Security** with JWT authentication, input validation, and PII protection

---

## Protocol Objectives

Run a mission file, URL, or natural-language intent with Sentinels in the background:

```bash
node bin/starlight.js --url https://www.dhirajdas.dev --all-sentinels --headless --json
node bin/starlight.js --intent "Go to https://www.saucedemo.com and click Login" --all-sentinels --headless --json
```

The runner starts the Hub, waits for health, starts Sentinels, waits for registration, and routes browser actions through `starlight.pre_check` consensus.

## Hub & Constellation Features

| Feature | Description |
|---------|-------------|
| **100% Test Coverage** | Zero-defect implementation with 100% unit test coverage. |
| **Sentinel Store** | Install community-built Sentinels from the registry or GitHub. |
| **Visual Editor** | Create and export custom Sentinels with a no-code visual builder. |
| **Mobile Emulation** | Built-in support for responsive testing and mobile device emulation. |
| **Time-Travel Triage** | Debug failures with full state snapshots and rewind capabilities. |
| **JWT Authentication** | Secure token-based authentication with timing-safe verification. |
| **Input Validation** | Comprehensive JSON schema validation for all protocol messages. |
| **PII Protection** | Automatic detection and redaction of sensitive data (emails, passwords, credit cards). |
| **GDPR/HIPAA Compliance** | Built-in support for data subject rights and healthcare data protection. |
| **SSL/TLS Encryption** | Optional encryption for secure WebSocket communication. |

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
- 🔒 [Security Guide](https://github.com/starlight-protocol/starlight/blob/main/docs/SECURITY_GUIDE.md) - Comprehensive security documentation
- ⚙️ [Security Configuration](https://github.com/starlight-protocol/starlight/blob/main/docs/SECURITY_CONFIGURATION.md) - Security settings reference
- 📊 [Compliance Guide](https://github.com/starlight-protocol/starlight/blob/main/docs/COMPLIANCE_GUIDE.md) - GDPR/HIPAA compliance
- 🧪 [Security Testing](https://github.com/starlight-protocol/starlight/blob/main/docs/SECURITY_TESTING.md) - Testing procedures
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
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ JWT Handler │  │Schema Validator│  │   PII Redactor      │  │
│  │  (Auth)     │  │  (Security)   │  │   (Privacy)          │  │
│  └─────────────┘  └──────────────┘  └───────────────────────┘  │
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

MIT - Created by [Dhiraj Das](https://www.dhirajdas.dev)
