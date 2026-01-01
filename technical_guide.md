# CBA Technical Guide: Architecture & Implementation (v3.0)

This document provides a deep technical overview of Constellation-Based Automation (CBA), including the protocol specification, implementation details, and configuration reference.

---

## 1. Architectural Comparison: POM vs CBA

### Traditional Page Object Model (POM)
```mermaid
graph TD
    A[Test Script] -->|Call Method| B[Page Object]
    B -->|Selector Input| C[Browser]
    C -.->|Unexpected Modal| D[CRASH / Fail]
    style D fill:#f96,stroke:#333,stroke-width:2px
```
**Weakness:** Test logic must handle every UI state, leading to complex conditional logic.

### Constellation-Based Automation (CBA)
```mermaid
graph TD
    subgraph Intent Layer
        T[Intent Script]
    end

    subgraph Sovereign Layer
        H{CBA Hub}
    end

    subgraph Sentinel Layer
        V[Vision Sentinel]
        J[Janitor Sentinel]
        P[Pulse Sentinel]
    end

    subgraph Environment
        B[Browser]
    end

    T -->|Goal: Click Submit| H
    H -->|Handshake| V
    H -->|Handshake| J
    H -->|Handshake| P
    V -->|AI Vision: Found Modal| H
    J -->|Selectors: Found Modal| H
    P -->|Stability Check| H
    H -->|Hijack| B
    B -->|Healing Action| B
    B -->|Path Clear| H
    H -->|Resume Intent| B
    B -->|Success| T

    style H fill:#1e293b,stroke:#3b82f6,color:#fff
    style V fill:#064e3b,stroke:#10b981,color:#fff
    style J fill:#064e3b,stroke:#10b981,color:#fff
    style P fill:#064e3b,stroke:#10b981,color:#fff
```

---

## 2. Key Differences

| **Parameter** | **POM** | **CBA** |
| :--- | :--- | :--- |
| Logic Type | Linear / Procedural | Agentic / Goal-Oriented |
| Healing | Manual retry | **Predictive Memory** |
| Performance | Hard-coded waits | **Temporal Pulse** |
| ROI | Invisible | **Quantified Dashboard** |
| Outcome | Flaky | Stable via Sovereign Remediation |

---

## 3. The Starlight Protocol (v3.0)

### Message Format (JSON-RPC 2.0)
```json
{
    "jsonrpc": "2.0",
    "method": "starlight.<action>",
    "params": { ... },
    "id": "unique-id"
}
```

### Protocol Methods

| Method | Initiator | Purpose |
| :--- | :--- | :--- |
| `starlight.registration` | Sentinel | Register with Hub |
| `starlight.pulse` | Sentinel | Heartbeat signal |
| `starlight.intent` | Intent | Issue goal or command (with optional `stabilityHint`) |
| `starlight.pre_check` | Hub | Handshake before execution |
| `starlight.clear` | Sentinel | Approve execution |
| `starlight.wait` | Sentinel | Veto (stability concern) |
| `starlight.hijack` | Sentinel | Request browser lock |
| `starlight.resume` | Sentinel | Release lock |
| `starlight.action` | Sentinel | Execute healing action |
| `starlight.context_update` | Sentinel | Inject shared state |
| `starlight.entropy_stream` | Hub | Broadcast environment jitter |
| `starlight.finish` | Intent | End mission |

---

## 4. Configuration Reference

CBA v2.8 uses `config.json` for all settings:

```json
{
    "hub": {
        "port": 8080,
        "syncBudget": 30000,
        "missionTimeout": 180000,
        "heartbeatTimeout": 5000,
        "lockTTL": 5000,
        "entropyThrottle": 100,
        "screenshotMaxAge": 86400000,
        "traceMaxEvents": 500,
        "shadowDom": {
            "enabled": true,
            "maxDepth": 5
        }
    },
    "aura": {
        "preventiveWaitMs": 1500,
        "bucketSizeMs": 500
    },
    "sentinel": {
        "settlementWindow": 1.0,
        "reconnectDelay": 3,
        "heartbeatInterval": 2
    },
    "vision": {
        "model": "moondream",
        "timeout": 25,
        "ollamaUrl": "http://localhost:11434/api/generate"
    }
}
```

### Hub Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `port` | int | 8080 | WebSocket server port |
| `syncBudget` | int | 30000 | Max wait for handshake (ms) |
| `missionTimeout` | int | 180000 | Mission safety timeout (ms) |
| `heartbeatTimeout` | int | 5000 | Sentinel heartbeat timeout (ms) |
| `lockTTL` | int | 5000 | Hijack lock TTL (ms) |
| `entropyThrottle` | int | 100 | Min interval between entropy broadcasts (ms) |
| `screenshotMaxAge` | int | 86400000 | Auto-delete screenshots older than (ms) |
| `traceMaxEvents` | int | 500 | Max events in mission trace |
| `shadowDom.enabled` | bool | true | Enable shadow DOM traversal |
| `shadowDom.maxDepth` | int | 5 | Max shadow root nesting depth |

---

## 4.5 Phase 9: Shadow DOM Penetration

CBA v2.8 can pierce Shadow DOM boundaries to detect and interact with encapsulated web components.

### Shadow-Piercing Selectors

Use the `>>>` combinator (Playwright's shadow-piercing syntax):

```javascript
// Standard selector (won't reach shadow DOM)
await page.click('.modal');

// Shadow-piercing selector (reaches into shadow roots)
await page.click('shadow-modal >>> .shadow-close-btn');
```

### Hub Behavior

The Hub's `resolveSemanticIntent` and `broadcastPreCheck` automatically:
1. Traverse up to `shadowDom.maxDepth` levels of shadow roots
2. Generate `>>>` selectors for elements inside shadow boundaries
3. Report `inShadow: true` in blocking element metadata

### JanitorSentinel Patterns

The Janitor registers shadow-aware patterns:
```python
self.blocking_patterns = [
    ".modal", ".popup", "#overlay",
    ">>> .modal", ">>> .popup",  # Shadow-piercing
]
```

### Sovereign Remediation

When clearing obstacles matching `shadow`, the Hub recursively hides elements across all shadow roots:
```javascript
function hideObstacles(root) {
    root.querySelectorAll('.modal, .shadow-overlay').forEach(el => {
        el.style.display = 'none';
    });
    root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) hideObstacles(el.shadowRoot);
    });
}
hideObstacles(document);
```

---

## 4.6 Phase 16: Mutation Fingerprinting (Stability Sensing)

Starlight v3.0 introduces **Stability Sensing** to eliminate manual waits.

### The Mutation Observer
The Test Recorder injects a `MutationObserver` that monitors DOM entropy after every interaction:
1. **Trigger**: User clicks or types.
2. **Track**: High-resolution tracking of all mutations (attributes, children, subtree).
3. **Analyze**: Defines "Settled" as a 500ms window with zero mutations.
4. **Encode**: Saves the `settleTime` (Action to Silence) as a metadata hint.

### Context-Aware Waiting
The **Pulse Sentinel** consumes this hint to dynamically adjust its `settleWindow`. If the hint is `450ms`, the Sentinel adds this to its baseline, ensuring it doesn't grant execution consent until the environmental jitter has subsided.

---

## 4.7 bin/starlight.js: The Autonomous Orchestrator

The unified CLI entry point for CI/CD environments.

### Orchestration Lifecycle
1. **Hub Launch**: Spawns Hub process + waits for `/health` response.
2. **Constellation Assembly**: Launches configured Sentinels (Pulse, Janitor).
3. **Mission Execution**: Spawns the intent script.
4. **Graceful Cleanup**: Kills all child processes (using `taskkill /t` on Windows) to ensure telemetry and reports are saved.

---

## 5. Starlight SDK (Python)

### Base Class Structure
```python
from sdk.starlight_sdk import SentinelBase

class MySentinel(SentinelBase):
    def __init__(self):
        super().__init__(layer_name="MySentinel", priority=10)
        self.selectors = [".my-pattern"]
        self.capabilities = ["custom-feature"]

    async def on_pre_check(self, params, msg_id):
        # Analyze params, then:
        await self.send_clear()  # or send_wait() or send_hijack()

    async def on_message(self, method, params, msg_id):
        # Handle broadcasts (e.g., COMMAND_COMPLETE)
        pass
```

### SDK Features (v2.7)

| Feature | Description |
|---------|-------------|
| **Persistent Memory** | `self.memory` dict, auto-loaded/saved |
| **Graceful Shutdown** | SIGINT/SIGTERM handlers |
| **Atomic Writes** | Temp file + rename pattern |
| **Config Loading** | Reads `config.json` automatically |
| **Auto-Reconnect** | Retries on connection failure |
| **Proper Exceptions** | No silent error swallowing |

### Communication Methods
```python
await self.send_clear()           # Approve execution
await self.send_wait(1000)        # Veto with delay (ms)
await self.send_hijack("reason")  # Request browser lock
await self.send_resume()          # Release lock
await self.send_action("click", selector)  # Execute action
await self.update_context({...})  # Inject shared state
```

---

## 6. Phase 7: Predictive Intelligence

### Historical Learning Engine
The Hub parses `mission_trace.json` on startup:

```javascript
trace.forEach(event => {
    // Learn selectors
    if (event.method === 'starlight.intent' && event.params.goal && event.params.selector) {
        this.historicalMemory.set(event.params.goal, event.params.selector);
    }
    // Learn entropy auras
    if (event.method === 'starlight.entropy_stream') {
        const bucket = Math.floor((event.timestamp - traceStart) / 500);
        this.historicalAuras.add(bucket);
    }
});
```

### Temporal Aura Mapping
Entropy events are quantized into 500ms buckets:
```javascript
const bucket = Math.floor(relativeTime / 500);
if (historicalAuras.has(bucket)) {
    await delay(config.aura.predictiveWaitMs);
}
```

### Sentinel Learning
Sentinels track successful remediations:
```python
# On success feedback
self.memory[obstacle_id] = successful_selector
self._save_memory()  # Atomic write to JSON
```

---

## 7. ROI Quantization Model

| Event Type | Value Added |
|------------|-------------|
| Sentinel Remediation | 5 min + duration |
| Self-Healing | 2-3 min |
| Aura Stabilization | 30 sec |

All metrics are summed into `totalSavedTime` and displayed in `report.html`.

---

## 8. File Structure

```
cba/
├── config.json          # Centralized configuration
├── requirements.txt     # Python dependencies
├── package.json         # Node.js metadata
├── CHANGELOG.md         # Version history
├── src/
│   ├── hub.js           # CBA Hub (orchestrator)
│   └── intent.js        # Example intent script
├── sdk/
│   └── starlight_sdk.py # Sentinel base class
├── sentinels/
│   ├── pulse_sentinel.py    # Stability monitor
│   ├── janitor.py           # Heuristic healer
│   ├── vision_sentinel.py   # AI analyzer
│   └── data_sentinel.py     # Context injector
├── test/
│   ├── intent_learning.js   # Learning demo
│   └── learning_test.html   # Test page
└── screenshots/         # Auto-cleaned daily
```

---

## 9. Mission Lifecycle

```mermaid
sequenceDiagram
    participant I as Intent
    participant H as Hub
    participant P as Pulse
    participant J as Janitor

    I->>H: starlight.intent (goal)
    H->>H: Check Aura (predictive wait)
    H->>P: starlight.pre_check
    H->>J: starlight.pre_check
    P->>H: starlight.clear
    J->>H: starlight.hijack (found modal)
    J->>H: starlight.action (click close)
    J->>H: starlight.resume
    H->>H: Execute command
    H->>I: COMMAND_COMPLETE
```

---

## 10. Best Practices

1. **Use Semantic Goals**: Prefer `{ goal: 'Login' }` over selectors
2. **Let Sentinels Learn**: Run missions multiple times to build memory
3. **Monitor ROI**: Check `report.html` for quantified value
4. **Configure Timeouts**: Adjust `syncBudget` for slow environments
5. **Clean Shutdown**: Always use Ctrl+C to preserve sentinel memory

---

*Starlight Protocol v3.0 — The Autonomous Era*
