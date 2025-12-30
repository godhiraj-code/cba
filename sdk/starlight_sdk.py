"""
Starlight Sentinel SDK (v2.7)
Standardizes the creation of autonomous agents for the CBA ecosystem.

Phase 8: Added graceful shutdown, proper exception handling, and atomic file writes.
"""

import asyncio
import websockets
import json
import time
import os
import signal
import tempfile
import shutil
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
        self.memory = {}
        self.last_action = None
        self.memory_file = f"{self.layer}_memory.json"
        
        # Load config
        self.config = self._load_config()

    def _load_config(self):
        """Load configuration from config.json."""
        config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'config.json')
        try:
            if os.path.exists(config_path):
                with open(config_path, 'r') as f:
                    return json.load(f)
        except Exception as e:
            print(f"[{self.layer}] Warning: Could not load config: {e}")
        return {"sentinel": {"reconnectDelay": 3, "heartbeatInterval": 2}}

    def _load_memory(self):
        """Phase 7.3: Load persistent Sentinel experience."""
        try:
            if os.path.exists(self.memory_file):
                with open(self.memory_file, 'r') as f:
                    self.memory = json.load(f)
                print(f"[{self.layer}] Phase 7: Loaded {len(self.memory)} persistent patterns.")
        except json.JSONDecodeError as e:
            print(f"[{self.layer}] Warning: Memory file corrupted, starting fresh: {e}")
            self.memory = {}
        except Exception as e:
            print(f"[{self.layer}] Warning: Failed to load memory: {e}")

    def _save_memory(self):
        """Phase 7.3: Persist Sentinel experience with atomic write."""
        try:
            # Atomic write: write to temp file, then rename
            fd, temp_path = tempfile.mkstemp(suffix='.json', dir=os.path.dirname(self.memory_file) or '.')
            try:
                with os.fdopen(fd, 'w') as f:
                    json.dump(self.memory, f, indent=4)
                shutil.move(temp_path, self.memory_file)
            except Exception:
                os.unlink(temp_path)
                raise
        except Exception as e:
            print(f"[{self.layer}] Warning: Failed to save memory: {e}")

    async def start(self):
        """Main entry point for the sentinel."""
        self._load_memory()
        self._running = True
        
        # Setup graceful shutdown
        def handle_shutdown(sig, frame):
            print(f"\n[{self.layer}] Received shutdown signal, saving state...")
            self._save_memory()
            self._running = False
        
        signal.signal(signal.SIGINT, handle_shutdown)
        signal.signal(signal.SIGTERM, handle_shutdown)
        
        reconnect_delay = self.config.get("sentinel", {}).get("reconnectDelay", 3)
        
        while self._running:
            try:
                print(f"[{self.layer}] Connecting to Starlight Hub...")
                async with websockets.connect(self.uri) as websocket:
                    self._websocket = websocket
                    await self._register()
                    
                    # Start background tasks
                    heartbeat_task = asyncio.create_task(self._heartbeat_loop())
                    
                    async for message in websocket:
                        if not self._running:
                            break
                        data = json.loads(message)
                        asyncio.create_task(self._handle_protocol(data))
                        
            except websockets.exceptions.ConnectionClosed as e:
                print(f"[{self.layer}] Connection closed: {e}. Retrying in {reconnect_delay}s...")
            except ConnectionRefusedError:
                print(f"[{self.layer}] Hub not available. Retrying in {reconnect_delay}s...")
            except Exception as e:
                print(f"[{self.layer}] Connection error: {type(e).__name__}: {e}. Retrying in {reconnect_delay}s...")
            
            if self._running:
                await asyncio.sleep(reconnect_delay)
        
        # Final save on exit
        self._save_memory()
        print(f"[{self.layer}] Shutdown complete.")

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
        interval = self.config.get("sentinel", {}).get("heartbeatInterval", 2)
        while self._websocket and self._running:
            try:
                msg = {
                    "jsonrpc": "2.0",
                    "method": "starlight.pulse",
                    "params": {"layer": self.layer},
                    "id": "pulse-" + str(int(time.time()))
                }
                await self._websocket.send(json.dumps(msg))
                await asyncio.sleep(interval)
            except websockets.exceptions.ConnectionClosed:
                break
            except Exception as e:
                print(f"[{self.layer}] Heartbeat error: {e}")
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
            await self.on_context_update(params.get("context", {}))
        else:
            # Phase 7.3: For responses/broadcasts without method, pass full data
            await self.on_message(method, params if method else data, msg_id)

    # --- Communication Methods ---

    async def send_clear(self):
        await self._send_msg("starlight.clear", {})

    async def send_wait(self, retry_after_ms=1000):
        await self._send_msg("starlight.wait", {"retryAfterMs": retry_after_ms})

    async def send_hijack(self, reason):
        await self._send_msg("starlight.hijack", {"reason": reason})

    async def send_resume(self, re_check=True):
        await self._send_msg("starlight.resume", {"re_check": re_check})

    async def send_action(self, cmd, selector, text=None):
        """Execute a healing action via the Hub."""
        params = {"cmd": cmd, "selector": selector}
        if text: params["text"] = text
        await self._send_msg("starlight.action", params)

    async def update_context(self, context_data):
        """Inject data into the Hub's sovereign state."""
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
            except websockets.exceptions.ConnectionClosed:
                print(f"[{self.layer}] Cannot send {method}: connection closed")
            except Exception as e:
                print(f"[{self.layer}] Failed to send {method}: {e}")

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
