/**
 * Starlight Mission Control - Client Script
 * Connects to launcher server and handles UI interactions
 */

// Logic Fix: Make WebSocket URL configurable via query parameter
const params = new URLSearchParams(window.location.search);
const adminToken = params.get('token') || sessionStorage.getItem('starlightLauncherToken') || '';
if (params.get('token')) {
    sessionStorage.setItem('starlightLauncherToken', params.get('token'));
}
const defaultWsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:3001`;
const WS_URL = params.get('ws') || `${defaultWsUrl}${adminToken ? `?token=${encodeURIComponent(adminToken)}` : ''}`;
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
        case 'telemetry':
            updateVitals(msg.data);
            break;
        case 'missionList':
            updateMissionDropdown(msg.missions);
            break;
        case 'sentinels':
            renderSentinelCards(msg.sentinels);
            break;
        case 'SENTINEL_ERROR': {
            const errText = `🚨 ${msg.layer}: ${msg.error}`;
            window.showToast?.(errText, true);
            addLog(msg.layer, msg.error, 'error');
            break;
        }
        default:
            // Phase 13.5: Handle recording events
            if (msg.type?.startsWith('RECORDING_')) {
                handleRecordingEvent(msg);
            }
            break;
    }
}

function updateVitals(data) {
    if (!data) return;
    document.getElementById('success-rate').textContent = `${data.successRate}%`;
    document.getElementById('saved-effort').innerHTML = `${data.totalSavedMins}<span class="unit">min</span>`;
    document.getElementById('sovereign-mttr').innerHTML = `${Math.round(data.avgRecoveryTimeMs)}<span class="unit">ms</span>`;
    document.getElementById('interventions-count').textContent = data.totalInterventions;
}

function updateStatus(status) {
    processStatus = status;

    // Update all process statuses dynamically
    Object.keys(status).forEach(name => {
        if (name === 'mission') return; // Skip mission, handled separately
        updateProcessUI(name, status[name]);
    });

    // Update launch button
    if (status.mission === 'running') {
        launchBtn.textContent = '⏳ Running...';
        launchBtn.disabled = true;
    } else {
        launchBtn.textContent = '🚀 Launch Mission';
        launchBtn.disabled = false;
    }
}

function updateMissionDropdown(missions) {
    if (!missions) return;
    const select = document.getElementById('mission-select');
    const currentValue = select.value;

    // Clear existing
    select.innerHTML = '';

    // Add missions
    missions.forEach(mission => {
        const option = document.createElement('option');
        option.value = mission;
        option.textContent = mission;
        if (mission === currentValue) option.selected = true;
        select.appendChild(option);
    });

    if (missions.length === 0) {
        const option = document.createElement('option');
        option.textContent = 'No missions found';
        option.disabled = true;
        select.appendChild(option);
    }
}

function updateProcessUI(name, state) {
    // Get elements dynamically - they may not exist in statusIcons/statusCards
    const icon = document.getElementById(`${name}-status`);
    const card = document.getElementById(`${name}-card`);
    const btn = document.getElementById(`${name}-btn`);

    // Skip if elements don't exist (e.g., sentinel cards not yet rendered)
    if (!icon || !card || !btn) return;

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
        const params = { cmd: 'start', process: name };
        if (name === 'hub') {
            const browserSelect = document.getElementById('browser-select');
            const deviceSelect = document.getElementById('device-select');
            const networkSelect = document.getElementById('network-select');
            if (browserSelect) {
                params.browser = browserSelect.value;
            }
            if (deviceSelect && deviceSelect.value) {
                params.device = deviceSelect.value;
            }
            if (networkSelect) {
                params.network = networkSelect.value;
            }
        }
        send(params);
    }
}

function startAll() {
    const browserSelect = document.getElementById('browser-select');
    const deviceSelect = document.getElementById('device-select');
    const networkSelect = document.getElementById('network-select');
    const browser = browserSelect ? browserSelect.value : 'chromium';
    const device = deviceSelect ? deviceSelect.value : null;
    const network = networkSelect ? networkSelect.value : 'online';
    send({ cmd: 'startAll', browser, device, network });
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

// Phase 13.5: Recording
let isRecording = false;

function toggleRecording() {
    if (isRecording) {
        // Stop recording
        const name = prompt('Name for this test (leave empty for auto-generated):');
        send({ cmd: 'stopRecording', name: name || null });
        isRecording = false;
        document.getElementById('record-btn').textContent = '🔴 Record';
        document.getElementById('record-btn').classList.remove('recording');
        document.getElementById('recording-indicator').style.display = 'none';
        addLog('System', '⏹️ Recording stopped. Generating test file...', 'success');
    } else {
        // Start recording
        const urlInput = document.getElementById('record-url');
        const url = urlInput.value.trim() || 'https://google.com';
        send({ cmd: 'startRecording', url: url });
        isRecording = true;
        document.getElementById('record-btn').textContent = '⏹️ Stop';
        document.getElementById('record-btn').classList.add('recording');
        document.getElementById('recording-indicator').style.display = 'block';
        addLog('System', `🔴 Recording started on ${url}. Navigate and interact on the browser.`, 'success');
    }
}

// Handle recording events from server
function handleRecordingEvent(msg) {
    if (msg.type === 'RECORDING_STOPPED' && msg.fileName) {
        addLog('Recorder', `✅ Test file generated: ${msg.fileName}`, 'success');
        // Add new test to dropdown
        const option = document.createElement('option');
        option.value = msg.fileName;
        option.textContent = `📝 ${msg.fileName} (Recorded)`;
        option.selected = true;
        document.getElementById('mission-select').prepend(option);
    } else if (msg.type === 'RECORDING_ERROR') {
        addLog('Recorder', `❌ Error: ${msg.error}`, 'error');
        isRecording = false;
        document.getElementById('record-btn').textContent = '🔴 Record';
        document.getElementById('recording-indicator').style.display = 'none';
    }
}

// Sentinel Fleet Manager: Render dynamic sentinel cards
function renderSentinelCards(sentinels) {
    const grid = document.getElementById('fleet-grid');
    if (!grid) return;

    // Find the "Create Sentinel" card (we'll insert before it)
    const createCard = grid.querySelector('a[href="/sentinel-editor"]');

    // Remove any existing dynamic sentinel cards
    grid.querySelectorAll('.sentinel-card').forEach(card => card.remove());

    // Insert cards for each sentinel
    sentinels.forEach(sentinel => {
        const isRunning = processStatus[sentinel.id] === 'running';
        const card = document.createElement('div');
        card.className = 'status-card sentinel-card';
        card.id = `${sentinel.id}-card`;
        if (isRunning) card.classList.add('running');

        card.innerHTML = `
            <div class="status-header">
                <span class="status-icon" id="${sentinel.id}-status">${isRunning ? '🟢' : '⚫'}</span>
                <h3>${sentinel.icon} ${sentinel.name}</h3>
            </div>
            <p class="status-desc">${getDescription(sentinel.id)}</p>
            <button class="btn ${isRunning ? 'btn-stop' : 'btn-start'}" 
                    id="${sentinel.id}-btn" 
                    onclick="toggleProcess('${sentinel.id}')">
                ${isRunning ? 'Stop' : 'Start'}
            </button>
        `;

        // Insert before the create card
        if (createCard) {
            grid.insertBefore(card, createCard);
        } else {
            grid.appendChild(card);
        }
    });
}

// Get description based on sentinel name
function getDescription(id) {
    const descriptions = {
        'pulse_sentinel': 'Temporal Stability Monitor',
        'janitor': 'Obstacle Clearing Agent',
        'vision_sentinel': 'AI-Powered Visual Detection',
        'data_sentinel': 'Context Injection Engine',
        'pii_sentinel': 'Privacy Data Detection'
    };
    return descriptions[id] || 'Custom Sentinel';
}

// ═══════════════════════════════════════════════════════════════
// Phase 13: Natural Language Intent (NLI)
// ═══════════════════════════════════════════════════════════════

/**
 * Execute a natural language instruction via the Hub
 */
function executeNLI() {
    const input = document.getElementById('nli-input');
    const instruction = input.value.trim();

    if (!instruction) {
        addLog('NLI', 'Please enter a natural language instruction', 'error');
        return;
    }

    addLog('NLI', `🗣️ Executing: "${instruction.substring(0, 50)}${instruction.length > 50 ? '...' : ''}"`, 'info');

    // Send NLI command to launcher server
    send({
        cmd: 'executeNLI',
        instruction: instruction
    });

    // Update button state
    const btn = document.getElementById('nli-btn');
    btn.textContent = '⏳ Running...';
    btn.disabled = true;

    // Reset button after timeout (will be reset by server response in real implementation)
    setTimeout(() => {
        btn.textContent = '🚀 Execute NL';
        btn.disabled = false;
    }, 30000);
}

/**
 * Load example NLI instructions
 */
function loadNLIExample(type) {
    const input = document.getElementById('nli-input');

    const examples = {
        login: 'Go to https://www.saucedemo.com and fill Username with standard_user and fill Password with secret_sauce and click Login',
        checkout: 'Click Add to cart and click shopping cart and click Checkout and fill First Name with Test and fill Last Name with User and fill Zip/Postal Code with 12345 and click Continue',
        search: 'Go to https://www.google.com and fill search with Starlight Protocol and click Search'
    };

    input.value = examples[type] || '';
    addLog('NLI', `📝 Loaded ${type} example`, 'info');
}

/**
 * Check NLI parser status (Ollama availability, model, etc.)
 */
function checkNLIStatus() {
    send({ cmd: 'getNLIStatus' });
    addLog('NLI', '🔍 Checking NLI status...', 'info');
}

/**
 * Toggle Ollama server (start/stop)
 */
let ollamaRunning = false;

function toggleOllama() {
    const btn = document.getElementById('ollama-btn');

    if (ollamaRunning) {
        send({ cmd: 'stopOllama' });
        btn.textContent = '🦙 Launch Ollama';
        btn.className = 'btn btn-start';
        ollamaRunning = false;
        addLog('NLI', '⏹️ Stopping Ollama...', 'info');
    } else {
        send({ cmd: 'startOllama' });
        btn.textContent = '⏹️ Stop Ollama';
        btn.className = 'btn btn-stop';
        ollamaRunning = true;
        addLog('NLI', '🦙 Launching Ollama server...', 'info');
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    connect();

    // Add keyboard shortcut for NLI input (Enter to execute)
    const nliInput = document.getElementById('nli-input');
    if (nliInput) {
        nliInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                executeNLI();
            }
        });
    }
});
