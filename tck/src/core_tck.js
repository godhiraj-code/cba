'use strict';

const crypto = require('node:crypto');
const WebSocket = require('ws');

class WirePeer {
    constructor(url) {
        this.url = url;
        this.socket = null;
        this.pending = new Map();
        this.handlers = new Map();
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = new WebSocket(this.url);
            this.socket.once('open', resolve);
            this.socket.once('error', reject);
            this.socket.on('message', raw => this.onMessage(raw));
        });
    }

    handle(method, handler) {
        this.handlers.set(method, handler);
        return this;
    }

    call(method, params) {
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`TCK request '${method}' timed out`));
            }, 3_000);
            this.pending.set(id, { resolve, reject, timer });
            this.send({ jsonrpc: '2.0', id, method, params });
        });
    }

    send(message) {
        this.socket.send(JSON.stringify(message));
    }

    async onMessage(raw) {
        const message = JSON.parse(raw.toString());
        if (message.id !== undefined && (Object.hasOwn(message, 'result') || message.error)) {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            if (message.error) {
                const error = new Error(message.error.message);
                error.code = message.error.data?.protocolCode || String(message.error.code);
                pending.reject(error);
            } else {
                pending.resolve(message.result);
            }
            return;
        }

        const handler = this.handlers.get(message.method);
        if (!handler) return;
        try {
            const result = await handler(message.params || {});
            if (message.id !== undefined) {
                this.send({ jsonrpc: '2.0', id: message.id, result: result ?? null });
            }
        } catch (error) {
            if (message.id !== undefined) {
                this.send({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                        code: -32603,
                        message: error.message,
                        data: { protocolCode: 'TCK_HANDLER_ERROR' }
                    }
                });
            }
        }
    }

    close() {
        if (!this.socket || this.socket.readyState > WebSocket.OPEN) return Promise.resolve();
        return new Promise(resolve => {
            this.socket.once('close', resolve);
            this.socket.close(1000, 'TCK complete');
        });
    }
}

function check(results, name, condition, details) {
    results.push({ name, passed: Boolean(condition), details });
    if (!condition) throw new Error(`${name}: ${details || 'check failed'}`);
}

async function expectProtocolError(operation, code) {
    try {
        await operation();
        return false;
    } catch (error) {
        return error.code === code;
    }
}

async function runCoreTck(options = {}) {
    let hub;
    let url = options.url;
    const token = options.token || 'starlight-tck-token-000000000000';
    if (!url) {
        const { ProtocolHub, digestToken } = require('../../src/core');
        hub = new ProtocolHub({
            port: 0,
            tokenDigests: [digestToken(token)],
            offerTimeoutMs: 100,
            executionTimeoutMs: 100,
            maxAttempts: 2
        });
        url = (await hub.start()).url;
    }

    const results = [];
    const peers = [];
    try {
        const incompatible = new WirePeer(url);
        peers.push(incompatible);
        await incompatible.connect();
        check(
            results,
            'rejects incompatible protocol versions',
            await expectProtocolError(
                () => incompatible.call('starlight.register', {
                    role: 'client', name: 'incompatible', protocolVersion: '99.0', token
                }),
                'UNSUPPORTED_VERSION'
            )
        );

        const anonymous = new WirePeer(url);
        peers.push(anonymous);
        await anonymous.connect();
        check(
            results,
            'rejects intents from unregistered connections',
            await expectProtocolError(
                () => anonymous.call('starlight.intent', { goal: 'not authorized' }),
                'FORBIDDEN'
            )
        );

        const unauthorized = new WirePeer(url);
        peers.push(unauthorized);
        await unauthorized.connect();
        check(
            results,
            'rejects invalid credentials',
            await expectProtocolError(
                () => unauthorized.call('starlight.register', {
                    role: 'client',
                    name: 'unauthorized',
                    protocolVersion: '1.0',
                    token: 'wrong-token-000000000000000000'
                }),
                'UNAUTHORIZED'
            )
        );

        const malformed = new WirePeer(url);
        peers.push(malformed);
        await malformed.connect();
        const malformedClosed = new Promise(resolve => malformed.socket.once('close', resolve));
        malformed.socket.send('not-json');
        await malformedClosed;
        check(results, 'closes malformed JSON peers with a policy violation', malformed.socket.readyState === WebSocket.CLOSED);

        let executions = 0;
        let active = 0;
        let maximumActive = 0;
        let retryExecutions = 0;
        let finishNoncooperative;
        const cancelledExecutions = new Map();
        const sentinel = new WirePeer(url);
        peers.push(sentinel);
        sentinel
            .handle('starlight.offer', () => ({ score: 0.9, reason: 'TCK sentinel' }))
            .handle('starlight.execute', async ({ intent }) => {
                executions++;
                active++;
                maximumActive = Math.max(maximumActive, active);
                if (intent.goal === 'Noncooperative timeout') {
                    return new Promise(resolve => { finishNoncooperative = () => {
                        active--;
                        resolve({ status: 'completed' });
                    }; });
                }
                if (intent.goal === 'Terminal failure') {
                    active--;
                    return { status: 'failed', error: { message: 'expected failure' }, evidence: ['failure'] };
                }
                if (intent.goal === 'Unhandled') {
                    active--;
                    return { status: 'unhandled' };
                }
                if (intent.goal === 'Retry once') {
                    retryExecutions++;
                    active--;
                    return retryExecutions === 1
                        ? { status: 'retry', retryAfterMs: 1 }
                        : { status: 'completed', evidence: ['retried'] };
                }
                if (intent.goal === 'Cancel active' || intent.goal === 'Timeout') {
                    return new Promise(resolve => cancelledExecutions.set(intent.id, () => {
                        active--;
                        resolve({ status: 'completed' });
                    }));
                }
                await new Promise(resolve => setTimeout(resolve, 20));
                active--;
                return { status: 'completed', value: { executions }, evidence: ['tck'] };
            })
            .handle('starlight.cancel', ({ intentId }) => cancelledExecutions.get(intentId)?.());
        await sentinel.connect();
        const registration = await sentinel.call('starlight.register', {
            role: 'sentinel',
            name: `tck-sentinel-${crypto.randomUUID()}`,
            version: '1.0.0',
            protocolVersion: '1.0',
            priority: 10,
            capacity: 1,
            capabilities: ['tck'],
            token
        });
        check(results, 'registers a Sentinel', registration.registered === true);

        const client = new WirePeer(url);
        peers.push(client);
        await client.connect();
        await client.call('starlight.register', {
            role: 'client', name: 'tck-client', protocolVersion: '1.0', token
        });

        const stableIntent = { id: `tck-intent-${crypto.randomUUID()}`, goal: 'Complete TCK intent' };
        const completed = await client.call('starlight.intent', stableIntent);
        check(results, 'routes and completes an intent', completed.status === 'completed');
        check(results, 'returns Sentinel identity', completed.sentinel?.name?.startsWith('tck-sentinel-'));
        check(results, 'returns evidence', completed.evidence?.[0] === 'tck');

        const replay = await client.call('starlight.intent', stableIntent);
        check(results, 'replays an intent without repeating side effects', executions === 1 && replay.value.executions === 1);
        check(
            results,
            'rejects reuse of an intent ID with changed content',
            await expectProtocolError(
                () => client.call('starlight.intent', { ...stableIntent, goal: 'Different goal' }),
                'INTENT_CONFLICT'
            )
        );

        await Promise.all([
            client.call('starlight.intent', { id: crypto.randomUUID(), goal: 'Concurrent A' }),
            client.call('starlight.intent', { id: crypto.randomUUID(), goal: 'Concurrent B' })
        ]);
        check(results, 'honors Sentinel capacity', maximumActive === 1, `maximum active executions: ${maximumActive}`);

        check(
            results,
            'failed outcomes are terminal',
            await expectProtocolError(
                () => client.call('starlight.intent', { id: crypto.randomUUID(), goal: 'Terminal failure' }),
                'INTENT_FAILED'
            )
        );
        check(
            results,
            'unhandled outcomes exhaust fallback deterministically',
            await expectProtocolError(
                () => client.call('starlight.intent', { id: crypto.randomUUID(), goal: 'Unhandled' }),
                'NO_SENTINEL'
            )
        );
        const retried = await client.call(
            'starlight.intent',
            { id: crypto.randomUUID(), goal: 'Retry once' }
        );
        check(
            results,
            'retry outcomes obey the attempt budget',
            retried.status === 'completed' && retryExecutions === 2
        );

        const cancellationId = crypto.randomUUID();
        const activeIntent = client.call(
            'starlight.intent',
            { id: cancellationId, goal: 'Cancel active' }
        );
        await new Promise(resolve => setTimeout(resolve, 20));
        const cancellation = await client.call('starlight.cancel', { intentId: cancellationId });
        check(results, 'cancellation is acknowledged', cancellation.cancelled === true);
        check(
            results,
            'cancellation is terminal and propagates to the Sentinel',
            await expectProtocolError(() => activeIntent, 'CANCELLED')
        );

        const timeoutStartedAt = Date.now();
        check(
            results,
            'execution timeout is bounded and cleans up the remote attempt',
            await expectProtocolError(
                () => client.call('starlight.intent', { id: crypto.randomUUID(), goal: 'Timeout' }),
                'NO_SENTINEL'
            ) && Date.now() - timeoutStartedAt < 1_000
        );

        await expectProtocolError(() => client.call('starlight.intent', {
            id: crypto.randomUUID(), goal: 'Noncooperative timeout'
        }), 'NO_SENTINEL');
        const callsBeforeBusy = executions;
        const busy = await expectProtocolError(() => client.call('starlight.intent', {
            id: crypto.randomUUID(), goal: 'Must wait for old tool'
        }), 'NO_SENTINEL');
        check(results, 'timed-out remote work retains its capacity until it settles',
            busy && executions === callsBeforeBusy && active === 1);
        finishNoncooperative();
        const recovered = await client.call('starlight.intent', { id: crypto.randomUUID(), goal: 'After settlement' });
        check(results, 'remote capacity recovers after the late outcome', recovered.status === 'completed');

        return {
            protocolVersion: registration.protocolVersion,
            passed: results.length,
            failed: 0,
            results
        };
    } finally {
        await Promise.all(peers.map(peer => peer.close()));
        await hub?.close();
    }
}

if (require.main === module) {
    const urlArg = process.argv.find(argument => argument.startsWith('--url='));
    const tokenArg = process.argv.find(argument => argument.startsWith('--token='));
    runCoreTck({
        url: urlArg?.slice('--url='.length),
        token: tokenArg?.slice('--token='.length)
    }).then(report => {
        console.log(JSON.stringify(report, null, 2));
    }).catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { runCoreTck };
