# 🛰️ Constellation-Based Automation (CBA)
## Starlight Protocol v2.7 — The Predictive Intelligence Era

[![Version](https://img.shields.io/badge/version-2.7.0-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![Python](https://img.shields.io/badge/python-%3E%3D3.9-blue.svg)](https://python.org)

**"Don't look at the ground; look at the Starlight."**

CBA is a philosophical shift in browser automation. Inspired by biological navigation (like the dung beetle using the Milky Way), this framework moves away from linear scripts that handle every possible UI obstacle. Instead, it uses a **Sovereign Constellation** of autonomous agents (Sentinels) that orient toward high-level goals.

---

## 🏗️ The Sovereign Constellation

![CBA Architecture](architecture.png)

CBA uses a **Decentralized Sidecar Architecture** communicating over a JSON-RPC message bus.

| Layer | Role |
| :--- | :--- |
| **Intent Layer** | High-level business intent. Selector-less (e.g., `{ goal: 'Login' }`). |
| **The Hub** | Orchestrates Playwright, resolves semantic goals, manages **Sovereign Context**. |
| **Vision Sentinel** | Uses local SLMs (Moondream) for visual obstacle detection. |
| **Janitor Sentinel** | Heuristic background process that clears modals and overlays. |
| **Pulse Sentinel** | Monitors network/DOM jitter for **Wait-Less** temporal stability. |
| **Data Sentinel** | Passively extracts metadata and injects it into the shared context. |

---

## ✨ What's New in v2.7

### 🛠️ Phase 8: Codebase Hardening

| Feature | Description |
|---------|-------------|
| **Centralized Config** | All settings in `config.json` |
| **Screenshot Cleanup** | Auto-removes files older than 24h |
| **Trace Rotation** | Limits mission trace to 500 events |
| **Graceful Shutdown** | Ctrl+C saves sentinel memory |
| **SDK Improvements** | Atomic writes, proper exceptions |
| **PulseSentinel Migration** | Now uses SentinelBase SDK |

See [CHANGELOG.md](CHANGELOG.md) for full history.

---

## 🛰️ The Starlight Protocol

Standardized signals for zero-wait, selector-less autonomy:

| Method | Purpose |
| :--- | :--- |
| `starlight.intent` | Issues a high-level `goal` or `cmd`. |
| `starlight.pre_check` | Handshake broadcast with screenshot for AI analysis. |
| `starlight.wait` | Veto due to environmental instability. |
| `starlight.hijack` | Request absolute browser lock for healing. |
| `starlight.context_update` | Inject intelligence into the shared mission state. |

---

## 🛠️ The Starlight SDK (Python)

Build a sentinel in minutes:

```python
from sdk.starlight_sdk import SentinelBase

class MySentinel(SentinelBase):
    def __init__(self):
        super().__init__(layer_name="MySentinel", priority=10)
        self.capabilities = ["custom-healing"]

    async def on_pre_check(self, params, msg_id):
        # Your custom healing logic here
        await self.send_clear()

if __name__ == "__main__":
    import asyncio
    asyncio.run(MySentinel().start())
```

**SDK Features:**
- ✅ Auto-reconnect on connection failure
- ✅ Persistent memory (JSON-based)
- ✅ Graceful shutdown (SIGINT/SIGTERM)
- ✅ Atomic file writes
- ✅ Config-driven settings

---

## 🌌 Phase 7: The Galaxy Mesh

CBA is a **Self-Learning Ecosystem**:

### 🧠 Predictive Memory
The Hub learns from every mission:
- **Self-Healing**: Failed selectors auto-substitute from historical memory
- **Aura Throttling**: Proactive pacing during historically unstable windows
- **Sentinel Learning**: Agents remember successful remediation strategies

### 📈 ROI Dashboard
The `report.html` quantifies business value:
- **Triage Savings**: Minutes saved per obstacle cleared
- **Self-Healing Credits**: Automated selector fixes
- **Aura Stabilization**: Predictive jitter avoidance
- **Visual Proof**: Before/after screenshots

---

## 🚀 Getting Started

### Prerequisites
- Node.js v18+ & Python 3.9+
- [Ollama](https://ollama.ai/) (optional, for Vision Sentinel)

### Setup
```bash
git clone <repo-url>
cd cba
npm install
pip install -r requirements.txt
npx playwright install chromium
```

### Run the Demo
```bash
# Windows (recommended)
run_cba.bat

# Manual
node src/hub.js          # Terminal 1
python sentinels/pulse_sentinel.py   # Terminal 2
python sentinels/janitor.py          # Terminal 3
node src/intent.js       # Terminal 4
```

---

## ⚙️ Configuration

All settings are in `config.json`:

```json
{
    "hub": {
        "port": 8080,
        "syncBudget": 30000,
        "missionTimeout": 180000
    },
    "sentinel": {
        "settlementWindow": 1.0,
        "reconnectDelay": 3
    },
    "vision": {
        "model": "moondream",
        "timeout": 25
    }
}
```

See [technical_guide.md](technical_guide.md) for full reference.

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [user_guide.md](user_guide.md) | Getting started, sentinel overview |
| [technical_guide.md](technical_guide.md) | Protocol spec, SDK reference |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [STARLIGHT_STANDARD.md](STARLIGHT_STANDARD.md) | Formal protocol specification |
| [roadmap.md](roadmap.md) | Future development plans |

---

## 🐳 Docker Deployment

```bash
docker-compose up --build
```

Deploys a managed Hub and sentinel mesh for ephemeral CI/CD execution.

---

## 🗺️ Roadmap

| Phase | Status |
|-------|--------|
| Phase 1-6 | ✅ Complete |
| Phase 7 (Galaxy Mesh) | ✅ Complete |
| Phase 8 (Quality) | ✅ Complete |
| Phase 9 (Security) | 🔜 Coming Soon |

---

## 📄 License

MIT License - see [LICENSE](LICENSE)

---

*Built with ❤️ by [Dhiraj Das](https://www.dhirajdas.dev)*
