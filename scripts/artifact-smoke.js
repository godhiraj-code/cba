'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'starlight-artifact-'));

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd || root,
        encoding: 'utf8',
        env: options.env || process.env,
        shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')
    });
    if (result.status !== 0) {
        process.stderr.write(result.stdout || '');
        process.stderr.write(result.stderr || '');
        throw result.error || new Error(`${command} ${args.join(' ')} exited ${result.status}`);
    }
    return result.stdout.trim();
}

try {
    const pack = JSON.parse(run(npm, ['pack', '--json', '--pack-destination', temporary]))[0];
    const names = pack.files.map(file => file.path);
    const forbidden = /(^|\/)(python-sdk|go-sdk|java-sdk|rust-sdk|launcher|test|tests|coverage|dist|node_modules)(\/|$)|(^|\/)(__pycache__|\.env|\.git|\.coverage)(\/|$)|\.(py|pyc|pyo|whl|tar\.gz|log)$/i;
    assert.deepEqual(names.filter(name => forbidden.test(name)), [], 'tarball contains forbidden files');
    for (const required of [
        'package.json',
        'src/core/index.js',
        'types/core.d.ts',
        'schemas/starlight.core.schema.json',
        'scripts/proof-e2e.js',
        'bin/starlight-core.js',
        'CHANGELOG.md'
    ]) assert(names.includes(required), `tarball is missing ${required}`);

    const consumer = path.join(temporary, 'consumer');
    fs.mkdirSync(consumer);
    run(npm, ['init', '-y'], { cwd: consumer });
    run(npm, ['install', path.join(temporary, pack.filename)], { cwd: consumer });
    const installed = path.join(
        consumer, 'node_modules', '@starlight-protocol', 'starlight'
    );
    const cli = path.join(
        consumer, 'node_modules', '.bin',
        process.platform === 'win32' ? 'starlight-core.cmd' : 'starlight-core'
    );
    assert.match(run(cli, ['--help'], { cwd: consumer }), /Usage: starlight-core/);
    const proof = JSON.parse(run(process.execPath, [path.join(installed, 'scripts', 'proof-e2e.js')], {
        cwd: consumer
    }));
    assert.equal(proof.ok, true);
    assert.equal(proof.replaySideEffects, 1);
    process.stdout.write(JSON.stringify({
        ok: true,
        proof: 'installed-artifact',
        package: pack.filename,
        files: names.length
    }) + '\n');
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}
