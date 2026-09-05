'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { npmCommand } = require('./npm-command');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commands = [
    [npm, ['test']],
    [npm, ['run', 'proof:e2e']],
    [npm, ['run', 'demo:walkthrough']],
    [npm, ['run', 'site:build']],
    [process.execPath, ['scripts/artifact-smoke.js']],
    [npm, ['audit', '--audit-level=low']]
];

for (const [command, args] of commands) {
    const invocation = command === npm ? npmCommand(args) : { command, args };
    const result = spawnSync(invocation.command, invocation.args, {
        stdio: 'inherit',
        env: { ...process.env, npm_config_cache: process.env.npm_config_cache || path.resolve('.npm-cache') }
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
process.stdout.write('release gate passed\n');
