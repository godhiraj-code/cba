/**
 * Starlight Launch Server - Backend for Mission Control
 * Manages Hub and Sentinel processes via WebSocket
 */

const { spawn } = require('child_process');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

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

// WebSocket server for real-time logs
const wss = new WebSocket.Server({ port: WS_PORT });
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('[Launcher] Client connected');

    // Send current status
    ws.send(JSON.stringify({ type: 'status', status: processStatus }));

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

    // Serve launcher UI files from launcher/ directory
    if (req.url === '/' || req.url.startsWith('/client.js') || req.url.startsWith('/styles.css')) {
        filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    } else {
        // Serve other files (report.html, screenshots/) from project root
        filePath = path.join(projectRoot, req.url);
    }

    const ext = path.extname(filePath);

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
