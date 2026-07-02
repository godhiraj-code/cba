# The Starlight Protocol: A Complete Guide

> *"The path should always be clear."*

---

## What is the Starlight Protocol?

**The Starlight Protocol is an open standard for autonomous browser automation.** 

Think of it as a "language" that allows different software components to work together to automate web browsers in a self-healing, intelligent way. Unlike traditional automation tools that break when websites change, Starlight-powered automation adapts, learns, and heals itself.

### The Problem We're Solving

Traditional browser automation (Selenium, Playwright, Puppeteer) has a fundamental flaw:

```
❌ Button moves → Test breaks
❌ CSS class changes → Test breaks  
❌ Popup appears → Test breaks
❌ Loading slow → Test breaks
```

**80% of automation maintenance time** is spent fixing broken selectors and handling unexpected UI changes. This costs companies millions of dollars annually and makes browser automation fragile and unreliable.

### The Starlight Solution

Starlight introduces **autonomous agents called Sentinels** that:

```
✅ Detect obstacles before they cause failures
✅ Heal broken selectors automatically
✅ Wait intelligently for the right moment
✅ Learn from successful executions
```

---

## Core Concepts

### 1. The Hub

The **Hub** is the central brain of the system. It:

- Controls the browser (via Playwright)
- Coordinates all Sentinels
- Resolves semantic goals to actual selectors
- Maintains learned mappings for self-healing
- Generates reports and telemetry

```
┌─────────────────────────────────────┐
│              THE HUB                │
│  ┌─────────┐  ┌─────────────────┐  │
│  │ Browser │  │ Semantic Engine │  │
│  │ Control │  │   (AI/Goals)    │  │
│  └────┬────┘  └────────┬────────┘  │
│       │                │           │
│  ┌────┴────────────────┴────┐     │
│  │     WebSocket Server      │     │
│  └───────────────────────────┘     │
└─────────────────────────────────────┘
```

### 2. Sentinels

**Sentinels** are autonomous agents that monitor and protect automation. Each Sentinel has a specific responsibility:

| Sentinel | Purpose |
|----------|---------|
| **Pulse Sentinel** | Waits for page stability (no mutations, network idle) |
| **Janitor Sentinel** | Detects and clears popups, modals, cookie banners |
| **Vision Sentinel** | Uses AI/ML to visually detect obstacles |
| **Data Sentinel** | Injects page and command context into shared state |
| **PII Sentinel** | Detects and redacts sensitive data |

Sentinels can be written in **any language** - Python, JavaScript, Go, Java, Rust, etc.

### 3. Intents

**Intents** are the automation scripts. Instead of writing fragile selectors:

```javascript
// ❌ Traditional (fragile)
await page.click('#submit-btn-v2');

// ✅ Starlight (semantic)
await runner.clickGoal('Submit Order');
```

The Hub resolves "Submit Order" to the actual button, learning and adapting over time.

### 4. The Protocol

All communication uses **JSON-RPC 2.0 over WebSocket**. This means:

- Any language can participate
- Real-time bidirectional communication
- Standard, well-documented format

```json
{
    "jsonrpc": "2.0",
    "method": "starlight.intent",
    "params": {
        "goal": "Click the login button"
    },
    "id": "intent-001"
}
```

---

## How It All Works Together

### The Automation Flow

```
┌──────────┐    ┌──────────┐    ┌──────────┐
│  Intent  │───▶│   Hub    │───▶│ Browser  │
│ (Script) │    │ (Brain)  │    │ (Chrome) │
└──────────┘    └────┬─────┘    └──────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │  Pulse  │ │ Janitor │ │ Vision  │
   │Sentinel │ │Sentinel │ │Sentinel │
   └─────────┘ └─────────┘ └─────────┘
```

### Step-by-Step Execution

1. **Intent sends command** → "Click the login button"
2. **Hub resolves goal** → Finds element matching "login button"
3. **Hub broadcasts PRE_CHECK** → Asks all Sentinels: "Is it safe to click?"
4. **Sentinels respond**:
   - Pulse: "Wait, page still loading" → `WAIT`
   - Janitor: "Popup detected, clearing..." → `HIJACK` → clears → `RESUME`
   - Vision: "All clear" → `CLEAR`
5. **Hub waits for consensus** → All Sentinels must approve
6. **Hub executes click** → Browser clicks the button
7. **Hub learns** → Remembers "login button" → `#login-submit` for next time

---

## The SDKs

SDKs allow developers to build Sentinels and Intents in their preferred language.

### JavaScript SDK (Built-in)

```javascript
const { IntentRunner } = require('@starlight-protocol/starlight/sdk');

const runner = new IntentRunner('ws://localhost:8080');
await runner.ready();
await runner.goto('https://example.com');
await runner.clickGoal('Sign In');
await runner.fillGoal('Email', 'user@example.com');
await runner.finish();
```

### Python SDK

```python
from sdk.starlight_sdk import SentinelBase

class MyJanitorSentinel(SentinelBase):
    def __init__(self):
        super().__init__(
            layer='JanitorSentinel',
            priority=5,
            selectors=['.popup', '.modal', '.cookie-banner']
        )
    
    async def on_pre_check(self, params, msg_id):
        if params.get('blocking'):
            await self.send_hijack(msg_id, 'Clearing obstacles')
            for elem in params['blocking']:
                await self.send_action('hide', elem['selector'])
            await self.send_resume()
        else:
            await self.send_clear(msg_id)
```

### Go SDK (New!)

```go
sentinel := starlight.NewSentinel("MySentinel", 5)
sentinel.OnPreCheck = func(params starlight.PreCheckParams, msgID string) error {
    if len(params.Blocking) > 0 {
        return sentinel.SendHijack(msgID, "Clearing obstacles")
    }
    return sentinel.SendClear(msgID)
}
sentinel.Start(ctx, "ws://localhost:8080")
```

### Java SDK (New!)

```java
Sentinel sentinel = new Sentinel("MySentinel", 5)
    .withSelectors(List.of(".popup", ".modal"))
    .onPreCheck((params, ctx) -> {
        if (!params.getBlocking().isEmpty()) {
            ctx.hijack("Clearing obstacles");
        } else {
            ctx.clear();
        }
    });

sentinel.start("ws://localhost:8080");
```

---

## Key Features

### 1. Self-Healing Selectors

The Hub learns successful goal→selector mappings and saves them:

```json
// starlight_memory.json
{
    "click:Login": "button#login-submit",
    "fill:Email": "input[name='email']",
    "click:Add to Cart": ".product-card .add-btn"
}
```

When a selector breaks, the Hub re-resolves the goal semantically.

### 2. Semantic Goal Resolution

Instead of brittle selectors, use natural language:

```javascript
await runner.clickGoal('Shopping Cart');  // Finds cart icon
await runner.fillGoal('Search', 'laptops');  // Finds search input
await runner.selectGoal('Country', 'India');  // Finds country dropdown
```

### 3. AI/ML Integration

- **Local AI**: Ollama with Moondream for visual obstacle detection
- **Cloud AI**: OpenAI, Anthropic, Azure for NLI (Natural Language Interface)
- **Vision Analysis**: Screenshot analysis to detect visual obstacles

### 4. Enterprise Security

- **JWT Authentication**: Token-based Sentinel authorization
- **PII Redaction**: Automatic sensitive data masking in logs
- **Input Validation**: Schema validation for all messages
- **TLS/SSL**: Encrypted WebSocket connections

### 5. Observability

- **OpenTelemetry**: Distributed tracing and metrics
- **Mission Reports**: HTML reports with screenshots and timelines
- **Telemetry**: Performance and reliability metrics

---

## Architecture Deep Dive

### Protocol Messages

| Method | Direction | Purpose |
|--------|-----------|---------|
| `starlight.registration` | Sentinel → Hub | Register with capabilities |
| `starlight.pre_check` | Hub → Sentinel | "Is it safe to proceed?" |
| `starlight.clear` | Sentinel → Hub | "Yes, proceed" |
| `starlight.wait` | Sentinel → Hub | "No, retry after X ms" |
| `starlight.hijack` | Sentinel → Hub | "I need browser control" |
| `starlight.action` | Sentinel → Hub | "Execute this action" |
| `starlight.resume` | Sentinel → Hub | "Done, proceed" |
| `starlight.intent` | Intent → Hub | Execute automation command |

### Priority System

Sentinels have priorities (1-10, lower = higher priority):

```
Priority 1: Pulse Sentinel (stability veto)
Priority 2: PII Sentinel
Priority 3: Vision Sentinel
Priority 5: Janitor Sentinel
Priority 10: Data/A11y passive Sentinels
```

### Consensus Mechanism

Before executing any action, the Hub requires **all Sentinels to approve**:

```
CLEAR + CLEAR + CLEAR = ✅ Execute
CLEAR + CLEAR + WAIT  = ⏳ Retry later
CLEAR + HIJACK + WAIT = 🚨 Sentinel takes control
```

There is no production "force proceed" after repeated `WAIT` responses. If the environment never becomes safe enough for the Sentinels to clear, the objective fails and the report explains which Sentinel blocked progress.

---

## What We're Building (Roadmap)

### Phase 1: Foundation ✅ (Current)

- [x] Go SDK - Enterprise language support
- [x] Java SDK - Enterprise language support  
- [x] OpenTelemetry - Observability
- [x] VS Code Extension - Developer experience
- [x] TCK - Technology Compatibility Kit

### Phase 2: Enterprise Features (Next 6 months)

- [ ] **Kubernetes Operator** - Cloud-native deployment
- [ ] **Multi-Tenancy** - Isolated tenant workspaces
- [ ] **Rust & C# SDKs** - More language support
- [ ] **Visual Regression Testing** - Pixel-perfect comparisons
- [ ] **Chaos Engineering** - Resilience testing

### Phase 3: Ecosystem Growth (6-12 months)

- [ ] **Plugin Marketplace** - Community Sentinels
- [ ] **Learning Platform** - Courses and certifications
- [ ] **Starlight Foundation** - Open governance
- [ ] **Browser Vendor Partnerships** - Native integrations

---

## Why Starlight Protocol?

### For Test Engineers

```
Before: 80% time fixing broken tests
After:  Focus on actual testing
```

### For Developers

```
Before: Complex Selenium/Playwright code
After:  Natural language goals
```

### For Enterprises

```
Before: Millions lost to flaky tests
After:  Reliable, self-healing automation
```

### For the Community

```
Before: Vendor lock-in to specific tools
After:  Open standard, any language, any tool
```

---

## Getting Started

### 1. Start the Hub

```bash
cd c:\cba
node src/hub.js
```

### 2. Run a Mission

```bash
node bin/starlight.js test/intent_saucedemo.js
```

For production-style protocol objectives, use the unified runner:

```bash
# URL objective
node bin/starlight.js --url https://www.dhirajdas.dev --all-sentinels --headless --json

# Natural-language objective
node bin/starlight.js --intent "Go to https://www.saucedemo.com and fill Username with standard_user and fill Password with secret_sauce and click Login" --all-sentinels --headless --json
```

The runner starts the Hub, waits for `/health`, starts Sentinels in the background, waits for registration, and only passes browser actions through Sentinel consensus.

### 3. Build Your Own Sentinel

Create `sentinels/my_sentinel.py`:

```python
from sdk.starlight_sdk import SentinelBase

class MySentinel(SentinelBase):
    def __init__(self):
        super().__init__(layer='MySentinel', priority=5)
    
    async def on_pre_check(self, params, msg_id):
        print(f"Checking: {params}")
        await self.send_clear(msg_id)

if __name__ == '__main__':
    import asyncio
    asyncio.run(MySentinel().start())
```

Run it:
```bash
python sentinels/my_sentinel.py
```

### 4. Write Semantic Intents

```javascript
const { IntentRunner } = require('./sdk/intent_runner');

(async () => {
    const runner = new IntentRunner('ws://localhost:8080');
    await runner.ready();
    
    await runner.goto('https://www.saucedemo.com');
    await runner.fillGoal('Username', 'standard_user');
    await runner.fillGoal('Password', 'secret_sauce');
    await runner.clickGoal('Login');
    
    await runner.finish();
})();
```

---

## The Vision

The Starlight Protocol aims to become the **universal standard for browser automation** - just like HTTP is for web communication or SQL is for databases.

**Our goal:**

> Any automation tool, any programming language, any platform - all speaking the same protocol, all benefiting from collective intelligence.

When one Starlight deployment learns that "Add to Cart" maps to `.product-add-btn`, that knowledge can be shared across the ecosystem, making everyone's automation more reliable.

---

## Join the Constellation

- 🌟 **GitHub**: [starlight-protocol/starlight](https://github.com/starlight-protocol/starlight)
- 📖 **Specification**: [STARLIGHT_PROTOCOL_SPEC_v1.0.0.md](./spec/STARLIGHT_PROTOCOL_SPEC_v1.0.0.md)
- 🛠️ **VS Code Extension**: Coming to marketplace
- 📦 **npm**: `@starlight-protocol/starlight`
- 🐍 **PyPI**: `starlight-protocol`

---

*Built with ❤️ for the automation community*

**The path should always be clear.** ✨
