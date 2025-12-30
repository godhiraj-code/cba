"""
Pulse Sentinel - Temporal Stability Monitor (v2.7)
Part of the Starlight Protocol - Phase 8 SDK Migration

Monitors "Environmental Entropy" (Network/DOM noise) to ensure 
the browser is settled before allowing Intent execution.
"""

import asyncio
import sys
import os
import time

# Path boilerplate for local imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sdk.starlight_sdk import SentinelBase

class PulseSentinel(SentinelBase):
    def __init__(self):
        super().__init__(layer_name="PulseSentinel", priority=1)
        self.capabilities = ["temporal-stability", "settling", "network-idle"]
        self.settlement_window = self.config.get("sentinel", {}).get("settlementWindow", 1.0)
        self.last_entropy_time = time.time()
        self.is_stable = False

    async def on_entropy(self, params):
        """Handle entropy stream events from Hub."""
        entropy_detected = params.get("entropy", False)
        if entropy_detected:
            self.last_entropy_time = time.time()
            if self.is_stable:
                print(f"[{self.layer}] Jitter Detected! Environment is UNSTABLE.")
            self.is_stable = False

    async def on_pre_check(self, params, msg_id):
        """Verify temporal stability before allowing command execution."""
        cmd = params.get("command", {}).get("cmd", "unknown")
        
        # Proactively check stability
        silence_duration = time.time() - self.last_entropy_time
        if silence_duration >= self.settlement_window:
            if not self.is_stable:
                print(f"[{self.layer}] Environment SETTLED ({silence_duration:.1f}s of silence).")
            self.is_stable = True
        
        if self.is_stable:
            print(f"[{self.layer}] Stability Verified for: {cmd}")
            await self.send_clear()
        else:
            wait_time = max(0.2, self.settlement_window - silence_duration)
            print(f"[{self.layer}] VETO: Environment is still settling. Retry in {wait_time:.1f}s")
            await self.send_wait(int(wait_time * 1000))

if __name__ == "__main__":
    sentinel = PulseSentinel()
    asyncio.run(sentinel.start())
