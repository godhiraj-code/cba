/**
 * Starlight Launch Server - Backend for Mission Control
 * Manages Hub and Sentinel processes via WebSocket
 */

const { spawn } = require('child_process');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const TelemetryEngine = require('../src/telemetry');

const PORT = 3000;
const WS_PORT = 3001;

// Process registry
const processes = {
    hub: null,
    pulse: null,
    janitor: null,
    mission: null
};

const processStatus = {
    hub: 'stopped',
    pulse: 'stopped',
    janitor: 'stopped',
    mission: 'stopped'
};

// Phase 13.5: Hub WebSocket connection for recording
let hubWs = null;

function connectToHub() {
    if (hubWs && hubWs.readyState === WebSocket.OPEN) return;

    try {
        hubWs = new WebSocket('ws://localhost:8080');
        hubWs.on('open', () => console.log('[Launcher] Connected to Hub'));
        hubWs.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                // Forward recording events to UI clients
                if (msg.type?.startsWith('RECORDING_')) {
                    broadcast(msg);
                    if (msg.type === 'RECORDING_STOPPED') {
                        broadcast({ type: 'missionList', missions: discoverMissions() });
                    }
                }
            } catch (e) { }
        });
        hubWs.on('close', () => {
            hubWs = null;
            console.log('[Launcher] Hub connection closed');
        });
        hubWs.on('error', () => hubWs = null);
    } catch (e) {
        hubWs = null;
    }
}

function forwardToHub(message, retries = 0) {
    const maxRetries = 5;
    if (!hubWs || hubWs.readyState !== WebSocket.OPEN) {
        if (retries >= maxRetries) {
            log('System', 'Could not connect to Hub - is it running?', 'error');
            return;
        }
        connectToHub();
        setTimeout(() => forwardToHub(message, retries + 1), 500);
        return;
    }
    hubWs.send(JSON.stringify({ jsonrpc: '2.0', ...message, id: 'launcher-' + Date.now() }));
}

const telemetry = new TelemetryEngine(path.join(__dirname, '../telemetry.json'));

// WebSocket server for real-time logs
const wss = new WebSocket.Server({ port: WS_PORT });
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('[Launcher] Client connected');

    // Send current status, telemetry and discovery
    ws.send(JSON.stringify({ type: 'status', status: processStatus }));
    ws.send(JSON.stringify({ type: 'telemetry', data: telemetry.getStats() }));
    ws.send(JSON.stringify({ type: 'missionList', missions: discoverMissions() }));

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            handleCommand(msg, ws);
        } catch (e) {
            console.error('[Launcher] Parse error:', e.message);
        }
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log('[Launcher] Client disconnected');
    });
});

function broadcast(message) {
    const data = JSON.stringify(message);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

function log(source, text, type = 'info') {
    const entry = {
        type: 'log',
        source,
        text,
        logType: type,
        timestamp: new Date().toLocaleTimeString()
    };
    broadcast(entry);
    console.log(`[${source}] ${text}`);
}

function handleCommand(msg, ws) {
    switch (msg.cmd) {
        case 'start':
            startProcess(msg.process);
            break;
        case 'stop':
            stopProcess(msg.process);
            break;
        case 'startAll':
            startProcess('hub');
            setTimeout(() => startProcess('pulse'), 1000);
            setTimeout(() => startProcess('janitor'), 1500);
            break;
        case 'stopAll':
            stopProcess('mission');
            stopProcess('janitor');
            stopProcess('pulse');
            setTimeout(() => stopProcess('hub'), 500);
            break;
        case 'launch':
            launchMission(msg.mission);
            break;
        case 'refreshMissions':
            broadcast({ type: 'missionList', missions: discoverMissions() });
            break;
        // Phase 13.5: Recording commands
        case 'startRecording':
            // Auto-start Hub if not running
            if (!processes.hub) {
                log('System', 'Starting Hub for recording...', 'info');
                startProcess('hub');
                // Wait for Hub to be ready before forwarding
                setTimeout(() => {
                    forwardToHub({ method: 'starlight.startRecording', params: { url: msg.url } });
                    log('System', `🔴 Recording started on ${msg.url} - Browser will open!`, 'success');
                }, 2000);
            } else {
                forwardToHub({ method: 'starlight.startRecording', params: { url: msg.url } });
                log('System', `🔴 Recording started on ${msg.url}`, 'success');
            }
            break;
        case 'stopRecording':
            forwardToHub({ method: 'starlight.stopRecording', params: { name: msg.name } });
            log('System', '⏹️ Recording stopped', 'success');
            break;
    }
}

function startProcess(name) {
    if (processes[name]) {
        log('System', `${name} is already running`, 'info');
        return;
    }

    let cmd, args;
    const cwd = path.join(__dirname, '..');

    switch (name) {
        case 'hub':
            cmd = 'node';
            args = ['src/hub.js'];
            break;
        case 'pulse':
            cmd = 'python';
            args = ['sentinels/pulse_sentinel.py'];
            break;
        case 'janitor':
            cmd = 'python';
            args = ['sentinels/janitor.py'];
            break;
        default:
            log('System', `Unknown process: ${name}`, 'error');
            return;
    }

    log('System', `Starting ${name}...`, 'info');

    const proc = spawn(cmd, args, {
        cwd,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
    });

    processes[name] = proc;
    processStatus[name] = 'running';
    broadcast({ type: 'status', status: processStatus });

    proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => log(name, line, name));
    });

    proc.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => log(name, line, 'error'));
    });

    proc.on('close', (code) => {
        log('System', `${name} exited with code ${code}`, code === 0 ? 'info' : 'error');
        processes[name] = null;
        processStatus[name] = 'stopped';
        broadcast({ type: 'status', status: processStatus });

        // Phase 10: Refresh and broadcast telemetry if the Hub just finished
        if (name === 'hub') {
            telemetry.refresh();
            broadcast({ type: 'telemetry', data: telemetry.getStats() });
        }
    });
}

function stopProcess(name) {
    const proc = processes[name];
    if (!proc) {
        log('System', `${name} is not running`, 'info');
        return;
    }

    log('System', `Stopping ${name}...`, 'info');

    if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', proc.pid, '/f', '/t']);
    } else {
        proc.kill('SIGTERM');
    }

    processes[name] = null;
    processStatus[name] = 'stopped';
    broadcast({ type: 'status', status: processStatus });
}

function launchMission(missionFile) {
    if (!processes.hub) {
        log('System', 'Hub is not running! Start Hub first.', 'error');
        return;
    }

    if (processes.mission) {
        log('System', 'A mission is already running!', 'error');
        return;
    }

    const cwd = path.join(__dirname, '..');
    const missionPath = path.join('test', missionFile);

    log('System', `Launching mission: ${missionFile}`, 'success');

    const proc = spawn('node', [missionPath], {
        cwd,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
    });

    processes.mission = proc;
    processStatus.mission = 'running';
    broadcast({ type: 'status', status: processStatus });

    proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => log('mission', line, 'intent'));
    });

    proc.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => log('mission', line, 'error'));
    });

    proc.on('close', (code) => {
        log('System', `Mission completed with code ${code}`, code === 0 ? 'success' : 'error');
        processes.mission = null;
        processStatus.mission = 'stopped';
        broadcast({ type: 'status', status: processStatus });
    });
}

// HTTP server for static files
const projectRoot = path.join(__dirname, '..');

const server = http.createServer((req, res) => {
    let filePath;

    // API: Export sentinel
    if (req.method === 'POST' && req.url === '/api/sentinel/export') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { filename, code } = JSON.parse(body);

                if (!filename || !code) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Missing filename or code' }));
                    return;
                }

                // Sanitize filename
                const safeName = filename.replace(/[^a-z0-9_\-\.]/gi, '_');
                const sentinelsDir = path.join(projectRoot, 'sentinels');
                const filePath = path.join(sentinelsDir, safeName);

                // Ensure sentinels directory exists
                if (!fs.existsSync(sentinelsDir)) {
                    fs.mkdirSync(sentinelsDir, { recursive: true });
                }

                // Write the file
                fs.writeFileSync(filePath, code, 'utf8');

                console.log(`[Launcher] Sentinel exported: ${safeName}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, path: `sentinels/${safeName}` }));
            } catch (e) {
                console.error('[Launcher] Export error:', e.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    // Serve sentinel editor
    if (req.url === '/sentinel-editor' || req.url === '/sentinel-editor.html') {
        filePath = path.join(__dirname, 'sentinel_editor.html');
    }
    // Serve launcher UI files from launcher/ directory
    else if (req.url === '/' || req.url.startsWith('/client.js') || req.url.startsWith('/styles.css')) {
        filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    } else {
        // Serve other files (report.html, screenshots/) from project root
        filePath = path.join(projectRoot, req.url);
    }

    const ext = path.extname(filePath);

    // Security: Prevent path traversal attacks
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(projectRoot) && !normalizedPath.startsWith(__dirname)) {
        console.warn(`[Launcher] SECURITY: Blocked path traversal attempt: ${req.url}`);
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.webp': 'image/webp'
    };

    const contentType = mimeTypes[ext] || 'text/plain';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found: ' + req.url);
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║      🛰️  Starlight Mission Control               ║
╠══════════════════════════════════════════════════╣
║  UI:        http://localhost:${PORT}               ║
║  WebSocket: ws://localhost:${WS_PORT}                ║
╚══════════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[Launcher] Shutting down...');
    Object.keys(processes).forEach(name => stopProcess(name));
    setTimeout(() => {
        wss.close();
        server.close();
        process.exit(0);
    }, 1000);
});
function discoverMissions() {
    const testDir = path.join(__dirname, '../test');
    try {
        if (!fs.existsSync(testDir)) return [];
        const files = fs.readdirSync(testDir);
        return files.filter(f => f.startsWith('intent_') && f.endsWith('.js'));
    } catch (e) {
        console.error('[Launcher] Discovery error:', e.message);
        return [];
    }
}

// Start discovery on load
const missions = discoverMissions();
console.log(`[Launcher] Discovered ${missions.length} mission scripts.`);
