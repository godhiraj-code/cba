"""
Data Sentinel - Context Enrichment Agent
Part of the Starlight Protocol v2.1 (Phase 4)

Demonstrates how to use the Sentinel SDK to inject business
data into the Hub's shared Sovereign State.
"""

import asyncio
import sys
import os
import time

# Ensure root is in path for SDK access
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sdk.starlight_sdk import SentinelBase

class DataSentinel(SentinelBase):
    def __init__(self):
        super().__init__(layer_name="DataSentinel", priority=20)
        self.capabilities = ["context-injection", "data-extraction"]
        self.selectors = ["#status-log"] # Watch the status log for data
        self.last_extraction = 0

    async def _register(self):
        """Override registration to also trigger an initial proactive extraction."""
        await super()._register()
        print(f"[{self.layer}] Proactive Intelligence Extraction Starting...")
        await self.extract_and_inject()

    async def extract_and_inject(self):
        mission_token = f"ALPHA-{int(time.time() % 1000)}"
        print(f"[{self.layer}] Extracted Intelligence: {mission_token}")
        await self.update_context({
            "missionToken": mission_token,
            "environmentStatus": "HIGH_ENERGY",
            "sentinelTimestamp": time.ctime()
        })
        self.last_extraction = time.time()

    async def on_pre_check(self, params, msg_id):
        await self.send_clear()

    async def on_entropy(self, params):
        now = time.time()
        if now - self.last_extraction > 5:
            await self.extract_and_inject()

if __name__ == "__main__":
    asyncio.run(DataSentinel().start())
