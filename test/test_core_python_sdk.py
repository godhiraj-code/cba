import asyncio
import json
import os
import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python-sdk" / "src"))

from starlight_protocol import PROTOCOL_VERSION, Sentinel, Starlight  # noqa: E402


HUB_SCRIPT = r"""
const { ProtocolHub } = require('./src/core');
(async () => {
  const hub = new ProtocolHub({ port: 0 });
  const address = await hub.start();
  console.log(JSON.stringify(address));
  const close = async () => { await hub.close(); process.exit(0); };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
})().catch(error => { console.error(error); process.exit(1); });
"""


class CorePythonInteropTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.process = await asyncio.create_subprocess_exec(
            "node",
            "-e",
            HUB_SCRIPT,
            cwd=str(ROOT),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=os.environ.copy(),
        )
        line = await asyncio.wait_for(self.process.stdout.readline(), timeout=10)
        self.address = json.loads(line.decode("utf-8"))
        self.sentinel = None
        self.client = None

    async def asyncTearDown(self):
        if self.client:
            await self.client.close()
        if self.sentinel:
            await self.sentinel.close()
        if self.process.returncode is None:
            self.process.terminate()
            await asyncio.wait_for(self.process.wait(), timeout=10)

    async def test_python_sentinel_and_client_interoperate_with_node_hub(self):
        async def handle(intent, execution):
            return {
                "status": "completed",
                "value": {
                    "goal": intent["goal"],
                    "topic": intent["context"]["topic"],
                    "attempt": execution["attempt"],
                },
                "evidence": ["python-sentinel-ran"],
            }

        self.sentinel = Sentinel(
            name="python-agent",
            url=self.address["url"],
            capabilities=["python", "heuristic"],
            can_handle=lambda intent: {"score": 0.91},
            handle=handle,
        )
        self.client = Starlight(url=self.address["url"], name="python-test")
        await self.sentinel.connect()
        await self.client.connect()

        result = await self.client.intent("Prepare report", {"topic": "reliability"})

        self.assertEqual(PROTOCOL_VERSION, "1.0")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["sentinel"]["name"], "python-agent")
        self.assertEqual(result["value"]["topic"], "reliability")
        self.assertEqual(result["evidence"], ["python-sentinel-ran"])

        await self.client.websocket.close()
        await self.client.peer.reader_task
        replayed_connection = await self.client.intent(
            "Prepare another report", {"topic": "resilience"}
        )
        self.assertEqual(replayed_connection["value"]["topic"], "resilience")


if __name__ == "__main__":
    unittest.main()
