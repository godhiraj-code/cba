# 🌠 Starlight Protocol: The CBA User Guide

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

## 3. Basic Usage: The Mission

To run a CBA mission, you launch a **Constellation**.

1. **Launch the Hub**: `node src/hub.js`
2. **Launch Sentinels**: Run your agents (e.g., `python sentinels/pulse_sentinel.py`).
3. **Execute Intent**: `node src/intent.js`

> [!TIP]
> Use the provided `run_cba.bat` to launch the full world-class constellation at once!

---

## 4. Semantic Intent (Phase 5)

You no longer need to find selectors. Just tell the Hub what you want to achieve.

```javascript
// Old Way (Procedural)
await page.click('#submit-12345');

// CBA Way (Semantic)
await this.send({ goal: 'INITIATE MISSION' });
```
The Hub's **Semantic Resolver** will scan the page's accessibility layer and text content to find the correct element for you.

---

## 5. Temporal Stability (Phase 3)

Forget `setTimeout` or `waitForSelector`. The **Pulse Sentinel** monitors the environment's "Entropy" (network requests + DOM mutations).

- If the page is jittery, the Hub will automatically **WAIT**.
- Once the Pulse reports "Settled," the Hub executes.
- This results in **0-wait** code that is perfectly timed to the site's performance.

---

## 6. Understanding the Sentinels

### 💓 The Pulse Sentinel (Stability)
The Guardian of Time. It eliminates flakiness by ensuring the environment is stable before any action.

### 🧹 The Janitor Sentinel (Heuristics)
Detects known obstacles (modals, cookie banners) and hijacks control to clear them.

### 👁️ The Vision Sentinel (AI-Driven)
Uses Local AI (Ollama) to visually detect obstacles without selectors. Perfect for chaotic or encrypted UIs.

### 📊 The Data Sentinel (Intelligence)
Passively extracts metadata (tokens, IDs) and injects it into the shared context for your intent script to use.

---

## 7. Troubleshooting

- **AI Analysis Timed Out**: Ensure [Ollama](https://ollama.ai/) is running with the `moondream` model.
- **Goal Resolution Failed**: Ensure the button or link has visible text or aria-labels that match your goal.
- **System Unresponsive**: View the `CBA Hub` console for "Critical Sentinel UNRESPONSIVE" errors.

---

🌠 *The stars in the constellation are many, but the intent is one.*
