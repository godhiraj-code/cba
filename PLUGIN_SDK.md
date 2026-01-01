# 🔌 Starlight Plugin SDK

Build and distribute your own Sentinels for the CBA ecosystem.

---

## Quick Start

### 1. Create Plugin Structure

```
my-plugin/
├── plugin.json          # Required: Plugin manifest
├── my_sentinel.py       # Required: Your sentinel code
└── README.md            # Recommended: Documentation
```

### 2. Create `plugin.json`

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What your sentinel does",
  "main": "my_sentinel.py",
  "author": "your-github-username",
  "sdk_version": ">=2.7",
  "tags": ["popup", "healing"]
}
```

### 3. Write Your Sentinel

```python
"""My Custom Sentinel - Auto-dismiss popups"""

import asyncio
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sdk.starlight_sdk import SentinelBase


class MyPluginSentinel(SentinelBase):
    def __init__(self):
        super().__init__(layer_name="MyPluginSentinel", priority=5)
        self.selectors = [".popup", "#modal", "[data-dismiss]"]
        self.capabilities = ["popup-detection"]
    
    async def on_pre_check(self, params, msg_id):
        # Phase 16: Use stabilityHint for context-aware budgets
        stability_hint = params.get("command", {}).get("stabilityHint", 0)
        blocking = params.get("blocking", [])
        
        # Check if any blocking elements match our selectors
        matches = [b for b in blocking if any(s in b.get("selector", "") for s in self.selectors)]
        
        if matches:
            print(f"[{self.layer}] Obstacle detected! (Stability Hint: {stability_hint}ms)")
            await self.send_hijack("Popup blocking execution")
            
            # Clear the obstacle
            for match in matches:
                await self.send_action("click", match["selector"])
            
            await self.send_resume()
        else:
            await self.send_clear()


if __name__ == "__main__":
    sentinel = MyPluginSentinel()
    asyncio.run(sentinel.start())
```

---

## Publishing Your Plugin

### Option A: GitHub Repository

1. Push your plugin folder to GitHub
2. Users install with:
   ```bash
   starlight install https://github.com/username/my-plugin
   ```

### Option B: Submit to Official Registry

1. Create a PR to add your plugin to `cli/plugins.json`
2. Include:
   - Plugin name, description, version
   - GitHub source URL
   - Tags for discoverability

---

## Plugin Manifest Reference

| Field | Required | Description |
|---|---|---|
| `name` | ✅ | Unique plugin identifier (lowercase, hyphens) |
| `version` | ✅ | Semantic version (e.g., "1.0.0") |
| `main` | ✅ | Entry point Python file |
| `description` | ✅ | Short description |
| `author` | ❌ | Your GitHub username |
| `sdk_version` | ❌ | Minimum SDK version (e.g., ">=2.7") |
| `tags` | ❌ | Keywords for search |

---

## Best Practices

1. **Use `SentinelBase`** - Always inherit from the SDK
2. **Set `priority`** - Lower = higher priority (1-10 recommended)
3. **Declare `selectors`** - What DOM patterns you monitor
4. **Declare `capabilities`** - What features you provide
5. **Handle errors** - Use try/catch in `on_pre_check`
6. **Document** - Include a README with usage examples

---

## CLI Commands

```bash
# Install from registry
starlight install cookie-consent

# Install from GitHub
starlight install https://github.com/user/plugin

# List installed
starlight list

# Show available
starlight list --available

# Uninstall
starlight remove cookie-consent
```

---

*Built with ❤️ by the CBA Community*
