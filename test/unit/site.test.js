'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');

test('public-site verification detects missing, stale and corrupt deployments at a project subpath', async t => {
    execFileSync(process.execPath, ['scripts/build-site.js'], { cwd: root });
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
        '.json': 'application/json', '.mp4': 'video/mp4', '.png': 'image/png', '.vtt': 'text/vtt' };
    let fault = '';
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        const name = url.pathname.slice('/starlight/'.length) || 'index.html';
        if (!url.pathname.startsWith('/starlight/') || name.includes('..') || (fault === 'missing homepage' && name === 'index.html')) {
            response.writeHead(404).end('missing');
            return;
        }
        let bytes = fs.readFileSync(path.join(root, 'dist/site', name));
        if (fault === 'stale commit' && name === 'build-info.json') bytes = Buffer.from(JSON.stringify({ commit: 'old' }));
        if (fault === 'corrupt asset' && name === 'app.js') bytes = Buffer.from('not the deployed application');
        response.setHeader('Content-Type', fault === 'wrong media type' && name.endsWith('.mp4') ? 'text/html' : types[path.extname(name)]);
        response.end(bytes);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    for (const scenario of ['', 'missing homepage', 'stale commit', 'corrupt asset', 'wrong media type']) {
        await t.test(scenario || 'complete deployment', async () => {
            fault = scenario;
            const result = await new Promise((resolve, reject) => {
                const child = spawn(process.execPath, ['scripts/check-site.js', `http://127.0.0.1:${server.address().port}/starlight/`], { cwd: root });
                let output = '';
                child.stdout.on('data', chunk => { output += chunk; });
                child.stderr.on('data', chunk => { output += chunk; });
                child.on('error', reject);
                child.on('exit', code => resolve({ code, output }));
            });
            assert.equal(result.code, scenario ? 1 : 0, result.output);
            const expected = { 'missing homepage': /HTTP 404/, 'stale commit': /different commit/,
                'corrupt asset': /unexpected size|stale or corrupt/, 'wrong media type': /wrong MIME type/ };
            if (scenario) assert.match(result.output, expected[scenario]);
        });
    }
});
