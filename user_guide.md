# CBA User Guide: Navigating by the Stars

Welcome to the **Constellation-Based Automation (CBA)** revolution. This guide will help you set up and run your first autonomous tests.

## 1. Installation

1.  **Hub**: Requires Node.js.
    ```bash
    cd cba
    npm install playwright ws nanoid
    ```
2.  **Sentinel**: Requires Python 3.10+.
    ```bash
    pip install websockets
    ```

## 2. Running a Test

### Option A: One-Click Execution (Recommended)
Simply run the launcher script from the project root:
```bash
./run_cba.bat
# or
npm start
```
This will automatically clean the port, launch the Hub and Sentinels in the background, and execute your Intent mission.

### Option B: Manual Execution
Open three terminal windows:

1.  **Terminal A (The Hub)**: `node src/hub.js`
2.  **Terminal B (The Sentinel)**: `python sentinels/janitor.py`
3.  **Terminal C (The Intent)**: `node src/intent.js`

## 3. Writing Intent Scripts (The Milky Way)

Your test scripts should be "Pure Intent." Do not include `if/else` checks for popups or manual `waitForSelector` hacks.

```javascript
// Example Intent Layer
const path = new IntentClient();
await path.send({ cmd: 'goto', url: 'https://example.com' });
await path.send({ cmd: 'click', selector: '#buy-now' });
```

## 4. Creating Custom Sentinels (Starlight v2.0)

Sentinels are language-agnostic. To create one using the **JSON-RPC 2.0** protocol:
1.  Connect to `ws://localhost:8080`.
2.  Register with `starlight.registration`:
    ```json
    { "jsonrpc": "2.0", "method": "starlight.registration", "params": { "layer": "MySentinel", "priority": 5, "selectors": [".modal"] }, "id": "1" }
    ```
3.  Listen for `starlight.pre_check` messages from the Hub.
4.  If an obstacle is detected, send `starlight.hijack`, perform your action via `starlight.action`, and then `starlight.resume`.

## 5. Interpreting Reports

After execution, open `report.html`. This report distinguishes between your **Intent Path** (what you wanted to do) and the **Sentinel Interventions** (the healing that happened automatically).

-   **Blue Cards**: Your business logic.
-   **Red Cards**: Autonomous healing interventions.
-   **ROI Dashboard**: Shows the literal time saved by the system.
