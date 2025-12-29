const WebSocket = require('ws');
const { nanoid } = require('nanoid');
const path = require('path');

class IntentScript {
    constructor(uri = "ws://localhost:8080") {
        this.ws = new WebSocket(uri);
        this.pending = new Map();

        this.ws.on('open', () => {
            // Starlight v2.0: Register as Intent Layer
            this.ws.send(JSON.stringify({
                jsonrpc: '2.0',
                method: 'starlight.registration',
                params: {
                    layer: 'IntentLayer',
                    priority: 100 // Intent is low priority, never hijacks
                },
                id: nanoid()
            }));
            this.run();
        });
        this.ws.on('message', (data) => this.handleResponse(data));
    }

    send(params) {
        const id = nanoid();
        const label = params.cmd || params.goal || 'goal';
        return new Promise((resolve, reject) => {
            console.log(`[Intent] Executing: ${label}...`);
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({
                jsonrpc: '2.0',
                method: 'starlight.intent',
                params: params,
                id
            }));
        });
    }

    handleResponse(data) {
        const msg = JSON.parse(data);
        if (msg.type === 'COMMAND_COMPLETE') {
            const promise = this.pending.get(msg.id);
            if (promise) {
                if (msg.context) {
                    console.log(`[Intent] Shared Sovereign Context Updated:`, msg.context);
                }
                if (msg.success) promise.resolve();
                else promise.reject();
                this.pending.delete(msg.id);
            }
        }
    }

    async run() {
        console.log("[Intent] Starting MISSION: COSMIC CHALLENGE (Semantic Mode)");

        try {
            // 1. Navigate to the Frontier
            const testPath = path.join(process.cwd(), 'test', 'cosmic_challenge.html');
            await this.send({
                cmd: 'goto',
                url: `file:///${testPath.replace(/\\/g, '/')}`
            });

            // 2. The Semantic Command
            // No selectors. No waits. The PulseSentinel & Hub Resolver handle everything.
            console.log("[Intent] Issuing High-Level Command: 'INITIATE MISSION'");
            await this.send({
                goal: 'INITIATE MISSION'
            });

            console.log("[Intent] GALAXY SECURED: Semantic Intent achieved.");
        } catch (e) {
            console.error("[Intent] MISSION FAILED: The void was too great.");
        } finally {
            // Signal test completion
            this.ws.send(JSON.stringify({
                jsonrpc: '2.0',
                method: 'starlight.finish',
                params: {},
                id: nanoid()
            }));
            await new Promise(r => setTimeout(r, 2000));
            process.exit(0);
        }
    }
}

new IntentScript();
