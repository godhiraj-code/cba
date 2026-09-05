#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const fileSystem = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { AgentPlatform } = require('../src/platform');

function usage() {
    process.stdout.write(`Starlight agent platform

Usage:
  starlight demo [--output-dir <directory>]
  starlight run <mission.json> --agents <agents.js> [--output-dir <directory>]
  starlight agents --agents <agents.js>
  starlight inspect <run-id> [--output-dir <directory>]

Agent modules export an agent or an array of agents (CommonJS or ESM).
Reports default to .starlight/runs. Paths resolve from the working directory.
Agent modules execute trusted local code with this process's permissions.
`);
}

function parse(args) {
    const positional = [];
    const flags = {};
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (!arg.startsWith('--')) { positional.push(arg); continue; }
        if (!['--agents', '--output-dir'].includes(arg)) throw new Error(`unknown option: ${arg}`);
        if (!args[index + 1] || args[index + 1].startsWith('--') || flags[arg]) {
            throw new Error(`${arg} requires one value and must appear once`);
        }
        flags[arg] = args[++index];
    }
    return { positional, flags };
}

async function loadAgents(platform, filename) {
    const module = await import(pathToFileURL(path.resolve(filename)).href);
    const agents = Array.isArray(module.default) ? module.default : [module.default];
    if (!agents.length) throw new Error('agent module must export at least one agent');
    for (const agent of agents) platform.register(agent);
}

async function main(args = process.argv.slice(2)) {
    if (!args.length || args.includes('--help') || args.includes('-h')) { usage(); return; }
    const { positional, flags } = parse(args);
    const [command, input] = positional;
    const outputDir = path.resolve(flags['--output-dir'] || '.starlight/runs');
    if (!['demo', 'run', 'agents', 'inspect'].includes(command)) throw new Error(`unknown command: ${command}`);
    if (positional.length !== (['run', 'inspect'].includes(command) ? 2 : 1)) {
        throw new Error(`invalid arguments for ${command}; see starlight --help`);
    }
    if (['demo', 'inspect'].includes(command) && flags['--agents']) {
        throw new Error(`${command} does not accept --agents`);
    }
    if (command === 'inspect') {
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input)) {
            throw new Error('inspect requires a run UUID');
        }
        const report = JSON.parse(await fs.readFile(path.join(outputDir, `${input}.json`), 'utf8'));
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        return;
    }
    const platform = new AgentPlatform();
    let mission;
    if (command === 'demo') {
        const example = path.resolve(__dirname, '../examples/data-report');
        await loadAgents(platform, path.join(example, 'agents.cjs'));
        const template = JSON.parse(await fs.readFile(path.join(example, 'mission.json'), 'utf8'));
        const artifactDir = path.join(outputDir, 'artifacts');
        await fs.mkdir(artifactDir, { recursive: true });
        mission = { ...template, context: {
            inputPath: path.join(example, 'orders.json'),
            outputPath: path.join(artifactDir, `${crypto.randomUUID()}.md`)
        } };
    } else {
        if (!flags['--agents']) throw new Error(`${command} requires --agents <agents.js>`);
        await loadAgents(platform, flags['--agents']);
        if (command === 'agents') {
            process.stdout.write(JSON.stringify(platform.agents(), null, 2) + '\n');
            return;
        }
        mission = JSON.parse(await fs.readFile(path.resolve(input), 'utf8'));
    }
    // Check report storage before allowing agents to change anything.
    await fs.mkdir(outputDir, { recursive: true });
    const handle = platform.submit(mission);
    const reportPath = path.join(outputDir, `${handle.id}.json`);
    let file;
    try {
        // Synchronous reservation happens before submit's execution microtask.
        file = fileSystem.openSync(reportPath, 'wx');
    } catch (error) {
        handle.cancel();
        await handle.done;
        throw error;
    }
    const cancel = () => handle.cancel();
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    try {
        const report = await handle.done;
        fileSystem.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
        process.stdout.write(JSON.stringify({ ...report, reportPath }, null, 2) + '\n');
        if (report.status !== 'completed') process.exitCode = 1;
    } finally {
        process.removeListener('SIGINT', cancel);
        process.removeListener('SIGTERM', cancel);
        fileSystem.closeSync(file);
    }
}

if (require.main === module) main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});

module.exports = { main };
