'use strict';

// Verify bytes served from the deployed origin, not just a green upload job.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
    const base = new URL(process.argv[2] || 'http://127.0.0.1:4173/starlight/');
    assert(base.pathname.endsWith('/'), 'Site URL must end with /');
    const expected = JSON.parse(fs.readFileSync(path.join(__dirname, '../dist/site/build-info.json'), 'utf8'));
    async function get(relative) {
        const url = new URL(relative, base);
        url.searchParams.set('verify', expected.commit);
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
        assert.equal(response.status, 200, `${url.pathname}: HTTP ${response.status}`);
        return { bytes: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type') };
    }
    const index = await get('');
    assert.match(index.type, /text\/html/);
    assert.match(index.bytes.toString(), /<title>Starlight — General-purpose agent platform<\/title>/);
    const live = JSON.parse((await get('build-info.json')).bytes.toString());
    assert.equal(live.commit, expected.commit, 'Public deployment is a different commit');
    const types = { '.html': /text\/html/, '.css': /text\/css/, '.js': /javascript/, '.mp4': /video\/mp4/,
        '.png': /image\/png/, '.svg': /image\/svg\+xml/, '.json': /application\/json/, '.vtt': /text\/vtt/ };
    for (const [name, item] of Object.entries(expected.files)) {
        if (name === '.nojekyll') continue;
        const { bytes, type } = await get(name);
        assert.match(type, types[path.extname(name)], `${name}: wrong MIME type`);
        assert.equal(bytes.length, item.bytes, `${name}: unexpected size`);
        assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), item.sha256, `${name}: stale or corrupt public bytes`);
    }
    process.stdout.write(`Public site verified: ${base.href}\nCommit: ${live.commit}\nHomepage HTTP 200; all 8 published files have the expected MIME types, sizes and SHA-256 hashes.\n`);
}
main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
