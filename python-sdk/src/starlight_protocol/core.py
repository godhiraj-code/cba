"""Minimal asyncio SDK for Starlight Core Protocol 1.0."""

import asyncio
import inspect
import json
import random
import uuid
from typing import Any, Awaitable, Callable, Dict, Optional, Union

import websockets


PROTOCOL_VERSION = "1.0"


class ProtocolError(Exception):
    """A structured error returned by a Starlight protocol peer."""

    def __init__(self, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.code = code
        self.details = details


async def _resolve(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


class _Peer:
    def __init__(self, websocket: Any, request_timeout: float = 30.0):
        self.websocket = websocket
        self.request_timeout = request_timeout
        self.pending: Dict[str, asyncio.Future] = {}
        self.handlers: Dict[str, Callable[..., Any]] = {}
        self.tasks = set()
        self.reader_task: Optional[asyncio.Task] = None
        self.send_lock = asyncio.Lock()

    def handle(self, method: str, handler: Callable[..., Any]) -> None:
        self.handlers[method] = handler

    def start(self) -> None:
        self.reader_task = asyncio.create_task(self._read_loop())

    async def call(self, method: str, params: Optional[Dict[str, Any]] = None) -> Any:
        request_id = str(uuid.uuid4())
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        try:
            try:
                await self._send({
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "method": method,
                    "params": params or {},
                })
            except Exception as error:
                raise ProtocolError("DISCONNECTED", str(error)) from error
            return await asyncio.wait_for(future, timeout=self.request_timeout)
        except asyncio.TimeoutError as error:
            raise ProtocolError("TIMEOUT", "request '{}' timed out".format(method)) from error
        finally:
            self.pending.pop(request_id, None)

    async def notify(self, method: str, params: Optional[Dict[str, Any]] = None) -> None:
        await self._send({"jsonrpc": "2.0", "method": method, "params": params or {}})

    async def _send(self, message: Dict[str, Any]) -> None:
        async with self.send_lock:
            await self.websocket.send(json.dumps(message))

    async def _read_loop(self) -> None:
        disconnected = ProtocolError("DISCONNECTED", "protocol peer disconnected")
        try:
            async for raw in self.websocket:
                message = json.loads(raw)
                if "id" in message and ("result" in message or "error" in message):
                    future = self.pending.get(str(message["id"]))
                    if future and not future.done():
                        if message.get("error"):
                            remote = message["error"]
                            data = remote.get("data") or {}
                            future.set_exception(ProtocolError(
                                data.get("protocolCode", str(remote.get("code"))),
                                remote.get("message", "remote protocol error"),
                                data.get("details"),
                            ))
                        else:
                            future.set_result(message.get("result"))
                    continue

                task = asyncio.create_task(self._dispatch(message))
                self.tasks.add(task)
                task.add_done_callback(self.tasks.discard)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            disconnected = ProtocolError("DISCONNECTED", str(error))
        finally:
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(disconnected)

    async def _dispatch(self, message: Dict[str, Any]) -> None:
        method = message.get("method")
        handler = self.handlers.get(method)
        if not handler:
            if "id" in message:
                await self._error(message["id"], "METHOD_NOT_FOUND", "unknown method '{}'".format(method))
            return
        try:
            result = await _resolve(handler(message.get("params") or {}))
            if "id" in message:
                await self._send({"jsonrpc": "2.0", "id": message["id"], "result": result})
        except asyncio.CancelledError:
            return
        except Exception as error:
            if "id" in message:
                await self._error(message["id"], "SENTINEL_ERROR", str(error))

    async def _error(self, request_id: Any, code: str, message: str) -> None:
        await self._send({
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {
                "code": -32000,
                "message": message,
                "data": {"protocolCode": code},
            },
        })

    async def close(self) -> None:
        await self.websocket.close(code=1000, reason="SDK shutdown")
        if self.reader_task:
            await asyncio.gather(self.reader_task, return_exceptions=True)
        for task in list(self.tasks):
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)


ClaimHandler = Callable[[Dict[str, Any]], Union[Any, Awaitable[Any]]]
IntentHandler = Callable[[Dict[str, Any], Dict[str, Any]], Union[Any, Awaitable[Any]]]


class Sentinel:
    """A remote Sentinel implemented with callbacks or subclass overrides."""

    def __init__(
        self,
        name: str,
        handle: Optional[IntentHandler] = None,
        can_handle: Optional[ClaimHandler] = None,
        url: str = "ws://127.0.0.1:8080",
        sentinel_id: Optional[str] = None,
        version: str = "0.0.0",
        priority: int = 100,
        capacity: int = 1,
        capabilities: Optional[list] = None,
        token: Optional[str] = None,
    ):
        if not name or not name.strip():
            raise ValueError("name must be non-empty")
        self.name = name.strip()
        self.url = url
        self.sentinel_id = sentinel_id
        self.version = version
        self.priority = priority
        self.capacity = capacity
        self.capabilities = capabilities or []
        self.token = token
        self._handle_callback = handle
        self._claim_callback = can_handle
        self.websocket = None
        self.peer: Optional[_Peer] = None
        self.executions: Dict[str, asyncio.Task] = {}
        self.stopping = False

    async def can_handle(self, intent: Dict[str, Any]) -> Any:
        if self._claim_callback:
            return await _resolve(self._claim_callback(intent))
        return True

    async def handle(self, intent: Dict[str, Any], execution: Dict[str, Any]) -> Any:
        if not self._handle_callback:
            raise NotImplementedError("override handle() or pass a handle callback")
        return await _resolve(self._handle_callback(intent, execution))

    async def connect(self) -> "Sentinel":
        self.stopping = False
        self.websocket = await websockets.connect(self.url)
        self.peer = _Peer(self.websocket)
        self.peer.handle("starlight.offer", self._offer)
        self.peer.handle("starlight.execute", self._execute)
        self.peer.handle("starlight.cancel", self._cancel)
        self.peer.start()
        registration = {
            "role": "sentinel",
            "id": self.sentinel_id,
            "name": self.name,
            "version": self.version,
            "protocolVersion": PROTOCOL_VERSION,
            "priority": self.priority,
            "capacity": self.capacity,
            "capabilities": self.capabilities,
            "token": self.token,
        }
        await self.peer.call(
            "starlight.register",
            {key: value for key, value in registration.items() if value is not None},
        )
        return self

    async def _offer(self, params: Dict[str, Any]) -> Any:
        return await self.can_handle(params["intent"])

    async def _execute(self, params: Dict[str, Any]) -> Any:
        intent = params["intent"]
        task = asyncio.current_task()
        self.executions[intent["id"]] = task
        try:
            return await self.handle(intent, {
                "attempt": params.get("attempt"),
                "claim": params.get("claim"),
                "history": params.get("history") or [],
            })
        finally:
            self.executions.pop(intent["id"], None)

    async def _cancel(self, params: Dict[str, Any]) -> None:
        task = self.executions.get(params.get("intentId"))
        if task and task is not asyncio.current_task():
            task.cancel()

    async def serve_forever(self) -> None:
        if not self.peer or not self.peer.reader_task:
            raise RuntimeError("sentinel is not connected")
        await self.peer.reader_task

    async def run(
        self,
        reconnect: bool = True,
        min_delay: float = 0.25,
        max_delay: float = 10.0,
        stop_event: Optional[asyncio.Event] = None,
    ) -> None:
        delay = min_delay
        self.stopping = False
        while not self.stopping and not (stop_event and stop_event.is_set()):
            try:
                await self.connect()
                delay = min_delay
                await self.serve_forever()
            except (OSError, ProtocolError, websockets.ConnectionClosed):
                if not reconnect or self.stopping:
                    raise
            if not reconnect or self.stopping or (stop_event and stop_event.is_set()):
                break
            try:
                await asyncio.wait_for(
                    stop_event.wait() if stop_event else asyncio.sleep(delay + random.random() * delay * 0.2),
                    timeout=delay + delay * 0.2 if stop_event else None,
                )
            except asyncio.TimeoutError:
                pass
            delay = min(max_delay, delay * 2)

    async def close(self) -> None:
        self.stopping = True
        if self.peer:
            await self.peer.close()


class Starlight:
    """Intent-only client for a remote Starlight Coordinator."""

    def __init__(
        self,
        url: str = "ws://127.0.0.1:8080",
        name: str = "python-intent-client",
        token: Optional[str] = None,
        reconnect_attempts: int = 1,
        reconnect_delay: float = 0.1,
    ):
        self.url = url
        self.name = name
        self.token = token
        self.reconnect_attempts = reconnect_attempts
        self.reconnect_delay = reconnect_delay
        self.websocket = None
        self.peer: Optional[_Peer] = None
        self.connect_lock = asyncio.Lock()

    async def connect(self) -> "Starlight":
        async with self.connect_lock:
            if self.peer and self.peer.reader_task and not self.peer.reader_task.done():
                return self
            self.websocket = await websockets.connect(self.url)
            self.peer = _Peer(self.websocket)
            self.peer.start()
            registration = {
                "role": "client",
                "name": self.name,
                "protocolVersion": PROTOCOL_VERSION,
                "token": self.token,
            }
            await self.peer.call(
                "starlight.register",
                {key: value for key, value in registration.items() if value is not None},
            )
        return self

    async def intent(
        self,
        goal: Union[str, Dict[str, Any]],
        context: Optional[Dict[str, Any]] = None,
        constraints: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if not self.peer:
            raise RuntimeError("client is not connected")
        params = dict(goal) if isinstance(goal, dict) else {
            "goal": goal,
            "context": context or {},
            "constraints": constraints or {},
        }
        params.setdefault("id", str(uuid.uuid4()))
        for attempt in range(self.reconnect_attempts + 1):
            try:
                return await self.peer.call("starlight.intent", params)
            except ProtocolError as error:
                if attempt >= self.reconnect_attempts or error.code not in ("DISCONNECTED", "TIMEOUT"):
                    raise
                await asyncio.sleep(self.reconnect_delay * (attempt + 1))
                await self.connect()
        raise AssertionError("unreachable")

    async def close(self) -> None:
        if self.peer:
            await self.peer.close()
