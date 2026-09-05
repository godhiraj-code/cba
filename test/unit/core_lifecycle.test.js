'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { Coordinator, ProtocolHub, Sentinel, Starlight } = require('../../src/core');
const { RpcPeer } = require('../../src/core/rpc');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error('condition did not become true');
        await wait(5);
    }
}

test('remote timeout retains capacity until the real handler settles', async t => {
    const hub = new ProtocolHub({ port: 0, allowAnonymousLoopback: true,
        executionTimeoutMs: 20, schedulingTimeoutMs: 20, fallbackOnError: false });
    const { url } = await hub.start();
    let settle;
    let calls = 0;
    const sentinel = new Sentinel({ url, name: 'non-cooperative', handle: () => {
        calls++;
        return new Promise(resolve => { settle = resolve; });
    } });
    const client = new Starlight({ url, reconnectAttempts: 0 });
    t.after(async () => { settle?.({ status: 'completed' }); client.close(); sentinel.close(); await hub.close(); });
    await sentinel.connect(); await client.connect();
    await assert.rejects(() => client.intent('First'), { code: 'TIMEOUT' });
    assert.equal(hub.coordinator.list()[0].active, 1);
    await assert.rejects(() => client.intent('Second'), { code: 'TIMEOUT' });
    assert.equal(calls, 1);
    settle({ status: 'completed' });
    await until(() => hub.coordinator.list()[0].active === 0);
});

test('remote cancellation supplies an AbortSignal and clears finished execution state', async t => {
    const hub = new ProtocolHub({ port: 0, allowAnonymousLoopback: true });
    const { url } = await hub.start();
    let started = false;
    let aborted = false;
    const sentinel = new Sentinel({ url, name: 'cooperative', handle: (_intent, { signal }) => new Promise(resolve => {
        started = true;
        signal.addEventListener('abort', () => { aborted = true; resolve({ status: 'unhandled' }); }, { once: true });
    }) });
    const client = new Starlight({ url, reconnectAttempts: 0 });
    t.after(async () => { client.close(); sentinel.close(); await hub.close(); });
    await sentinel.connect(); await client.connect();
    const result = client.intent({ id: 'cancel-signal', goal: 'Stop on cancellation' });
    const rejected = assert.rejects(() => result, { code: 'CANCELLED' });
    await until(() => started);
    await client.cancel('cancel-signal');
    await rejected;
    await until(() => aborted && sentinel.executions.size === 0 && hub.coordinator.list()[0].active === 0);
});

test('registration is serialized and an authentication result cannot resurrect a closed peer', async t => {
    let authenticate;
    let authCalls = 0;
    const hub = new ProtocolHub({ port: 0, authenticate: () => {
        authCalls++;
        return new Promise(resolve => { authenticate = resolve; });
    } });
    const { url } = await hub.start();
    t.after(() => hub.close());
    const socket = new WebSocket(url);
    await new Promise(resolve => socket.once('open', resolve));
    const peer = new RpcPeer(socket);
    const registration = { role: 'sentinel', name: 'racing', protocolVersion: '1.0' };
    const first = peer.call('starlight.register', registration).catch(error => error);
    await until(() => authCalls === 1);
    const second = await peer.call('starlight.register', { ...registration, name: 'second' }).catch(error => error);
    assert.equal(second.code, 'INVALID_REQUEST');
    await until(() => socket.readyState === WebSocket.CLOSED);
    authenticate(true);
    await first;
    await wait(10);
    assert.equal(authCalls, 1);
    assert.deepEqual(hub.coordinator.list(), []);
});

test('connect calls wait for authentication and a reconnect replays a snapshot of the original intent', async t => {
    let authenticate;
    let delayAuth = true;
    const hub = new ProtocolHub({ port: 0, authenticate: () => delayAuth
        ? new Promise(resolve => { authenticate = resolve; }) : 'principal' });
    const { url } = await hub.start();
    const client = new Starlight({ url, reconnectDelayMs: 5 });
    t.after(async () => { client.close(); await hub.close(); });
    const first = client.connect();
    await until(() => Boolean(authenticate));
    let secondConnected = false;
    const second = client.connect().then(() => { secondConnected = true; });
    await wait(10);
    assert.equal(secondConnected, false);
    delayAuth = false;
    authenticate('principal');
    await Promise.all([first, second]);
    let effects = 0;
    hub.coordinator.register({ name: 'local', offer: () => true, execute: async intent => {
        effects++;
        client.socket.terminate();
        await wait(20);
        return { status: 'completed', value: intent.context.nested.value };
    } });
    const input = { goal: 'Keep submitted content', context: { nested: { value: 7 } } };
    const pending = client.intent(input);
    input.context.nested.value = 99;
    assert.equal((await pending).value, 7);
    assert.equal(effects, 1);
});

test('observers and reentrant replay cannot change outcomes or duplicate work', async () => {
    const coordinator = new Coordinator();
    let calls = 0;
    let replay;
    const intent = { id: 'reentrant', goal: 'Execute once' };
    coordinator.on('intent.received', () => { replay = coordinator.dispatch(intent); });
    coordinator.on('sentinel.selected', () => { throw new Error('logger failed'); });
    coordinator.on('intent.completed', () => { throw new Error('metrics failed'); });
    coordinator.register({ name: 'worker', offer: () => true,
        execute: () => ({ status: 'completed', value: ++calls }) });
    assert.equal((await coordinator.dispatch(intent)).value, 1);
    assert.equal((await replay).value, 1);
    assert.equal(calls, 1);
});

test('stale unregister callbacks cannot remove a replacement registration', () => {
    const coordinator = new Coordinator();
    const agent = { name: 'replaceable', offer: () => true, execute: () => ({ status: 'completed' }) };
    const old = coordinator.register(agent);
    assert.equal(old(), true);
    coordinator.register(agent);
    assert.equal(old(), false);
    assert.equal(coordinator.list().length, 1);
});

test('a conflicting replay does not revoke cancellation of the original request', async t => {
    const hub = new ProtocolHub({ port: 0, allowAnonymousLoopback: true });
    const { url } = await hub.start();
    hub.coordinator.register({ name: 'worker', offer: () => true, execute: () => new Promise(() => {}) });
    const client = new Starlight({ url, reconnectAttempts: 0 });
    t.after(async () => { client.close(); await hub.close(); });
    await client.connect();
    const first = client.intent({ id: 'active-conflict', goal: 'Original' });
    const rejected = assert.rejects(() => first, { code: 'CANCELLED' });
    await until(() => hub.coordinator.list()[0].active === 1);
    await assert.rejects(() => client.intent({ id: 'active-conflict', goal: 'Changed' }), { code: 'INTENT_CONFLICT' });
    assert.equal((await client.cancel('active-conflict')).cancelled, true);
    await rejected;
});

test('Hub shutdown bounds drain time and clears active cooperative work', async () => {
    const hub = new ProtocolHub({ port: 0, allowAnonymousLoopback: true, shutdownTimeoutMs: 20 });
    const { url } = await hub.start();
    const client = new Starlight({ url, reconnectAttempts: 0 });
    hub.coordinator.register({ name: 'worker', offer: () => true,
        execute: (_intent, { signal }) => new Promise(resolve => {
            signal.addEventListener('abort', () => resolve({ status: 'unhandled' }), { once: true });
        }) });
    await client.connect();
    const result = client.intent('Long work').catch(error => error);
    await until(() => hub.coordinator.list()[0].active === 1);
    const started = Date.now();
    await assert.rejects(() => hub.close(), { code: 'TIMEOUT' });
    await result;
    client.close();
    assert(Date.now() - started < 1000);
    assert.equal(hub.coordinator.activeIntents.size, 0);
});

test('Sentinel capacity persists across reconnect while an old tool ignores cancellation', async t => {
    const hub = new ProtocolHub({ port: 0, allowAnonymousLoopback: true, fallbackOnError: false });
    const { url } = await hub.start();
    let settle;
    let calls = 0;
    const sentinel = new Sentinel({ url, name: 'reconnecting-device', handle: () => {
        calls++;
        return calls === 1 ? new Promise(resolve => { settle = resolve; }) : { status: 'completed' };
    } });
    const client = new Starlight({ url, reconnectAttempts: 0 });
    t.after(async () => { settle?.({ status: 'completed' }); client.close(); sentinel.close(); await hub.close(); });
    await sentinel.connect(); await client.connect();
    const first = client.intent('Before disconnect').catch(error => error);
    await until(() => calls === 1);
    sentinel.socket.terminate();
    await until(() => hub.coordinator.list().length === 0);
    await first;
    await sentinel.connect();
    const second = client.intent('After reconnect');
    await wait(20);
    assert.equal(calls, 1);
    settle({ status: 'completed' });
    assert.equal((await second).status, 'completed');
    assert.equal(calls, 2);
});

test('malformed truthy authentication hook values cannot grant a role', async t => {
    for (const identity of [{}, [], 1, { principalId: '' }]) {
        const hub = new ProtocolHub({ port: 0, authenticate: () => identity });
        const { url } = await hub.start();
        const client = new Starlight({ url });
        t.after(async () => { client.close(); await hub.close(); });
        await assert.rejects(() => client.connect(), { code: 'UNAUTHORIZED' });
        assert.equal(client.registered, false);
    }
});
