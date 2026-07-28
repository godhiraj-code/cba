'use strict';

const { spawnSync } = require('node:child_process');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commands = [
    [npm, ['test']],
    [npm, ['run', 'proof:e2e']],
    [process.execPath, ['scripts/artifact-smoke.js']],
    [npm, ['audit', '--omit=dev', '--audit-level=low']]
];

for (const [command, args] of commands) {
    const result = spawnSync(command, args, {
        stdio: 'inherit',
        shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
process.stdout.write('release gate passed\n');
