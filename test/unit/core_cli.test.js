'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { runCoreTck } = require('../../tck/src/core_tck');

const cli = path.resolve(__dirname, '../../bin/starlight-core.js');

test('documented external Hub CLI profile passes the independent wire TCK', async t => {
    const token = 'external-cli-tck-token-0000000000';
    const child = spawn(process.execPath, [cli, '--host=127.0.0.1', '--port=0',
        '--offer-timeout-ms=100', '--execution-timeout-ms=100', '--scheduling-timeout-ms=100', '--max-attempts=2'],
    { env: { ...process.env, STARLIGHT_AUTH_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { child.kill(); });
    const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Hub CLI did not start')), 5000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Hub exited ${code}`)); });
        child.stdout.on('data', data => {
            const match = data.toString().match(/ws:\/\/127\.0\.0\.1:\d+/);
            if (match) { clearTimeout(timer); resolve(match[0]); }
        });
    });
    const report = await runCoreTck({ url, token });
    assert.equal(report.passed, 19);
    assert.equal(report.failed, 0);
});

test('Hub CLI rejects unknown flags and invalid execution budgets', () => {
    for (const option of ['--unknown=1', '--execution-timeout-ms=Infinity', '--max-attempts=0']) {
        const result = spawnSync(process.execPath, [cli, '--allow-anonymous-loopback', option],
            { encoding: 'utf8', timeout: 5000 });
        assert.equal(result.status, 1, result.stderr);
    }
});
