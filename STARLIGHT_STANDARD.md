# 🛰️ The Starlight Protocol Standard (v3.0)

The **Starlight Protocol** is a high-fidelity communication standard for autonomous automation agents. It ensures that **Intent** (user goals) remains decoupled from the **Environment** (UI entropy, network jitter, popups).

---

## 1. Core Architecture: The Constellation
A Starlight-compliant system MUST consist of:
1.  **The Hub**: A central orchestrator that manages browser context and message routing.
2.  **The Intent Layer**: A client that issues high-level goals (e.g., "Login", "Purchase").
3.  **The Sentinels**: Autonomous agents that monitor specific environmental layers (DOM, Network, Visual).

## 2. Message Schema (JSON-RPC 2.0)
All communication MUST follow the JSON-RPC 2.0 specification.

### 2.1 Essential Methods
| Method | Direction | Description |
| :--- | :--- | :--- |
| `starlight.registration` | Sentinel -> Hub | Self-identification, priority, and capabilities. |
| `starlight.pre_check` | Hub -> Sentinel | Request environmental "Aura" scan before executing an intent. |
| `starlight.clear` | Sentinel -> Hub | Signal that the environment is safe for execution. |
| `starlight.wait` | Sentinel -> Hub | Veto execution due to instability (Network/DOM jitter). |
| `starlight.hijack` | Sentinel -> Hub | Lock browser control to perform corrective action. |
| `starlight.intent` | Intent -> Hub | Issue a semantic goal or selector-based command. |

**`starlight.intent` Parameters:**
- `cmd`: Action to perform (`click`, `fill`, `goto`, `clear`)
- `goal`: Semantic description of the objective (e.g., "Login Button")
- `selector`: (Optional) CSS/XPath selector for the target
- `value`: (Optional) Data for `fill` actions
- `stabilityHint`: (Optional) Recorded settlement time in milliseconds [Phase 16]
- `layer`: The intended Sentinel layer for this action

## 3. The Handshake Lifecycle
Every `starlight.intent` MUST trigger a Handshake:
1.  **Broadcast**: Hub sends `starlight.pre_check` to all Registered Sentinels (Priority <= 10).
2.  **Review**: Sentinels scan for obstacles (DOM matches or Visual analysis).
    - Sentinels respond with detection results.
    - `params.command` contains the original intent (including `stabilityHint`).
3.  **Consensus**:
    - If all Sentinels return `starlight.clear`, execution proceeds.
    - If any Sentinel returns `starlight.wait`, Hub pauses and retries.
    - If any Sentinel returns `starlight.hijack`, Hub yields control until `starlight.resume`.

## 4. Resilience Metrics (ROI)
Compliance requires standardized telemetry for ROI reporting:
- **Manual Time Saved**: `5 mins (triage baseline) + Interruption duration`.
- **System Aura**: Calculation of network/DOM entropy during execution.
- **Mission Integrity**: Success rate of semantic goals vs raw selector failures.

## 5. Compliance: Time-Travel Triage
A world-class Hub MUST provide a `mission_trace.json` log containing:
- Every JSON-RPC message with a high-precision `timestamp`.
- Full DOM snapshots (B64) for every `starlight.intent`.
- Visual context (Screenshots) for every `starlight.pre_check`.

---
*Status: OMEGA COMPLIANT*
