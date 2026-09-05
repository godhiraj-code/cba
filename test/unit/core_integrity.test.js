'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Coordinator } = require('../../src/core');

test('replay at full history capacity preserves the existing execution', async () => {
    const coordinator = new Coordinator({ maxIntentHistory: 1 });
    let calls = 0;
    coordinator.register({ name: 'worker', offer: () => true,
        execute: () => ({ status: 'completed', value: ++calls }) });
    const intent = { id: 'same', goal: 'Run once' };
    const first = await coordinator.dispatch(intent);
    assert.equal(await coordinator.dispatch(intent), first);
    await assert.rejects(() => coordinator.dispatch({ ...intent, goal: 'Changed' }), { code: 'INTENT_CONFLICT' });
    assert.equal(calls, 1);
    await coordinator.dispatch({ id: 'new', goal: 'Make room for new work' });
    assert.equal(calls, 2);
});

test('nested intent and outcome data are independent immutable snapshots', async () => {
    const coordinator = new Coordinator();
    const source = { id: 'immutable', goal: 'Keep bounds', constraints: { budget: { max: 10 } } };
    const output = { list: [42] };
    coordinator.register({ name: 'worker', offer: intent => {
        assert.throws(() => { intent.constraints.budget.max = 100; });
        return true;
    }, execute: intent => {
        assert.equal(intent.constraints.budget.max, 10);
        return { status: 'completed', value: output };
    } });
    const pending = coordinator.dispatch(source);
    source.constraints.budget.max = 200;
    const result = await pending;
    output.list[0] = 0;
    assert.deepEqual(result.value, { list: [42] });
    assert.throws(() => { result.value.list.push(0); });
});

test('non-JSON local intent data and unbounded execution overrides are rejected', async () => {
    const coordinator = new Coordinator();
    const cyclic = {}; cyclic.self = cyclic;
    for (const value of [NaN, Infinity, undefined, () => {}, cyclic, new Date()]) {
        assert.throws(() => coordinator.dispatch({ goal: 'invalid', context: { value } }), { code: 'INVALID_REQUEST' });
    }
    for (const options of [{ maxAttempts: Infinity }, { maxAttempts: 0 }, { executionTimeoutMs: -1 },
        { offerTimeoutMs: Infinity }, { schedulingTimeoutMs: 0 }]) {
        await assert.rejects(() => coordinator.dispatch('invalid override', options), { code: 'INVALID_REQUEST' });
    }
});
