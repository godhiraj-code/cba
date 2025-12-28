import asyncio
import websockets
import json
import time

class JanitorSentinel:
    def __init__(self, uri="ws://localhost:8080"):
        self.uri = uri
        self.layer = "JanitorSentinel"
        self.priority = 5
        self.blocking_patterns = [".modal", ".popup", "#overlay"]
        self.is_hijacking = False

    async def connect(self):
        async with websockets.connect(self.uri) as websocket:
            print(f"[{self.layer}] Connected to Starlight Hub (v2.0 Protocol).")
            
            # Starlight v2.0: JSON-RPC Registration
            registration = {
                "jsonrpc": "2.0",
                "method": "starlight.registration",
                "params": {
                    "layer": self.layer,
                    "priority": self.priority,
                    "selectors": self.blocking_patterns
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
            # Starlight v2.0: JSON-RPC Pulse with Aura
            msg = {
                "jsonrpc": "2.0",
                "method": "starlight.pulse",
                "params": {
                    "data": {
                        "currentAura": self.blocking_patterns
                    }
                },
                "id": str(int(time.time() * 1000))
            }
            await ws.send(json.dumps(msg))
            await asyncio.sleep(0.5)  # 500ms heartbeat

    async def handle_message(self, ws, data):
        # Starlight v2.0: Check for JSON-RPC method
        method = data.get("method")
        params = data.get("params", {})

        if method == "starlight.pre_check":
            cmd = params.get("command", {}).get("cmd", "unknown")
            print(f"[{self.layer}] PRE_CHECK: Auditing environment for {cmd}...")
            
            # Check for blocking elements sent by Hub
            blocking = params.get("blocking", [])
            if blocking:
                for b in blocking:
                    matched_pattern = None
                    for pattern in self.blocking_patterns:
                        if pattern.replace('.', '') in b.get("className", "") or pattern.replace('#', '') == b.get("id", ""):
                            matched_pattern = pattern
                            break
                    
                    if matched_pattern:
                        selector_to_hijack = b.get('selector', matched_pattern)
                        await self.hijack(ws, selector_to_hijack, f"Proactive Audit: detected visible {selector_to_hijack}")
                        return 
            
            # Path is clear - send CLEAR signal
            if not self.is_hijacking:
                clear_msg = {
                    "jsonrpc": "2.0",
                    "method": "starlight.clear",
                    "params": {},
                    "id": str(int(time.time() * 1000))
                }
                await ws.send(json.dumps(clear_msg))

    async def hijack(self, ws, selector, reason):
        if self.is_hijacking: return

        print(f"[{self.layer}] !!! HIJACKING !!! Reason: {reason}")
        self.is_hijacking = True
        
        # Starlight v2.0: HIJACK signal
        hijack_msg = {
            "jsonrpc": "2.0",
            "method": "starlight.hijack",
            "params": {
                "reason": reason,
                "obstacleSignature": selector
            },
            "id": str(int(time.time() * 1000))
        }
        await ws.send(json.dumps(hijack_msg))

        # Execute Sovereign Healing
        print(f"[{self.layer}] Executing Sovereign Healing...")
        target_pattern = selector if "close" in selector else ".close-btn"
        
        # Starlight v2.0: ACTION signal
        action_msg = {
            "jsonrpc": "2.0",
            "method": "starlight.action",
            "params": {
                "cmd": "click",
                "selector": f"{target_pattern} >> visible=true"
            },
            "id": str(int(time.time() * 1000))
        }
        await ws.send(json.dumps(action_msg))
        
        await asyncio.sleep(1.5)

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
    sentinel = JanitorSentinel()
    asyncio.run(sentinel.connect())
