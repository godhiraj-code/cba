'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cli = path.resolve(__dirname, '../../bin/starlight-platform.js');
function workspace(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'starlight-cli-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}
function run(cwd, args) {
    return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 15_000 });
}

test('CLI demo produces a verified artifact and inspect reads the saved report', t => {
    const cwd = workspace(t);
    const demo = run(cwd, ['demo']);
    assert.equal(demo.status, 0, demo.stderr || demo.error?.message);
    const report = JSON.parse(demo.stdout);
    assert.equal(report.status, 'completed');
    assert.deepEqual(report.steps[0].result.value, { count: 3, totalCents: 5500 });
    assert.match(fs.readFileSync(report.steps[1].result.value.path, 'utf8'), /Orders: 3\nTotal \(cents\): 5500/);
    const inspect = run(cwd, ['inspect', report.id]);
    assert.equal(inspect.status, 0, inspect.stderr);
    assert.deepEqual(JSON.parse(inspect.stdout), JSON.parse(fs.readFileSync(report.reportPath, 'utf8')));
    assert.equal(run(cwd, ['demo']).status, 0, 'repeated demos use fresh paths');
});

test('CLI loads CommonJS and ESM agents and persists failed runs with partial history', t => {
    const cwd = workspace(t);
    for (const [extension, prefix] of [['cjs', 'module.exports ='], ['mjs', 'export default']]) {
        const agentPath = path.join(cwd, `agent.${extension}`);
        fs.writeFileSync(agentPath, `${prefix} {
            name: 'custom', canHandle: () => true,
            run: intent => intent.goal === 'first'
                ? { status: 'completed', value: 7 }
                : { status: 'failed', error: 'deliberate failure', evidence: ['reason'] }
        };`);
        const listing = run(cwd, ['agents', '--agents', agentPath]);
        assert.equal(listing.status, 0, listing.stderr);
        assert.equal(JSON.parse(listing.stdout)[0].name, 'custom');
        const missionPath = path.join(cwd, 'mission.json');
        fs.writeFileSync(missionPath, JSON.stringify({ goal: 'Check failure', steps: ['first', 'second', 'third'] }));
        const failed = run(cwd, ['run', missionPath, '--agents', agentPath, '--output-dir', 'reports']);
        assert.equal(failed.status, 1, failed.stderr);
        const report = JSON.parse(failed.stdout);
        assert.equal(report.status, 'failed');
        assert.deepEqual(report.steps.map(step => step.status), ['completed', 'failed']);
        assert.equal(report.steps[0].result.value, 7);
        assert.equal(JSON.parse(fs.readFileSync(report.reportPath)).error.message, 'deliberate failure');
    }
});

test('CLI rejects invalid commands, missing agents, and traversal in run IDs', t => {
    const cwd = workspace(t);
    for (const args of [['unknown'], ['run', 'mission.json'], ['demo', '--typo', 'x'],
        ['inspect', '../secret'], ['demo', 'extra']]) {
        const result = run(cwd, args);
        assert.equal(result.status, 1, `unexpected success: ${args.join(' ')}`);
        assert(result.stderr.trim());
    }
});
