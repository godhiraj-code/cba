"""
Vision Sentinel - AI-Powered Obstacle Detection (v2.7)
Part of the Starlight Protocol - Phase 8 Quality Fixes

Uses local SLMs (Ollama/Moondream) for visual, selector-free obstacle detection.
Features persistent memory for learned remediation strategies.
"""

import asyncio
import sys
import os
import httpx

# Path boilerplate for local imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sdk.starlight_sdk import SentinelBase

class VisionSentinel(SentinelBase):
    def __init__(self):
        super().__init__(layer_name="VisionSentinel", priority=3)
        self.capabilities = ["vision"]
        
        # Load from config
        vision_config = self.config.get("vision", {})
        self.model = vision_config.get("model", "moondream")
        self.timeout = vision_config.get("timeout", 25)
        self.ollama_url = vision_config.get("ollamaUrl", "http://localhost:11434/api/generate")

    async def on_pre_check(self, params, msg_id):
        screenshot_b64 = params.get("screenshot")
        
        if not screenshot_b64:
            await self.send_clear()
            return

        print(f"[{self.layer}] Starting AI Analysis ({self.timeout}s Budget)...")
        obstacle = await self.analyze_screenshot(screenshot_b64)
        
        if obstacle:
            print(f"[{self.layer}] AI Success: Detected {obstacle}")
            
            target_selector = self.memory.get(obstacle)
            if target_selector:
                print(f"[{self.layer}] Phase 7: Recalling resolution for {obstacle} -> {target_selector}")
            else:
                target_selector = "button:has-text('Close') >> visible=true"
            
            await self.send_hijack(f"AI Vision detected: {obstacle}")
            await self.send_action("click", target_selector)
            self.last_action = {"id": obstacle, "selector": target_selector}
            
            await asyncio.sleep(1.0)
            await self.send_resume(re_check=True)
        else:
            await self.send_clear()

    async def on_message(self, method, params, msg_id):
        """Learn from command completion feedback."""
        m_type = params.get("type") if isinstance(params, dict) else None
        
        if m_type == "COMMAND_COMPLETE" and self.last_action:
            if params.get("success", True):
                obs_id = self.last_action["id"]
                sel = self.last_action["selector"]
                if self.memory.get(obs_id) != sel:
                    print(f"[{self.layer}] Phase 7: Learning AI remediation! {obs_id} -> {sel}")
                    self.memory[obs_id] = sel
                    self._save_memory()
            self.last_action = None

    async def analyze_screenshot(self, screenshot_b64):
        prompt = "What is the main obstacle in this image? (popup, modal, banner, or none)"
        try:
            async with httpx.AsyncClient(timeout=float(self.timeout)) as client:
                response = await client.post(
                    self.ollama_url,
                    json={
                        "model": self.model,
                        "prompt": prompt,
                        "images": [screenshot_b64],
                        "stream": False
                    }
                )
                
                if response.status_code == 200:
                    answer = response.json().get("response", "").strip().lower()
                    print(f"[{self.layer}] AI Raw Response: '{answer}'")
                    
                    keywords = ["popup", "modal", "banner", "overlay", "cookie", "dialog", "alert", "window", "obstacle"]
                    for kw in keywords:
                        if kw in answer: 
                            return kw
                    return None
        except httpx.TimeoutException:
            print(f"[{self.layer}] AI Analysis timed out after {self.timeout}s")
        except httpx.ConnectError:
            print(f"[{self.layer}] Cannot connect to Ollama at {self.ollama_url}")
        except Exception as e:
            print(f"[{self.layer}] AI Analysis failed: {type(e).__name__}: {e}")
        
        return None

if __name__ == "__main__":
    sentinel = VisionSentinel()
    asyncio.run(sentinel.start())
