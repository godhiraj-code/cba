"""
Starlight Sentinel SDK (v4.0.0-alpha.1)
Standardizes the creation of autonomous agents for the CBA ecosystem.

Phase 18: Extended action methods for universal automation commands.
"""

import asyncio
import websockets
import json
import time
import os
import sys
import signal
import tempfile
import shutil
import contextvars
from abc import ABC, abstractmethod

class SentinelBase(ABC):
    def __init__(self, layer_name, priority, uri=None):
        # Support HUB_URL environment variable for flexible Hub connection
        # Use .strip() to handle Windows cmd trailing whitespace
        self.uri = (uri or os.environ.get("HUB_URL", "ws://localhost:8080")).strip()
        self.layer = layer_name
        self.priority = priority
        self.selectors = []
        self.capabilities = []
        self._websocket = None
        self._running = False
        self.memory = {}
        self.last_action = None
        self._current_request_id = contextvars.ContextVar(
            f"{self.layer}_current_request_id",
            default=None
        )
        self._precheck_lock = asyncio.Lock()
        self._protocol_tasks = set()
        # Stability: Use absolute path in project root, not relative CWD
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.memory_file = os.path.join(project_root, f"{self.layer}_memory.json")
        
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
        # Stability: SIGTERM doesn't exist on Windows
        if sys.platform != 'win32':
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

                    try:
                        async for message in websocket:
                            if not self._running:
                                break
                            try:
                                data = json.loads(message)
                                task = asyncio.create_task(self._handle_protocol(data))
                                self._protocol_tasks.add(task)
                                task.add_done_callback(self._protocol_task_done)
                            except json.JSONDecodeError as e:
                                print(f"[{self.layer}] Warning: Received malformed JSON, ignoring: {e}")
                    finally:
                        heartbeat_task.cancel()
                        await asyncio.gather(heartbeat_task, return_exceptions=True)
                        for task in self._protocol_tasks:
                            task.cancel()
                        await asyncio.gather(*self._protocol_tasks, return_exceptions=True)
                        self._protocol_tasks.clear()
                        
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
        # Security: Get auth token from config
        auth_token = self.config.get("hub", {}).get("security", {}).get("authToken")
        auth_token = os.environ.get("STARLIGHT_AUTH_TOKEN", auth_token)
        
        msg = {
            "jsonrpc": "2.0",
            "method": "starlight.registration",
            "params": {
                "layer": self.layer,
                "role": "sentinel",
                "priority": self.priority,
                "selectors": self.selectors,
                "capabilities": self.capabilities,
                "version": "1.0.0",
                "authToken": auth_token
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
            async with self._precheck_lock:
                token = self._current_request_id.set(msg_id)
                try:
                    await self.on_pre_check(params, msg_id)
                finally:
                    self._current_request_id.reset(token)
        elif method == "starlight.entropy_stream":
            await self.on_entropy(params)
        elif method == "starlight.sovereign_update":
            await self.on_context_update(params.get("context", {}))
        elif method == "starlight.ping":
            await self._send_msg(
                "starlight.pong",
                {"timestamp": int(time.time() * 1000)}
            )
        # Phase 17: Inter-Sentinel Side-Talk
        elif method == "starlight.sidetalk":
            await self.on_sidetalk(params)
        elif method == "starlight.sidetalk_ack":
            await self.on_sidetalk_ack(params)
        else:
            # Phase 7.3: For responses/broadcasts without method, pass full data
            await self.on_message(method, params if method else data, msg_id)

    def _protocol_task_done(self, task):
        self._protocol_tasks.discard(task)
        if not task.cancelled():
            error = task.exception()
            if error:
                print(f"[{self.layer}] Protocol handler failed: {error}")

    # --- Communication Methods ---

    async def send_clear(self, confidence=1.0, msg_id=None):
        """Approve execution with an optional confidence score (0.0-1.0)."""
        await self._send_msg(
            "starlight.clear",
            {"confidence": confidence},
            msg_id or self._current_request_id.get()
        )

    async def send_wait(self, retry_after_ms=1000, confidence=1.0, severity="soft", reason=None, msg_id=None):
        """Veto execution with an optional confidence score (0.0-1.0)."""
        params = {
            "retryAfterMs": retry_after_ms,
            "confidence": confidence,
            "severity": severity
        }
        if reason:
            params["reason"] = reason
        await self._send_msg(
            "starlight.wait",
            params,
            msg_id or self._current_request_id.get()
        )

    async def send_hijack(self, reason, msg_id=None):
        await self._send_msg(
            "starlight.hijack",
            {"reason": reason},
            msg_id or self._current_request_id.get()
        )

    async def send_resume(self, re_check=True):
        await self._send_msg("starlight.resume", {"re_check": re_check})

    async def send_action(self, cmd, selector=None, text=None, value=None, key=None, files=None):
        """Execute a healing action via the Hub."""
        params = {"cmd": cmd}
        if selector: params["selector"] = selector
        if text: params["text"] = text
        if value: params["value"] = value
        if key: params["key"] = key
        if files: params["files"] = files
        await self._send_msg("starlight.action", params)

    # === Extended Action Methods (v1.2.0) ===
    
    async def send_click(self, selector):
        """Click an element."""
        await self.send_action("click", selector)
    
    async def send_fill(self, selector, text):
        """Fill an input field."""
        await self.send_action("fill", selector, text=text)
    
    async def send_select(self, selector, value):
        """Select a dropdown option by value."""
        await self.send_action("select", selector, value=value)
    
    async def send_hover(self, selector):
        """Hover over an element."""
        await self.send_action("hover", selector)
    
    async def send_check(self, selector):
        """Check a checkbox."""
        await self.send_action("check", selector)
    
    async def send_uncheck(self, selector):
        """Uncheck a checkbox."""
        await self.send_action("uncheck", selector)
    
    async def send_scroll(self, selector=None):
        """Scroll to an element, or scroll to bottom if no selector."""
        await self.send_action("scroll", selector)
    
    async def send_press(self, key):
        """Press a keyboard key."""
        await self.send_action("press", key=key)
    
    async def send_type(self, text):
        """Type text using keyboard."""
        await self.send_action("type", text=text)
    
    async def send_upload(self, selector, files):
        """Upload file(s) to file input. Files can be single path or list of paths."""
        await self.send_action("upload", selector, files=files)

    async def update_context(self, context_data):
        """Inject data into the Hub's sovereign state."""
        await self._send_msg("starlight.context_update", {"context": context_data})

    # Phase 17: Inter-Sentinel Side-Talk
    async def send_sidetalk(self, to, topic, payload, reply_to=None):
        """
        Send a side-talk message to another Sentinel.
        
        Args:
            to: Target Sentinel name (e.g., 'A11ySentinel') or '*' for broadcast
            topic: Message topic (e.g., 'environment_state', 'capability_query')
            payload: Dict with message data
            reply_to: Optional message ID to reply to
        """
        params = {
            "from": self.layer,
            "to": to,
            "topic": topic,
            "payload": payload
        }
        if reply_to:
            params["replyTo"] = reply_to
        await self._send_msg("starlight.sidetalk", params)
        print(f"[{self.layer}] Side-Talk -> {to} (topic: {topic})")

    async def broadcast_state(self, stable=True, mutation_rate=0):
        """Convenience method to broadcast environment state to all Sentinels."""
        await self.send_sidetalk("*", "environment_state", {
            "stable": stable,
            "mutationRate": mutation_rate,
            "timestamp": time.time()
        })

    async def _send_msg(self, method, params, msg_id=None):
        if self._websocket:
            try:
                message_id = msg_id or str(time.time_ns())
                msg = self._format_message(method, params, message_id)
                await self._websocket.send(json.dumps(msg))
            except websockets.exceptions.ConnectionClosed:
                print(f"[{self.layer}] Cannot send {method}: connection closed")
            except Exception as e:
                print(f"[{self.layer}] Failed to send {method}: {e}")

    def _format_message(self, method, params, msg_id):
        """Phase 16.1: Extracted formatting for structural testability."""
        return {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": msg_id
        }

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

    # Phase 17: Side-Talk Hooks (Override in Sentinel for custom handling)
    async def on_sidetalk(self, params):
        """
        Called when a side-talk message is received from another Sentinel.
        Override in your Sentinel to handle inter-Sentinel communication.
        
        Args:
            params: {from, to, topic, payload, timestamp}
        """
        sender = params.get("from", "Unknown")
        topic = params.get("topic", "unknown")
        print(f"[{self.layer}] Side-Talk received from {sender} (topic: {topic})")

    async def on_sidetalk_ack(self, params):
        """
        Called when a side-talk delivery acknowledgment is received.
        Status can be 'delivered' or 'undeliverable'.
        
        Args:
            params: {originalId, status, reason, availableSentinels}
        """
        status = params.get("status", "unknown")
        if status == "undeliverable":
            reason = params.get("reason", "Unknown reason")
            available = params.get("availableSentinels", [])
            print(f"[{self.layer}] Side-Talk undeliverable: {reason}")
            print(f"[{self.layer}] Available Sentinels: {', '.join(available)}")
