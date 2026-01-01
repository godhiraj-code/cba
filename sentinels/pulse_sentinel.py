"""
Pulse Sentinel - Temporal Stability Monitor (v2.8)
Part of the Starlight Protocol - Phase 9 Animation Tolerance

Monitors "Environmental Entropy" (Network/DOM noise) to ensure 
the browser is settled before allowing Intent execution.

v2.8: Added animation tolerance with max veto count to handle
sites with continuous CSS animations.
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
        self.settlement_window = self.config.get("sentinel", {}).get("settlementWindow", 0.5)
        self.max_veto_count = self.config.get("sentinel", {}).get("maxVetoCount", 3)
        self.last_entropy_time = time.time()
        self.is_stable = False
        self.veto_count = 0
        self.current_command_id = None

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
        
        # Use goal or selector as stable command identifier (stays same across retries)
        goal = params.get("command", {}).get("goal", "")
        selector = params.get("command", {}).get("selector", "")
        url = params.get("command", {}).get("url", "")
        cmd_key = goal or selector or url or cmd
        
        # Reset veto count for new commands
        if cmd_key != self.current_command_id:
            self.veto_count = 0
            self.current_command_id = cmd_key
        
        # Phase 16: Dynamic Settlement Adjustment
        stability_hint = params.get("command", {}).get("stabilityHint", 0)
        base_window = self.config.get("sentinel", {}).get("settlementWindow", 0.5)
        
        # Calculate dynamic window (Hint is in ms, SDK uses seconds)
        # We use the hint as a weight, adding it to the baseline but capping at 2.0s
        dynamic_window = max(base_window, min(2.0, (stability_hint / 1000.0) + 0.1))
        
        if stability_hint > 0:
             # Only use hint if it's significantly different from baseline
             current_window = dynamic_window
        else:
             current_window = base_window

        # Proactively check stability
        silence_duration = time.time() - self.last_entropy_time
        if silence_duration >= current_window:
            if not self.is_stable:
                print(f"[{self.layer}] Environment SETTLED for {cmd} ({silence_duration:.1f}s silence, Target: {current_window:.1f}s).")
            self.is_stable = True
        
        if self.is_stable:
            print(f"[{self.layer}] Stability Verified for: {cmd}")
            self.veto_count = 0
            await self.send_clear()
        elif self.veto_count >= self.max_veto_count:
            # Animation tolerance: force clear after max retries
            print(f"[{self.layer}] ANIMATION TOLERANCE: Max vetoes ({self.max_veto_count}) reached, force clearing for: {cmd}")
            self.veto_count = 0
            await self.send_clear()
        else:
            self.veto_count += 1
            wait_time = max(0.2, self.settlement_window - silence_duration)
            print(f"[{self.layer}] VETO ({self.veto_count}/{self.max_veto_count}): Environment settling. Retry in {wait_time:.1f}s")
            await self.send_wait(int(wait_time * 1000))

if __name__ == "__main__":
    sentinel = PulseSentinel()
    asyncio.run(sentinel.start())

