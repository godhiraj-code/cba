/**
 * Starlight Intent Helper
 * Event-driven command execution for reliable test missions.
 * Replaces fragile setTimeout-based patterns with response-driven flow.
 */

const WebSocket = require('ws');

class IntentRunner {
    constructor(hubUrl = 'ws://localhost:8080') {
        this.hubUrl = hubUrl;
        this.ws = null;
        this.pendingCommands = new Map();
        this.commandIdCounter = 0;
        this.onContextUpdate = null;
    }

    /**
     * Connect to the Starlight Hub.
     * @returns {Promise<void>}
     */
    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.hubUrl);

            this.ws.on('open', () => {
                console.log('[IntentRunner] Connected to Starlight Hub');
                resolve();
            });

            this.ws.on('message', (data) => {
                const msg = JSON.parse(data);
                this._handleMessage(msg);
            });

            this.ws.on('error', (err) => {
                console.error('[IntentRunner] WebSocket error:', err.message);
                reject(err);
            });

            this.ws.on('close', () => {
                console.log('[IntentRunner] Connection closed');
            });
        });
    }

    _handleMessage(msg) {
        if (msg.type === 'COMMAND_COMPLETE') {
            const pending = this.pendingCommands.get(msg.id);
            if (pending) {
                this.pendingCommands.delete(msg.id);
                if (msg.success) {
                    pending.resolve(msg);
                } else {
                    pending.reject(new Error(`Command ${msg.id} failed`));
                }
            }
        } else if (msg.method === 'starlight.sovereign_update' && this.onContextUpdate) {
            this.onContextUpdate(msg.params.context);
        }
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
     * Send a command and wait for completion.
     * @private
     */
    _sendCommand(params, timeout = 30000) {
        return new Promise((resolve, reject) => {
            const id = `cmd-${++this.commandIdCounter}`;

            const timeoutId = setTimeout(() => {
                this.pendingCommands.delete(id);
                reject(new Error(`Command ${id} timed out after ${timeout}ms`));
            }, timeout);

            this.pendingCommands.set(id, {
                resolve: (result) => {
                    clearTimeout(timeoutId);
                    resolve(result);
                },
                reject: (err) => {
                    clearTimeout(timeoutId);
                    reject(err);
                }
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
     * Signal mission completion and close connection.
     * @param {string} reason - Completion reason
     */
    async finish(reason = 'Mission complete') {
        this.ws.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'starlight.finish',
            params: { reason },
            id: 'shutdown-1'
        }));

        // Give Hub time to process
        await new Promise(r => setTimeout(r, 500));
        this.close();
    }

    /**
     * Close WebSocket connection.
     */
    close() {
        if (this.ws) {
            this.ws.close();
        }
    }
}

module.exports = IntentRunner;
