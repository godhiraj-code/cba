'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Ajv2020 = require('ajv/dist/2020');
const WebSocket = require('ws');
const {
    Coordinator,
    ERROR_CODES,
    ProtocolHub,
    Sentinel,
    Starlight
} = require('../../src/core');

test('the package default export is the lean protocol', () => {
    const packageApi = require('../..');
    assert.equal(packageApi.Coordinator, Coordinator);
    assert.equal(typeof packageApi.CBAHub, 'undefined');
});

test('the canonical schema accepts every core request shape', () => {
    const schema = require('../../schemas/starlight.core.schema.json');
    const validate = new Ajv2020({ strict: false }).compile(schema);
    const intent = { id: 'intent-1', goal: 'Verify checkout', context: {}, constraints: {} };
    const requests = [
        {
            jsonrpc: '2.0', id: '1', method: 'starlight.register',
            params: {
                role: 'sentinel', name: 'agent', protocolVersion: '1.0',
                priority: 10, capabilities: []
            }
        },
        { jsonrpc: '2.0', id: '2', method: 'starlight.intent', params: intent },
        { jsonrpc: '2.0', id: '3', method: 'starlight.offer', params: { intent } },
        {
            jsonrpc: '2.0', id: '4', method: 'starlight.execute',
            params: { intent, attempt: 1, claim: { score: 1 }, history: [] }
        },
        { jsonrpc: '2.0', method: 'starlight.cancel', params: { intentId: 'intent-1' } }
    ];

    for (const request of requests) {
        assert.equal(validate(request), true, JSON.stringify(validate.errors));
    }
});

test('an intent-only mission is handled by the best claiming sentinel', async () => {
    const coordinator = new Coordinator();
    const calls = [];

    coordinator.register({
        name: 'heuristic',
        priority: 1,
        offer: () => ({ score: 0.6 }),
        execute: () => {
            calls.push('heuristic');
            return { status: 'completed' };
        }
    });
    coordinator.register({
        name: 'computer-use',
        priority: 50,
        capabilities: ['desktop', 'vision'],
        offer: intent => ({ score: intent.goal.includes('invoice') ? 0.95 : 0.2 }),
        execute: _intent => {
            calls.push('computer-use');
            return {
                status: 'completed',
                value: { invoiceId: 'INV-42' },
                evidence: [{ kind: 'receipt', ref: 'memory://INV-42' }]
            };
        }
    });

    const result = await coordinator.dispatch('Create an invoice for Acme');

    assert.equal(result.status, 'completed');
    assert.equal(result.sentinel.name, 'computer-use');
    assert.deepEqual(result.value, { invoiceId: 'INV-42' });
    assert.deepEqual(calls, ['computer-use']);
});

test('a broken or slow offer cannot block a healthy sentinel', async () => {
    const coordinator = new Coordinator({ offerTimeoutMs: 10 });
    coordinator.register({
        name: 'stuck-agent',
        offer: () => new Promise(() => {}),
        execute: () => ({ status: 'completed' })
    });
    coordinator.register({
        name: 'healthy-agent',
        offer: () => {
            throw new Error('temporary scoring failure');
        },
        execute: () => ({ status: 'completed' })
    });
    coordinator.register({
        name: 'fallback-agent',
        offer: () => true,
        execute: () => ({ status: 'completed' })
    });

    const result = await coordinator.dispatch('Handle this safely');
    assert.equal(result.sentinel.name, 'fallback-agent');
});

test('caller cancellation reaches the active sentinel and stays terminal', async () => {
    const coordinator = new Coordinator({ executionTimeoutMs: 1_000 });
    const controller = new AbortController();
    const cancelled = new Error('mission cancelled');
    let sentinelObservedCancellation = false;

    coordinator.register({
        name: 'long-running-agent',
        offer: () => true,
        execute: (_intent, execution) => new Promise(resolve => {
            execution.signal.addEventListener('abort', () => {
                sentinelObservedCancellation = true;
                resolve({ status: 'completed' });
            }, { once: true });
            setTimeout(() => controller.abort(cancelled), 5);
        })
    });

    await assert.rejects(
        () => coordinator.dispatch('Perform long operation', { signal: controller.signal }),
        error => error === cancelled
    );
    assert.equal(sentinelObservedCancellation, true);
});

test('duplicate intent IDs reuse one execution and reject changed content', async () => {
    const coordinator = new Coordinator();
    let executions = 0;
    coordinator.register({
        name: 'idempotent-agent',
        offer: () => true,
        execute: async () => {
            executions++;
            await new Promise(resolve => setTimeout(resolve, 10));
            return { status: 'completed', value: executions };
        }
    });

    const intent = { id: 'stable-id', goal: 'Create one order', context: { sku: 'A' } };
    const [first, replay] = await Promise.all([
        coordinator.dispatch(intent),
        coordinator.dispatch({ ...intent, context: { sku: 'A' } })
    ]);

    assert.equal(executions, 1);
    assert.equal(first, replay);
    await assert.rejects(
        () => coordinator.dispatch({ ...intent, context: { sku: 'B' } }),
        error => error.code === ERROR_CODES.INTENT_CONFLICT
    );
});

test('a sentinel is execution-isolated unless it declares more capacity', async () => {
    const coordinator = new Coordinator();
    let active = 0;
    let maximumActive = 0;
    coordinator.register({
        name: 'single-device',
        capacity: 1,
        offer: () => true,
        execute: async () => {
            active++;
            maximumActive = Math.max(maximumActive, active);
            await new Promise(resolve => setTimeout(resolve, 10));
            active--;
            return { status: 'completed' };
        }
    });

    await Promise.all([
        coordinator.dispatch({ id: 'parallel-1', goal: 'First operation' }),
        coordinator.dispatch({ id: 'parallel-2', goal: 'Second operation' })
    ]);

    assert.equal(maximumActive, 1);
});

test('unhandled and retry outcomes provide controlled fallback', async () => {
    const coordinator = new Coordinator({ maxAttempts: 2 });
    let retryCount = 0;

    coordinator.register({
        name: 'specialist',
        offer: () => 1,
        execute: () => ({ status: 'unhandled' })
    });
    coordinator.register({
        name: 'mobile-agent',
        offer: () => 0.8,
        execute: () => {
            retryCount++;
            return retryCount === 1
                ? { status: 'retry', retryAfterMs: 0 }
                : { status: 'completed', evidence: { screen: 'checkout-complete' } };
        }
    });

    const result = await coordinator.dispatch('Complete checkout in the mobile app');

    assert.equal(result.sentinel.name, 'mobile-agent');
    assert.deepEqual(result.attempts.map(item => item.status), ['unhandled', 'retry', 'completed']);
});

test('a failed outcome is terminal and preserves evidence', async () => {
    const coordinator = new Coordinator();
    coordinator.register({
        name: 'policy',
        offer: () => true,
        execute: () => ({
            status: 'failed',
            error: 'Purchase exceeds the allowed budget',
            evidence: { limit: 100 }
        })
    });

    await assert.rejects(
        () => coordinator.dispatch('Buy the item', { executionTimeoutMs: 100 }),
        error => error.code === ERROR_CODES.INTENT_FAILED && error.details.evidence.limit === 100
    );
});

test('the WebSocket reference transport works across process boundaries', async t => {
    const hub = new ProtocolHub({ port: 0, offerTimeoutMs: 500, executionTimeoutMs: 1_000 });
    const address = await hub.start();
    const sentinel = new Sentinel({
        url: address.url,
        name: 'remote-llm',
        version: '1.2.0',
        capabilities: ['language', 'browser'],
        canHandle: intent => ({ score: intent.goal.includes('report') ? 0.9 : 0 }),
        handle: (intent, execution) => ({
            status: 'completed',
            value: { summary: intent.context.topic, attempt: execution.attempt },
            evidence: ['remote-handler-ran']
        })
    });
    const client = new Starlight({ url: address.url, name: 'intent-test' });

    t.after(async () => {
        client.close();
        sentinel.close();
        await hub.close();
    });

    await sentinel.connect();
    await client.connect();
    const result = await client.intent('Prepare the report', { topic: 'reliability' });

    assert.equal(result.status, 'completed');
    assert.equal(result.sentinel.name, 'remote-llm');
    assert.deepEqual(result.value, { summary: 'reliability', attempt: 1 });
});

test('a client reconnect replays safely after its response connection drops', async t => {
    const hub = new ProtocolHub({ port: 0 });
    const address = await hub.start();
    let executions = 0;
    const sentinel = new Sentinel({
        url: address.url,
        name: 'reconnect-agent',
        canHandle: () => true,
        handle: async () => {
            executions++;
            await new Promise(resolve => setTimeout(resolve, 30));
            return { status: 'completed', value: executions };
        }
    });
    const client = new Starlight({
        url: address.url,
        reconnectAttempts: 2,
        reconnectDelayMs: 10
    });
    t.after(async () => {
        client.close();
        sentinel.close();
        await hub.close();
    });
    await sentinel.connect();
    await client.connect();

    hub.coordinator.once('intent.received', () => {
        setTimeout(() => {
            const connection = [...hub.connections].find(item => item.role === 'client');
            connection?.socket.terminate();
        }, 5);
    });
    const result = await client.intent('Survive connection loss');

    assert.equal(result.status, 'completed');
    assert.equal(executions, 1);
});

test('Hub shutdown drains an active intent before closing peers', async () => {
    const hub = new ProtocolHub({ port: 0, shutdownTimeoutMs: 1_000 });
    const address = await hub.start();
    let started;
    const executionStarted = new Promise(resolve => { started = resolve; });
    const sentinel = new Sentinel({
        url: address.url,
        name: 'drain-agent',
        canHandle: () => true,
        handle: async () => {
            started();
            await new Promise(resolve => setTimeout(resolve, 20));
            return { status: 'completed' };
        }
    });
    const client = new Starlight({ url: address.url, reconnectAttempts: 0 });
    await sentinel.connect();
    await client.connect();

    const intent = client.intent('Finish before shutdown');
    await executionStarted;
    const closing = hub.close();
    const result = await intent;
    await closing;
    client.close();
    sentinel.close();

    assert.equal(result.status, 'completed');
});

test('Hub heartbeat evicts a stale Sentinel connection', async t => {
    const hub = new ProtocolHub({ port: 0, heartbeatIntervalMs: 10 });
    const address = await hub.start();
    const socket = new WebSocket(address.url, { autoPong: false });
    t.after(async () => {
        socket.terminate();
        await hub.close();
    });
    await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    });
    socket.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 'register-stale',
        method: 'starlight.register',
        params: {
            role: 'sentinel',
            name: 'stale-agent',
            protocolVersion: '1.0'
        }
    }));
    await new Promise(resolve => socket.once('message', resolve));
    assert.equal(hub.coordinator.list().length, 1);

    await new Promise(resolve => socket.once('close', resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(hub.coordinator.list().length, 0);
});

test('Hub security hooks authenticate, authorize, and rate-limit clients', async t => {
    const hub = new ProtocolHub({
        port: 0,
        authenticate: registration => registration.token === 'allowed',
        authorize: request => request.registration.name !== 'blocked-client',
        rateLimit: { max: 1, windowMs: 1_000 }
    });
    const address = await hub.start();
    const sentinel = new Sentinel({
        url: address.url,
        name: 'secure-agent',
        token: 'allowed',
        canHandle: () => true,
        handle: () => ({ status: 'completed' })
    });
    const client = new Starlight({
        url: address.url,
        token: 'allowed',
        reconnectAttempts: 0
    });
    const denied = new Starlight({ url: address.url, token: 'denied' });
    const blocked = new Starlight({
        url: address.url,
        name: 'blocked-client',
        token: 'allowed',
        reconnectAttempts: 0
    });
    t.after(async () => {
        client.close();
        denied.close();
        blocked.close();
        sentinel.close();
        await hub.close();
    });

    await assert.rejects(() => denied.connect(), error => error.code === ERROR_CODES.UNAUTHORIZED);
    await sentinel.connect();
    await client.connect();
    await blocked.connect();
    await assert.rejects(
        () => blocked.intent('Not authorized'),
        error => error.code === ERROR_CODES.UNAUTHORIZED
    );
    await client.intent('Allowed once');
    await assert.rejects(
        () => client.intent('Rate limited next'),
        error => error.code === ERROR_CODES.RATE_LIMITED && error.details.retryAfterMs > 0
    );
});
