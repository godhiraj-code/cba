'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { AgentPlatform, ProtocolHub, Sentinel, digestToken } = require('..');

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

async function main() {
scene('From a goal to accountable execution', 'Starlight / General-purpose agent platform / 5.x alpha',
    'Mission → routing → agent → verification → report',
    ['You define the goal, context, constraints, and steps.',
        'Agents supply tools, models, or deterministic code.',
        'Starlight coordinates execution and records what happened.',
        'This walkthrough uses real Node.js and WebSocket executions.'], 12);
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

const verification = new AgentPlatform();
let verificationCalls = 0;
verification.register({ name: 'incorrect-analyst', canHandle: () => true,
    run: () => { verificationCalls++; return { status: 'completed', value: { totalCents: 9999 }, evidence: ['claimed total: 9999'] }; },
    verify: (_intent, outcome) => outcome.value.totalCents === 5500 });
const rejected = await verification.run({ goal: 'Reject incorrect work', steps: ['Calculate', 'Write'] });
assert.equal(rejected.status, 'failed');
assert.equal(verificationCalls, 1);
assert.equal(rejected.error.details.cause.code, 'VERIFICATION_FAILED');
scene('07 / A success claim is not enough', 'The verifier rejects an incorrect total before the next step.',
    'agent.verify(intent, outcome) → false',
    ['Agent claimed: completed / totalCents: 9999', 'Independent expected total: 5500',
        `Mission status: ${rejected.status}`, `Cause: ${rejected.error.details.cause.code}`,
        `Agents executed: ${verificationCalls}`, 'Writer step: never started',
        'Evidence retained: ' + rejected.error.details.evidence.join(', ')], 15);

const cancellable = new AgentPlatform();
let started;
let observedAbort = false;
const ready = new Promise(resolve => { started = resolve; });
cancellable.register({ name: 'cooperative-worker', canHandle: () => true,
    run: (_intent, { signal }) => new Promise(resolve => {
        signal.addEventListener('abort', () => { observedAbort = true; resolve({ status: 'failed', error: 'cancelled by caller' }); }, { once: true });
        started();
    }) });
const handle = cancellable.submit({ goal: 'Work until cancelled', steps: ['Wait for input', 'Write result'] });
await ready;
const running = cancellable.getRun(handle.id);
assert.equal(running.status, 'running');
handle.cancel();
const cancelled = await handle.done;
assert.equal(cancelled.status, 'cancelled');
assert.equal(observedAbort, true);
assert.equal(cancelled.steps.length, 1);
scene('08 / Cancel work deliberately', 'Cancellation reaches a cooperating agent and stops the mission.',
    'const handle = platform.submit(mission); handle.cancel();',
    ['Before cancellation: ' + running.status, 'Agent receives execution.signal abort: true',
        'After cancellation: ' + cancelled.status, 'Next step: never started',
        'Cancellation is cooperative. It cannot undo external work.'], 15);

const remotePlatform = new AgentPlatform();
const token = crypto.randomBytes(32).toString('hex');
const hub = new ProtocolHub({ port: 0, coordinator: remotePlatform.coordinator, tokenDigests: [digestToken(token)] });
const { url } = await hub.start();
const remote = new Sentinel({ url, token, name: 'remote-word-counter',
    canHandle: intent => intent.goal === 'Count words remotely',
    handle: intent => ({ status: 'completed', value: { words: intent.context.text.trim().split(/\s+/).length }, evidence: ['counted on authenticated WebSocket agent'] }) });
let remoteReport;
try {
    await remote.connect();
    remoteReport = await remotePlatform.run({ goal: 'Count words remotely', context: { text: 'Goals become observable results' } });
    assert.equal(remoteReport.status, 'completed');
    assert.equal(remoteReport.steps[0].result.value.words, 4);
} finally { remote.close(); await hub.close(); }
scene('09 / Cross a real network boundary', 'A Sentinel connects to a token-authenticated local WebSocket Hub.',
    'AgentPlatform → ProtocolHub ↔ Sentinel',
    ['Transport: JSON-RPC over WebSocket', 'Authentication: token checked by the Hub',
        'Agent: ' + remoteReport.steps[0].result.sentinel.name, 'Input: Goals become observable results',
        'Returned value: ' + remoteReport.steps[0].result.value.words + ' words',
        'One process here; real socket transport. Multi-process proof also included.'], 16);

const recovered = run(['demo', '--output-dir', output]);
assert.equal(recovered.status, 'completed');
assert.notEqual(recovered.id, report.id);
assert.deepEqual(recovered.steps[0].result.value, { count: 3, totalCents: 5500 });
scene('10 / Correct the input. Start a fresh run.', 'Restore the valid row limit and verify the resulting artifact again.',
    'starlight demo',
    ['Constraint: maxRows = 1000', 'New run ID: ' + recovered.id,
        'Status: ' + recovered.status, 'Verified result: 3 orders / 5500 cents',
        'Fresh run and artifact. No durable resume or automatic rollback.'], 14);
scene('Build agents. Keep execution inspectable.', 'Run the examples, inspect the evidence, then supply your own agents.',
    'npm ci  →  npm run demo  →  npm run demo:walkthrough',
    ['Goal + context + constraints → independently routed steps',
        'Agent identity + attempts + verification evidence → a run report',
        'Tools and models belong inside your agents.',
        'Alpha boundaries: trusted code, cooperative cancellation, in-memory SDK history.',
        'starlight-protocol.github.io/starlight/'], 12);

const transcript = { product: 'Starlight', version: require('../package.json').version,
    capturedAt: new Date().toISOString(), format: 'walkthrough rendered from real CLI results',
    assertions: { success: true, savedReport: true, artifactReadBack: true, constraintFailure: true,
        verificationRejected: true, cancellation: true, authenticatedRemote: true, freshRecovery: true },
    reports: { success: report, constraintFailure: failed, verificationFailure: rejected, cancellation: cancelled,
        remote: remoteReport, recovery: recovered }, artifact: content, scenes };
transcript.pathNote = 'Workspace prefixes are replaced with <workspace> and workspace: in the public recording. Run IDs and results are unchanged.';
const targetArg = process.argv.find(arg => arg.startsWith('--record='));
const target = targetArg ? path.resolve(targetArg.slice(9)) : path.join(output, 'transcript.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(transcript, (_key, value) => typeof value === 'string'
    ? value.replaceAll(pathToFileURL(root).href, 'workspace:').replaceAll(root, '<workspace>') : value, 2) + '\n');
process.stdout.write(`\nAll walkthrough assertions passed. Transcript: ${target}\n`);
}
main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
