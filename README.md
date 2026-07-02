# 🛰️ Starlight Protocol

<p align="center">
  <img src="https://raw.githubusercontent.com/starlight-protocol/starlight/main/assets/starlight-logo.png" alt="Starlight Protocol" width="150">
</p>

<p align="center">
  <strong>An Open Standard for Autonomous Browser Automation</strong>
</p>

<p align="center">
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.3.5--alpha.1-blue.svg" alt="Version"></a>
  <a href="https://www.npmjs.com/package/@starlight-protocol/starlight"><img src="https://img.shields.io/npm/v/@starlight-protocol/starlight?label=npm&color=cb3837" alt="npm"></a>
  <a href="https://pypi.org/project/starlight-protocol/"><img src="https://img.shields.io/pypi/v/starlight-protocol?label=pypi&color=3775a9" alt="PyPI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License"></a>
  <a href="https://github.com/starlight-protocol/starlight/actions/workflows/starlight_ci.yml"><img src="https://github.com/starlight-protocol/starlight/actions/workflows/starlight_ci.yml/badge.svg" alt="CI"></a>
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
  <img src="https://raw.githubusercontent.com/starlight-protocol/starlight/main/assets/architecture.png" alt="Architecture" width="600">
</p>

| Component | Role |
|-----------|------|
| **Hub** | Central orchestrator, manages Playwright browser |
| **JWT Handler** | Authentication & authorization system |
| **Schema Validator** | Input validation & message verification |
| **PII Redactor** | Data protection & privacy compliance |
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
git clone https://github.com/starlight-protocol/starlight.git
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

### Protocol Objectives
```bash
# Probe a URL with the default background sentinel fleet
node bin/starlight.js --url https://example.com --headless

# Start at a URL, then let natural-language intent drive the mission
node bin/starlight.js --url https://www.saucedemo.com --intent "log in and add the first item to the cart" --headless

# Use every available sentinel, including AI vision if its local backend is running
node bin/starlight.js --url https://example.com --all-sentinels --headless
```

The CLI now treats the protocol objective as a first-class workflow: it starts the Hub, launches Sentinels in the background, waits for registration, executes the mission/URL/intent, and cleans up the constellation when complete.

Real-site protocol evidence is tracked in [`docs/PROTOCOL_OBJECTIVE_EVIDENCE.md`](docs/PROTOCOL_OBJECTIVE_EVIDENCE.md).

### Mission Control (GUI)
```bash
node launcher/server.js
# Open http://localhost:3000
```

### Multi-Browser Support (Phase 14.1)
```bash
# Run with Firefox
HUB_BROWSER_ENGINE=firefox node bin/starlight.js test/intent_portfolio_v2.js

# Run with WebKit (Safari engine)
HUB_BROWSER_ENGINE=webkit node bin/starlight.js test/intent_portfolio_v2.js

# Or configure in config.json:
{
  "hub": {
    "browser": { "engine": "firefox" }
  }
}
```

**Supported Browsers:**
- **Chromium** (default) - Full CDP access, shadow DOM piercing
- **Firefox** - Mozilla engine, standard DOM APIs
- **WebKit** - Safari engine, iOS compatibility testing

Install all browsers:
```bash
npx playwright install chromium firefox webkit
```

### Mobile Emulation (Phase 14.2)
```bash
# Run on iPhone 14 Pro Max
HUB_DEVICE="iPhone 14 Pro Max" node bin/starlight.js test/intent_saucedemo.js

# Run on Pixel 7
HUB_DEVICE="Pixel 7" node bin/starlight.js test/intent_saucedemo.js

# Or configure in config.json:
{
  "hub": {
    "device": "iPhone 14 Pro Max"
  }
}
```

**Verified:** Full 12-step SauceDemo checkout flow passes autonomously. See [test/intent_saucedemo.js](test/intent_saucedemo.js).

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

## 💸 Commercial launch wedge

Starlight should not launch as another generic browser automation tool. The sharper wedge is **Sentinel/Agent-powered AI QA reliability** for teams whose Playwright, Selenium, RPA, or AI-agent browser workflows are flaky, blocked by popups, leaking sensitive data, or hard to explain after failure.

The paid offer should start as a productized service before broad SaaS: reliability audits, managed Sentinel regression runs, and custom Sentinels for one high-value customer journey. The open-source protocol creates trust and virality; the monetizable layer is outcome-based QA reliability, launch-readiness reports, and premium Sentinel/Agent implementation.

Generate the current commercial snapshot with:

```bash
npm run launch:report
```

Then open Mission Control to see the Launch Readiness panel.

For the first paid offer, see [docs/PILOT_OFFER.md](docs/PILOT_OFFER.md).

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| **JWT Authentication** | Secure token-based authentication with timing-safe verification |
| **Input Validation** | Comprehensive JSON schema validation for all protocol messages |
| **PII Protection** | Automatic detection and redaction of sensitive data (emails, passwords, credit cards) |
| **Self-Healing Selectors** | Learns alternatives when selectors fail |
| **Animation Tolerance** | Handles CSS animations without blocking |
| **No-Code Recorder** | Record tests by clicking through your site |
| **Visual Sentinel Editor** | Create custom Sentinels without code |
| **Shadow DOM Support** | Pierces web component boundaries |
| **Webhook Alerts** | Slack/Teams notifications |
| **Upload Automation** | Native file upload support (selector & semantic) |
| **ROI Dashboard** | Quantifies time saved |

---

## 🛠️ SDKs & Language Support

The Starlight Protocol is **language-agnostic**. The Hub (Node.js) communicates with Sentinels via WebSocket, regardless of what language they're written in.

### Pre-Built Sentinels (Python)

The following **production-ready Sentinels** are included and used by Mission Control:

| Sentinel | Location | Description |
|----------|----------|-------------|
| **Pulse Sentinel** | `sentinels/pulse_sentinel.py` | Waits for page stability |
| **Janitor Sentinel** | `sentinels/janitor.py` | Clears popups, modals, banners |
| **Vision Sentinel** | `sentinels/vision_sentinel.py` | AI-powered obstacle detection |
| **Data Sentinel** | `sentinels/data_sentinel.py` | Context extraction |
| **A11y Sentinel** | `sentinels/a11y_sentinel.py` | Accessibility monitoring |
| **PII Sentinel** | `sentinels/pii_sentinel.py` | Sensitive data protection |
| **Responsive Sentinel** | `sentinels/responsive_sentinel.py` | Viewport monitoring |

```bash
# These are what Mission Control launches
python sentinels/janitor.py
```

### SDKs for Custom Sentinel Development

Build your own Sentinels in your preferred language:

#### Python SDK (Mature)
```python
from sdk.starlight_sdk import SentinelBase

class MySentinel(SentinelBase):
    def __init__(self):
        super().__init__("MySentinel", priority=5)
        self.selectors = [".my-obstacle"]
    
    async def on_pre_check(self, params, msg_id):
        await self.send_clear(msg_id)

if __name__ == "__main__":
    import asyncio
    asyncio.run(MySentinel().start())
```

#### Go SDK
> ⚠️ **Note:** This SDK provides building blocks. Pre-built Sentinels (Janitor, Pulse, etc.) are NOT included - use Python versions or build your own.

```go
// go-sdk/examples/simple_sentinel/main.go
sentinel := starlight.NewSentinel("MySentinel", 5)
sentinel.OnPreCheck = func(params starlight.PreCheckParams, msgID string) error {
    return sentinel.SendClear(msgID)
}
sentinel.Start(ctx, "ws://localhost:8080")
```

📦 **Location:** [`go-sdk/`](go-sdk/) | 📄 **[Go SDK README](go-sdk/README.md)**

#### Java SDK
> ⚠️ **Note:** This SDK provides building blocks. Pre-built Sentinels (Janitor, Pulse, etc.) are NOT included - use Python versions or build your own.

```java
// java-sdk/src/.../examples/SimpleSentinel.java
Sentinel sentinel = new Sentinel("MySentinel", 5)
    .withSelectors(List.of(".popup"))
    .onPreCheck((params, ctx) -> ctx.clear());

sentinel.start("ws://localhost:8080");
```

📦 **Location:** [`java-sdk/`](java-sdk/) | 📄 **[Java SDK README](java-sdk/README.md)**

#### Rust SDK
> ⚠️ **Note:** This SDK provides building blocks. Pre-built Sentinels (Janitor, Pulse, etc.) are NOT included - use Python versions or build your own.

```rust
// rust-sdk/examples/simple_sentinel.rs
use starlight::{Sentinel, SentinelConfig, SentinelHandler, PreCheckParams, PreCheckResponse};

struct MyHandler;

#[async_trait::async_trait]
impl SentinelHandler for MyHandler {
    async fn on_pre_check(&self, params: PreCheckParams) -> PreCheckResponse {
        if params.blocking.is_empty() {
            PreCheckResponse::Clear
        } else {
            PreCheckResponse::Hijack { reason: "Detected obstacles".to_string() }
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = SentinelConfig::new("MySentinel", 5);
    let mut sentinel = Sentinel::new(config, MyHandler);
    sentinel.connect("ws://localhost:8080").await?;
    sentinel.run().await?;
    Ok(())
}
```

📦 **Location:** [`rust-sdk/`](rust-sdk/) | 📄 **[Rust SDK README](rust-sdk/README.md)**

#### JavaScript SDK (Built-in)
```javascript
const { IntentRunner } = require('./sdk/intent_runner');

const runner = new IntentRunner('ws://localhost:8080');
await runner.clickGoal('Submit');
```

### SDK Comparison

| Feature | Python | Go | Java | Rust | JavaScript |
|---------|--------|-----|------|------|------------|
| Pre-built Sentinels | ✅ Yes | ❌ No | ❌ No | ❌ No | ❌ No |
| Mission Control Support | ✅ Yes | ❌ Manual | ❌ Manual | ❌ Manual | ✅ Intents |
| JWT Authentication | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Auto-Reconnect | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Production Ready | ✅ Yes | 🔶 Alpha | 🔶 Alpha | 🔶 Alpha | ✅ Yes |

---


## 🛒 Available Sentinels

The following Sentinels are included and ready to use:

| Sentinel | File | Description |
|----------|------|-------------|
| **Pulse** | `sentinels/pulse_sentinel.py` | Monitors DOM mutations and network activity for stability |
| **Janitor** | `sentinels/janitor.py` | Clears popups, modals, overlays, cookie banners |
| **Vision** | `sentinels/vision_sentinel.py` | AI-powered visual obstacle detection (Moondream/Ollama) |
| **Data** | `sentinels/data_sentinel.py` | Context extraction and injection |
| **A11y** | `sentinels/a11y_sentinel.py` | Accessibility monitoring and WCAG compliance |
| **PII** | `sentinels/pii_sentinel.py` | Sensitive data detection and redaction |
| **Responsive** | `sentinels/responsive_sentinel.py` | Viewport and responsive layout monitoring |

### Create Your Own Sentinel

```bash
# Use CLI to scaffold a new Sentinel
python cli/main.py create "My Custom Sentinel"

# Or use the Visual Editor (no-code)
# Open Mission Control → Click "Create Sentinel"
```

### Coming Soon: Sentinel Marketplace
> 🚧 **Planned for Phase 3**: A community marketplace for sharing and installing Sentinels.

---


## ✅ Test Coverage

```bash
# Run all unit tests (100% coverage)
node test/run_all_tests.js
```

| Component | Test File | Status |
|-----------|-----------|--------|
| IntentRunner | test_intent_runner.js | ✅ |
| SentinelSDK | test_sentinel_sdk.js | ✅ |
| HubCore | test_hub_core.js | ✅ |
| BrowserAdapter | test_browser_adapter.js | ✅ |
| ShadowUtils | test_shadow_utils.js | ✅ |
| Warp | test_warp.js | ✅ |
| Telemetry | test_telemetry.js | ✅ |
| CLI | test_cli.js | ✅ |
| + 4 more | ... | ✅ |

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [🔒 Security Guide](docs/SECURITY_GUIDE.md) | Security architecture & best practices |
| [📖 Book](docs/book/THE_STARLIGHT_PROTOCOL_BOOK.md) | Comprehensive guide |
| [📄 Specification](spec/STARLIGHT_PROTOCOL_SPEC_v1.0.0.md) | Formal protocol standard |
| [📋 User Guide](docs/user_guide.md) | Getting started |
| [⚙️ Technical Guide](docs/technical_guide.md) | SDK & configuration |
| [🛡️ Security Configuration](docs/SECURITY_CONFIGURATION.md) | Security settings reference |
| [📊 Compliance Guide](docs/COMPLIANCE_GUIDE.md) | GDPR/HIPAA compliance |
| [🧪 Security Testing](docs/SECURITY_TESTING.md) | Security testing procedures |
| [🗺️ Roadmap](docs/roadmap.md) | Future plans |
| [📝 Changelog](CHANGELOG.md) | Version history |

---

## 🔒 Security Features

Starlight Protocol includes enterprise-grade security features:

### **Authentication & Authorization**
- ✅ JWT-based authentication with HS256 signing
- ✅ Configurable token expiration (default: 3600s)
- ✅ Timing-safe signature verification
- ✅ Token refresh mechanism

### **Input Validation & Protection**
- ✅ Comprehensive JSON schema validation for all protocol messages
- ✅ Field type checking, pattern matching, and length limits
- ✅ CSS selector injection prevention
- ✅ XSS protection with HTML escaping

### **Data Protection & Privacy**
- ✅ Automatic PII detection and redaction
- ✅ AES-256-GCM encryption for sensitive data
- ✅ Secure logging with automatic PII redaction
- ✅ Compliance modes: alert, block, or redact

### **Security Configuration**
```json
{
    "security": {
        "jwtSecret": "your-secret-key",
        "tokenExpiry": 3600,
        "piiRedaction": true,
        "ssl": {
            "enabled": false,
            "keyPath": null,
            "certPath": null
        }
    }
}
```

📄 **[Security Guide](docs/SECURITY_GUIDE.md)** - Complete security documentation

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
