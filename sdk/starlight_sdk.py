"""
Starlight Sentinel SDK (v2.1)
Standardizes the creation of autonomous agents for the CBA ecosystem.
"""

import asyncio
import websockets
import json
import time
from abc import ABC, abstractmethod

class SentinelBase(ABC):
    def __init__(self, layer_name, priority, uri="ws://localhost:8080"):
        self.uri = uri
        self.layer = layer_name
        self.priority = priority
        self.selectors = []
        self.capabilities = []
        self._websocket = None
        self._running = False

    async def start(self):
        """Main entry point for the sentinel."""
        self._running = True
        while self._running:
            try:
                print(f"[{self.layer}] Connecting to Starlight Hub...")
                async with websockets.connect(self.uri) as websocket:
                    self._websocket = websocket
                    await self._register()
                    
                    # Start background tasks
                    heartbeat_task = asyncio.create_task(self._heartbeat_loop())
                    
                    async for message in websocket:
                        data = json.loads(message)
                        await self._handle_protocol(data)
                        
            except Exception as e:
                print(f"[{self.layer}] Connection error: {e}. Retrying in 3s...")
                await asyncio.sleep(3)

    async def _register(self):
        msg = {
            "jsonrpc": "2.0",
            "method": "starlight.registration",
            "params": {
                "layer": self.layer,
                "priority": self.priority,
                "selectors": self.selectors,
                "capabilities": self.capabilities
            },
            "id": "reg-" + str(int(time.time()))
        }
        await self._websocket.send(json.dumps(msg))

    async def _heartbeat_loop(self):
        while self._websocket:
            try:
                msg = {
                    "jsonrpc": "2.0",
                    "method": "starlight.pulse",
                    "params": {"layer": self.layer},
                    "id": "pulse-" + str(int(time.time()))
                }
                await self._websocket.send(json.dumps(msg))
                await asyncio.sleep(2)
            except: 
                break

    async def _handle_protocol(self, data):
        method = data.get("method")
        params = data.get("params", {})
        msg_id = data.get("id")

        if method == "starlight.pre_check":
            await self.on_pre_check(params, msg_id)
        elif method == "starlight.entropy_stream":
            await self.on_entropy(params)
        elif method == "starlight.sovereign_update":
            # Phase 4: Shared state updates
            await self.on_context_update(params.get("context", {}))
        else:
            await self.on_message(method, params, msg_id)

    # --- Communication Methods ---

    async def send_clear(self):
        await self._send_msg("starlight.clear", {})

    async def send_wait(self, retry_after_ms=1000):
        await self._send_msg("starlight.wait", {"retryAfterMs": retry_after_ms})

    async def send_hijack(self, reason):
        await self._send_msg("starlight.hijack", {"reason": reason})

    async def send_resume(self, re_check=True):
        await self._send_msg("starlight.resume", {"re_check": re_check})

    async def update_context(self, context_data):
        """Phase 4: Inject data into the Hub's sovereign state."""
        await self._send_msg("starlight.context_update", {"context": context_data})

    async def _send_msg(self, method, params):
        if self._websocket:
            try:
                msg = {
                    "jsonrpc": "2.0",
                    "method": method,
                    "params": params,
                    "id": str(int(time.time() * 1000))
                }
                await self._websocket.send(json.dumps(msg))
            except:
                pass

    # --- Lifecycle Hooks (Override These) ---

    @abstractmethod
    async def on_pre_check(self, params, msg_id):
        pass

    async def on_entropy(self, params):
        pass

    async def on_context_update(self, context):
        pass

    async def on_message(self, method, params, msg_id):
        pass
