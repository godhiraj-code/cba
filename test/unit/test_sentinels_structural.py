import unittest
import sys
import os
import asyncio
import json
import time
from unittest.mock import MagicMock, AsyncMock, patch

# Add project root to path
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../'))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from sdk.starlight_sdk import SentinelBase
from sentinels.janitor import JanitorSentinel
from sentinels.pulse_sentinel import PulseSentinel

class MockSentinel(SentinelBase):
    def __init__(self, name, priority=1):
        super().__init__(layer_name=name, priority=priority)
        self.sent_messages = []

    async def on_pre_check(self, params, msg_id):
        await self.send_clear()

class TestSentinelSDKStructural(unittest.TestCase):
    def test_base_initialization(self):
        """Test that SentinelBase initializes correctly"""
        sentinel = MockSentinel("TestSentinel", priority=5)
        self.assertEqual(sentinel.layer, "TestSentinel")
        self.assertEqual(sentinel.priority, 5)
        self.assertIn("ws://", sentinel.uri)

    def test_message_formatting(self):
        """Test JSON-RPC 2.0 message formatting"""
        sentinel = MockSentinel("TestSentinel", priority=5)
        msg = sentinel._format_message("starlight.test", {"param": 1}, "msg-1")
        
        self.assertEqual(msg["jsonrpc"], "2.0")
        self.assertEqual(msg["method"], "starlight.test")
        self.assertEqual(msg["params"]["param"], 1)
        self.assertEqual(msg["id"], "msg-1")

    def test_lifecycle_hooks(self):
        """Test that lifecycle hooks exist and are callable (coverage)"""
        sentinel = MockSentinel("TestSentinel", priority=1)
        
        # Test actual implementations
        loop = asyncio.new_event_loop()
        loop.run_until_complete(sentinel.on_entropy({"noise": 0.5}))
        loop.run_until_complete(sentinel.on_message("starlight.broadcast", {"data": "test"}, "id-m1"))
        loop.run_until_complete(sentinel.on_context_update({"test": True}))
        loop.run_until_complete(sentinel.on_sidetalk({"from": "other", "topic": "test"}))
        loop.run_until_complete(sentinel.on_sidetalk_ack({"status": "delivered"}))
        loop.run_until_complete(sentinel.on_sidetalk_ack({"status": "undeliverable", "reason": "timeout", "availableSentinels": []}))
        loop.close()
        self.assertTrue(True, "Lifecycle hooks called successfully")

class TestSentinelsStructural(unittest.TestCase):
    def test_janitor_patterns(self):
        """Test that JanitorSentinel has correct blocking patterns"""
        janitor = JanitorSentinel()
        self.assertIn(".modal", janitor.blocking_patterns)
        
    def test_janitor_pre_check(self):
        """Test JanitorSentinel blocking detection logic"""
        janitor = JanitorSentinel()
        janitor.sent_messages = []
        async def mock_send(method, params, msg_id=None):
            janitor.sent_messages.append({"method": method, "params": params})
        janitor._send_msg = mock_send

        # Scenario 1: Blocking
        params = {
            "blocking": [{"selector": ".modal", "className": "modal", "tagName": "DIV"}],
            "command": {"cmd": "click"}
        }
        asyncio.run(janitor.on_pre_check(params, "id-1"))
        self.assertTrue(len(janitor.sent_messages) > 0)

        # Scenario 2: Non-blocking
        janitor.sent_messages = []
        params = {"blocking": [], "command": {"cmd": "click"}}
        asyncio.run(janitor.on_pre_check(params, "id-2"))
        self.assertEqual(janitor.sent_messages[0]["method"], "starlight.clear")

    def test_pulse_initialization(self):
        """Test PulseSentinel initialization"""
        pulse = PulseSentinel()
        self.assertEqual(pulse.priority, 1)

    def test_pulse_pre_check(self):
        """Test PulseSentinel stability check logic"""
        pulse = PulseSentinel()
        pulse.sent_messages = []
        async def mock_send(method, params, msg_id=None):
            pulse.sent_messages.append({"method": method, "params": params})
        pulse._send_msg = mock_send

        # Scenario 1: Unstable
        pulse.is_stable = False
        params = {"stability": {"is_stable": False}}
        asyncio.run(pulse.on_pre_check(params, "id-p1"))
        has_wait = any(m["method"] == "starlight.wait" for m in pulse.sent_messages)
        self.assertTrue(has_wait)

        # Scenario 2: Stable
        pulse.sent_messages = []
        pulse.is_stable = True
        params = {"stability": {"is_stable": True}}
        asyncio.run(pulse.on_pre_check(params, "id-p2"))
        self.assertEqual(pulse.sent_messages[0]["method"], "starlight.clear")

    def test_pulse_clears_on_final_veto_budget(self):
        """Pulse should clear on the final configured veto budget attempt."""
        pulse = PulseSentinel()
        pulse.sent_messages = []
        async def mock_send(method, params, msg_id=None):
            pulse.sent_messages.append({"method": method, "params": params})
        pulse._send_msg = mock_send

        pulse.is_stable = False
        pulse.veto_count = pulse.max_veto_count - 1
        pulse.current_command_id = "checkpoint"
        pulse.last_entropy_time = time.time()

        asyncio.run(pulse.on_pre_check({"command": {"cmd": "checkpoint"}}, "id-p3"))
        self.assertEqual(pulse.sent_messages[0]["method"], "starlight.clear")

class TestSDKCoverageIntensive(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Use MockSentinel but DO NOT override _send_msg to hit SDK logic
        self.sentinel = MockSentinel("TestSDK", priority=5)
        self.sentinel._websocket = MagicMock()
        self.sentinel._websocket.send = AsyncMock()

    async def test_registration_and_heartbeat(self):
        # Registration
        await self.sentinel._register()
        self.sentinel._websocket.send.assert_called()
        
        # Pulse
        # Use AsyncMock for sleep
        with patch('asyncio.sleep', new_callable=AsyncMock):
            # Run heartbeat once
            self.sentinel._running = True
            
            # Subclass mock to stop after one send
            original_send = self.sentinel._websocket.send
            async def mock_send_stop(data):
                await original_send(data)
                self.sentinel._running = False
            
            self.sentinel._websocket.send = mock_send_stop
            
            await self.sentinel._heartbeat_loop()
            self.sentinel._websocket.send = original_send
            self.sentinel._websocket.send.assert_called()

    async def test_all_actions(self):
        # Coverage for all send_* methods
        await self.sentinel.send_click(".btn")
        await self.sentinel.send_fill(".input", "text")
        await self.sentinel.send_select(".select", "val")
        await self.sentinel.send_hover(".hover")
        await self.sentinel.send_check(".check")
        await self.sentinel.send_uncheck(".uncheck")
        await self.sentinel.send_scroll(".element")
        await self.sentinel.send_scroll() # Empty
        await self.sentinel.send_press("Enter")
        await self.sentinel.send_type("hello")
        await self.sentinel.send_upload(".file", "f.txt")
        await self.sentinel.send_resume()
        await self.sentinel.send_hijack("blocked")
        await self.sentinel.send_wait()
        
        # Verify call counts (14 actions)
        self.assertEqual(self.sentinel._websocket.send.call_count, 14)

    async def test_sidetalk(self):
        await self.sentinel.send_sidetalk("A11ySentinel", "state", {"ok": True})
        await self.sentinel.broadcast_state(stable=True)
        # 2 messages
        self.assertEqual(self.sentinel._websocket.send.call_count, 2)

    async def test_protocol_handling(self):
        # Test routing in _handle_protocol
        methods = {
            "starlight.pre_check": "on_pre_check",
            "starlight.entropy_stream": "on_entropy",
            "starlight.sovereign_update": "on_context_update",
            "starlight.sidetalk": "on_sidetalk",
            "starlight.sidetalk_ack": "on_sidetalk_ack"
        }
        
        for method, hook in methods.items():
            with patch.object(MockSentinel, hook, new_callable=AsyncMock) as mocked_hook:
                sentinel = MockSentinel("Test", priority=1)
                await sentinel._handle_protocol({"method": method, "params": {}, "id": "1"})
                mocked_hook.assert_called_once()

    def test_memory_logic(self):
        # Non-async tests for memory
        sentinel = MockSentinel("MemTest", priority=1)
        sentinel.memory = {"learned": True}
        sentinel._save_memory()
        
        new_sentinel = MockSentinel("MemTest", priority=1)
        new_sentinel._load_memory()
        self.assertTrue(new_sentinel.memory.get("learned"))
        
        # Cleanup
        if os.path.exists(new_sentinel.memory_file):
            os.remove(new_sentinel.memory_file)

    def test_config_loading(self):
        sentinel = MockSentinel("ConfigTest", priority=1)
        config = sentinel._load_config()
        self.assertIsInstance(config, dict)

if __name__ == '__main__':
    unittest.main()
