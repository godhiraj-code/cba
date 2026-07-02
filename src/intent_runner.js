/**
 * Starlight Intent Helper
 * Event-driven command execution for reliable test missions.
 * Replaces fragile setTimeout-based patterns with response-driven flow.
 */

const ws = require('ws');
const crypto = require('crypto');
// Use ws if global.WebSocket doesn't look like our mock (Node 24 global WebSocket is NOT an EventEmitter)
const WebSocket = (typeof global !== 'undefined' && global.WebSocket && (global.WebSocket.isMock || global.WebSocket.name === 'MockWebSocket')) ? global.WebSocket : ws;

class IntentRunner {
    constructor(hubUrl = process.env.HUB_URL || process.env.STARLIGHT_HUB_URL || 'ws://localhost:8080', options = {}) {
        if (typeof hubUrl === 'object' && hubUrl !== null) {
            options = hubUrl;
            hubUrl = options.hubUrl || process.env.HUB_URL || process.env.STARLIGHT_HUB_URL || 'ws://localhost:8080';
        }
        this.hubUrl = hubUrl;
        this.options = options;
        this.authToken = options.authToken || process.env.STARLIGHT_AUTH_TOKEN || null;
        this.layer = options.layer || `IntentRunner-${crypto.randomUUID()}`;
        this.ws = null;
        this.pendingCommands = new Map();
        this.onContextUpdate = null;
    }

    /**
     * Connect to the Starlight Hub.
     * @returns {Promise<void>}
     */
    connect() {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.hubUrl);

                // Use addEventListener for cross-environment compatibility (Node 24 built-in vs ws package)
                this.ws.addEventListener('open', () => {
                    console.log('[IntentRunner] Connected to Starlight Hub');
                    const registrationId = `reg-${crypto.randomUUID()}`;
                    const timeoutId = setTimeout(() => {
                        this.pendingCommands.delete(registrationId);
                        reject(new Error('Hub registration timed out'));
                    }, this.options.registrationTimeout || 5000);

                    this.pendingCommands.set(registrationId, {
                        resolve: () => {
                            clearTimeout(timeoutId);
                            resolve();
                        },
                        reject: (error) => {
                            clearTimeout(timeoutId);
                            reject(error);
                        },
                        cmdDesc: 'Hub registration'
                    });

                    this.ws.send(JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'starlight.registration',
                        params: {
                            layer: this.layer,
                            role: 'intent',
                            priority: 10,
                            capabilities: ['intent'],
                            selectors: [],
                            version: '1.0.0',
                            ...(this.authToken ? { authToken: this.authToken } : {})
                        },
                        id: registrationId
                    }));
                });

                this.ws.addEventListener('message', (event) => {
                    try {
                        const data = typeof event.data === 'string' ? event.data : event.data.toString();
                        const msg = JSON.parse(data);
                        if (this.onMessage) {
                            this.onMessage(msg);
                        }
                        this._handleMessage(msg);
                    } catch (e) {
                        console.error('[IntentRunner] Failed to parse message:', e.message);
                    }
                });

                this.ws.addEventListener('error', (event) => {
                    const error = event.error || { message: 'WebSocket connection failed' };
                    console.error('[IntentRunner] WebSocket error:', error.message);
                    reject(error);
                });

                this.ws.addEventListener('close', () => {
                    console.log('[IntentRunner] Connection closed');
                });
            } catch (err) {
                console.error('[IntentRunner] Failed to initialize WebSocket:', err.message);
                reject(err);
            }
        });
    }

    _handleMessage(msg) {
        // Internal Protocol Tracking
        const msgType = msg.method || msg.type;

        if (msgType === 'starlight.hijack') {
            console.log(`[IntentRunner] 🛡️ Sentinel Hijack Detected: ${msg.params?.sentinel || msg.sentinel}`);
            this.lastActionHijacked = true;
            this.hijackDetails = msg;
        }

        if (msg.id && (Object.prototype.hasOwnProperty.call(msg, 'result') || msg.error)) {
            const pending = this.pendingCommands.get(msg.id);
            if (!pending) return;
            this.pendingCommands.delete(msg.id);

            if (msg.error) {
                pending.reject(new Error(msg.error.message || 'Hub request failed'));
            } else if (msg.result?.success === false) {
                pending.reject(new Error(msg.result.error || `Failed: ${pending.cmdDesc}`));
            } else {
                pending.resolve(msg.result);
            }
            return;
        }

        if (msg.type === 'COMMAND_COMPLETE') {
            const pending = this.pendingCommands.get(msg.id);
            if (pending) {
                this.pendingCommands.delete(msg.id);
                if (msg.success) {
                    pending.resolve(msg);
                } else {
                    const desc = pending.cmdDesc || msg.id;
                    const reason = msg.error || 'Unknown error';
                    pending.reject(new Error(`Failed: ${desc} - ${reason}`));
                }
            }
        } else if (msg.method === 'starlight.sovereign_update' && this.onContextUpdate) {
            this.onContextUpdate(msg.params.context);
        }
    }

    _isSocketOpen() {
        return !!this.ws && this.ws.readyState === 1;
    }

    /**
     * Navigate to a URL and wait for completion.
     * @param {string} url - Target URL
     * @returns {Promise<object>} Command result
     */
    async goto(url) {
        return this._sendCommand({ cmd: 'goto', url });
    }

    /**
     * Click an element by selector.
     * @param {string} selector - CSS selector
     * @returns {Promise<object>} Command result
     */
    async click(selector) {
        return this._sendCommand({ cmd: 'click', selector });
    }

    /**
     * Click an element by semantic goal (text/ARIA).
     * @param {string} goal - Semantic goal text
     * @param {object} context - Optional context metadata
     * @returns {Promise<object>} Command result
     */
    async clickGoal(goal, context = {}) {
        return this._sendCommand({ cmd: 'click', goal, context });
    }

    /**
     * Fill a text input.
     * @param {string} selector - CSS selector
     * @param {string} text - Text to fill
     * @returns {Promise<object>} Command result
     */
    async fill(selector, text) {
        return this._sendCommand({ cmd: 'fill', selector, text });
    }

    /**
     * Fill a form input by semantic goal (label text, placeholder, aria-label).
     * The Hub resolves the input selector automatically.
     * @param {string} goal - Semantic goal (e.g., 'Search', 'Email', 'Password')
     * @param {string} text - Text to fill
     * @param {object} context - Optional context metadata
     * @returns {Promise<object>} Command result
     */
    async fillGoal(goal, text, context = {}) {
        return this._sendCommand({ cmd: 'fill', goal, text, context });
    }

    // === SELECT (Dropdown) ===
    async select(selector, value) {
        return this._sendCommand({ cmd: 'select', selector, value });
    }
    async selectGoal(goal, value, context = {}) {
        return this._sendCommand({ cmd: 'select', goal, value, context });
    }

    // === HOVER ===
    async hover(selector) {
        return this._sendCommand({ cmd: 'hover', selector });
    }
    async hoverGoal(goal, context = {}) {
        return this._sendCommand({ cmd: 'hover', goal, context });
    }

    // === CHECK/UNCHECK (Checkbox) ===
    async check(selector) {
        return this._sendCommand({ cmd: 'check', selector });
    }
    async checkGoal(goal, context = {}) {
        return this._sendCommand({ cmd: 'check', goal, context });
    }
    async uncheck(selector) {
        return this._sendCommand({ cmd: 'uncheck', selector });
    }
    async uncheckGoal(goal, context = {}) {
        return this._sendCommand({ cmd: 'uncheck', goal, context });
    }

    // === SCROLL ===
    async scrollTo(selector) {
        return this._sendCommand({ cmd: 'scroll', selector });
    }
    async scrollToGoal(goal, context = {}) {
        return this._sendCommand({ cmd: 'scroll', goal, context });
    }
    async scrollToBottom() {
        return this._sendCommand({ cmd: 'scroll' });
    }

    // === KEYBOARD ===
    async press(key) {
        return this._sendCommand({ cmd: 'press', key });
    }
    async type(text) {
        return this._sendCommand({ cmd: 'type', text });
    }

    /**
     * Upload file(s) to a file input.
     * @param {string} selector - Direct CSS selector for file input
     * @param {string|string[]} files - File path(s) to upload
     * @returns {Promise<object>} Command result
     */
    async upload(selector, files) {
        return this._sendCommand({ cmd: 'upload', selector, files });
    }

    /**
     * Upload file(s) using semantic goal resolution.
     * @param {string} goal - Semantic goal (e.g., "Resume upload")
     * @param {string|string[]} files - File path(s) to upload
     * @returns {Promise<object>} Command result
     */
    async uploadGoal(goal, files) {
        return this._sendCommand({ cmd: 'upload', goal, files });
    }

    /**
     * Record a logical checkpoint in the mission trace.
     * @param {string} name - Checkpoint name
     * @returns {Promise<object>} Command result
     */
    async checkpoint(name, options = {}) {
        return this._sendCommand({ cmd: 'checkpoint', name }, options.timeout);
    }

    /**
     * Send a command and wait for completion.
     * @private
     */
    _sendCommand(params, timeout = 30000) {
        return new Promise((resolve, reject) => {
            if (!this._isSocketOpen()) {
                reject(new Error('IntentRunner is not connected to the Hub'));
                return;
            }

            const id = `cmd-${crypto.randomUUID()}`;

            // Build human-readable description for error messages
            const cmdDesc = this._describeCommand(params);

            const timeoutId = setTimeout(() => {
                this.pendingCommands.delete(id);
                reject(new Error(`Timeout: ${cmdDesc} did not complete within ${timeout / 1000}s`));
            }, timeout);

            this.pendingCommands.set(id, {
                resolve: (result) => {
                    clearTimeout(timeoutId);
                    resolve(result);
                },
                reject: (err) => {
                    clearTimeout(timeoutId);
                    reject(err);
                },
                cmdDesc  // Store for better error messages
            });

            this.ws.send(JSON.stringify({
                jsonrpc: '2.0',
                method: 'starlight.intent',
                params,
                id
            }));
        });
    }

    /**
     * Create human-readable command description for error messages.
     * @private
     */
    _describeCommand(params) {
        if (params.cmd === 'goto') {
            return `Navigate to "${params.url}"`;
        } else if (params.goal) {
            return `Click goal "${params.goal}"`;
        } else if (params.selector) {
            return `Click "${params.selector}"`;
        } else if (params.cmd === 'fill') {
            return `Fill "${params.selector}"`;
        } else if (params.cmd === 'screenshot') {
            return `Take screenshot "${params.name || 'unnamed'}"`;
        } else if (params.cmd === 'checkpoint') {
            return `Checkpoint "${params.name}"`;
        }
        return `Command "${params.cmd || 'unknown'}"`;
    }

    /**
     * Signal mission completion and close connection.
     * @param {string} reason - Completion reason
     */
    async finish(reason = 'Mission complete') {
        if (this.ws && (this.ws.readyState === 1 || this.ws.readyState === 'OPEN' || (typeof this.ws.readyState === 'number' && this.ws.readyState === 1))) {
            this.ws.send(JSON.stringify({
                jsonrpc: '2.0',
                method: 'starlight.finish',
                params: { reason },
                id: 'shutdown-1'
            }));
            // Give Hub time to process
            await new Promise(r => setTimeout(r, 500));
        } else {
            console.warn('[IntentRunner] Skipping finish send: WebSocket not open');
        }
        this.close();
    }

    /**
     * Close WebSocket connection.
     */
    close() {
        for (const [id, pending] of this.pendingCommands) {
            pending.reject(new Error(`Connection closed before ${pending.cmdDesc || id} completed`));
        }
        this.pendingCommands.clear();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // Phase 13: Natural Language Intent (NLI) Methods
    // ═══════════════════════════════════════════════════════════════

    /**
     * Execute a natural language instruction.
     * Parses the text into structured commands and executes each.
     * 
     * Phase 13: Now requests page context from Hub for context-aware parsing.
     * 
     * @param {string} instruction - Plain English instruction
     * @returns {Promise<object[]>} Results from all executed steps
     * 
     * @example
     * await runner.executeNL('Login with username test and password secret123');
     * await runner.executeNL('Go to saucedemo.com and add first item to cart');
     */
    async executeNL(instruction) {
        // Lazy load NLI parser to avoid import issues if not used
        if (!this._nliParser) {
            const config = this._loadConfig();
            const { NLIParser } = require('./nli/parser');
            this._nliParser = new NLIParser(config.nli || {});
        }

        console.log(`[IntentRunner] 🗣️ NLI: "${instruction.substring(0, 50)}${instruction.length > 50 ? '...' : ''}"`);

        // Request page context from Hub for context-aware parsing
        let pageContext = null;
        try {
            pageContext = await this.requestPageContext();
        } catch (e) {
            console.warn(`[IntentRunner] Could not get page context: ${e.message}`);
        }

        // Parse with page context (parser will use it if fallback is uncertain)
        const steps = await this._nliParser.parse(instruction, pageContext);
        const results = [];

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            console.log(`[IntentRunner] 📝 Step ${i + 1}/${steps.length}: ${step.cmd} ${step.goal || step.url || ''}`);

            try {
                const result = await this._sendCommand(step);
                results.push({ step, success: true, result });
            } catch (error) {
                results.push({ step, success: false, error: error.message });
                throw error; // Re-throw to stop execution on failure
            }
        }

        return results;
    }

    /**
     * Request page context from Hub.
     * Returns buttons, inputs, links, products, and headings on the current page.
     * 
     * @returns {Promise<object>} Page context
     */
    async requestPageContext() {
        // Check if WebSocket is connected
        if (!this._isSocketOpen()) {
            return { error: 'WebSocket not connected' };
        }

        return new Promise((resolve, reject) => {
            const id = `context-${crypto.randomUUID()}`;
            const timeout = setTimeout(() => {
                this.pendingCommands.delete(id);
                resolve({
                    error: 'Page context request timed out',
                    buttons: [],
                    inputs: [],
                    links: [],
                    products: [],
                    headings: []
                });
            }, 10000);

            this.pendingCommands.set(id, {
                resolve: (result) => {
                    clearTimeout(timeout);
                    resolve(result || {});
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                },
                cmdDesc: 'Page context request'
            });

            // Send request
            this.ws.send(JSON.stringify({
                jsonrpc: '2.0',
                method: 'starlight.getPageContext',
                params: {},
                id
            }));
        });
    }

    /**
     * Execute a Gherkin .feature file.
     * 
     * @param {string} featurePath - Path to .feature file
     * @param {string} scenarioName - Optional: run only this scenario
     * @returns {Promise<object[]>} Results from all steps
     * 
     * @example
     * await runner.executeFeature('./test/features/checkout.feature');
     */
    async executeFeature(featurePath, scenarioName = null) {
        const { GherkinBridge } = require('./nli/gherkin');
        const bridge = new GherkinBridge();

        console.log(`[IntentRunner] 📄 Loading feature: ${featurePath}`);
        const parsed = bridge.parseFile(featurePath);

        console.log(`[IntentRunner] Feature: ${parsed.feature}`);
        console.log(`[IntentRunner] Scenarios: ${parsed.scenarios.map(s => s.name).join(', ')}`);

        const results = [];

        for (const scenario of parsed.scenarios) {
            // Skip if specific scenario requested and this isn't it
            if (scenarioName && scenario.name !== scenarioName) {
                continue;
            }

            console.log(`[IntentRunner] 🎬 Scenario: ${scenario.name}`);

            for (const step of scenario.steps) {
                try {
                    const result = await this._sendCommand(step);
                    results.push({ scenario: scenario.name, step, success: true, result });
                } catch (error) {
                    results.push({ scenario: scenario.name, step, success: false, error: error.message });
                    throw error;
                }
            }
        }

        return results;
    }

    /**
     * Generate a .feature file from completed mission trace.
     * 
     * @param {string} tracePath - Path to mission_trace.json
     * @param {string} outputName - Output filename (without .feature)
     * @returns {string} Path to generated feature file
     */
    documentMission(tracePath, outputName = 'generated') {
        const { MissionDocumenter } = require('./nli/documenter');
        const documenter = new MissionDocumenter();

        const content = documenter.generateFromTrace(tracePath, outputName);
        return documenter.save(content, outputName);
    }

    /**
     * Get NLI parser status for diagnostics.
     * @returns {Promise<object>} NLI status
     */
    async getNLIStatus() {
        if (!this._nliParser) {
            const config = this._loadConfig();
            const { NLIParser } = require('./nli/parser');
            this._nliParser = new NLIParser(config.nli || {});
        }
        return this._nliParser.getStatus();
    }

    /**
     * Load config.json for NLI settings.
     * @private
     */
    _loadConfig() {
        try {
            const fs = require('fs');
            const path = require('path');
            const configPath = path.join(__dirname, '..', 'config.json');
            if (fs.existsSync(configPath)) {
                return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            }
        } catch { }
        return {};
    }
}


module.exports = IntentRunner;
