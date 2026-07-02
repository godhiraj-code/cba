# 🌌 Starlight Protocol: The GALAXY User Guide (v3.0.3)

Welcome to the future of browser automation. This guide explains **Constellation-Based Automation (CBA)**—a paradigm shift from traditional Page Object Models (POM) and flaky `wait_for` calls toward a sovereign, multi-agent ecosystem.

---

## 1. The Core Philosophy: Why CBA?

Traditional automation is **brittle** because it couples the "Goal" (What you want) with the "Environment" (The chaos of the site). When a popup appears or the network lags, your script dies.

**CBA decouples them:**
- **The Intent Layer**: Only cares about the goal (e.g., "Login").
- **The Sentinels**: Guardians that watch the environment 24/7 and clear obstacles *before* they block the intent.
- **The Hub**: The "Air Traffic Controller" that orchestrates the two.

---

## 2. Architecture Overview

```mermaid
graph TD
    Intent[Intent Layer: The Goal] -->|JSON-RPC| Hub[CBA Hub: Orchestrator]
    Hub -->|Entropy Stream| Sentinels[Sentinel Constellation]
    Sentinels -->|Veto / Clear / Hijack| Hub
    Hub -->|Sovereign State| Intent
    
    subgraph "Sentinels"
        Janitor[Janitor: Heuristic Fixes]
        Vision[Vision: AI Analysis]
        Pulse[Pulse: Stability Veto]
        Data[Data: Context Injection]
    end
```

---

## 3. Quick Start

### Prerequisites
- **Node.js** v18+ and **Python** 3.9+
- **Playwright**: `npx playwright install chromium`
  - For Firefox: `npx playwright install firefox`
  - For WebKit: `npx playwright install webkit`
- **Python deps**: `pip install -r requirements.txt`
- **Ollama** (optional): For AI Vision Sentinel

### Running a Mission

**Option A: One-Command Execution (The Autonomous Way)**
```bash
# Hub + Sentinels + Intent in one command
node bin/starlight.js test/intent_portfolio_v2.js --headless --verbose

# URL objective with every production Sentinel
node bin/starlight.js --url https://www.dhirajdas.dev --all-sentinels --headless --json

# Natural-language objective
node bin/starlight.js --intent "Go to https://www.saucedemo.com and fill Username with standard_user and fill Password with secret_sauce and click Login" --all-sentinels --headless --json
```
This script handles the entire lifecycle: spawning the constellation, waiting for Hub health and Sentinel registration, running the mission/objective, and cleaning up.

**Option B: Manual Launch (For Development)**
```bash
# Terminal 1: Hub
node src/hub.js

# Terminal 2: Pulse Sentinel
python sentinels/pulse_sentinel.py

# Terminal 3: Janitor Sentinel
python sentinels/janitor.py

# Terminal 4: Run Intent
node src/intent.js
```

---

## 4. Configuration

CBA v3.0 introduces centralized configuration with enterprise security via `config.json`:

```json
{
    "hub": {
        "port": 8080,
        "browser": {
            "engine": "chromium"
        },
        "syncBudget": 30000,
        "missionTimeout": 180000,
        "screenshotMaxAge": 86400000,
        "traceMaxEvents": 500
    },
    "security": {
        "jwtSecret": "your-256-bit-secret-key",
        "tokenExpiry": 3600,
        "piiRedaction": true,
        "inputValidation": true,
        "ssl": {
            "enabled": false,
            "keyPath": null,
            "certPath": null
        },
        "rateLimiting": {
            "enabled": true,
            "maxRequests": 100,
            "windowMs": 60000
        }
    },
    "aura": {
        "predictiveWaitMs": 1500
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

| Setting | Default | Description |
|---------|---------|-------------|
| `browser.engine` | chromium | Browser engine: `chromium`, `firefox`, or `webkit` |
| `syncBudget` | 30000 | Max wait (ms) for sentinel handshake |
| `missionTimeout` | 180000 | Max mission duration (ms) |
| `screenshotMaxAge` | 86400000 | Auto-delete screenshots older than 24h |
| `traceMaxEvents` | 500 | Max events in mission trace |
| `settlementWindow` | 1.0 | Seconds of silence required for stability |

### Security Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `jwtSecret` | null | JWT signing secret (256-bit minimum) |
| `tokenExpiry` | 3600 | JWT token expiration (seconds) |
| `piiRedaction` | true | Enable PII detection and redaction |
| `inputValidation` | true | Enable message schema validation |
| `ssl.enabled` | false | Enable SSL/TLS encryption |
| `rateLimiting.enabled` | true | Enable rate limiting protection |

#### Quick Security Setup

1. **Generate JWT Secret:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2. **Update config.json:**
```json
{
    "security": {
        "jwtSecret": "generated-256-bit-secret",
        "tokenExpiry": 3600,
        "piiRedaction": true
    }
}
```

3. **Enable SSL (Production):**
```json
{
    "security": {
        "ssl": {
            "enabled": true,
            "keyPath": "./certs/server.key",
            "certPath": "./certs/server.crt"
        }
    }
}
```

---

## 5. Semantic Intent (Phase 5)

You no longer need to find selectors. Just tell the Hub what you want to achieve.

```javascript
// Old Way (Procedural)
await page.click('#submit-12345');

// CBA Way (Semantic)
await this.send({ goal: 'INITIATE MISSION' });
```
The Hub's **Semantic Resolver** will scan the page's accessibility layer and text content to find the correct element for you.

---

## 6. Understanding the Sentinels

### 💓 The Pulse Sentinel (Stability)
The Guardian of Time. It eliminates flakiness by ensuring the environment is stable before any action.
- **Now uses SDK**: Inherits from `SentinelBase` for consistency
- **Auto-reconnect**: Retries connection if Hub restarts

### 🧹 The Janitor Sentinel (Heuristics)
Detects known obstacles (modals, cookie banners) and hijacks control to clear them.
- **Persistent Memory**: Remembers which selectors worked
- **Predictive Mode**: Uses learned selectors on subsequent runs

### 👁️ The Vision Sentinel (AI-Driven)
Uses Local AI (Ollama) to visually detect obstacles without selectors.
- **Configurable Model**: Set via `config.json`
- **Timeout Handling**: Graceful fallback on Ollama timeout

### 📊 The Data Sentinel (Intelligence)
Extracts real metadata from commands and injects it into the shared context.

---

## 7. Phase 7: Predictive Intelligence & The Galaxy Mesh

CBA is no longer just a listener; it is a **learner**.

### 🧬 Self-Healing Selectors
When a UI change breaks a selector, the Hub switches from **Reactive** to **Predictive** mode:
1.  **Failure Detected**: A command fails to find its target.
2.  **Memory Retrieval**: The Hub consults its `historicalMemory`.
3.  **Substitution**: It automatically retries with a historically successful selector.
4.  **Proof**: The event is tagged with a **SELF-HEALED** badge in the report.

### 🌀 What is an Aura?
An **Aura** is a temporal window of high environment entropy. By learning these "Auras" from past runs, the Hub can proactively slow down its mission pace *before* a failure occurs.

### 🏛️ Sovereign Intelligence (Sentinel Learning)
Sentinels possess a **Persistent Memory Layer**:
- **Experience Accumulation**: Records winning selectors
- **Predictive Remediation**: Skips exploration on known obstacles
- **Local Persistence**: JSON files like `JanitorSentinel_memory.json`
- **Graceful Shutdown**: Memory saved on Ctrl+C

---

## 8. Phase 16: The Autonomous Era (NEW)

### What's New in v3.0

| Feature | Description |
|---------|-------------|
| **CLI Orchestrator** | `starlight.js` for zero-touch lifecycle management |
| **Mutation Fingerprinting** | Captures page "stability signatures" during recording |
| **Context-Aware Pulse** | Dynamic settle-time adjustment for heavy UIs |
| **Failure-Safe Reports** | Immediate report generation on mission failure |
| **Health Check** | `/health` endpoint for Hub system verification |

### 🎬 No-Code Marker HUD (v3.0.1)

The Mission Control UI includes a **Test Recorder** that captures user interactions without writing code:

1. **Start Recording**: Enter a URL in Mission Control and click `🔴 Record`
2. **HUD Appears**: A floating badge appears in the bottom-right corner of the browser
3. **Click the Badge**: Expands to show the control panel

**HUD Controls:**
| Button | Action |
|--------|--------|
| 🏷️ Tag Next Click | Assign a custom goal name to the next click |
| Checkpoint Input | Text field to enter checkpoint name |
| 🚩 Save Checkpoint | Record a logical milestone in your test |
| ⏹️ Stop Recording | End the session and generate the intent file |

**Example Workflow:**
1. Click "🏷️ Tag Next Click" → Click on Login button → Name it "Login"
2. Type "LoginComplete" in the checkpoint input → Click "🚩 Save Checkpoint"
3. Continue interacting with the site...
4. Click "⏹️ Stop Recording" when done

The generated intent file will appear in the `test/` directory and be available in Mission Control.

---

## 9. Time-Travel Triage (Phase 6)

CBA features **Time-Travel Triage**, allowing you to inspect missions with surgical precision.

### How to use the Triage Tool
1.  **Run Mission**: A `mission_trace.json` file is generated.
2.  **Open Triage**: Open `triage.html` in any browser.
3.  **Load Trace**: Click "Load mission_trace.json".
4.  **Rewind**: Select any event to see the browser state.

---

## 10. Phase 17: Deep Mesh Intelligence (NEW)

### 🛸 Starlight Warp (Failure Triage)
When a test fails, capture the **exact browser state** for instant debugging:

**What's Captured:**
- Screenshot, URL, cookies, localStorage
- Console logs, network requests
- Full DOM snapshot

**Security:** All sensitive data (emails, tokens, passwords) is automatically redacted.

**Use Case:** Share the `.warp` file with teammates—they can restore and see exactly what you saw.

### 🗣️ Inter-Sentinel Side-Talk
Sentinels can now communicate directly with each other:
- **Stability Broadcast**: Pulse tells everyone "environment is stable"
- **Availability Handling**: If a Sentinel is offline, sender gets notified

### 🗳️ Consensus Mesh
By default, the Hub waits for every connected Sentinel to answer the `PRE_CHECK` handshake. A lower quorum can be configured, but any `WAIT` or `HIJACK` still overrides quorum and pauses execution.
- **Fail-Fast**: Respects any veto (`WAIT`) immediately.
- **No Forced Proceed**: Repeated vetoes fail the objective instead of bypassing Sentinel judgment.
- **Evidence**: Reports and `mission_trace.json` show which Sentinels cleared, waited, hijacked, or injected context.

### 🌀 Temporal Ghosting (Speed Limit)
Run missions in "Ghost Mode" to find the UI's performance limits.
- **Observation**: Tracks exact settlement times for every button and input.
- **Optimization**: Automatically adjusts mission pace based on past findings.

---

## 11. Phase 15: Visual Sentinel Editor & Fleet Manager (NEW in v3.0.3)

### 🛠️ Creating Custom Sentinels (No-Code)

The **Visual Sentinel Editor** lets anyone build a custom Sentinel without writing Python code.

**How to Access:**
1. Open Mission Control at `http://localhost:3000`
2. Click **"🛠️ Create Sentinel"** button
3. Or navigate directly to `http://localhost:3000/sentinel-editor`

**Creating a Sentinel:**

| Step | Action |
|------|--------|
| 1. Choose Template | Click "Cookie Banner", "Modal Popup", etc. (or start blank) |
| 2. Configure | Set name, priority (1-10), and capabilities |
| 3. Add Patterns | Enter CSS selectors to watch (e.g., `.cookie-banner`, `#popup`) |
| 4. Set Action | Choose: Click element, Hide element, or Wait & retry |
| 5. Preview | See the generated Python code in real-time |
| 6. Export | Click "🚀 Export Sentinel" → Saved to `sentinels/` |

**Built-in Templates:**
- **Cookie Banner**: Dismisses GDPR/cookie consent popups
- **Modal Popup**: Closes modals and overlays
- **Login Wall**: Detects authentication blockers
- **Rate Limiter**: Handles rate limits and CAPTCHAs

### 🛰️ Sentinel Fleet Manager

Mission Control now dynamically discovers ALL sentinels in the `sentinels/` directory.

**Features:**
- **Auto-Discovery**: Any `*.py` file in `sentinels/` appears as a card
- **Start/Stop Individual**: Click the button on any sentinel card
- **Start All**: Launches the entire constellation with one click
- **Visual Status**: Green (running) or black (stopped) indicators

**How It Works:**
1. Sentinels connect to the Hub via WebSocket
2. On each action, the Hub sends `PRE_CHECK` to ALL sentinels
3. Each sentinel responds: `CLEAR`, `WAIT`, or `HIJACK`
4. Only Sentinels with something to fix take control; passive Sentinels still clear or inject context

---

## 11. Sentinel Store & Visual Editor (Phase 15)

CBA includes a complete ecosystem for creating, installing, and managing Sentinels.

### 🛒 Sentinel Store CLI

**List Installed Sentinels:**
```bash
python cli/main.py list
python cli/main.py list --available  # Also shows registry plugins
```

**Install from Registry or GitHub:**
```bash
# From the plugin registry
python cli/main.py install janitor-google

# From GitHub
python cli/main.py install https://github.com/user/my-sentinel
```

**Create New Sentinel:**
```bash
python cli/main.py create "Cookie Blocker"
# Creates: sentinels/cookie_blocker_sentinel.py
```

**Remove a Plugin:**
```bash
python cli/main.py remove janitor-google
```

### 🎨 Visual Sentinel Editor (No-Code)

The **Sentinel Editor** allows you to create Sentinels without writing code:

1. Open Mission Control: `http://localhost:3000`
2. Click the **"Create Sentinel"** card
3. Use the visual builder:

| Feature | Description |
|---------|-------------|
| **Template Gallery** | Blank, Cookie Banner, Modal, Login Wall, Rate Limiter |
| **CSS Selector Builder** | Add/remove patterns with live preview |
| **Capability Selection** | Popup Detection, Stability, AI Vision, Form Filling |
| **Response Actions** | Click, Hide, or Wait |
| **Code Preview** | See generated Python code in real-time |
| **Export** | Save directly to `sentinels/` directory |

### 📦 Creating a Plugin Package

To share your Sentinel with the community, create a `plugin.json`:

```json
{
  "name": "my-sentinel",
  "version": "1.0.0",
  "main": "my_sentinel.py",
  "description": "Handles specific obstacles"
}
```

Then push to GitHub and share the URL for others to install.

---

## 12. Webhook Alerting (Phase 10)

Get notified on Slack, Teams, or Discord when missions complete.

**Configuration:**
```json
// config.json
"webhooks": {
    "enabled": true,
    "urls": ["https://hooks.slack.com/services/XXX"],
    "notifyOn": ["failure", "success"]
}
```

**Payload includes:**
- Mission name and status (success/failure)
- Duration and intervention count
- Mean Time To Recovery (MTTR)

---

## 12. Phase 18: Universal Protocol (NEW in v3.2)

### 🧠 Learning Persistence
The Hub now **learns and remembers** successful goal→selector mappings across sessions.

**How it works:**
1. When a semantic goal (e.g., `clickGoal('Submit')`) succeeds, the resolved selector is saved
2. On shutdown, all learned mappings are written to `starlight_memory.json`
3. On startup, the Hub loads this memory for instant self-healing

**Example in console:**
```
[CBA Hub] 🧠 LEARNED: click:Submit -> button[type="submit"]
[CBA Hub] 🧠 Memory saved: 15 learned mappings
```

### 🎛️ Extended Commands API
The IntentRunner now supports **all common automation actions** with semantic goals:

| Method | Description | Example |
|--------|-------------|---------|
| `fillGoal(goal, text)` | Fill input by label/placeholder | `fillGoal('Email', 'user@test.com')` |
| `selectGoal(goal, value)` | Select dropdown option | `selectGoal('Country', 'usa')` |
| `checkGoal(goal)` | Check a checkbox | `checkGoal('I agree')` |
| `uncheckGoal(goal)` | Uncheck a checkbox | `uncheckGoal('Newsletter')` |
| `hoverGoal(goal)` | Hover over element | `hoverGoal('Menu')` |
| `scrollToGoal(goal)` | Scroll to element | `scrollToGoal('Footer')` |
| `uploadGoal(goal, files)` | Upload file(s) to input | `uploadGoal('Resume', 'cv.pdf')` |
| `press(key)` | Press keyboard key | `press('Enter')` |
| `type(text)` | Type text (keyboard) | `type('Hello World')` |

**Semantic Resolution Priority:**
1. Associated `<label>` text
2. `placeholder` attribute
3. `aria-label` attribute
4. `name` attribute
5. Historical memory (self-healing)

### 🛡️ CAPTCHA Detection
JanitorSentinel now detects CAPTCHA/robot challenges:
- Google reCAPTCHA elements
- "Are you a robot?" text patterns
- Verification prompts

When detected, the Sentinel signals HIJACK for human intervention.

---

## 13. Security Setup & Troubleshooting

### 🔒 Security Configuration

#### Authentication Setup
```bash
# 1. Generate secure JWT secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2. Update config.json with security settings
```

#### Sentinel Authentication
Sentinels automatically include JWT tokens in registration:
```python
# Sentinel SDK handles authentication automatically
sentinel = MySentinel()
# Token generated and included in registration
```

#### PII Protection
All sensitive data is automatically redacted:
- Emails → `[EMAIL_REDACTED]`
- Passwords → `[REDACTED]`
- Credit cards → `[CREDITCARD_REDACTED]`
- JWT tokens → `[JWT_REDACTED]`

---

## 14. Troubleshooting

### Security Issues
| Issue | Solution |
|-------|----------|
| Authentication Failed | Check JWT secret matches in Hub and Sentinel config |
| Token Expired | Increase `tokenExpiry` or implement token refresh |
| PII Leaking in Logs | Verify `piiRedaction: true` in config |
| SSL Certificate Error | Ensure valid cert/key paths in SSL config |
| Rate Limited | Adjust `rateLimiting.maxRequests` or whitelist IPs |

### General Issues
| Issue | Solution |
|-------|----------|
| AI Analysis Timed Out | Ensure Ollama is running with `moondream` |
| Goal Resolution Failed | Ensure button has visible text or aria-label |
| System Unresponsive | Check Hub console for "UNRESPONSIVE" errors |
| Sentinel Won't Connect | Verify Hub is running on port 8080 |
| Memory Not Saved | Ensure graceful shutdown (Ctrl+C, not kill) |
| Start All not working | Ensure sentinel filenames end in `.py` |
| Custom Sentinel not appearing | Check it's in `sentinels/` directory |

### Security Debug Mode
Enable security logging:
```json
{
    "logging": {
        "level": "debug",
        "security": true
    }
}
```

This will show:
- Authentication attempts and failures
- Input validation errors
- PII redaction events
- Rate limiting triggers

---

🌠 *The stars in the constellation are many, but the intent is one.*
