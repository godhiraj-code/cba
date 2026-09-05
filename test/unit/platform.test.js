'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentPlatform, ProtocolHub, Sentinel, digestToken } = require('../..');

test('a mission routes steps to separate agents and passes verified results forward', async () => {
    const platform = new AgentPlatform();
    platform.register({
        name: 'producer', canHandle: intent => intent.goal === 'Produce',
        run: intent => ({ status: 'completed', value: { total: intent.context.amount * 2 } }),
        verify: (_intent, outcome) => outcome.value.total === 12
    });
    platform.register({
        name: 'consumer', canHandle: intent => intent.goal === 'Consume',
        run: intent => {
            assert.deepEqual(intent.constraints, { max: 20, min: 0 });
            assert.equal(intent.context.mission.results[0].value.total, 12);
            assert.throws(() => { intent.context.mission.results[0].value.total = 100; });
            return { status: 'completed', evidence: ['consumed'] };
        }
    });
    const report = await platform.run({
        goal: 'Produce and consume', context: { amount: 6 }, constraints: { max: 20 },
        steps: ['Produce', { goal: 'Consume', constraints: { min: 0 } }]
    });
    assert.equal(report.status, 'completed');
    assert.deepEqual(report.steps.map(step => step.result.sentinel.name), ['producer', 'consumer']);
    assert.deepEqual(platform.getRun(report.id), report);
    assert.throws(() => { report.steps[0].result.value.total = -1; });
});

test('failed verification is terminal and does not run later steps or fallback agents', async () => {
    const platform = new AgentPlatform();
    let calls = 0;
    platform.register({
        name: 'false-success', canHandle: () => 1,
        run: () => { calls++; return { status: 'completed', evidence: ['attempt'] }; },
        verify: () => false
    });
    platform.register({ name: 'fallback', canHandle: () => 0.5,
        run: () => { calls++; return { status: 'completed' }; } });
    const report = await platform.run({ goal: 'Verify before continuing', steps: ['first', 'second'] });
    assert.equal(report.status, 'failed');
    assert.equal(report.error.code, 'INTENT_FAILED');
    assert.match(report.error.message, /failed completion verification/);
    assert.deepEqual(report.error.details.evidence, ['attempt']);
    assert.equal(report.steps.length, 1);
    assert.equal(calls, 1);
});

test('agent exceptions do not repeat a potentially completed side effect elsewhere', async () => {
    const platform = new AgentPlatform();
    let effects = 0;
    platform.register({ name: 'primary', canHandle: () => 1,
        run: () => { effects++; throw new Error('response was lost'); } });
    platform.register({ name: 'fallback', canHandle: () => 0.5,
        run: () => { effects++; return { status: 'completed' }; } });
    const report = await platform.run('Create once');
    assert.equal(report.status, 'failed');
    assert.equal(effects, 1);
});

test('platform timeouts stop the mission and quarantine agents that ignore cancellation', async () => {
    const platform = new AgentPlatform({ coordinatorOptions: { executionTimeoutMs: 10 } });
    let effects = 0;
    platform.register({ name: 'stuck', canHandle: () => 1,
        run: () => { effects++; return new Promise(() => {}); } });
    platform.register({ name: 'fallback', canHandle: () => 0.5,
        run: () => { effects++; return { status: 'completed' }; } });
    const report = await platform.run('Do bounded work');
    assert.equal(report.status, 'failed');
    assert.equal(report.error.code, 'TIMEOUT');
    assert.equal(effects, 1);
    assert.equal(platform.agents()[0].active, 1);
});

test('cancelling a running mission reaches the agent and prevents subsequent steps', async () => {
    const platform = new AgentPlatform();
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    let observed = false;
    platform.register({ name: 'worker', canHandle: () => true,
        run: (_intent, { signal }) => new Promise(resolve => {
            started();
            signal.addEventListener('abort', () => {
                observed = true;
                resolve({ status: 'completed' });
            }, { once: true });
        }) });
    const handle = platform.submit({ goal: 'Work', steps: ['First', 'Second'] });
    await ready;
    assert.equal(platform.getRun(handle.id).steps[0].status, 'running');
    assert.equal(handle.cancel(), true);
    const report = await handle.done;
    assert.equal(report.status, 'cancelled');
    assert.equal(report.steps.length, 1);
    assert.equal(observed, true);
    assert.equal(handle.cancel(), false);
});

test('pre-cancelled runs never execute and retained history is bounded', async () => {
    const platform = new AgentPlatform({ maxRuns: 1 });
    const cancelled = new AbortController();
    cancelled.abort();
    const first = await platform.run('Cancelled', { signal: cancelled.signal });
    assert.equal(first.status, 'cancelled');
    assert.equal(first.steps.length, 0);
    const second = await platform.run('No available agent');
    assert.equal(second.status, 'failed');
    assert.equal(second.error.code, 'NO_SENTINEL');
    assert.equal(platform.getRun(first.id), undefined);
    assert.equal(platform.listRuns().length, 1);
});

test('invalid plans are rejected before any agent runs', () => {
    const platform = new AgentPlatform();
    for (const mission of [
        { goal: 'x', steps: [] },
        { goal: 'x', steps: ['valid', ''] },
        { goal: 'x', context: { mission: {} } },
        { goal: 'x', constraints: { max: 1 }, steps: [{ goal: 'y', constraints: { max: 2 } }] },
        { goal: 'x', steps: [{ id: 'reuse-id', goal: 'y' }] },
        { goal: 'x', steps: Array(101).fill('y') }
    ]) assert.throws(() => platform.submit(mission), error => error.code === 'INVALID_REQUEST');
    assert.deepEqual(platform.listRuns(), []);
});

test('concurrent missions share agent capacity; active history cannot be evicted', async () => {
    const platform = new AgentPlatform({ maxRuns: 2 });
    let active = 0;
    let peak = 0;
    platform.register({ name: 'single-resource', canHandle: () => true,
        run: async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active--;
            return { status: 'completed' };
        } });
    const first = platform.submit('First');
    const second = platform.submit('Second');
    assert.throws(() => platform.submit('Third'), error => error.code === 'RESOURCE_EXHAUSTED');
    assert.deepEqual((await Promise.all([first.done, second.done])).map(run => run.status), ['completed', 'completed']);
    assert.equal(peak, 1);
});

test('platform missions route through authenticated remote agents on a shared Hub', async t => {
    const platform = new AgentPlatform();
    const token = 'platform-remote-test-0000000000';
    const hub = new ProtocolHub({ port: 0, coordinator: platform.coordinator, tokenDigests: [digestToken(token)] });
    const { url } = await hub.start();
    const remote = new Sentinel({ url, token, name: 'remote', canHandle: () => true,
        handle: intent => ({ status: 'completed', value: intent.context.mission.step }) });
    t.after(async () => { remote.close(); await hub.close(); });
    await remote.connect();
    const report = await platform.run({ goal: 'Remote workflow', steps: ['First', 'Second'] });
    assert.equal(report.status, 'completed');
    assert.deepEqual(report.steps.map(step => step.result.value), [1, 2]);
    assert(report.steps.every(step => step.result.sentinel.name === 'remote'));
});

test('a verifier exception preserves evidence and the underlying error in the run report', async () => {
    const platform = new AgentPlatform();
    platform.register({ name: 'checked', canHandle: () => true,
        run: () => ({ status: 'completed', evidence: ['artifact-before-check'] }),
        verify: () => { throw new Error('verification service unavailable'); } });
    const report = await platform.run('Check the artifact');
    assert.equal(report.status, 'failed');
    assert.deepEqual(report.error.details.evidence, ['artifact-before-check']);
    assert.equal(report.error.details.cause.code, 'AGENT_ERROR');
    assert.equal(report.steps[0].error.details.attempts.length, 1);
});
