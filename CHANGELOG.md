# 📜 Changelog

All notable changes to the CBA (Constellation-Based Automation) project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.7.0] - 2024-12-30

### 🛠️ Phase 8: Codebase Hardening & Quality Fixes

#### Added
- **`config.json`**: Centralized configuration file for all hardcoded values
  - Hub settings: port, syncBudget, missionTimeout, heartbeatTimeout, lockTTL
  - Aura settings: predictiveWaitMs, bucketSizeMs
  - Sentinel settings: settlementWindow, reconnectDelay, heartbeatInterval
  - Vision settings: model, timeout, ollamaUrl
- **`requirements.txt`**: Python dependencies with pinned versions
- **Screenshot Cleanup**: Auto-removes screenshots older than 24 hours at Hub startup
- **Trace Rotation**: Mission trace limited to 500 events (configurable)
- **Graceful Shutdown**: Sentinels now handle SIGINT/SIGTERM, saving memory before exit

#### Changed
- **PulseSentinel**: Migrated to inherit from `SentinelBase` (SDK consistency)
- **Sync Budget**: Reduced default from 90s to 30s (configurable)
- **Exception Handling**: Replaced bare `except:` blocks with proper error handling
- **File Persistence**: Memory files now use atomic writes (temp file + rename)
- **DataSentinel**: Now extracts real command/goal data instead of fake tokens

#### Fixed
- **Janitor Learning Race Condition**: Now tracks all tried selectors correctly
- **SDK Message Handling**: Non-blocking protocol processing with `asyncio.create_task`
- **Path Handling**: Standardized `sys.path` approach across all sentinels

---

## [2.6.0] - 2024-12-29

### 🛰️ Phase 7: The Galaxy Mesh (Predictive Intelligence)

#### Added
- **Self-Healing Selectors**: Hub learns DOM patterns from `mission_trace.json`
- **Aura-Based Throttling**: Dynamic pacing based on historical entropy windows
- **Sentinel Learning**: Persistent memory for Janitor and Vision sentinels
- **`JanitorSentinel_memory.json`**: Stores learned remediation selectors
- **`test/intent_learning.js`**: Demo mission for Sentinel learning
- **`test/learning_test.html`**: Test page with stubborn modal

#### Changed
- **ROI Dashboard**: Now includes "AURA STABILIZED" badge and predictive ROI
- **Hub Memory**: Loads historical selectors and auras on startup

---

## [2.5.0] - 2024-12-28

### 🛡️ Phase 6: The Omega Standard

#### Added
- **Time-Travel Triage**: Full DOM snapshots on every intent
- **`triage.html`**: Interactive mission replay tool
- **`mission_trace.json`**: High-fidelity event logging
- **Docker Support**: `Dockerfile` and `docker-compose.yml`
- **STARLIGHT_STANDARD.md**: Formal protocol specification

---

## [2.4.0] - 2024-12-27

### 🎯 Phase 5: Semantic Intent

#### Added
- **Semantic Resolver**: Goals like "INITIATE MISSION" auto-resolve to selectors
- **Aria Label Support**: Accessibility-first element discovery
- **Cosmic Challenge**: Stress test with multiple obstacles

---

## [2.3.0] - 2024-12-26

### 🌐 Phase 4: Decentralized Sentinel Mesh

#### Added
- **Starlight SDK**: `SentinelBase` class for rapid agent development
- **Sovereign Context**: Shared state across the constellation
- **DataSentinel**: Passive intelligence extraction agent

---

## [2.2.0] - 2024-12-25

### ⏱️ Phase 3: Temporal Stability

#### Added
- **PulseSentinel**: Network/DOM entropy monitoring
- **Auto-Wait Handshake**: No more `setTimeout` in intent scripts
- **Entropy Stream**: Real-time stability signaling

---

## [2.1.0] - 2024-12-24

### 👁️ Phase 2: AI Visionary Layer

#### Added
- **VisionSentinel**: Local SLM (Moondream) integration
- **Screenshot Analysis**: Visual obstacle detection
- **Hybrid Healing**: 25s AI budget with heuristic fallback

---

## [2.0.0] - 2024-12-23

### 🚀 Phase 1: The Core Protocol

#### Added
- **CBA Hub**: Central orchestrator with Playwright
- **JSON-RPC 2.0**: Standardized message bus
- **JanitorSentinel**: Heuristic obstacle removal
- **Priority Handshaking**: Multi-sentinel coordination
- **Hero Story Report**: Business ROI visualization

---

## [1.0.0] - 2024-12-22

### 🌟 Initial Release

- Proof of concept for Constellation-Based Automation
- Basic Hub with WebSocket communication
- Single sentinel prototype
