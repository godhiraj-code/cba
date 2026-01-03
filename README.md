# 🛰️ Starlight Protocol

<p align="center">
  <img src="assets/starlight-logo.png" alt="Starlight Protocol" width="150">
</p>

<p align="center">
  <strong>An Open Standard for Autonomous Browser Automation</strong>
</p>

<p align="center">
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-3.0.3-blue.svg" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License"></a>
  <a href="https://github.com/godhiraj-code/cba/actions/workflows/starlight_ci.yml"><img src="https://github.com/godhiraj-code/cba/actions/workflows/starlight_ci.yml/badge.svg" alt="CI"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node"></a>
  <a href="https://python.org"><img src="https://img.shields.io/badge/python-%3E%3D3.9-blue.svg" alt="Python"></a>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="spec/STARLIGHT_PROTOCOL_SPEC_v1.0.0.md">Specification</a> •
  <a href="docs/book/THE_STARLIGHT_PROTOCOL_BOOK.md">Book</a> •
  <a href="docs/roadmap.md">Roadmap</a>
</p>

---

## What is the Starlight Protocol?

The Starlight Protocol decouples **intent** from **environment**. Your test scripts describe goals; autonomous Sentinels handle the chaos.

```javascript
// Traditional: Handle EVERYTHING yourself
if (await page.$('.cookie-banner')) await page.click('.dismiss');
if (await page.$('.popup')) await page.click('.close');
await page.click('#submit');

// Starlight: Express INTENT only
await hub.send({ goal: 'Submit Form' });
// Sentinels automatically clear obstacles
```

---

## 🏗️ Architecture

<p align="center">
  <img src="assets/architecture.png" alt="Architecture" width="600">
</p>

| Component | Role |
|-----------|------|
| **Hub** | Central orchestrator, manages Playwright browser |
| **Pulse Sentinel** | Monitors DOM/Network stability |
| **Janitor Sentinel** | Clears popups, modals, banners |
| **Vision Sentinel** | AI-powered obstacle detection (Moondream) |
| **Data Sentinel** | Context extraction & injection |

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ & Python 3.9+
- [Ollama](https://ollama.ai/) (optional, for Vision)

### Install
```bash
git clone https://github.com/godhiraj-code/cba.git
cd cba
npm install
pip install -r requirements.txt
npx playwright install chromium
```

### Run
```bash
# One command launches everything
node bin/starlight.js test/intent_portfolio_v2.js --headless
```

### Mission Control (GUI)
```bash
node launcher/server.js
# Open http://localhost:3000
```

---

## 🛰️ The Protocol

All communication uses JSON-RPC 2.0:

| Method | Purpose |
|--------|---------|
| `starlight.intent` | Issue a goal or command |
| `starlight.pre_check` | Hub → Sentinels handshake |
| `starlight.clear` | Sentinel approves action |
| `starlight.wait` | Sentinel vetoes (retry later) |
| `starlight.hijack` | Sentinel takes browser control |
| `starlight.resume` | Sentinel releases control |

📄 **[Full Specification](spec/STARLIGHT_PROTOCOL_SPEC_v1.0.0.md)**

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| **Self-Healing Selectors** | Learns alternatives when selectors fail |
| **Animation Tolerance** | Handles CSS animations without blocking |
| **No-Code Recorder** | Record tests by clicking through your site |
| **Visual Sentinel Editor** | Create custom Sentinels without code |
| **Shadow DOM Support** | Pierces web component boundaries |
| **Webhook Alerts** | Slack/Teams notifications |
| **ROI Dashboard** | Quantifies time saved |

---

## 🛠️ Build a Sentinel

```python
from sdk.starlight_sdk import SentinelBase

class MySentinel(SentinelBase):
    def __init__(self):
        super().__init__("MySentinel", priority=5)
        self.selectors = [".my-obstacle"]
    
    async def on_pre_check(self, params, msg_id):
        # Your detection logic
        await self.send_clear()

if __name__ == "__main__":
    import asyncio
    asyncio.run(MySentinel().start())
```

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [📖 Book](docs/book/THE_STARLIGHT_PROTOCOL_BOOK.md) | Comprehensive guide |
| [📄 Specification](spec/STARLIGHT_PROTOCOL_SPEC_v1.0.0.md) | Formal protocol standard |
| [📋 User Guide](docs/user_guide.md) | Getting started |
| [⚙️ Technical Guide](docs/technical_guide.md) | SDK & configuration |
| [🗺️ Roadmap](docs/roadmap.md) | Future plans |
| [📝 Changelog](CHANGELOG.md) | Version history |

---

## 🐳 Docker

```bash
docker-compose up --build
```

---

## 📖 Blog Series

- [Part 1: The Inner Workings](https://www.dhirajdas.dev/blog/constellation-based-automation-starlight-protocol)
- [Part 2: Mission Control & ROI](https://www.dhirajdas.dev/blog/starlight-mission-control-observability-roi)
- [Part 3: The Autonomous Era](https://www.dhirajdas.dev/blog/starlight-part-3-autonomous-era)

---

## 📄 License

MIT License - [LICENSE](LICENSE)

---

<p align="center">
  <em>"Don't look at the ground; look at the Starlight."</em>
</p>

<p align="center">
  Built with ❤️ by <a href="https://www.dhirajdas.dev">Dhiraj Das</a>
</p>
