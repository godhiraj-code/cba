const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ProtocolObjectiveRunner,
    discoverSentinels,
    normalizeUrl,
    parseCliArgs
} = require('../../src/protocol_objective');

test('normalizeUrl preserves explicit schemes and defaults bare domains to https', () => {
    assert.equal(normalizeUrl('https://example.com'), 'https://example.com');
    assert.equal(normalizeUrl('http://example.com'), 'http://example.com');
    assert.equal(normalizeUrl('file:///tmp/app.html'), 'file:///tmp/app.html');
    assert.equal(normalizeUrl('example.com/path'), 'https://example.com/path');
});

test('parseCliArgs supports mission, URL, and plain-language objectives', () => {
    assert.deepEqual(parseCliArgs(['test/intent_saucedemo.js', '--headless']).missionPath, 'test/intent_saucedemo.js');

    const urlOptions = parseCliArgs(['--url', 'example.com', '--intent', 'click Login', '--sentinels', 'pulse,janitor']);
    assert.equal(urlOptions.url, 'example.com');
    assert.equal(urlOptions.intent, 'click Login');
    assert.equal(urlOptions.sentinels, 'pulse,janitor');

    const intentOptions = parseCliArgs(['go to example.com and verify the login button']);
    assert.equal(intentOptions.intent, 'go to example.com and verify the login button');
});

test('discoverSentinels resolves production default and excludes vision unless requested', () => {
    const defaults = discoverSentinels(process.cwd(), 'default');
    const defaultFiles = defaults.map(s => s.file);

    assert.ok(defaultFiles.includes('pulse_sentinel.py'));
    assert.ok(defaultFiles.includes('janitor.py'));
    assert.equal(defaultFiles.includes('vision_sentinel.py'), false);
    assert.ok(defaults.some(s => s.layer === 'PulseSentinel'));

    const selected = discoverSentinels(process.cwd(), 'pulse,janitor');
    assert.deepEqual(selected.map(s => s.layer), ['PulseSentinel', 'JanitorSentinel']);
});

test('waitForSentinels polls health until requested layers register', async () => {
    let calls = 0;
    const runner = new ProtocolObjectiveRunner({
        httpGetJson: async () => {
            calls++;
            return calls < 2
                ? { status: 'healthy', sentinels: [] }
                : { status: 'healthy', sentinels: [{ layer: 'PulseSentinel' }] };
        }
    });

    await runner.waitForSentinels([{ layer: 'PulseSentinel' }], 1000);
    assert.equal(calls, 2);
});
