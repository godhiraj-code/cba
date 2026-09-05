'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { npmCommand } = require('./npm-command');

const root = path.resolve(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'starlight artifact '));

function run(command, args, options = {}) {
    const invocation = command === npm ? npmCommand(args) : { command, args };
    const result = spawnSync(invocation.command, invocation.args, {
        cwd: options.cwd || root,
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: path.join(temporary, 'npm-cache'), ...options.env }
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
    const forbidden = /(^|\/)(legacy|python-sdk|go-sdk|java-sdk|rust-sdk|launcher|test|tests|coverage|dist|node_modules)(\/|$)|(^|\/)(__pycache__|\.env|\.git|\.coverage)(\/|$)|\.(py|pyc|pyo|whl|tar\.gz|log)$/i;
    assert.deepEqual(names.filter(name => forbidden.test(name)), [], 'tarball contains forbidden files');
    for (const required of [
        'package.json',
        'src/core/index.js',
        'src/index.js',
        'src/platform/index.js',
        'types/platform.d.ts',
        'bin/starlight-platform.js',
        'examples/data-report/agents.cjs',
        'examples/data-report/orders.json',
        'docs/OBJECTIVE.md',
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
    run(process.execPath, ['-e', [
        "const assert = require('node:assert/strict');",
        "const root = require('@starlight-protocol/starlight');",
        "assert.equal(root.Coordinator, require('@starlight-protocol/starlight/core').Coordinator);",
        "assert.equal(root.AgentPlatform, require('@starlight-protocol/starlight/platform').AgentPlatform);"
    ].join('\n')], { cwd: consumer });
    const cli = path.join(
        consumer, 'node_modules', '.bin',
        process.platform === 'win32' ? 'starlight-core.cmd' : 'starlight-core'
    );
    assert(fs.existsSync(cli), 'installed core CLI shim is missing');
    assert.match(run(npm, ['exec', '--offline', '--', 'starlight-core', '--help'], { cwd: consumer }), /Usage: starlight-core/);
    const platformCli = path.join(consumer, 'node_modules', '.bin',
        process.platform === 'win32' ? 'starlight.cmd' : 'starlight');
    assert(fs.existsSync(platformCli), 'installed platform CLI shim is missing');
    assert.match(run(npm, ['exec', '--offline', '--', 'starlight', '--help'], { cwd: consumer }), /Starlight agent platform/);
    const demo = JSON.parse(run(npm, ['exec', '--offline', '--', 'starlight', 'demo'], { cwd: consumer }));
    assert.equal(demo.status, 'completed');
    assert.deepEqual(demo.steps[0].result.value, { count: 3, totalCents: 5500 });
    assert.equal(demo.steps[1].result.sentinel.name, 'report-writer');
    assert.match(fs.readFileSync(demo.steps[1].result.value.path, 'utf8'), /Total \(cents\): 5500/);
    const inspected = JSON.parse(run(npm, ['exec', '--offline', '--', 'starlight', 'inspect', demo.id], { cwd: consumer }));
    assert.equal(inspected.id, demo.id);
    assert.equal(inspected.status, 'completed');
    const proof = JSON.parse(run(process.execPath, [path.join(installed, 'scripts', 'proof-e2e.js')], {
        cwd: consumer
    }));
    assert.equal(proof.ok, true);
    assert.equal(proof.replaySideEffects, 1);
    process.stdout.write(JSON.stringify({
        ok: true,
        proof: 'installed-artifact',
        package: pack.filename,
        platformDemo: demo.status,
        files: names.length
    }) + '\n');
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}
