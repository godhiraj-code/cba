'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const {
    ERROR_CODES,
    METHODS,
    OUTCOME_STATUSES,
    PROTOCOL_VERSION
} = require('../src/core');
const { normalizeOutcome } = require('../src/core/contract');

const root = path.resolve(__dirname, '..');
const schema = require('../schemas/starlight.core.schema.json');
const validate = new Ajv2020({ strict: false }).compile(schema);
const spec = fs.readFileSync(path.join(root, 'spec/STARLIGHT_CORE_PROTOCOL.md'), 'utf8');
const types = fs.readFileSync(path.join(root, 'types/core.d.ts'), 'utf8');

assert.equal(PROTOCOL_VERSION, '1.0');
assert.match(schema.title, /5\.x/);
assert.match(spec, new RegExp(`wire contract ${PROTOCOL_VERSION.replace('.', '\\.')}`, 'i'));
assert.match(types, /export type IntentResult/);

for (const method of Object.values(METHODS)) {
    assert.match(JSON.stringify(schema), new RegExp(method.replace('.', '\\.')));
    assert.match(spec, new RegExp(method.replace('.', '\\.')));
}
for (const status of OUTCOME_STATUSES) {
    assert.match(JSON.stringify(schema), new RegExp(status));
    assert.match(spec, new RegExp(`\`${status}\``));
}
for (const code of Object.values(ERROR_CODES)) {
    assert.match(spec, new RegExp(`\`${code}\``));
}

const intent = { id: 'contract-1', goal: 'Verify contract', context: {}, constraints: {} };
const fixtures = [
    {
        jsonrpc: '2.0',
        id: '1',
        method: METHODS.REGISTER,
        params: {
            role: 'sentinel',
            name: 'contract-sentinel',
            protocolVersion: PROTOCOL_VERSION,
            token: 'contract-token-0000000000'
        }
    },
    { jsonrpc: '2.0', id: '2', method: METHODS.INTENT, params: intent },
    { jsonrpc: '2.0', id: '3', method: METHODS.OFFER, params: { intent } },
    {
        jsonrpc: '2.0',
        id: '4',
        method: METHODS.EXECUTE,
        params: { intent, attempt: 1, claim: { score: 1 }, history: [] }
    },
    { jsonrpc: '2.0', method: METHODS.CANCEL, params: { intentId: intent.id } },
    { jsonrpc: '2.0', id: '3', result: { score: 0.9, reason: 'fixture' } },
    { jsonrpc: '2.0', id: '4', result: { status: 'retry', retryAfterMs: 10 } }
];
for (const fixture of fixtures) {
    assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
}

const invalid = [
    { ...fixtures[1], extra: true },
    { ...fixtures[1], params: { ...intent, unknown: true } },
    { jsonrpc: '2.0', id: 'x', result: { status: 'completed', retryAfterMs: 1 } },
    { jsonrpc: '2.0', id: 'x', result: { status: 'failed' } },
    {
        jsonrpc: '2.0', id: 'client-with-sentinel-fields', method: METHODS.REGISTER,
        params: { role: 'client', name: 'client', protocolVersion: '1.0', capacity: 1 }
    },
    {
        jsonrpc: '2.0', id: 'numeric-version', method: METHODS.REGISTER,
        params: { role: 'client', name: 'client', protocolVersion: 1 }
    },
    {
        jsonrpc: '2.0', id: 'routed-without-id', method: METHODS.OFFER,
        params: { intent: { goal: 'missing Hub-assigned id' } }
    }
];
for (const fixture of invalid) {
    assert.equal(validate(fixture), false, `schema accepted ${JSON.stringify(fixture)}`);
}

const invalidOutcomes = [
    { status: 'completed', error: 'ambiguous' },
    { status: 'unhandled', value: 42 },
    { status: 'failed', error: '' },
    { status: 'failed', error: { arbitrary: true } }
];
for (const outcome of invalidOutcomes) {
    assert.throws(() => normalizeOutcome(outcome));
    assert.equal(
        validate({ jsonrpc: '2.0', id: 'runtime-parity', result: outcome }),
        false,
        `schema accepted runtime-invalid outcome ${JSON.stringify(outcome)}`
    );
}

process.stdout.write(
    `contract alignment: ${fixtures.length} valid, ${invalid.length + invalidOutcomes.length} invalid fixtures\n`
);
