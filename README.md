# 🛰️ Constellation-Based Automation (CBA)

**"Don't look at the ground; look at the Starlight."**

CBA is a philosophical shift in browser automation. Inspired by biological navigation (like the dung beetle using the Milky Way), this framework moves away from linear scripts that handle every possible UI obstacle. Instead, it uses **Autonomous Aspect Layers (Sentinels)** that orient toward the goal using universal state indicators.

## 🏗️ The Hub & Sentinel Architecture

Instead of a monolithic library, CBA uses a **Sidecar Architecture** communicating over a JSON-RPC message bus (WebSockets).

| Layer | Biological Equivalent | Role in CBA |
| :--- | :--- | :--- |
| **The Intent Layer** | The Goal | High-level business logic (e.g., "Buy a Shirt"). Zero logic for popups or delays. |
| **The Hub** | The Brain | Orchestrates Playwright and manages the command queue. Enforces the **Starlight Protocol**. |
| **The Janitor (Sentinel)** | The Ground | Autonomous background process that watches for DOM obstacles (modals, cookie banners) and hijacks control to clear them. |
| **The Pulse (Sentinel)** | Magnetic Field | Watches network/API traffic and prevents actions until the application is "stable." |

## 🛰️ The Starlight Protocol (v2.0)

The Hub and Sentinels communicate using **JSON-RPC 2.0** standardized signals:

```json
{
  "jsonrpc": "2.0",
  "method": "starlight.[action]",
  "params": { ... },
  "id": "unique-id"
}
```

| Method | Initiator | Purpose |
| :--- | :--- | :--- |
| `starlight.registration` | Sentinel | Register layer, priority, and selective patterns. |
| `starlight.pre_check` | Hub | Broadcast intent before execution. Requires response. |
| `starlight.hijack` | Sentinel | Request absolute browser lock for recovery. |
| `starlight.resume` | Sentinel | Signal path is clear and return control. |
| `starlight.pulse` | Sentinel | Async heartbeat (every 500ms). |

### The Starlight Speed Limit
The Hub enforces a **200ms** handshake budget. If a Sentinel doesn't respond to a `PRE_CHECK` within this window, the Hub proceeds without waiting. This ensures high-performance automation while allowing for defensive recovery.

## 📊 Visual Proof: Execution Report

CBA doesn't just work; it proves it. Every execution generates a `report.html` with:
- **Timeline**: Integrated history of user intents and sentinel interventions.
- **Evidence**: Screenshots of every `HIJACK` event (the "Before" and "After" of path clearing).
- **Status**: Live heartbeat monitoring of system health.

## 📚 Documentation
- [Technical Guide](file:///c:/cba/technical_guide.md): Protocol specs and architecture.
- [User Guide](file:///c:/cba/user_guide.md): Setup and test development.
- [Execution Report](file:///c:/cba/report.html): Sample output from the latest run.

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- Python (3.9+)
- Playwright

### Installation
```bash
# Clone the repository
git clone <repo-url>
cd cba

# Install Node dependencies
npm install ws playwright nanoid
npx playwright install chromium

# Install Python dependencies
pip install websockets
```

### Running the Prototype
1. **Start the Hub**:
   ```bash
   node src/hub.js
   ```
2. **Start the Janitor (Background)**:
   ```bash
   python sentinels/janitor.py
   ```
3. **Run the Intent Script**:
   ```bash
   node src/intent.js
   ```

## 🛠️ Why this is Unique

1. **Language-Agnostic**: The Hub is Node.js, but your Janitor can be C++, and your Data layer can be Python. They just need to talk JSON.
2. **Non-Linear**: Your test script doesn't have `if (popup) { click }`. It assumes the environment is being filtered for noise.
3. **Maintenance-Free**: When a developer adds a new "Newsletter Popup," you don't update 100 test scripts; you just update the **Janitor Sentinel**.

---
*Built with ❤️ by [Dhiraj Das](https://www.dhirajdas.dev)*
