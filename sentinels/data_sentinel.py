"""
Data Sentinel - Context Enrichment Agent (v2.7)
Part of the Starlight Protocol - Phase 8 Quality Fixes

Extracts real page metadata and injects it into the Hub's shared Sovereign State.
"""

import asyncio
import sys
import os
import time

# Path boilerplate for local imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sdk.starlight_sdk import SentinelBase

class DataSentinel(SentinelBase):
    def __init__(self):
        super().__init__(layer_name="DataSentinel", priority=20)
        self.capabilities = ["context-injection", "data-extraction"]
        self.selectors = []  # No blocking patterns to watch
        self.last_extraction = 0
        self.extraction_interval = 5  # seconds between extractions

    async def on_pre_check(self, params, msg_id):
        """Extract metadata from pre-check context and inject intelligence."""
        command = params.get("command", {})
        
        # Extract real data from the command context
        intelligence = {
            "lastCommand": command.get("cmd"),
            "lastGoal": command.get("goal"),
            "lastUrl": command.get("url"),
            "extractionTimestamp": time.ctime(),
            "sentinelStatus": "ACTIVE"
        }
        
        # Only inject if we have meaningful data
        if any([command.get("cmd"), command.get("goal"), command.get("url")]):
            await self.update_context(intelligence)
            print(f"[{self.layer}] Injected context: cmd={command.get('cmd')}, goal={command.get('goal')}")
        
        # Always clear - we don't block commands
        await self.send_clear()

    async def on_entropy(self, params):
        """Periodically extract and inject environmental state."""
        now = time.time()
        if now - self.last_extraction > self.extraction_interval:
            await self.update_context({
                "environmentEntropy": params.get("entropy", False),
                "entropyTimestamp": time.ctime()
            })
            self.last_extraction = now

    async def on_context_update(self, context):
        """Log context updates from other sentinels."""
        if context:
            print(f"[{self.layer}] Received context update: {list(context.keys())}")

if __name__ == "__main__":
    sentinel = DataSentinel()
    asyncio.run(sentinel.start())
