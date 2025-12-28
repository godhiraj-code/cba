"""
Vision Sentinel - AI-Driven Obstacle Detection
Part of the Starlight Protocol v2.0 (Phase 2)

Uses a local SLM (moondream via Ollama) to visually detect obstacles
without relying on CSS selectors.
"""

import asyncio
import websockets
import json
import time
import base64
import httpx

class VisionSentinel:
    def __init__(self, uri="ws://localhost:8080", model="moondream"):
        self.uri = uri
        self.layer = "VisionSentinel"
        self.priority = 3  # Higher priority than Janitor (5)
        self.model = model
        self.ollama_url = "http://localhost:11434/api/generate"
        self.is_hijacking = False
        self.detected_selectors = []  # Self-healing: learned selectors

    async def connect(self):
        async with websockets.connect(self.uri) as websocket:
            print(f"[{self.layer}] Connected to Starlight Hub (v2.0 Protocol).")
            print(f"[{self.layer}] Using AI Model: {self.model}")
            
            # Starlight v2.0: JSON-RPC Registration
            registration = {
                "jsonrpc": "2.0",
                "method": "starlight.registration",
                "params": {
                    "layer": self.layer,
                    "priority": self.priority,
                    "selectors": [],  # We don't need selectors - we use vision!
                    "capabilities": ["vision", "ai-healing"]
                },
                "id": str(int(time.time() * 1000))
            }
            await websocket.send(json.dumps(registration))

            # Start Heartbeat Task
            heartbeat_task = asyncio.create_task(self.pulse(websocket))

            async for message in websocket:
                data = json.loads(message)
                await self.handle_message(websocket, data)
            
            heartbeat_task.cancel()

    async def pulse(self, ws):
        while True:
            msg = {
                "jsonrpc": "2.0",
                "method": "starlight.pulse",
                "params": {
                    "data": {
                        "currentAura": self.detected_selectors,
                        "capabilities": ["vision", "ai-healing"]
                    }
                },
                "id": str(int(time.time() * 1000))
            }
            await ws.send(json.dumps(msg))
            await asyncio.sleep(0.5)

    async def handle_message(self, ws, data):
        method = data.get("method")
        params = data.get("params", {})

        if method == "starlight.pre_check":
            cmd = params.get("command", {}).get("cmd", "unknown")
            screenshot_b64 = params.get("screenshot")
            
            if screenshot_b64:
                print(f"[{self.layer}] PRE_CHECK with screenshot: Analyzing with AI...")
                obstacle = await self.analyze_screenshot(screenshot_b64)
                
                if obstacle:
                    print(f"[{self.layer}] AI detected obstacle: {obstacle}")
                    await self.hijack(ws, obstacle)
                    return
            
            # No obstacle detected - clear
            if not self.is_hijacking:
                clear_msg = {
                    "jsonrpc": "2.0",
                    "method": "starlight.clear",
                    "params": {},
                    "id": str(int(time.time() * 1000))
                }
                await ws.send(json.dumps(clear_msg))

    async def analyze_screenshot(self, screenshot_b64):
        """
        Send screenshot to local SLM for obstacle detection.
        Returns obstacle description if found, None otherwise.
        """
        prompt = """Look at this browser screenshot. Is there a popup, modal, cookie banner, 
overlay, or any obstacle blocking the main content? Answer with just one word: 
either the obstacle type (popup, modal, banner, overlay) or "clear" if there's no obstacle."""

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                # Use /api/chat for vision models in Ollama
                response = await client.post(
                    "http://localhost:11434/api/chat",
                    json={
                        "model": self.model,
                        "messages": [
                            {
                                "role": "user",
                                "content": prompt,
                                "images": [screenshot_b64]
                            }
                        ],
                        "stream": False
                    }
                )
                
                if response.status_code == 200:
                    result = response.json()
                    answer = result.get("message", {}).get("content", "").strip().lower()
                    print(f"[{self.layer}] AI Response: {answer}")
                    
                    # Check for obstacle keywords
                    obstacle_keywords = ["popup", "modal", "banner", "overlay", "cookie", "dialog", "alert"]
                    for keyword in obstacle_keywords:
                        if keyword in answer:
                            return keyword
                    
                    if "clear" in answer or "no" in answer or "none" in answer:
                        return None
                    
                    return None  # Default to clear if uncertain
                else:
                    print(f"[{self.layer}] Ollama error: {response.status_code} - {response.text}")
                    
        except Exception as e:
            print(f"[{self.layer}] AI analysis failed: {e}")
        
        return None

    async def hijack(self, ws, obstacle_type):
        if self.is_hijacking:
            return

        print(f"[{self.layer}] !!! AI HIJACKING !!! Detected: {obstacle_type}")
        self.is_hijacking = True
        
        # Starlight v2.0: HIJACK signal
        hijack_msg = {
            "jsonrpc": "2.0",
            "method": "starlight.hijack",
            "params": {
                "reason": f"AI Vision detected {obstacle_type}",
                "obstacleSignature": obstacle_type,
                "aiDetected": True
            },
            "id": str(int(time.time() * 1000))
        }
        await ws.send(json.dumps(hijack_msg))

        # AI-driven healing: Try common close patterns
        print(f"[{self.layer}] Executing AI-Driven Sovereign Healing...")
        close_selectors = [
            ".close-btn >> visible=true",
            "[aria-label*='close'] >> visible=true",
            "button:has-text('Close') >> visible=true",
            "button:has-text('Accept') >> visible=true",
            ".modal .close >> visible=true",
            "#close >> visible=true"
        ]
        
        for selector in close_selectors:
            action_msg = {
                "jsonrpc": "2.0",
                "method": "starlight.action",
                "params": {
                    "cmd": "click",
                    "selector": selector
                },
                "id": str(int(time.time() * 1000))
            }
            await ws.send(json.dumps(action_msg))
            await asyncio.sleep(0.3)  # Brief pause between attempts
        
        await asyncio.sleep(1.0)

        # Starlight v2.0: RESUME signal
        print(f"[{self.layer}] Requesting RE_CHECK for landscape stability...")
        resume_msg = {
            "jsonrpc": "2.0",
            "method": "starlight.resume",
            "params": {
                "re_check": True
            },
            "id": str(int(time.time() * 1000))
        }
        await ws.send(json.dumps(resume_msg))
        self.is_hijacking = False

if __name__ == "__main__":
    sentinel = VisionSentinel()
    asyncio.run(sentinel.connect())
