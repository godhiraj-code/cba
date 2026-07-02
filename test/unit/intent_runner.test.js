const test = require('node:test');
const assert = require('node:assert/strict');

class MockWebSocket {
    static OPEN = 1;
    static isMock = true;

    constructor(url) {
        this.url = url;
        this.readyState = MockWebSocket.OPEN;
        this.listeners = new Map();
        this.sent = [];
        queueMicrotask(() => this.emit('open', {}));
    }

    addEventListener(event, handler) {
        const handlers = this.listeners.get(event) || [];
        handlers.push(handler);
        this.listeners.set(event, handlers);
    }

    emit(event, value) {
        for (const handler of this.listeners.get(event) || []) handler(value);
    }

    send(raw) {
        const message = JSON.parse(raw);
        this.sent.push(message);
        if (message.method === 'starlight.registration') {
            queueMicrotask(() => this.respond(message.id, {
                registered: true,
                role: 'intent'
            }));
        } else if (message.method === 'starlight.intent') {
            queueMicrotask(() => this.respond(message.id, {
                success: true,
                command: message.params.cmd
            }));
        } else if (message.method === 'starlight.getPageContext') {
            queueMicrotask(() => this.respond(message.id, {
                title: 'Example',
                inputs: []
            }));
        }
    }

    respond(id, result) {
        this.emit('message', {
            data: JSON.stringify({ jsonrpc: '2.0', id, result })
        });
    }

    close() {
        this.readyState = 3;
        this.emit('close', {});
    }
}

global.WebSocket = MockWebSocket;
const IntentRunner = require('../../src/intent_runner');

test('IntentRunner registers before sending commands and resolves by request ID', async () => {
    const runner = new IntentRunner({ authToken: 'token', layer: 'TestIntent' });
    await runner.connect();

    assert.equal(runner.ws.sent[0].method, 'starlight.registration');
    assert.equal(runner.ws.sent[0].params.role, 'intent');
    assert.equal(runner.ws.sent[0].params.authToken, 'token');

    const result = await runner.goto('https://example.com');
    assert.equal(result.success, true);
    assert.equal(result.command, 'goto');

    const context = await runner.requestPageContext();
    assert.equal(context.title, 'Example');
    runner.close();
});

test('IntentRunner rejects commands when disconnected', async () => {
    const runner = new IntentRunner();
    await assert.rejects(() => runner.click('#submit'), /not connected/);
});

test('IntentRunner uses HUB_URL when no hub URL is passed', () => {
    const previous = process.env.HUB_URL;
    process.env.HUB_URL = 'ws://127.0.0.1:19090';
    try {
        const runner = new IntentRunner();
        assert.equal(runner.hubUrl, 'ws://127.0.0.1:19090');
    } finally {
        if (previous === undefined) {
            delete process.env.HUB_URL;
        } else {
            process.env.HUB_URL = previous;
        }
    }
});
