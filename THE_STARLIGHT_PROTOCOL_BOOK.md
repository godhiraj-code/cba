# The Starlight Protocol
## A Definitive Guide to Constellation-Based Automation

*By Dhiraj Das*

---

# Table of Contents

1. [Introduction: Why Starlight?](#chapter-1-introduction)
2. [The Core Philosophy](#chapter-2-philosophy)
3. [Architecture Deep Dive](#chapter-3-architecture)
4. [The Hub: The Orchestrator](#chapter-4-the-hub)
5. [Sentinels: The Guardians](#chapter-5-sentinels)
6. [The Protocol: JSON-RPC Messages](#chapter-6-protocol)
7. [Self-Healing Intelligence](#chapter-7-self-healing)
8. [Building Custom Sentinels](#chapter-8-custom-sentinels)
9. [Mission Control & Tooling](#chapter-9-tooling)
10. [Enterprise Deployment](#chapter-10-enterprise)
11. [The Future: Phase 17 & Beyond](#chapter-11-future)

---

# Chapter 1: Introduction

## The Problem with Traditional Automation

Every automation engineer has experienced this nightmare: a test that passed yesterday suddenly fails today. The code hasn't changed. The application hasn't changed. Yet something in the **environment**—a cookie banner, a slow network, a modal popup—has broken the fragile path your script was walking.

Traditional automation frameworks like Selenium, Playwright, and Cypress treat the browser as a **deterministic machine**. You tell it: "Click this button." It tries to click. If the button isn't there, it fails. If a popup is covering it, it fails. If the network is slow and the button hasn't loaded, it fails.

**The Starlight Protocol takes a fundamentally different approach.**

Instead of treating the browser as a machine to be commanded, Starlight treats it as an **environment to be governed**. Your test script only describes the *goal*—what you want to achieve. A constellation of autonomous agents monitors the environment and clears obstacles *before* they can block your goal.

## What Makes Starlight Different?

| Traditional Automation | Starlight Protocol |
|------------------------|-------------------|
| Scripts contain if/else for popups | Scripts contain only goals |
| Manual retry logic | Automatic self-healing |
| Hard-coded waits | Temporal stability sensing |
| Single thread of control | Multi-agent mesh |
| Tests break when UI changes | Predictive selector recovery |

## The Origin Story

Starlight was born from a simple observation: **the best automation engineers don't write better scripts—they build better systems**.

Instead of adding more conditional logic to handle edge cases, what if we could deploy a team of specialized agents, each monitoring a different aspect of the environment, all working together to ensure your goal succeeds?

This is Constellation-Based Automation (CBA).

---

# Chapter 2: The Core Philosophy

## Decoupling Intent from Environment

The fundamental insight of the Starlight Protocol is that every automation failure has two causes:

1. **The Intent**: What you wanted to do (click a button, fill a form)
2. **The Environment**: What got in the way (popup, network lag, DOM instability)

Traditional frameworks couple these together. Your script must handle both the goal AND every possible environmental obstacle.

**Starlight decouples them completely:**

```
┌─────────────────────────────────────────────────────┐
│                    INTENT LAYER                     │
│         "Log in with user@example.com"              │
│         (Contains ONLY the goal)                    │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│                    SOVEREIGN LAYER                  │
│                      CBA Hub                        │
│         (Orchestrates the constellation)            │
└─────────────────────────┬───────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   Pulse     │   │   Janitor   │   │   Vision    │
│  Sentinel   │   │  Sentinel   │   │  Sentinel   │
│ (Stability) │   │ (Obstacles) │   │ (AI Eyes)   │
└─────────────┘   └─────────────┘   └─────────────┘
        │                 │                 │
        └─────────────────┼─────────────────┘
                          ▼
┌─────────────────────────────────────────────────────┐
│                   ENVIRONMENT                       │
│                     Browser                         │
│         (The chaotic reality of the web)            │
└─────────────────────────────────────────────────────┘
```

## The Three Laws of Starlight

### Law 1: The Intent Must Be Pure
Your test script should describe ONLY what you want to achieve. It should never contain code to handle popups, wait for stability, or retry on failure. These are environmental concerns, not intent concerns.

### Law 2: The Environment Is Sovereign
The browser environment is treated as a "sovereign state"—an unpredictable territory that requires continuous monitoring. No assumption is made about its stability.

### Law 3: The Constellation Is Collective
No single agent is responsible for environment health. A mesh of specialized Sentinels, each with unique capabilities, collectively ensures the path is clear.

---

# Chapter 3: Architecture Deep Dive

## The Three Layers

### 1. The Intent Layer
This is where your tests live. Intent scripts are written in JavaScript and communicate with the Hub via WebSocket using JSON-RPC 2.0.

```javascript
// Example Intent Script
const ws = new WebSocket('ws://localhost:8080');

// I only describe WHAT I want, not HOW to handle obstacles
await send({ method: 'starlight.intent', params: {
    cmd: 'goto',
    selector: 'https://example.com'
}});

await send({ method: 'starlight.intent', params: {
    goal: 'INITIATE MISSION'  // Semantic goal - no selector needed
}});
```

### 2. The Sovereign Layer (Hub)
The Hub is the brain of the constellation. Written in Node.js (1400+ lines), it:
- Manages the Playwright browser instance
- Routes messages between Intent and Sentinels
- Enforces the PRE_CHECK handshake before every action
- Maintains historical memory for self-healing
- Generates mission traces and reports

### 3. The Sentinel Layer
Sentinels are autonomous Python agents that monitor specific environmental aspects:

| Sentinel | Responsibility | Response Types |
|----------|---------------|----------------|
| **Pulse** | DOM/Network stability | CLEAR, WAIT |
| **Janitor** | Known obstacles (popups, banners) | CLEAR, HIJACK |
| **Vision** | AI-powered visual detection | CLEAR, HIJACK |
| **Data** | Context extraction | CLEAR (passive) |
| **PII** | Privacy data detection | CLEAR, ALERT |

## The Handshake Lifecycle

Every action in Starlight follows this lifecycle:

```
1. Intent sends starlight.intent to Hub
   ↓
2. Hub broadcasts starlight.pre_check to ALL Sentinels
   ↓
3. Each Sentinel analyzes the environment
   ↓
4. Sentinels respond:
   - CLEAR: "No problems detected"
   - WAIT: "Page is unstable, retry later"
   - HIJACK: "Obstacle found, I'll fix it"
   ↓
5. Hub waits for consensus:
   - All CLEAR → Execute the action
   - Any WAIT → Pause and retry
   - Any HIJACK → Yield control to that Sentinel
   ↓
6. After HIJACK, Sentinel sends RESUME
   ↓
7. Hub re-runs PRE_CHECK to verify
   ↓
8. Action executes
```

---

# Chapter 4: The Hub

## Core Responsibilities

The Hub (`src/hub.js`) is the central orchestrator. Its key components:

### 1. WebSocket Server
Listens on port 8080 for connections from Intents and Sentinels.

### 2. Browser Manager
Uses Playwright to control Chromium. Injects MutationObserver for DOM monitoring.

### 3. Message Router
Routes JSON-RPC messages between connected clients.

### 4. Handshake Coordinator
Implements the PRE_CHECK consensus algorithm.

### 5. Semantic Resolver
Translates goals like "Login Button" to actual CSS selectors by scanning the page's accessibility layer.

### 6. Historical Memory
Maintains `mission_trace.json` for time-travel debugging and self-healing selector substitution.

## Key Methods

```javascript
// Registration: When a Sentinel connects
handleMessage(id, ws, msg) {
    case 'starlight.registration':
        this.sentinels.set(id, { ws, ...msg.params });
        
// The core handshake before every action
broadcastPreCheck(msg) {
    // Send PRE_CHECK to all sentinels
    // Wait for responses (CLEAR, WAIT, HIJACK)
    // React accordingly
    
// When a Sentinel takes control
handleHijack(id, msg) {
    this.lockOwner = id;
    this.isLocked = true;
    // Only this Sentinel can now issue commands
```

## Configuration

All settings are externalized to `config.json`:

```json
{
    "hub": {
        "port": 8080,
        "syncBudget": 30000,    // Max wait for handshake (ms)
        "missionTimeout": 180000,
        "screenshotMaxAge": 86400000,
        "traceMaxEvents": 500
    }
}
```

---

# Chapter 5: Sentinels

## The Sentinel Base Class

All Sentinels inherit from `SentinelBase` (in `sdk/starlight_sdk.py`):

```python
from sdk.starlight_sdk import SentinelBase

class MySentinel(SentinelBase):
    def __init__(self):
        super().__init__(
            layer_name="MySentinel",
            priority=5,  # 1 = highest priority
            uri="ws://localhost:8080"
        )
        self.capabilities = ["detection"]
        self.selectors = [".my-pattern"]
    
    def on_pre_check(self, params, msg_id):
        # Called before every action
        # Must respond with CLEAR, WAIT, or HIJACK
        if self.detect_problem():
            self.send_hijack("Found obstacle")
            self.fix_problem()
            self.send_resume()
        else:
            self.send_clear()
```

## Built-In Sentinels

### 💚 Pulse Sentinel (Stability)
Monitors DOM mutation rate. If the page is still changing, it vetoes execution.

**How it works:**
1. Receives entropy stream from Hub (mutation count/sec)
2. If mutations > threshold, sends WAIT
3. When mutations = 0 for N seconds, sends CLEAR

### 🧹 Janitor Sentinel (Obstacles)
Detects and clears known obstacles using CSS selectors.

**Patterns it handles:**
- Cookie consent banners
- Newsletter popups
- Modal overlays
- Login walls

### 👁️ Vision Sentinel (AI)
Uses local AI (Ollama with Moondream) to visually detect obstacles without selectors.

**When to use:**
- Unknown popups with dynamic IDs
- Visual obstructions that CSS can't identify
- Complex multi-element obstacles

### 📊 Data Sentinel (Intelligence)
Passively extracts context from the page and injects it into the Hub's shared state.

### 🔒 PII Sentinel (Security)
Scans for sensitive data (emails, SSNs, credit cards) and alerts if found.

---

# Chapter 6: The Protocol

## Message Format (JSON-RPC 2.0)

All communication uses JSON-RPC 2.0:

```json
{
    "jsonrpc": "2.0",
    "method": "starlight.<action>",
    "params": { ... },
    "id": "unique-id"
}
```

## Protocol Methods

### Registration
```json
{
    "method": "starlight.registration",
    "params": {
        "layer": "JanitorSentinel",
        "priority": 5,
        "capabilities": ["detection", "healing"],
        "selectors": [".cookie-banner", "#consent-popup"]
    }
}
```

### Intent (Command)
```json
{
    "method": "starlight.intent",
    "params": {
        "cmd": "click",
        "selector": "#submit-btn",
        "stabilityHint": 450  // Recorded settle time
    }
}
```

### Intent (Semantic Goal)
```json
{
    "method": "starlight.intent",
    "params": {
        "goal": "INITIATE CHECKOUT"
    }
}
```

### Pre-Check (Hub → Sentinels)
```json
{
    "method": "starlight.pre_check",
    "params": {
        "command": { ... },  // The pending intent
        "screenshot": "base64..."  // For Vision Sentinel
    }
}
```

### Responses
```json
// All clear
{ "method": "starlight.clear" }

// Page unstable
{ "method": "starlight.wait", "params": { "retryAfterMs": 1000 }}

// Taking control
{ "method": "starlight.hijack", "params": { "reason": "Cookie popup detected" }}

// Releasing control
{ "method": "starlight.resume", "params": { "reCheck": true }}
```

---

# Chapter 7: Self-Healing Intelligence

## Historical Memory

The Hub maintains a `mission_trace.json` that records every action's success or failure. This powers three self-healing capabilities:

### 1. Selector Substitution
When a selector fails, the Hub searches its history for alternative selectors that worked on the same page.

```javascript
// If #submit-btn fails, try alternatives from history
const alternatives = this.historicalMemory.get('/checkout');
// → [".btn-primary", "[data-action='submit']", "button:has-text('Submit')"]
```

### 2. Aura-Based Throttling
The Hub learns which pages are historically unstable ("Auras") and automatically increases settlement time.

### 3. Sentinel Learning
Sentinels persist their own memory (e.g., `JanitorSentinel_memory.json`), remembering which selectors successfully cleared obstacles.

---

# Chapter 8: Building Custom Sentinels

## Using the Visual Editor

The easiest way to create a Sentinel is the no-code Visual Editor:

1. Open `http://localhost:3000/sentinel-editor`
2. Choose a template (Cookie, Modal, Login, Rate Limiter)
3. Add your selectors
4. Click "Export"

## Manual Creation

```python
# sentinels/my_sentinel.py
import sys
sys.path.insert(0, '.')
from sdk.starlight_sdk import SentinelBase

class MyCustomSentinel(SentinelBase):
    def __init__(self):
        super().__init__("MyCustom", priority=5)
        self.selectors = [".my-obstacle"]
        self.capabilities = ["detection", "healing"]
    
    def on_pre_check(self, params, msg_id):
        command = params.get('command', {})
        
        # Check if any of our selectors match
        for selector in self.selectors:
            if self.page_contains(selector):
                self.send_hijack(f"Found {selector}")
                self.send_action("click", selector)
                self.send_resume()
                return
        
        self.send_clear()

if __name__ == "__main__":
    MyCustomSentinel().start()
```

---

# Chapter 9: Mission Control & Tooling

## Mission Control UI

Launch with: `node launcher/server.js`

Features:
- **Fleet Manager**: Start/stop any Sentinel
- **Mission Selector**: Choose and run tests
- **Live Logs**: Real-time constellation activity
- **Telemetry Dashboard**: Success rate, MTTR, interventions
- **Test Recorder**: Capture tests without code

## CLI Commands

```bash
starlight init <name>     # Scaffold new project
starlight create <name>   # Generate Sentinel boilerplate
starlight run             # Launch constellation
starlight doctor          # Environment diagnostics
starlight triage          # Time-travel debugging UI
starlight install <pkg>   # Install community Sentinels
```

## Time-Travel Triage

Open `triage.html`, load `mission_trace.json`, and:
- Step through every action
- See DOM snapshots at each point
- Identify exactly where failures occurred

---

# Chapter 10: Enterprise Deployment

## Docker

```dockerfile
FROM mcr.microsoft.com/playwright:v1.40.0-focal
WORKDIR /app
COPY . .
RUN npm install && pip install -r requirements.txt
CMD ["node", "bin/starlight.js", "test/my_mission.js", "--headless"]
```

## CI/CD Integration

```yaml
# GitHub Actions
- name: Run Starlight Tests
  run: |
    npm install
    pip install -r requirements.txt
    npx playwright install chromium
    node bin/starlight.js test/checkout.js --headless --verbose
```

## Webhook Alerts

```json
// config.json
"webhooks": {
    "enabled": true,
    "urls": ["https://hooks.slack.com/..."],
    "notifyOn": ["failure", "success"]
}
```

---

# Chapter 11: The Future

## Phase 17: Deep Mesh Intelligence

The roadmap includes:

- **Starlight Warp**: Serialize browser state for instant failure triage
- **Inter-Sentinel Communication**: Agents negotiate directly without Hub
- **Consensus Mesh**: Voting-based action validation
- **Temporal Ghosting**: Discover UI speed limits automatically
- **Chaos Sentinels**: Test constellation resilience

## The Vision

Starlight is evolving from a framework into a **protocol**—a standard for how autonomous agents collaborate to achieve goals in chaotic environments.

The ultimate vision: you describe what you want in natural language, and a constellation of specialized agents figures out how to make it happen, adapting in real-time to whatever the environment throws at them.

---

# Appendix: Quick Reference

## Protocol Methods
| Method | Direction | Purpose |
|--------|-----------|---------|
| `starlight.registration` | Sentinel → Hub | Register |
| `starlight.pre_check` | Hub → Sentinel | Request scan |
| `starlight.clear` | Sentinel → Hub | Approve |
| `starlight.wait` | Sentinel → Hub | Veto |
| `starlight.hijack` | Sentinel → Hub | Take control |
| `starlight.resume` | Sentinel → Hub | Release |
| `starlight.intent` | Intent → Hub | Issue goal |

## Sentinel Priority
| Priority | Usage |
|----------|-------|
| 1-3 | Critical stability (Pulse) |
| 4-6 | Obstacle clearing (Janitor) |
| 7-9 | Intelligence (Data, Vision) |
| 10 | Passive monitoring (PII) |

---

*The stars in the constellation are many, but the intent is one.*

*Built with ❤️ by Dhiraj Das*
*https://www.dhirajdas.dev*
