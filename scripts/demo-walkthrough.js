'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin/starlight-platform.js');
const example = path.join(root, 'examples/data-report');
const output = path.join(root, '.starlight/demo-video', crypto.randomUUID());
fs.mkdirSync(output, { recursive: true });
const scenes = [];

function scene(title, caption, command, lines, seconds = 10) {
    scenes.push({ title, caption, command, lines, seconds });
    process.stdout.write(`\n${title}\n$ ${command}\n${lines.join('\n')}\n`);
}
function run(args, expectedCode = 0) {
    const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: root, encoding: 'utf8', timeout: 15_000
    });
    assert.equal(result.status, expectedCode, result.stderr || result.error?.message);
    return JSON.parse(result.stdout);
}

const source = JSON.parse(fs.readFileSync(path.join(example, 'orders.json'), 'utf8'));
scene('01 / Start with real data', 'Three orders. No browser, API key, or model required.',
    'node -p "JSON.stringify(require(\'./examples/data-report/orders.json\'), null, 2)"',
    JSON.stringify(source, null, 2).split('\n'), 10);

const agents = run(['agents', '--agents', path.join(example, 'agents.cjs')]);
scene('02 / Discover the agents', 'Each agent declares a capability and an execution capacity.',
    'starlight agents --agents examples/data-report/agents.cjs',
    agents.flatMap(agent => [`${agent.name}`, `  capabilities: ${agent.capabilities.join(', ')}`, `  capacity: ${agent.capacity}`, '']), 9);

const mission = JSON.parse(fs.readFileSync(path.join(example, 'mission.json'), 'utf8'));
scene('03 / Express the mission', 'Intent describes the outcome. Agent code owns the implementation.',
    'Read examples/data-report/mission.json',
    [`Goal: ${mission.goal}`, '', `Constraint: maxRows = ${mission.constraints.maxRows}`, '',
        ...mission.steps.map((step, index) => `${index + 1}. ${step}`)], 10);

const report = run(['demo', '--output-dir', output]);
assert.equal(report.status, 'completed');
assert.deepEqual(report.steps[0].result.value, { count: 3, totalCents: 5500 });
const artifact = report.steps[1].result.value.path;
assert(fs.existsSync(artifact));
scene('04 / Execute and verify', 'The analyst verifies the total; the writer reads back its file.',
    'starlight demo',
    [`Run: ${report.id}`, `Status: ${report.status}`, '',
        ...report.steps.flatMap(step => [`Step ${step.index}: ${step.status}`, `  agent: ${step.result.sentinel.name}`,
            `  attempts: ${step.result.attempts.length}`, `  evidence records: ${step.result.evidence.length}`]), '',
        'Verified result: 3 orders / 5500 cents'], 12);

const inspected = run(['inspect', report.id, '--output-dir', output]);
assert.equal(inspected.id, report.id);
assert.deepEqual(inspected.steps, report.steps);
const content = fs.readFileSync(artifact, 'utf8');
assert.match(content, /Orders: 3\nTotal \(cents\): 5500/);
scene('05 / Inspect the saved result', 'A saved JSON report retains identity, attempts, values, and evidence.',
    `starlight inspect ${report.id}`,
    ['Saved report status: ' + inspected.status, 'Artifact exists: true', '',
        'Actual Markdown file contents:', ...content.trim().split('\n')], 10);

const failedOutput = path.join(output, 'must-not-exist.md');
const constrained = { ...mission, constraints: { maxRows: 1 },
    context: { inputPath: path.join(example, 'orders.json'), outputPath: failedOutput } };
const failedMission = path.join(output, 'constraint-failure.json');
fs.writeFileSync(failedMission, JSON.stringify(constrained, null, 2));
const failed = run(['run', failedMission, '--agents', path.join(example, 'agents.cjs'), '--output-dir', output], 1);
assert.equal(failed.status, 'failed');
assert.equal(failed.steps.length, 1);
assert.equal(fs.existsSync(failedOutput), false);
scene('06 / Prove the failure boundary', 'A failed constraint stops later steps and preserves the reason.',
    'starlight run constraint-failure.json --agents examples/data-report/agents.cjs',
    ['Same 3 source rows; changed constraint: maxRows = 1', '', `Status: ${failed.status}`, 'Exit code: 1',
        'Steps started: ' + failed.steps.length, 'Report writer executed: false', 'Output file exists: false', '',
        'Error: ' + failed.error.message], 12);

const transcript = { product: 'Starlight', version: require('../package.json').version,
    capturedAt: new Date().toISOString(), format: 'walkthrough rendered from real CLI results',
    assertions: { success: true, savedReport: true, artifactReadBack: true, constraintFailure: true }, scenes };
const targetArg = process.argv.find(arg => arg.startsWith('--record='));
const target = targetArg ? path.resolve(targetArg.slice(9)) : path.join(output, 'transcript.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(transcript, null, 2) + '\n');
process.stdout.write(`\nAll walkthrough assertions passed. Transcript: ${target}\n`);
