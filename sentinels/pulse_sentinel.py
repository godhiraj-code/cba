"""
Pulse Sentinel - Temporal Stability Monitor
Part of the Starlight Protocol v2.0 (Phase 3)

Monitors "Environmental Entropy" (Network/DOM noise) to ensure 
the browser is settled before allowing Intent execution.
"""

import asyncio
import websockets
import json
import time

class PulseSentinel:
    def __init__(self, uri="ws://localhost:8080"):
        self.uri = uri
        self.layer = "PulseSentinel"
        self.priority = 1  # Highest priority - Stability comes first
        self.settlement_window = 1.0  # Seconds of silence required
        self.last_entropy_time = time.time()
        self.is_stable = False

    async def pulse_loop(self, ws):
        while True:
            try:
                msg = {
                    "jsonrpc": "2.0",
                    "method": "starlight.pulse",
                    "params": {"layer": self.layer},
                    "id": str(int(time.time() * 1000))
                }
                await ws.send(json.dumps(msg))
                await asyncio.sleep(1)
            except: break

    async def connect(self):
        try:
            async with websockets.connect(self.uri) as websocket:
                print(f"[{self.layer}] Connected to Starlight Hub (v2.0 Protocol).")
                
                registration = {
                    "jsonrpc": "2.0",
                    "method": "starlight.registration",
                    "params": {
                        "layer": self.layer,
                        "priority": self.priority,
                        "capabilities": ["temporal-stability", "settling", "network-idle"]
                    },
                    "id": str(int(time.time() * 1000))
                }
                await websocket.send(json.dumps(registration))
                asyncio.create_task(self.pulse_loop(websocket))

                async for message in websocket:
                    data = json.loads(message)
                    await self.handle_message(websocket, data)
        except Exception as e:
            print(f"[{self.layer}] Connection failed: {e}")

    async def handle_message(self, ws, data):
        method = data.get("method")
        params = data.get("params", {})

        # Starlight v3.0: Hub streams entropy data
        if method == "starlight.entropy_stream":
            entropy_detected = params.get("entropy", False)
            if entropy_detected:
                self.last_entropy_time = time.time()
                if self.is_stable:
                    print(f"[{self.layer}] Jitter Detected! Environment is UNSTABLE.")
                self.is_stable = False
            
        elif method == "starlight.pre_check":
            cmd = params.get("command", {}).get("cmd", "unknown")
            
            # Proactively check stability
            silence_duration = time.time() - self.last_entropy_time
            if silence_duration >= self.settlement_window:
                if not self.is_stable:
                    print(f"[{self.layer}] Environment SETTLED ({silence_duration:.1f}s of silence).")
                self.is_stable = True
            
            if self.is_stable:
                print(f"[{self.layer}] Stability Verified for: {cmd}")
                await self.send_clear(ws)
            else:
                wait_time = max(0.2, self.settlement_window - silence_duration)
                print(f"[{self.layer}] VETO: Environment is still settling. Retry in {wait_time:.1f}s")
                await self.send_wait(ws, wait_time)

    async def send_clear(self, ws):
        clear_msg = {
            "jsonrpc": "2.0",
            "method": "starlight.clear",
            "params": {},
            "id": str(int(time.time() * 1000))
        }
        await ws.send(json.dumps(clear_msg))

    async def send_wait(self, ws, seconds):
        # Starlight v3.0: Requesting a settlement delay
        wait_msg = {
            "jsonrpc": "2.0",
            "method": "starlight.wait",
            "params": { "retryAfterMs": int(seconds * 1000) },
            "id": str(int(time.time() * 1000))
        }
        await ws.send(json.dumps(wait_msg))

if __name__ == "__main__":
    asyncio.run(PulseSentinel().connect())
