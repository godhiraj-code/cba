const { chromium } = require('playwright');
const { WebSocketServer, WebSocket } = require('ws');
const { nanoid } = require('nanoid');
const fs = require('fs');
const path = require('path');

class CBAHub {
    constructor(port = 8080) {
        this.port = port;
        this.wss = new WebSocketServer({ port });
        this.browser = null;
        this.page = null;
        this.sentinels = new Map();
        this.isLocked = false;
        this.lockOwner = null;
        this.lockTimeout = null;
        this.commandQueue = [];
        this.pendingRequests = new Map();
        this.heartbeatTimeout = 5000;
        this.systemHealthy = true;
        this.reportData = [];
        this.screenshotsDir = path.join(process.cwd(), 'screenshots');
        this.startTime = Date.now();
        this.totalSavedTime = 0; // In seconds
        this.hijackStarts = new Map();

        if (!fs.existsSync(this.screenshotsDir)) fs.mkdirSync(this.screenshotsDir);

        this.init();
    }

    async init() {
        console.log(`[CBA Hub] Starting Starlight Hub: The Hero's Journey...`);
        this.browser = await chromium.launch({ headless: false });
        this.page = await this.browser.newPage();

        this.wss.on('connection', (ws) => {
            const id = nanoid();
            ws.on('message', async (data) => {
                try {
                    const msg = JSON.parse(data);
                    if (!this.validateProtocol(msg)) {
                        console.error(`[CBA Hub] RECV INVALID PROTOCOL from ${id}:`, msg);
                        return;
                    }
                    if (msg.method !== 'starlight.pulse') {
                        console.log(`[CBA Hub] RECV: ${msg.method} from ${this.sentinels.get(id)?.layer || 'Unknown'}`);
                    }
                    await this.handleMessage(id, ws, msg);
                } catch (e) {
                    console.error(`[CBA Hub] Parse Error from ${id}:`, e.message);
                }
            });
            ws.on('close', () => this.handleDisconnect(id));
        });

        setInterval(() => this.checkSystemHealth(), 1000);

        this.page.on('dialog', async dialog => {
            console.log(`[CBA Hub] Auto-dismissing dialog: ${dialog.message()}`);
            await dialog.dismiss();
        });

        await this.page.addInitScript(() => {
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    const node = mutation.target;
                    if (node.nodeType === 1) {
                        window.onMutation({
                            type: 'dom_mutation',
                            target: {
                                tagName: node.tagName,
                                className: node.className,
                                id: node.id,
                                visibility: window.getComputedStyle(node).display
                            }
                        });
                    }
                }
            });
            window.addEventListener('load', () => {
                observer.observe(document.body, {
                    childList: true, subtree: true, attributes: true,
                    attributeFilter: ['style', 'class']
                });
            });
        });
        await this.page.exposeFunction('onMutation', (mutation) => {
            this.broadcastMutation(mutation);
        });
    }

    validateProtocol(msg) {
        // Starlight v2.0: JSON-RPC 2.0 Validation
        return msg.jsonrpc === '2.0' && msg.method && msg.method.startsWith('starlight.') && msg.params;
    }

    handleDisconnect(id) {
        const s = this.sentinels.get(id);
        if (s) {
            console.log(`[CBA Hub] Sentinel Disconnected: ${s.layer}`);
            this.sentinels.delete(id);
            if (this.lockOwner === id) this.releaseLock('Sentinel disconnected');
        }
    }

    async handleMessage(id, ws, msg) {
        const sentinel = this.sentinels.get(id);
        const params = msg.params;

        switch (msg.method) {
            case 'starlight.registration':
                this.sentinels.set(id, { ws, lastSeen: Date.now(), layer: params.layer, priority: params.priority, selectors: params.selectors });
                console.log(`[CBA Hub] Registered Sentinel: ${params.layer} (Priority: ${params.priority})`);
                break;
            case 'starlight.pulse':
                if (sentinel) {
                    sentinel.lastSeen = Date.now();
                    sentinel.currentAura = params.data?.currentAura || [];
                }
                break;
            case 'starlight.clear':
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.get(id).resolve();
                    this.pendingRequests.delete(id);
                }
                break;
            case 'starlight.hijack':
                await this.handleHijack(id, params);
                break;
            case 'starlight.resume':
                this.handleResume(id, params);
                break;
            case 'starlight.intent':
                this.enqueueCommand(id, { ...params, id: msg.id }); // Include JSON-RPC id for response correlation
                break;
            case 'starlight.action':
                await this.executeSentinelAction(id, params);
                break;
            case 'starlight.finish':
                await this.shutdown();
                break;
        }
    }

    async shutdown() {
        console.log("[CBA Hub] Test Finished. Closing gracefully...");
        await this.generateReport();
        if (this.page) await this.page.close();
        if (this.browser) await this.browser.close();
        this.wss.close(() => {
            console.log("[CBA Hub] Hub shutdown complete.");
            process.exit(0);
        });
    }

    async takeScreenshot(name) {
        const filename = `${Date.now()}_${name}.png`;
        const filepath = path.join(this.screenshotsDir, filename);
        if (this.page && !this.page.isClosed()) {
            try {
                await this.page.screenshot({ path: filepath });
                return filename;
            } catch (e) { return null; }
        }
        return null;
    }

    checkSystemHealth() {
        const now = Date.now();
        let healthy = true;
        for (const [id, s] of this.sentinels.entries()) {
            if (s.priority <= 5 && (now - s.lastSeen > this.heartbeatTimeout)) {
                console.error(`[CBA Hub] ERROR: Critical Sentinel ${s.layer} is UNRESPONSIVE.`);
                healthy = false;
            }
        }
        this.systemHealthy = healthy;
    }

    async handleHijack(id, msg) {
        if (!this.systemHealthy) return;
        const requested = this.sentinels.get(id);

        if (this.isLocked) {
            const current = this.sentinels.get(this.lockOwner);
            if (requested.priority < current.priority) {
                this.releaseLock('Preempted by higher priority');
            } else return;
        }

        console.log(`[CBA Hub] Locking for ${requested.layer}. Reason: ${msg.reason}`);
        this.isLocked = true;
        this.lockOwner = id;

        if (this.lockTimeout) clearTimeout(this.lockTimeout);
        this.lockTimeout = setTimeout(() => this.releaseLock('TTL Expired'), 5000);

        const screenshot = await this.takeScreenshot(`HIJACK_${requested.layer}`);

        this.hijackStarts.set(id, Date.now()); // ROI Tracking: Mark start

        this.reportData.push({
            type: 'HIJACK',
            sentinel: requested.layer,
            reason: msg.reason,
            timestamp: new Date().toLocaleTimeString(),
            screenshot
        });

        for (const req of this.pendingRequests.values()) req.reject();
        this.pendingRequests.clear();
    }

    handleResume(id, msg) {
        if (this.lockOwner === id) {
            console.log(`[CBA Hub] RESUME from ${this.sentinels.get(id).layer}`);

            // ROI Tracking: Calculate duration
            const start = this.hijackStarts.get(id);
            if (start) {
                const durationMs = Date.now() - start;
                const savedSeconds = 300 + Math.floor(durationMs / 1000); // 5 mins baseline + duration
                this.totalSavedTime += savedSeconds;
                console.log(`[CBA Hub] ROI Update: Sentinel cleared obstacle in ${durationMs}ms. Estimated ${savedSeconds}s manual effort saved.`);
            }

            this.releaseLock('Resume requested');
            if (msg.re_check) this.commandQueue.unshift({ cmd: 'nop', internal: true });
        }
    }

    releaseLock(reason) {
        this.isLocked = false;
        this.lockOwner = null;
        if (this.lockTimeout) clearTimeout(this.lockTimeout);
        this.processQueue();
    }

    enqueueCommand(clientId, msg) {
        this.commandQueue.push({ clientId, ...msg });
        this.processQueue();
    }

    async processQueue() {
        if (this.isLocked || this.commandQueue.length === 0 || !this.systemHealthy) return;

        const msg = this.commandQueue.shift();
        if (msg.internal && msg.cmd === 'nop') {
            console.log("[CBA Hub] Processing RE_CHECK settling (500ms)...");
            await new Promise(r => setTimeout(r, 500));
            this.processQueue();
            return;
        }

        const clear = await this.broadcastPreCheck(msg);
        if (!clear) {
            this.commandQueue.unshift(msg);
            return;
        }

        const beforeScreenshot = await this.takeScreenshot(`BEFORE_${msg.cmd}`);
        const success = await this.executeCommand(msg);
        const afterScreenshot = await this.takeScreenshot(`AFTER_${msg.cmd}`);

        this.reportData.push({
            type: 'COMMAND',
            id: msg.id,
            cmd: msg.cmd,
            selector: msg.selector,
            success,
            timestamp: new Date().toLocaleTimeString(),
            beforeScreenshot,
            afterScreenshot
        });

        this.broadcastToClient(msg.clientId, { type: 'COMMAND_COMPLETE', id: msg.id, success });
        this.processQueue();
    }

    async broadcastPreCheck(msg) {
        const syncBudget = 30000; // Extended for AI Vision processing (30s for moondream)
        console.log(`[CBA Hub] Awaiting Handshake for ${msg.cmd} (Budget: ${syncBudget / 1000}s)...`);
        const relevantSentinels = Array.from(this.sentinels.entries())
            .filter(([id, s]) => s.priority <= 10);

        if (relevantSentinels.length === 0) return true;

        const allSelectors = [...new Set(relevantSentinels.flatMap(([id, s]) => s.selectors || []))];
        const blockingElements = await this.page.evaluate((selectors) => {
            const results = [];
            selectors.forEach(s => {
                const elements = document.querySelectorAll(s);
                elements.forEach(el => {
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    const isVisible = style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        style.opacity !== '0' &&
                        rect.width > 0 && rect.height > 0;

                    if (isVisible) {
                        results.push({
                            selector: s,
                            id: el.id,
                            className: el.className,
                            display: style.display,
                            rect: `${Math.round(rect.width)}x${Math.round(rect.height)}`
                        });
                    }
                });
            });
            return results;
        }, allSelectors);

        // Phase 2: Capture screenshot for Vision Sentinel AI analysis
        let screenshotB64 = null;
        try {
            const screenshotBuffer = await this.page.screenshot({ type: 'jpeg', quality: 50 });
            screenshotB64 = screenshotBuffer.toString('base64');
            console.log(`[CBA Hub] Screenshot captured for AI analysis (${Math.round(screenshotB64.length / 1024)}KB)`);
        } catch (e) {
            console.warn('[CBA Hub] Screenshot capture failed:', e.message);
        }

        this.broadcast({
            jsonrpc: '2.0',
            method: 'starlight.pre_check',
            params: {
                command: msg,
                blocking: blockingElements,
                screenshot: screenshotB64  // For Vision Sentinel
            },
            id: nanoid()
        });

        const promises = relevantSentinels.map(([id, s]) => {
            return new Promise((resolve, reject) => {
                this.pendingRequests.set(id, { resolve, reject });
            });
        });

        try {
            await Promise.race([
                Promise.all(promises),
                new Promise((_, r) => setTimeout(() => r('timeout'), syncBudget))
            ]);
            return true;
        } catch (e) {
            if (e === 'timeout') console.warn(`[CBA Hub] Handshake TIMEOUT: Sentinel sync exceeded ${syncBudget}ms.`);
            return false;
        } finally {
            this.pendingRequests.clear();
        }
    }

    async executeCommand(msg, retry = true) {
        try {
            if (msg.cmd === 'goto') await this.page.goto(msg.url);
            else if (msg.cmd === 'click') await this.page.click(msg.selector);
            else if (msg.cmd === 'fill') await this.page.fill(msg.selector, msg.text);
            return true;
        } catch (e) {
            if (retry) {
                await new Promise(r => setTimeout(r, 100));
                return await this.executeCommand(msg, false);
            }
            return false;
        }
    }

    async executeSentinelAction(id, msg) {
        if (this.lockOwner !== id) return;
        console.log(`[CBA Hub] Sentinel Action: ${msg.cmd} ${msg.selector} `);
        try {
            if (msg.cmd === 'click') {
                console.log(`[CBA Hub]Force - clicking Sentinel target: ${msg.selector} `);
                try {
                    await this.page.click(msg.selector, { timeout: 2000, force: true });
                } catch (clickErr) {
                    console.warn(`[CBA Hub] Standard click failed, using dispatchEvent fallback...`);
                    await this.page.dispatchEvent(msg.selector, 'click');
                }
                console.log(`[CBA Hub] Sentinel Action SUCCESS: ${msg.selector} `);
            }
        } catch (e) {
            console.error(`[CBA Hub] Sentinel action failed: ${e.message} `);
        }

        // ABSOLUTE SOVEREIGN REMEDIATION: Definitively clear the obstacle via JS
        if (msg.selector.includes('modal') || msg.selector.includes('overlay') || msg.selector.includes('close')) {
            console.log(`[CBA Hub] SOVEREIGN REMEDIATION: Definitively hiding elements matching ${msg.selector}...`);
            await this.page.evaluate((sel) => {
                const elements = document.querySelectorAll('.modal, .overlay, .popup');
                elements.forEach(el => {
                    const style = window.getComputedStyle(el);
                    if (style.display !== 'none') el.style.display = 'none';
                });
            });
        }
    }

    broadcastMutation(mutation) {
        for (const [id, s] of this.sentinels.entries()) {
            if (!s.selectors || s.selectors.some(sel =>
                mutation.target.className.includes(sel.replace('.', '')) ||
                mutation.target.id === sel.replace('#', '')
            )) {
                s.ws.send(JSON.stringify(mutation));
            }
        }
    }

    broadcast(msg) {
        const data = JSON.stringify(msg);
        for (const s of this.sentinels.values()) {
            if (s.ws.readyState === WebSocket.OPEN) s.ws.send(data);
        }
    }

    broadcastToClient(clientId, msg) {
        const data = JSON.stringify(msg);
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(data);
        });
    }

    async generateReport() {
        console.log("[CBA Hub] Generating Hero Story Report...");
        const totalSavedMins = Math.floor(this.totalSavedTime / 60);
        const html = `
    < !DOCTYPE html >
        <html>
            <head>
                <title>CBA Hero Story: Navigational Proof</title>
                <style>
                    body {font - family: 'Inter', sans-serif; background: #0f172a; color: white; padding: 2rem; }
                    .hero-header {text - align: center; padding: 3rem; background: linear-gradient(135deg, #1e293b, #0f172a); border-radius: 12px; margin-bottom: 2rem; border: 1px solid #334155; }
                    .card {background: #1e293b; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid #334155; position: relative; }
                    .hijack {border - left: 6px solid #f43f5e; background: rgba(244, 63, 94, 0.05); }
                    .command {border - left: 6px solid #3b82f6; background: rgba(59, 130, 246, 0.05); }
                    .tag {position: absolute; top: 1rem; right: 1rem; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.7rem; font-weight: bold; text-transform: uppercase; }
                    .tag-hijack {background: #f43f5e; }
                    .tag-command {background: #3b82f6; }
                    img {max - width: 100%; border-radius: 6px; margin-top: 1rem; border: 1px solid #475569; }
                    .flex {display: flex; gap: 1.5rem; }
                    .roi-dashboard {margin - top: 4rem; padding: 2rem; background: #064e3b; border-radius: 12px; border: 2px solid #10b981; text-align: center; }
                    .roi-value {font - size: 3rem; font-weight: 800; color: #10b981; margin: 1rem 0; }
                    .meta {color: #94a3b8; font-size: 0.85rem; margin-bottom: 0.5rem; font-family: monospace; }
                    h1, h3 {margin: 0; }
                    p {color: #cbd5e1; line-height: 1.6; }
                </style>
            </head>
            <body>
                <div class="hero-header">
                    <h1>🌠 Starlight Protocol: The Hero's Journey</h1>
                    <p>Proving that your intent is bigger than the environment's noise.</p>
                </div>

                <div id="timeline">
                    ${this.reportData.map(item => `
                    <div class="card ${item.type.toLowerCase()}">
                        <span class="tag tag-${item.type.toLowerCase()}">${item.type === 'HIJACK' ? 'Sentinel Intervention' : 'Intent Path'}</span>
                        <div class="meta">${item.timestamp}</div>
                        ${item.type === 'HIJACK' ? `
                            <h3>Sovereign Correction: ${item.sentinel}</h3>
                            <p><strong>Reason:</strong> ${item.reason}</p>
                            <img src="screenshots/${item.screenshot}" alt="Obstacle Detected" />
                        ` : `
                            <h3>Navigational Step: ${item.cmd} ${item.selector || ''}</h3>
                            <div class="flex">
                                <div><p class="meta">Before Influence:</p><img src="screenshots/${item.beforeScreenshot}" /></div>
                                <div><p class="meta">After Success:</p><img src="screenshots/${item.afterScreenshot}" /></div>
                            </div>
                        `}
                    </div>
                `).join('')}
                </div>

                <div class="roi-dashboard">
                    <h2>📈 Business Value Dashboard</h2>
                    <div class="roi-value">~${totalSavedMins} Minutes Saved</div>
                    <p>By automating obstacle clearance and environment stability, Starlight prevented manual reproduction and debugging efforts for your engineering team.</p>
                    <p class="meta">ROI Calculation: 5 mins triage baseline + actual intervention duration per obstacle.</p>
                </div>
            </body>
        </html>`;
        fs.writeFileSync(path.join(process.cwd(), 'report.html'), html);
        console.log("[CBA Hub] Hero Story saved to report.html");
    }
}

new CBAHub();
