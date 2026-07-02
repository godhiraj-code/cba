const { spawn: defaultSpawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const IntentRunner = require('./intent_runner');

const DEFAULT_SENTINEL_FILES = [
    'pulse_sentinel.py',
    'janitor.py',
    'pii_sentinel.py',
    'a11y_sentinel.py',
    'responsive_sentinel.py',
    'data_sentinel.py'
];

function normalizeUrl(value) {
    if (!value || typeof value !== 'string') {
        throw new Error('A URL objective requires a non-empty URL');
    }
    const trimmed = value.trim();
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^about:/i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
}

function parseNumber(value, name) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive number`);
    }
    return parsed;
}

function readOptionValue(argv, index, name) {
    const current = argv[index];
    const eqIndex = current.indexOf('=');
    if (eqIndex !== -1) return { value: current.slice(eqIndex + 1), nextIndex: index };

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`${name} requires a value`);
    }
    return { value, nextIndex: index + 1 };
}

function parseCliArgs(argv = process.argv.slice(2)) {
    const options = {
        headless: false,
        verbose: false,
        json: false,
        host: process.env.STARLIGHT_HOST || '127.0.0.1',
        port: Number(process.env.STARLIGHT_PORT || 8080),
        sentinels: 'default',
        hubTimeoutMs: 30000,
        sentinelTimeoutMs: 15000,
        objectiveTimeoutMs: 180000,
        reuseHub: true
    };
    const positional = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--headless') {
            options.headless = true;
        } else if (arg === '--verbose' || arg === '-v') {
            options.verbose = true;
        } else if (arg === '--json') {
            options.json = true;
        } else if (arg === '--no-reuse-hub') {
            options.reuseHub = false;
        } else if (arg === '--no-sentinels') {
            options.sentinels = 'none';
        } else if (arg === '--all-sentinels') {
            options.sentinels = 'all';
        } else if (arg.startsWith('--url')) {
            const parsed = readOptionValue(argv, i, '--url');
            options.url = parsed.value;
            i = parsed.nextIndex;
        } else if (arg.startsWith('--intent') || arg.startsWith('--objective')) {
            const parsed = readOptionValue(argv, i, arg.startsWith('--intent') ? '--intent' : '--objective');
            options.intent = parsed.value;
            i = parsed.nextIndex;
        } else if (arg.startsWith('--sentinels')) {
            const parsed = readOptionValue(argv, i, '--sentinels');
            options.sentinels = parsed.value;
            i = parsed.nextIndex;
        } else if (arg.startsWith('--port')) {
            const parsed = readOptionValue(argv, i, '--port');
            options.port = parseNumber(parsed.value, '--port');
            i = parsed.nextIndex;
        } else if (arg.startsWith('--host')) {
            const parsed = readOptionValue(argv, i, '--host');
            options.host = parsed.value;
            i = parsed.nextIndex;
        } else if (arg.startsWith('--hub-timeout')) {
            const parsed = readOptionValue(argv, i, '--hub-timeout');
            options.hubTimeoutMs = parseNumber(parsed.value, '--hub-timeout');
            i = parsed.nextIndex;
        } else if (arg.startsWith('--sentinel-timeout')) {
            const parsed = readOptionValue(argv, i, '--sentinel-timeout');
            options.sentinelTimeoutMs = parseNumber(parsed.value, '--sentinel-timeout');
            i = parsed.nextIndex;
        } else if (arg.startsWith('--timeout')) {
            const parsed = readOptionValue(argv, i, '--timeout');
            options.objectiveTimeoutMs = parseNumber(parsed.value, '--timeout');
            i = parsed.nextIndex;
        } else if (arg.startsWith('-')) {
            throw new Error(`Unknown option: ${arg}`);
        } else {
            positional.push(arg);
        }
    }

    if (positional.length > 0) {
        const first = positional[0];
        const absolute = path.resolve(process.cwd(), first);
        if (fs.existsSync(absolute) || first.endsWith('.js') || first.endsWith('.mjs') || first.endsWith('.cjs')) {
            options.missionPath = first;
        } else if (!options.intent && !options.url) {
            options.intent = positional.join(' ');
        } else {
            throw new Error(`Unexpected positional argument: ${first}`);
        }
    }

    return options;
}

function inferSentinelLayer(filePath) {
    try {
        const source = fs.readFileSync(filePath, 'utf8');
        const match = source.match(/layer_name\s*=\s*["']([^"']+)["']/);
        if (match) return match[1];
    } catch { }

    const base = path.basename(filePath, '.py');
    return base
        .split(/[_-]+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

function discoverSentinels(cwd = process.cwd(), selection = 'default') {
    if (selection === false || selection === 'none') return [];

    const sentinelsDir = path.join(cwd, 'sentinels');
    if (!fs.existsSync(sentinelsDir)) return [];

    const files = fs.readdirSync(sentinelsDir)
        .filter(file => file.endsWith('.py'))
        .filter(file => !file.startsWith('__') && !file.startsWith('test_'))
        .sort();

    const byFile = new Map(files.map(file => [file, file]));
    const byId = new Map();
    for (const file of files) {
        const id = path.basename(file, '.py');
        byId.set(id, file);
        byId.set(id.replace(/_sentinel$/, ''), file);
    }

    let selectedFiles;
    if (!selection || selection === 'default') {
        selectedFiles = DEFAULT_SENTINEL_FILES.filter(file => byFile.has(file));
    } else if (selection === 'all') {
        selectedFiles = files;
    } else if (Array.isArray(selection)) {
        selectedFiles = selection;
    } else {
        selectedFiles = String(selection)
            .split(',')
            .map(item => item.trim())
            .filter(Boolean)
            .map(item => byFile.get(item) || byId.get(item) || item);
    }

    const seen = new Set();
    return selectedFiles
        .filter(file => {
            if (seen.has(file)) return false;
            seen.add(file);
            return byFile.has(file);
        })
        .map(file => {
            const absolutePath = path.join(sentinelsDir, file);
            return {
                id: path.basename(file, '.py'),
                file,
                path: absolutePath,
                relativePath: path.join('sentinels', file),
                layer: inferSentinelLayer(absolutePath)
            };
        });
}

function getJson(url, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => {
                body += chunk;
            });
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
                }
            });
        });
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Timed out after ${timeoutMs}ms`));
        });
        req.on('error', reject);
    });
}

function formatUsage() {
    return [
        'Usage:',
        '  starlight <mission_file> [--headless] [--verbose]',
        '  starlight --url <url> [--intent "plain language objective"] [--headless]',
        '  starlight --intent "plain language objective" [--headless]',
        '',
        'Options:',
        '  --sentinels default|all|none|pulse,janitor   Background sentinel fleet (default: default)',
        '  --all-sentinels                              Start every Python sentinel',
        '  --no-sentinels                               Start only the Hub',
        '  --port <port>                                Hub port (default: 8080)',
        '  --host <host>                                Hub host (default: 127.0.0.1)',
        '  --timeout <ms>                               Mission/objective timeout',
        '  --sentinel-timeout <ms>                      Sentinel registration timeout',
        '  --json                                      Print machine-readable result'
    ].join('\n');
}

class ProtocolObjectiveRunner {
    constructor(options = {}) {
        this.options = {
            cwd: process.cwd(),
            host: '127.0.0.1',
            port: 8080,
            headless: false,
            verbose: false,
            sentinels: 'default',
            hubTimeoutMs: 30000,
            sentinelTimeoutMs: 15000,
            objectiveTimeoutMs: 180000,
            reuseHub: true,
            ...options
        };
        this.cwd = path.resolve(this.options.cwd);
        this.host = this.options.host;
        this.port = this.options.port;
        this.verbose = !!this.options.verbose;
        this.spawn = this.options.spawn || defaultSpawn;
        this.httpGetJson = this.options.httpGetJson || getJson;
        this.IntentRunner = this.options.IntentRunner || IntentRunner;
        this.processes = [];
        this.ownsHub = false;
        this.startedAt = null;
    }

    get httpUrl() {
        return `http://${this.host}:${this.port}`;
    }

    get wsUrl() {
        return `ws://${this.host}:${this.port}`;
    }

    log(source, message, force = false) {
        if (!this.verbose && !force) return;
        const timestamp = new Date().toLocaleTimeString();
        const line = `[${timestamp}] [${source}] ${message}\n`;
        if (this.options.stdout?.write) {
            this.options.stdout.write(line);
        } else {
            process.stdout.write(line);
        }
    }

    async run() {
        this.startedAt = Date.now();
        const sentinels = discoverSentinels(this.cwd, this.options.sentinels);
        let success = false;

        try {
            const hub = await this.ensureHub();
            await this.startSentinels(sentinels);

            const objective = this.buildObjective();
            let objectiveResult;
            if (objective.type === 'mission') {
                objectiveResult = await this.runMissionFile(objective);
            } else {
                objectiveResult = await this.runProtocolObjective(objective);
            }
            success = objectiveResult.success !== false;

            const health = await this.readHealth().catch(() => null);
            return {
                success,
                objective,
                hub,
                sentinels: {
                    requested: sentinels.map(s => s.layer),
                    registered: health?.sentinels?.map(s => s.layer) || []
                },
                durationMs: Date.now() - this.startedAt,
                ...objectiveResult
            };
        } finally {
            await this.cleanup({ successfulObjective: success });
        }
    }

    buildObjective() {
        if (this.options.missionPath) {
            const missionPath = path.resolve(this.cwd, this.options.missionPath);
            if (!fs.existsSync(missionPath)) {
                throw new Error(`Mission file not found: ${missionPath}`);
            }
            return { type: 'mission', missionPath };
        }

        if (this.options.url || this.options.intent) {
            return {
                type: 'protocol',
                url: this.options.url ? normalizeUrl(this.options.url) : null,
                intent: this.options.intent || null
            };
        }

        throw new Error('No objective provided. Use a mission file, --url, or --intent.');
    }

    async ensureHub() {
        if (this.options.reuseHub) {
            const existing = await this.readHealth().catch(() => null);
            if (existing?.status === 'healthy') {
                this.log('System', `Using existing Hub at ${this.httpUrl}`, true);
                return { url: this.httpUrl, wsUrl: this.wsUrl, reused: true };
            }
        }

        const hubArgs = ['src/hub.js', `--port=${this.port}`];
        if (this.options.headless) hubArgs.push('--headless');
        await this.spawnProcess('Hub', process.execPath, hubArgs, {
            STARLIGHT_HOST: this.host
        });
        this.ownsHub = true;
        await this.waitForHub(this.options.hubTimeoutMs);
        return { url: this.httpUrl, wsUrl: this.wsUrl, reused: false };
    }

    async startSentinels(sentinels) {
        if (sentinels.length === 0) {
            this.log('System', 'Running without background sentinels', true);
            return;
        }

        const python = this.options.python || process.env.PYTHON || 'python';
        for (const sentinel of sentinels) {
            await this.spawnProcess(sentinel.layer, python, [sentinel.relativePath], {
                HUB_URL: this.wsUrl
            });
        }

        await this.waitForSentinels(sentinels, this.options.sentinelTimeoutMs);
    }

    async runProtocolObjective(objective) {
        const runner = new this.IntentRunner(this.wsUrl, {
            authToken: process.env.STARLIGHT_AUTH_TOKEN || null,
            layer: 'ProtocolObjectiveRunner'
        });
        const steps = [];

        try {
            await runner.connect();

            if (objective.url) {
                this.log('Objective', `Navigating to ${objective.url}`, true);
                const result = await runner.goto(objective.url);
                steps.push({ cmd: 'goto', url: objective.url, result });
            }

            if (objective.intent) {
                this.log('Objective', `Executing intent: ${objective.intent}`, true);
                const results = await runner.executeNL(objective.intent);
                steps.push(...results);
            } else if (objective.url) {
                const context = await runner.requestPageContext();
                steps.push({
                    cmd: 'inspect',
                    title: context.title,
                    url: context.url,
                    counts: {
                        buttons: context.buttons?.length || 0,
                        inputs: context.inputs?.length || 0,
                        links: context.links?.length || 0,
                        headings: context.headings?.length || 0
                    }
                });
                await runner.checkpoint(`URL objective loaded: ${objective.url}`);
            }

            if (this.ownsHub) {
                await runner.finish('Protocol objective complete');
            } else {
                runner.close();
            }

            return { success: true, steps };
        } catch (error) {
            if (this.ownsHub) {
                await runner.finish(`Protocol objective failed: ${error.message}`).catch(() => { });
            } else {
                runner.close();
            }
            throw error;
        }
    }

    async runMissionFile(objective) {
        this.log('Objective', `Launching mission file ${path.relative(this.cwd, objective.missionPath)}`, true);
        const result = await this.spawnAndWait('Mission', process.execPath, [objective.missionPath], {
            HUB_URL: this.wsUrl,
            STARLIGHT_HUB_URL: this.wsUrl
        }, this.options.objectiveTimeoutMs);

        if (result.code !== 0) {
            throw new Error(`Mission exited with code ${result.code}`);
        }

        return { success: true, steps: [{ cmd: 'mission', path: objective.missionPath, exitCode: result.code }] };
    }

    async readHealth() {
        return this.httpGetJson(`${this.httpUrl}/health`, 3000);
    }

    async waitForHub(timeoutMs) {
        await this.waitUntil('Hub startup', timeoutMs, async () => {
            this.assertNoExitedProcesses(['Hub']);
            const health = await this.readHealth().catch(() => null);
            return health?.status === 'healthy';
        });
        this.log('System', 'Hub is healthy', true);
    }

    async waitForSentinels(sentinels, timeoutMs) {
        const expected = new Set(sentinels.map(s => s.layer));
        await this.waitUntil('Sentinel registration', timeoutMs, async () => {
            this.assertNoExitedProcesses([...expected]);
            const health = await this.readHealth().catch(() => null);
            const registered = new Set((health?.sentinels || []).map(s => s.layer));
            return [...expected].every(layer => registered.has(layer));
        });
        this.log('System', `Registered ${sentinels.length} background sentinel(s)`, true);
    }

    assertNoExitedProcesses(names) {
        const expected = new Set(names);
        const failed = this.processes.find(record =>
            expected.has(record.name) &&
            record.exitCode !== undefined &&
            record.exitCode !== null
        );
        if (!failed) return;

        const output = (failed.stderr || failed.stdout || '').trim();
        const tail = output ? `: ${output.split(/\r?\n/).slice(-5).join('\n')}` : '';
        throw new Error(`${failed.name} exited before readiness (code ${failed.exitCode})${tail}`);
    }

    async waitUntil(label, timeoutMs, predicate) {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            if (await predicate()) return;
            await new Promise(resolve => setTimeout(resolve, 250));
        }
        throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }

    spawnProcess(name, command, args, extraEnv = {}) {
        return new Promise((resolve, reject) => {
            const child = this.spawn(command, args, {
                cwd: this.cwd,
                shell: false,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, ...(this.options.env || {}), ...extraEnv }
            });
            const record = { name, child, stdout: '', stderr: '', exitCode: null, signal: null };
            this.processes.push(record);

            child.stdout?.on('data', data => {
                const text = data.toString();
                record.stdout += text;
                this.log(name, text.trim());
            });
            child.stderr?.on('data', data => {
                const text = data.toString();
                record.stderr += text;
                this.log(name, text.trim());
            });
            child.once('spawn', () => {
                this.log('System', `Started ${name}`);
                resolve(record);
            });
            child.once('exit', (code, signal) => {
                record.exitCode = code;
                record.signal = signal;
            });
            child.once('error', reject);
        });
    }

    async spawnAndWait(name, command, args, extraEnv = {}, timeoutMs = 180000) {
        const record = await this.spawnProcess(name, command, args, extraEnv);
        return new Promise((resolve, reject) => {
            if (record.exitCode !== null) {
                resolve({ code: record.exitCode });
                return;
            }
            const timer = setTimeout(() => {
                this.stopProcess(record);
                reject(new Error(`${name} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            record.child.once('exit', code => {
                clearTimeout(timer);
                resolve({ code });
            });
        });
    }

    async cleanup() {
        const records = [...this.processes].reverse();
        await Promise.all(records.map(record => this.stopProcess(record)));
        this.processes = [];
    }

    stopProcess(record) {
        return new Promise(resolve => {
            const child = record.child;
            if (!child || child.exitCode !== null || child.killed) {
                resolve();
                return;
            }

            const timer = setTimeout(resolve, 3000);
            child.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });

            try {
                child.kill();
            } catch {
                clearTimeout(timer);
                resolve();
            }
        });
    }
}

async function runCli(argv = process.argv.slice(2), io = {}) {
    const stdout = io.stdout || process.stdout;
    const stderr = io.stderr || process.stderr;
    let options;

    try {
        options = parseCliArgs(argv);
        if (options.help) {
            stdout.write(`${formatUsage()}\n`);
            return 0;
        }

        const runner = new ProtocolObjectiveRunner({ ...options, stdout });
        const result = await runner.run();
        if (options.json) {
            stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        } else {
            stdout.write(`Starlight objective complete: ${result.success ? 'success' : 'failed'} (${result.durationMs}ms)\n`);
        }
        return result.success ? 0 : 1;
    } catch (error) {
        if (options?.json) {
            stdout.write(`${JSON.stringify({ success: false, error: error.message }, null, 2)}\n`);
        } else {
            stderr.write(`Starlight objective failed: ${error.message}\n`);
            stderr.write(`${formatUsage()}\n`);
        }
        return 1;
    }
}

module.exports = {
    DEFAULT_SENTINEL_FILES,
    ProtocolObjectiveRunner,
    discoverSentinels,
    formatUsage,
    inferSentinelLayer,
    normalizeUrl,
    parseCliArgs,
    runCli
};
