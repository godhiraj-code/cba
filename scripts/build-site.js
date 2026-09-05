'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', 'site');
const files = ['index.html', 'style.css', 'app.js', 'favicon.svg'];
const assets = ['starlight-demo.mp4', 'demo-poster.png', 'demo-transcript.json', 'demo-captions.vtt'];
fs.mkdirSync(path.join(output, 'assets'), { recursive: true });
function copy(source, target) {
    if (/\.(html|css|js|svg|json|vtt)$/.test(source)) {
        fs.writeFileSync(target, fs.readFileSync(source, 'utf8').replaceAll('\r\n', '\n'));
    } else fs.copyFileSync(source, target);
}
for (const name of files) copy(path.join(root, 'website', name), path.join(output, name));
for (const name of assets) copy(path.join(root, 'assets', name), path.join(output, 'assets', name));
fs.writeFileSync(path.join(output, '.nojekyll'), '');
const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
assert.match(html, /<title>Starlight — General-purpose agent platform<\/title>/);
const localTargets = new Set();
for (const [, target] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^https?:/.test(target)) {
        // GitHub documentation links must point at a file that exists in this checkout.
        const prefix = 'https://github.com/starlight-protocol/starlight/blob/main/';
        if (target.startsWith(prefix)) assert(fs.existsSync(path.join(root, target.slice(prefix.length))), `Missing source: ${target}`);
        continue;
    }
    if (target.startsWith('#')) {
        assert(html.includes(`id="${target.slice(1)}"`), `Missing anchor: ${target}`);
        continue;
    }
    if (target === './' || target === 'build-info.json') continue;
    assert(!target.startsWith('/'), `Root-relative path breaks project Pages: ${target}`);
    assert(fs.existsSync(path.join(output, target)), `Missing public asset: ${target}`);
    localTargets.add(target);
}
const transcript = JSON.parse(fs.readFileSync(path.join(output, 'assets/demo-transcript.json'), 'utf8'));
assert(Object.values(transcript.assertions).every(Boolean));
assert.equal(Object.keys(transcript.reports).length, 6);
assert.equal(transcript.scenes.reduce((sum, scene) => sum + scene.seconds, 0), transcript.media.seconds);
assert.match(fs.readFileSync(path.join(output, 'assets/demo-captions.vtt'), 'utf8'), /^WEBVTT/);
const publicFiles = [...files, ...assets.map(name => `assets/${name}`), '.nojekyll'];
const manifest = {
    commit: process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    version: require('../package.json').version,
    builtAt: new Date().toISOString(),
    files: Object.fromEntries(publicFiles.map(name => {
        const bytes = fs.readFileSync(path.join(output, name));
        return [name, { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }];
    }))
};
fs.writeFileSync(path.join(output, 'build-info.json'), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(`Site built: ${output}; homepage, ${localTargets.size} asset links, source links, anchors, six reports and chapter durations verified\n`);
