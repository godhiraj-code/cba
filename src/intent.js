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

    send(cmd) {
        const id = nanoid();
        return new Promise((resolve, reject) => {
            console.log(`[Intent] Executing: ${cmd.cmd}...`);
            this.pending.set(id, { resolve, reject });
            // Starlight v2.0: JSON-RPC Intent Command
            this.ws.send(JSON.stringify({
                jsonrpc: '2.0',
                method: 'starlight.intent',
                params: cmd,
                id
            }));
        });
    }

    handleResponse(data) {
        const msg = JSON.parse(data);
        if (msg.type === 'COMMAND_COMPLETE') {
            const promise = this.pending.get(msg.id);
            if (promise) {
                if (msg.success) promise.resolve();
                else promise.reject();
                this.pending.delete(msg.id);
            }
        }
    }

    async run() {
        console.log("[Intent] Starting Goal-Oriented Pathfinding (Milky Way Strategy)");

        try {
            // 1. Navigate
            const testPath = path.join(process.cwd(), 'test', 'chaos.html');
            await this.send({
                cmd: 'goto',
                url: `file:///${testPath.replace(/\\/g, '/')}`
            });

            // 2. The Patient Navigator: Allow chaos to emerge
            console.log("[Intent] Observing Terrain... (5s)");
            await new Promise(r => setTimeout(r, 5000));

            // 3. Click the Submit Button
            console.log("[Intent] Attempting Click. Navigating by the Stars.");
            await this.send({
                cmd: 'click',
                selector: '#submit-btn'
            });

            console.log("[Intent] GOAL ACHIEVED: The stars guided us.");

            // Starlight v2.0: Signal test completion
            this.ws.send(JSON.stringify({
                jsonrpc: '2.0',
                method: 'starlight.finish',
                params: {},
                id: nanoid()
            }));
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            console.error("[Intent] FAILED: Path blocked or system error.");
        }
    }
}

new IntentScript();
