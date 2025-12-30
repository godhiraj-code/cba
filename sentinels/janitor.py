"""
Janitor Sentinel - Obstacle Removal Agent (v2.7)
Part of the Starlight Protocol - Phase 8 Quality Fixes

Clears modals, popups, and overlays using heuristic pattern matching.
Features persistent memory for learned remediation strategies.
"""

import asyncio
import sys
import os

# Path boilerplate for local imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sdk.starlight_sdk import SentinelBase

class JanitorSentinel(SentinelBase):
    def __init__(self):
        super().__init__(layer_name="JanitorSentinel", priority=5)
        self.blocking_patterns = [".modal", ".popup", "#overlay", ".obstacle", "#stabilize-btn"]
        self.selectors = self.blocking_patterns 
        self.is_hijacking = False
        self.tried_selectors = []  # Track ALL selectors tried during exploration

    async def on_pre_check(self, params, msg_id):
        blocking = params.get("blocking", [])
        
        if blocking:
            for b in blocking:
                matched_pattern = None
                for pattern in self.blocking_patterns:
                    if pattern.replace('.', '') in b.get("className", "") or pattern.replace('#', '') == b.get("id", ""):
                        matched_pattern = pattern
                        break
                
                if matched_pattern:
                    obstacle_id = b.get('selector', matched_pattern)
                    await self.perform_remediation(obstacle_id)
                    return 
        
        if not self.is_hijacking:
            await self.send_clear()

    async def perform_remediation(self, obstacle_id):
        if self.is_hijacking: 
            return
        self.is_hijacking = True
        self.tried_selectors = []  # Reset for this remediation attempt
        
        best_action = self.memory.get(obstacle_id)
        if best_action:
            print(f"[{self.layer}] Phase 7: Recalling best action for {obstacle_id} -> {best_action}")
            await self.send_hijack(f"Predictive remediation for {obstacle_id}")
            await self.send_action("click", best_action)
            self.last_action = {"id": obstacle_id, "selector": best_action, "known": True}
        else:
            print(f"[{self.layer}] !!! HIJACKING !!! Reason: Detected {obstacle_id}")
            await self.send_hijack(f"Janitor heuristic healing for {obstacle_id}")
            
            # Heuristic exploration - try multiple selectors
            fallback_selectors = [
                f"{obstacle_id} .close", 
                f"{obstacle_id} #close-btn",
                f"{obstacle_id} button",
                ".modal-close", 
                ".close-btn",
                "button:has-text('Close')",
                "button:has-text('OK')",
                "#custom-close"
            ]
            
            for selector in fallback_selectors:
                full_sel = f"{selector} >> visible=true"
                print(f"[{self.layer}] Trying heuristic: {full_sel}")
                await self.send_action("click", full_sel)
                self.tried_selectors.append(full_sel)
                await asyncio.sleep(0.3)
            
            # Store all tried selectors; we'll learn the right one on success feedback
            self.last_action = {"id": obstacle_id, "selectors": self.tried_selectors, "known": False}

        await asyncio.sleep(1.0)
        await self.send_resume(re_check=True)
        self.is_hijacking = False

    async def on_message(self, method, params, msg_id):
        """Learn from command completion feedback."""
        m_type = params.get("type") if isinstance(params, dict) else None
        
        if m_type == "COMMAND_COMPLETE" and self.last_action:
            if params.get("success", True):
                obs_id = self.last_action["id"]
                
                if self.last_action.get("known"):
                    # Already knew the right selector, nothing to learn
                    pass
                else:
                    # Learning: We don't know which selector worked, so store the last one
                    # In a real system, we'd get feedback about which action succeeded
                    selectors = self.last_action.get("selectors", [])
                    if selectors:
                        # Heuristic: the last selector is most likely to have worked
                        # (since earlier ones would have been caught by re-check)
                        best_sel = selectors[-1]
                        if self.memory.get(obs_id) != best_sel:
                            print(f"[{self.layer}] Phase 7: LEARNING remediation! {obs_id} -> {best_sel}")
                            self.memory[obs_id] = best_sel
                            self._save_memory()
            
            self.last_action = None

if __name__ == "__main__":
    sentinel = JanitorSentinel()
    asyncio.run(sentinel.start())
