const test = require('node:test');
const assert = require('node:assert/strict');

const { JWTHandler } = require('../../src/auth/jwt_handler');
const { SchemaValidator } = require('../../src/validation/schema_validator');
const { CBAHub } = require('../../src/hub');

const validator = new SchemaValidator();

test('canonical schema accepts valid registration, intent, and action messages', () => {
    const messages = [
        {
            jsonrpc: '2.0',
            method: 'starlight.registration',
            params: {
                layer: 'TestSentinel',
                role: 'sentinel',
                priority: 5,
                capabilities: [],
                selectors: [],
                version: '1.0.0'
            },
            id: 'reg-1'
        },
        {
            jsonrpc: '2.0',
            method: 'starlight.intent',
            params: { cmd: 'fill', selector: '#email', text: 'person@example.com' },
            id: 'intent-1'
        },
        {
            jsonrpc: '2.0',
            method: 'starlight.action',
            params: { cmd: 'select', selector: '#country', value: 'US' },
            id: 'action-1'
        }
    ];

    for (const message of messages) {
        assert.deepEqual(validator.validate(message), { valid: true, errors: [] });
    }
});

test('canonical schema accepts passive lowest-priority sentinel registration', () => {
    const message = {
        jsonrpc: '2.0',
        method: 'starlight.registration',
        params: {
            layer: 'DataSentinel',
            role: 'sentinel',
            priority: 10,
            capabilities: ['context-injection', 'data-extraction'],
            selectors: [],
            version: '1.0.0',
            authToken: null
        },
        id: 'reg-data-1'
    };

    assert.deepEqual(validator.validate(message), { valid: true, errors: [] });
});

test('canonical schema rejects sentinel registration outside protocol priority range', () => {
    const message = {
        jsonrpc: '2.0',
        method: 'starlight.registration',
        params: {
            layer: 'DataSentinel',
            role: 'sentinel',
            priority: 20,
            capabilities: ['context-injection', 'data-extraction'],
            selectors: [],
            version: '1.0.0',
            authToken: null
        },
        id: 'reg-data-invalid'
    };

    assert.equal(validator.validate(message).valid, false);
});

test('canonical schema rejects unknown, empty, and malformed requests', () => {
    const invalidMessages = [
        { jsonrpc: '2.0', method: 'starlight.unknown', params: {}, id: 'bad-1' },
        { jsonrpc: '2.0', method: 'starlight.intent', params: {}, id: 'bad-2' },
        { jsonrpc: '2.0', method: 'starlight.intent', params: { cmd: 'goto' }, id: 'bad-3' },
        { jsonrpc: '2.0', method: 'starlight.action', params: { cmd: 'fill' }, id: 'bad-4' },
        { jsonrpc: '2.0', method: 'starlight.intent', params: { cmd: 'click', selector: 'button' }, id: 5 }
    ];

    for (const message of invalidMessages) {
        assert.equal(validator.validate(message).valid, false);
    }
});

test('JWT verification rejects algorithm substitution', () => {
    const jwt = new JWTHandler({ secret: 'test-secret', expiresIn: 60 });
    const token = jwt.generateToken({ role: 'sentinel' });
    const [, payload, signature] = token.split('.');
    const header = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url');

    assert.throws(
        () => jwt.verifyToken(`${header}.${payload}.${signature}`),
        /Unsupported token algorithm/
    );
});

test('Hub authentication, role permissions, routing, and trace redaction are isolated', async (t) => {
    const hub = new CBAHub(18080, true);
    t.after(() => {
        hub.memoryLock.shutdown();
        hub.wss.close();
    });

    hub.authRequired = true;
    hub.authToken = 'shared-secret';
    assert.equal(hub.authenticateRegistration({}).authenticated, false);
    assert.equal(hub.authenticateRegistration({ authToken: 'shared-secret' }).authenticated, true);
    assert.equal(hub.isMethodAllowed('sentinel', 'starlight.intent'), false);
    assert.equal(hub.isMethodAllowed('intent', 'starlight.action'), false);
    assert.equal(hub.isMethodAllowed('admin', 'starlight.startRecording'), true);

    const originMessages = [];
    const otherMessages = [];
    const sentinelMessages = [];
    const openSocket = sink => ({
        readyState: 1,
        send: value => sink.push(JSON.parse(value))
    });

    hub.clients.set('origin', { ws: openSocket(originMessages), role: 'intent', authenticated: true });
    hub.clients.set('other', { ws: openSocket(otherMessages), role: 'intent', authenticated: true });
    hub.sentinels.set('sentinel', { ws: openSocket(sentinelMessages), priority: 1 });

    hub.completeCommand('origin', 'request-1', { success: true });
    assert.equal(originMessages[0].id, 'request-1');
    assert.equal(otherMessages.length, 0);
    assert.equal(sentinelMessages[0].type, 'COMMAND_COMPLETE');

    await hub.recordTrace('RECV', 'origin', {
        method: 'starlight.intent',
        params: { password: 'secret', email: 'person@example.com' }
    });
    const trace = JSON.stringify(hub.missionTrace.at(-1));
    assert.equal(trace.includes('secret'), false);
    assert.equal(trace.includes('person@example.com'), false);
});
