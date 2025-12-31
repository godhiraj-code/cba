/**
 * Starlight Mission Control - Client Script
 * Connects to launcher server and handles UI interactions
 */

const WS_URL = 'ws://localhost:3001';
let ws = null;
let reconnectTimer = null;

// DOM Elements
const logOutput = document.getElementById('log-output');
const hubBtn = document.getElementById('hub-btn');
const pulseBtn = document.getElementById('pulse-btn');
const janitorBtn = document.getElementById('janitor-btn');
const launchBtn = document.getElementById('launch-btn');
const missionSelect = document.getElementById('mission-select');

// Status icons
const statusIcons = {
    hub: document.getElementById('hub-status'),
    pulse: document.getElementById('pulse-status'),
    janitor: document.getElementById('janitor-status')
};

// Status cards
const statusCards = {
    hub: document.getElementById('hub-card'),
    pulse: document.getElementById('pulse-card'),
    janitor: document.getElementById('janitor-card')
};

// Process state
let processStatus = {
    hub: 'stopped',
    pulse: 'stopped',
    janitor: 'stopped',
    mission: 'stopped'
};

// Connect to WebSocket server
function connect() {
    addLog('System', 'Connecting to launcher server...', 'info');

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        addLog('System', 'Connected to launcher server!', 'success');
        if (reconnectTimer) {
            clearInterval(reconnectTimer);
            reconnectTimer = null;
        }
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
    };

    ws.onclose = () => {
        addLog('System', 'Disconnected from server. Reconnecting...', 'error');
        scheduleReconnect();
    };

    ws.onerror = () => {
        addLog('System', 'Connection error. Is the server running?', 'error');
    };
}

function scheduleReconnect() {
    if (!reconnectTimer) {
        reconnectTimer = setInterval(() => {
            if (!ws || ws.readyState === WebSocket.CLOSED) {
                connect();
            }
        }, 3000);
    }
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'log':
            addLog(msg.source, msg.text, msg.logType);
            break;
        case 'status':
            updateStatus(msg.status);
            break;
    }
}

function updateStatus(status) {
    processStatus = status;

    // Update Hub
    updateProcessUI('hub', status.hub);
    updateProcessUI('pulse', status.pulse);
    updateProcessUI('janitor', status.janitor);

    // Update launch button
    if (status.mission === 'running') {
        launchBtn.textContent = '⏳ Running...';
        launchBtn.disabled = true;
    } else {
        launchBtn.textContent = '🚀 Launch Mission';
        launchBtn.disabled = false;
    }
}

function updateProcessUI(name, state) {
    const icon = statusIcons[name];
    const card = statusCards[name];
    const btn = document.getElementById(`${name}-btn`);

    if (state === 'running') {
        icon.textContent = '🟢';
        card.classList.add('running');
        btn.textContent = 'Stop';
        btn.className = 'btn btn-stop';
    } else {
        icon.textContent = '⚫';
        card.classList.remove('running');
        btn.textContent = 'Start';
        btn.className = 'btn btn-start';
    }
}

function addLog(source, text, logType = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${logType}`;

    const timestamp = new Date().toLocaleTimeString();
    entry.innerHTML = `<span style="opacity: 0.5">[${timestamp}]</span> [${source}] ${text}`;

    logOutput.appendChild(entry);
    logOutput.scrollTop = logOutput.scrollHeight;

    // Limit log entries
    while (logOutput.children.length > 500) {
        logOutput.removeChild(logOutput.firstChild);
    }
}

function send(cmd) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(cmd));
    } else {
        addLog('System', 'Not connected to server!', 'error');
    }
}

// UI Actions
function toggleProcess(name) {
    const state = processStatus[name];
    if (state === 'running') {
        send({ cmd: 'stop', process: name });
    } else {
        send({ cmd: 'start', process: name });
    }
}

function startAll() {
    send({ cmd: 'startAll' });
}

function stopAll() {
    send({ cmd: 'stopAll' });
}

function launchMission() {
    const mission = missionSelect.value;
    send({ cmd: 'launch', mission });
}

function openReport() {
    // Open report.html from the project root (served at /report.html)
    window.open('/report.html', '_blank');
}

function clearLogs() {
    logOutput.innerHTML = '<div class="log-entry log-info">[System] Logs cleared.</div>';
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    connect();
});
