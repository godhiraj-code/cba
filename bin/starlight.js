#!/usr/bin/env node

/**
 * Starlight Autonomous CLI Orchestrator
 * Unified entry point for headless CI/CD execution.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const args = process.argv.slice(2);
const missionPath = args.find(a => !a.startsWith('-'));
const isHeadless = args.includes('--headless');
const isVerbose = args.includes('--verbose');

if (!missionPath) {
    console.error('Usage: starlight <mission_file> [--headless] [--verbose]');
    process.exit(1);
}

const absoluteMissionPath = path.resolve(process.cwd(), missionPath);
if (!fs.existsSync(absoluteMissionPath)) {
    console.error(`Error: Mission file not found: ${absoluteMissionPath}`);
    process.exit(1);
}

const processes = {};

function log(source, msg) {
    if (isVerbose || source === 'System') {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] [${source}] ${msg}`);
    }
}

async function waitForHub(timeout = 30000) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const check = setInterval(() => {
            http.get('http://localhost:8080/health', (res) => {
                if (res.statusCode === 200) {
                    clearInterval(check);
                    resolve();
                }
            }).on('error', () => {
                if (Date.now() - start > timeout) {
                    clearInterval(check);
                    reject(new Error('Hub startup timeout'));
                }
            });
        }, 1000);
    });
}

async function spawnProcess(name, cmd, args, options = {}) {
    log('System', `Spawning ${name}...`);
    const proc = spawn(cmd, args, { shell: true, stdio: 'pipe', ...options });
    processes[name] = proc;

    proc.stdout.on('data', (data) => log(name, data.toString().trim()));
    proc.stderr.on('data', (data) => log(name, `ERR: ${data.toString().trim()}`));

    return proc;
}

async function main() {
    try {
        log('System', '--- Starlight Autonomous Mission Starting ---');

        // 1. Start Hub
        const hubArgs = ['src/hub.js'];
        if (isHeadless) hubArgs.push('--headless');
        await spawnProcess('Hub', 'node', hubArgs);

        // 2. Wait for Hub
        log('System', 'Waiting for Hub to initialize...');
        await waitForHub();
        log('System', 'Hub is ONLINE.');

        // 3. Start Sentinels
        await spawnProcess('Pulse', 'python', ['sentinels/pulse_sentinel.py']);
        await spawnProcess('Janitor', 'python', ['sentinels/janitor.py']);

        // Give sentinels a moment to register
        await new Promise(r => setTimeout(r, 2000));

        // 4. Run Mission
        log('System', `Launching Mission: ${path.basename(absoluteMissionPath)}`);
        const missionProc = spawn('node', [absoluteMissionPath], { shell: true, stdio: 'inherit' });

        missionProc.on('exit', (code) => {
            log('System', `Mission exited with code ${code}`);
            cleanup(code);
        });

    } catch (error) {
        log('System', `CRITICAL ERROR: ${error.message}`);
        cleanup(1);
    }
}

function cleanup(exitCode) {
    log('System', 'Shutting down Starlight constellation...');

    // Kill child processes
    for (const [name, proc] of Object.entries(processes)) {
        if (proc) {
            log('System', `Stopping ${name}...`);
            // On Windows taskkill is more reliable for children
            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', proc.pid, '/f', '/t'], { shell: true });
            } else {
                proc.kill('SIGTERM');
            }
        }
    }

    log('System', '--- Mission Orchestration Complete ---');
    process.exit(exitCode);
}

// Handle parent termination
process.on('SIGINT', () => cleanup(1));
process.on('SIGTERM', () => cleanup(1));

main();
