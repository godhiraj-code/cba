# CBA vs Traditional POM: Architectural Shift

This document outlines the fundamental shift from the linear **Page Object Model (POM)** to the non-linear, agentic **Constellation-Based Automation (CBA)**.

## 1. Traditional Page Object Model (POM)
In POM, the test script is tightly coupled to the UI structure through Page Objects. If an unexpected modal or UI change occurs, the test usually fails because the Page Object doesn't "know" how to handle the noise.

```mermaid
graph TD
    A[Test Script] -->|Call Method| B[Page Object]
    B -->|Selector Input| C[Browser]
    C -.->|Unexpected Modal| D[CRASH / Fail]
    style D fill:#f96,stroke:#333,stroke-width:2px
```

**Key Weakness:** The test logic must account for every possible UI state (modals, banners, loading states), leading to complex "if-else" logic in Page Objects.

---

## 2. Constellation-Based Automation (CBA)
CBA decouples **Intent** from **Environment**. The test only expresses a goal. A "Sentries" (Sentinels) monitor the environment and autonomously "heal" it before the intent is executed.

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
    end

    subgraph Environment
        B[Browser]
    end

    T -->|Goal: Click Submit| H
    H -->|Handshake| V
    H -->|Handshake| J
    V -->|AI Vision: Found Modal| H
    J -->|Selectors: Found Modal| H
    H -->|Hijack| B
    B -->|Healing Action| B
    B -->|Path Clear| H
    H -->|Resume Intent| B
    B -->|Success| T

    style H fill:#1e293b,stroke:#3b82f6,color:#fff
    style V fill:#064e3b,stroke:#10b981,color:#fff
    style J fill:#064e3b,stroke:#10b981,color:#fff
```

## Key Differences

| Feature | Page Object Model (POM) | Constellation-Based Automation (CBA) |
| :--- | :--- | :--- |
| **Logic Type** | Procedural / Linear | Reactive / Agentic |
| **Coupling** | High (Test knows UI) | Low (Intent is purely Business Goal) |
| **Error Handling** | Manual / Try-Catch | Autonomous (Sentinel Healing) |
| **AI Integration** | Difficult / Ad-hoc | Native (Vision Sentinels) |
| **Outcome** | "Flaky" on chaotic sites | "Stable" via Sovereign Remediation |

---

## Summary: The "Hero's Journey"
In CBA, the **Intent Layer** is the "Hero" who wants to reach a destination. The **Sentinels** are the "Guardians" who clear the path. The **Hub** is the "Map" that coordinates the journey. The Hero never has to worry about the obstacles—they are handled by the Guardians before the Hero even takes a step.
