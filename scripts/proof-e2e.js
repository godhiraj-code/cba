'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const apiPath = path.resolve(__dirname, '..', 'src', 'core');
const role = process.argv[2];

async function runRole() {
    const { ProtocolHub, Sentinel, Starlight, digestToken } = require(apiPath);
    if (role === 'hub') {
        const hub = new ProtocolHub({
            host: '127.0.0.1',
            port: 0,
            tokenDigests: [digestToken(process.env.STARLIGHT_PROOF_TOKEN)]
        });
        const address = await hub.start();
        process.send({ type: 'ready', url: address.url });
        const stop = async () => { await hub.close(); process.exit(0); };
        process.on('message', message => { if (message === 'stop') stop(); });
        process.once('SIGTERM', stop);
        return;
    }
    if (role === 'sentinel') {
        const sentinel = new Sentinel({
            url: process.env.STARLIGHT_PROOF_URL,
            token: process.env.STARLIGHT_PROOF_TOKEN,
            id: 'proof-sentinel-id',
            name: 'proof-sentinel',
            version: '1.0.0',
            capabilities: ['proof'],
            canHandle: () => ({ score: 0.99, reason: 'deterministic proof handler' }),
            handle: intent => {
                const count = Number(fs.readFileSync(process.env.STARLIGHT_PROOF_COUNTER, 'utf8'));
                fs.writeFileSync(process.env.STARLIGHT_PROOF_COUNTER, String(count + 1));
                return {
                    status: 'completed',
                    value: { echoed: intent.goal },
                    evidence: [{ kind: 'proof', ref: 'process-boundary' }]
                };
            }
        });
        await sentinel.connect();
        process.send({ type: 'ready' });
        const stop = () => { sentinel.close(); process.exit(0); };
        process.on('message', message => { if (message === 'stop') stop(); });
        process.once('SIGTERM', stop);
        return;
    }
    if (role === 'client') {
        const client = new Starlight({
            url: process.env.STARLIGHT_PROOF_URL,
            token: process.env.STARLIGHT_PROOF_TOKEN,
            reconnectAttempts: 0
        });
        await client.connect();
        const intent = {
            id: process.env.STARLIGHT_PROOF_INTENT,
            goal: 'return the deterministic proof value',
            context: { proof: true },
            constraints: {}
        };
        const first = await client.intent(intent);
        const replay = await client.intent(intent);
        client.close();
        process.send({ type: 'result', first, replay });
        return;
    }
    throw new Error(`unknown proof role: ${role}`);
}

if (role) {
    runRole().catch(error => {
        if (process.send) process.send({ type: 'error', error: error.stack || error.message });
        process.exit(1);
    });
} else {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'starlight-proof-'));
    const counter = path.join(temporary, 'side-effects.txt');
    fs.writeFileSync(counter, '0');
    const token = crypto.randomBytes(32).toString('base64url');
    const children = new Set();

    const child = (childRole, extraEnv = {}) => {
        const processHandle = spawn(process.execPath, [__filename, childRole], {
            env: {
                ...process.env,
                ...extraEnv,
                STARLIGHT_PROOF_TOKEN: token,
                STARLIGHT_PROOF_COUNTER: counter
            },
            stdio: ['ignore', 'ignore', 'pipe', 'ipc']
        });
        children.add(processHandle);
        let stderr = '';
        processHandle.stderr.on('data', chunk => { stderr += chunk; });
        processHandle.on('error', () => {});
        processHandle.once('exit', () => children.delete(processHandle));
        processHandle.proofStderr = () => stderr;
        return processHandle;
    };

    const message = (processHandle, expected, timeoutMs = 10_000) => {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(
                `${expected} timed out: ${processHandle.proofStderr()}`
            )), timeoutMs);
            const onMessage = value => {
                if (value.type === 'error') {
                    clearTimeout(timer);
                    reject(new Error(value.error));
                } else if (value.type === expected) {
                    clearTimeout(timer);
                    resolve(value);
                }
            };
            processHandle.on('message', onMessage);
            processHandle.once('exit', code => {
                clearTimeout(timer);
                reject(new Error(`${expected} process exited ${code}: ${processHandle.proofStderr()}`));
            });
        });
    };

    (async () => {
        const hub = child('hub');
        const { url } = await message(hub, 'ready');
        const sentinel = child('sentinel', { STARLIGHT_PROOF_URL: url });
        await message(sentinel, 'ready');
        const client = child('client', {
            STARLIGHT_PROOF_URL: url,
            STARLIGHT_PROOF_INTENT: crypto.randomUUID()
        });
        const { first, replay } = await message(client, 'result');
        assert.deepEqual(replay, first);
        assert.deepEqual(first.value, { echoed: 'return the deterministic proof value' });
        assert.equal(first.sentinel.id, 'proof-sentinel-id');
        assert.equal(first.sentinel.name, 'proof-sentinel');
        assert.equal(first.attempts.length, 1);
        assert.equal(first.attempts[0].status, 'completed');
        assert.deepEqual(first.evidence, [{ kind: 'proof', ref: 'process-boundary' }]);
        assert.equal(Number(fs.readFileSync(counter, 'utf8')), 1);
        process.stdout.write(JSON.stringify({
            ok: true,
            proof: 'process-websocket-e2e',
            sentinelId: first.sentinel.id,
            attempts: first.attempts.length,
            evidence: first.evidence.length,
            replaySideEffects: 1
        }) + '\n');
    })().catch(error => {
        process.stderr.write(`${error.stack || error}\n`);
        process.exitCode = 1;
    }).finally(async () => {
        for (const processHandle of children) {
            if (processHandle.connected && processHandle.exitCode === null) {
                processHandle.send('stop', () => {});
            }
        }
        await Promise.all([...children].map(processHandle => new Promise(resolve => {
            const timer = setTimeout(() => {
                processHandle.kill('SIGTERM');
                resolve();
            }, 2_000);
            processHandle.once('exit', () => { clearTimeout(timer); resolve(); });
        })));
        fs.rmSync(temporary, { recursive: true, force: true });
    });
}
