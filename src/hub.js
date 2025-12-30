const { chromium } = require('playwright');
const { WebSocketServer, WebSocket } = require('ws');
const { nanoid } = require('nanoid');
const fs = require('fs');
const path = require('path');

class CBAHub {
    constructor(port = 8080) {
        // Load configuration
        this.config = this.loadConfig();

        this.port = this.config.hub?.port || port;
        this.wss = new WebSocketServer({ port: this.port });
        this.browser = null;
        this.page = null;
        this.sentinels = new Map();
        this.isLocked = false;
        this.lockOwner = null;
        this.lockTimeout = null;
        this.commandQueue = [];
        this.pendingRequests = new Map();
        this.heartbeatTimeout = this.config.hub?.heartbeatTimeout || 5000;
        this.systemHealthy = true;
        this.reportData = [];
        this.screenshotsDir = path.join(process.cwd(), 'screenshots');
        this.totalSavedTime = 0;
        this.hijackStarts = new Map();
        this.lastEntropyBroadcast = 0;
        this.sovereignState = {};
        this.missionTrace = [];
        this.historicalMemory = new Map();
        this.historicalAuras = new Set();
        this.missionStartTime = null;
        this.isProcessing = false;

        if (!fs.existsSync(this.screenshotsDir)) fs.mkdirSync(this.screenshotsDir);

        this.cleanupScreenshots();
        this.loadHistoricalMemory();
        this.init();
    }

    loadConfig() {
        const configPath = path.join(process.cwd(), 'config.json');
        try {
            if (fs.existsSync(configPath)) {
                return JSON.parse(fs.readFileSync(configPath, 'utf8'));
            }
        } catch (e) {
            console.warn('[CBA Hub] Warning: Could not load config.json:', e.message);
        }
        return {};
    }

    cleanupScreenshots() {
        const maxAge = this.config.hub?.screenshotMaxAge || 86400000; // 24h default
        const now = Date.now();
        try {
            const files = fs.readdirSync(this.screenshotsDir);
            let cleaned = 0;
            for (const file of files) {
                const filepath = path.join(this.screenshotsDir, file);
                const stat = fs.statSync(filepath);
                if (now - stat.mtimeMs > maxAge) {
                    fs.unlinkSync(filepath);
                    cleaned++;
                }
            }
            if (cleaned > 0) {
                console.log(`[CBA Hub] Cleanup: Removed ${cleaned} old screenshots.`);
            }
        } catch (e) {
            console.warn('[CBA Hub] Screenshot cleanup failed:', e.message);
        }
    }

    async init() {
        // Mission Safety Timeout from config
        const missionTimeout = this.config.hub?.missionTimeout || 180000;
        setTimeout(() => {
            console.warn("[CBA Hub] MISSION TIMEOUT REACHED. Closing browser...");
            this.shutdown();
        }, missionTimeout);

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
                    await this.recordTrace('RECV', id, msg, msg.method === 'starlight.intent'); // Record snapshot for intents
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

        // v2.0 Phase 3: Network Entropy Tracking
        this.page.on('request', () => this.broadcastEntropy());
        this.page.on('requestfinished', () => this.broadcastEntropy());
        this.page.on('requestfailed', () => this.broadcastEntropy());

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
            // v2.0 Phase 3: Broadcast entropy on mutation
            this.broadcastEntropy();
            this.broadcastMutation(mutation);
        });
    }

    broadcastEntropy() {
        const now = Date.now();
        const throttle = this.config.hub?.entropyThrottle || 100;
        if (now - this.lastEntropyBroadcast < throttle) return;
        this.lastEntropyBroadcast = now;

        const msgObj = {
            jsonrpc: '2.0',
            method: 'starlight.entropy_stream',
            params: { entropy: true },
            id: nanoid()
        };
        const msg = JSON.stringify(msgObj);
        for (const ws of this.wss.clients) {
            if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        }
        // Record entropy for Phase 7.2 learning (Sync-safe fire and forget)
        this.recordTrace('SEND', 'System', msgObj);
    }
    async resolveSemanticIntent(goal) {
        // v2.1 Semantic Resolver: Scans for text matches or ARIA labels
        const target = await this.page.evaluate((goalText) => {
            const buttons = Array.from(document.querySelectorAll('button, a, input[type="button"]'));
            const normalizedGoal = goalText.toLowerCase();

            // 1. Exact Match
            let match = buttons.find(b => b.innerText.toLowerCase().includes(normalizedGoal));

            // 2. Fuzzy ARIA match
            if (!match) {
                match = buttons.find(b =>
                    (b.getAttribute('aria-label') || '').toLowerCase().includes(normalizedGoal) ||
                    (b.id || '').toLowerCase().includes(normalizedGoal)
                );
            }

            if (match) {
                // Generate a unique CSS selector for the Hub to use
                if (match.id) return `#${match.id}`;
                if (match.className) return `.${match.className.split(' ').join('.')}`;
                return match.tagName.toLowerCase();
            }
            return null;
        }, goal);

        if (!target && this.historicalMemory.has(goal)) {
            console.log(`[CBA Hub] Phase 7: Semantic resolution failed. Using Predictive Memory for "${goal}" -> ${this.historicalMemory.get(goal)}`);
            return { selector: this.historicalMemory.get(goal), selfHealed: true };
        }

        return target ? { selector: target, selfHealed: false } : null;
    }

    loadHistoricalMemory() {
        const traceFile = path.join(process.cwd(), 'mission_trace.json');
        if (fs.existsSync(traceFile)) {
            try {
                const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
                if (trace.length === 0) return;

                const firstIntent = trace.find(e => e.method === 'starlight.intent');
                const traceStart = firstIntent ? firstIntent.timestamp : trace[0].timestamp;

                trace.forEach(event => {
                    // 1. Learn Selectors
                    if (event.method === 'starlight.intent' && event.params.goal && event.params.selector) {
                        this.historicalMemory.set(event.params.goal, event.params.selector);
                    }
                    // 2. Learn Entropy Auras (Phase 7.2)
                    if (event.method === 'starlight.entropy_stream') {
                        const relTime = event.timestamp - traceStart;
                        const bucket = Math.floor(relTime / 500);
                        this.historicalAuras.add(bucket);
                    }
                });
                console.log(`[CBA Hub] Phase 7: Learned ${this.historicalMemory.size} selectors and ${this.historicalAuras.size} instability windows.`);
            } catch (e) {
                console.warn("[CBA Hub] Failed to load historical memory:", e.message);
            }
        }
    }

    isHistoricallyUnstable() {
        if (!this.missionStartTime) return false;
        const relTime = Date.now() - this.missionStartTime;
        const bucket = Math.floor(relTime / 500);
        // Check current, next, and previous bucket for a predictive buffer
        return this.historicalAuras.has(bucket) ||
            this.historicalAuras.has(bucket + 1) ||
            this.historicalAuras.has(bucket - 1);
    }

    broadcastContextUpdate() {
        const msg = JSON.stringify({
            jsonrpc: '2.0',
            method: 'starlight.sovereign_update',
            params: { context: this.sovereignState },
            id: nanoid()
        });
        for (const ws of this.wss.clients) {
            if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        }
    }

    async recordTrace(type, sentinelId, data, includeSnapshot = false) {
        if (data.method === 'starlight.pulse') return;
        const sentinel = this.sentinels.get(sentinelId);
        const snapshot = includeSnapshot ? await this.takeDOMSnapshot() : null;

        this.missionTrace.push({
            timestamp: Date.now(),
            humanTime: new Date().toLocaleTimeString(),
            type,
            layer: sentinel ? sentinel.layer : (sentinelId === 'System' ? 'System' : 'Intent'),
            method: data.method,
            params: data.params,
            id: data.id,
            snapshot
        });

        // Trace rotation: keep only the last N events
        const maxEvents = this.config.hub?.traceMaxEvents || 500;
        if (this.missionTrace.length > maxEvents) {
            this.missionTrace = this.missionTrace.slice(-maxEvents);
        }
    }

    async takeDOMSnapshot() {
        if (!this.page || this.page.isClosed()) return null;
        try {
            return await this.page.content();
        } catch (e) { return null; }
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
                this.sentinels.set(id, {
                    ws,
                    lastSeen: Date.now(),
                    layer: params.layer,
                    priority: params.priority,
                    selectors: params.selectors,
                    capabilities: params.capabilities
                });
                console.log(`[CBA Hub] Registered Sentinel: ${params.layer} (Priority: ${params.priority})`);
                break;
            case 'starlight.pulse':
                if (sentinel) {
                    sentinel.lastSeen = Date.now();
                    sentinel.currentAura = params.data?.currentAura || [];
                }
                break;
            case 'starlight.context_update':
                // Phase 4: Context Injection from Sentinels
                if (params.context) {
                    console.log(`[CBA Hub] Context Injection from ${sentinel?.layer || 'Unknown'}:`, params.context);
                    this.sovereignState = { ...this.sovereignState, ...params.context };
                    this.broadcastContextUpdate();
                }
                break;
            case 'starlight.clear':
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.get(id).resolve(msg);
                    this.pendingRequests.delete(id);
                }
                break;
            case 'starlight.wait':
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.get(id).resolve(msg);
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
                // Phase 5: Handle Semantic Intent (Goal-based)
                if (msg.params.goal) {
                    console.log(`[CBA Hub] Resolving Semantic Goal: "${msg.params.goal}"`);
                    const result = await this.resolveSemanticIntent(msg.params.goal);
                    if (result) {
                        msg.params.selector = result.selector;
                        msg.params.selfHealed = result.selfHealed;
                        msg.params.cmd = 'click'; // Default semantic action

                        // ROI: If semantic resolution used history, count it as saved triage time
                        if (result.selfHealed) {
                            this.totalSavedTime += 120; // ROI: 2 mins triage avoided
                        }
                    } else {
                        console.error(`[CBA Hub] FAILED to resolve semantic goal: ${msg.params.goal}`);
                        this.broadcastToClient(id, { type: 'COMMAND_COMPLETE', id: msg.id, success: false });
                        return;
                    }
                }
                this.enqueueCommand(id, { ...msg.params, id: msg.id });
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
        // Wait for queue to drain
        while (this.commandQueue.length > 0 || this.isLocked || this.isProcessing) {
            await new Promise(r => setTimeout(r, 100));
        }
        await this.generateReport();
        await this.saveMissionTrace();
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
        const lockTTL = this.config.hub?.lockTTL || 5000;
        this.lockTimeout = setTimeout(() => this.releaseLock('TTL Expired'), lockTTL);

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
        if (this.isLocked || this.commandQueue.length === 0 || !this.systemHealthy || this.isProcessing) return;

        if (!this.missionStartTime) this.missionStartTime = Date.now();

        this.isProcessing = true;
        try {
            const msg = this.commandQueue.shift();
            if (msg.internal && msg.cmd === 'nop') {
                console.log("[CBA Hub] Processing RE_CHECK settling (500ms)...");
                await new Promise(r => setTimeout(r, 500));
                this.isProcessing = false;
                this.processQueue();
                return;
            }

            // Phase 7.2: Aura-Based Throttling (Predictive Pacing)
            let predictiveWait = false;
            if (this.isHistoricallyUnstable()) {
                const auraWait = this.config.aura?.predictiveWaitMs || 1500;
                console.log(`[CBA Hub] Aura Detected: Proactively slowing down for historical jitter...`);
                await new Promise(r => setTimeout(r, auraWait));
                predictiveWait = true;
                this.totalSavedTime += 30;
            }

            const clear = await this.broadcastPreCheck(msg);
            if (!clear) {
                console.log(`[CBA Hub] Pre-check failed or timed out for ${msg.cmd}. Retrying in 2s...`);
                this.commandQueue.unshift(msg);
                setTimeout(() => {
                    this.isProcessing = false;
                    this.processQueue();
                }, 2000);
                return;
            }

            // v2.1: Robust Screenshot Timing (Wait for settlement)
            const beforeScreenshot = await this.takeScreenshot(`BEFORE_${msg.cmd}`);
            const originalSelector = msg.selector;
            const success = await this.executeCommand(msg);
            const selfHealed = originalSelector !== msg.selector;

            // Brief wait for UI to reflect change before "AFTER" capture
            await new Promise(r => setTimeout(r, 500));
            const afterScreenshot = await this.takeScreenshot(`AFTER_${msg.cmd}`);

            this.reportData.push({
                type: 'COMMAND',
                id: msg.id,
                cmd: msg.cmd,
                selector: msg.selector || msg.goal,
                url: msg.url, // Phase 7: Capture URL for GOTO reporting
                success,
                selfHealed: selfHealed || msg.selfHealed, // Phase 7: Tracking Predictive Healing
                predictiveWait, // Phase 7.2: Tracking Aura Throttling
                timestamp: new Date().toLocaleTimeString(),
                beforeScreenshot,
                afterScreenshot
            });

            this.broadcastToClient(null, {
                type: 'COMMAND_COMPLETE',
                id: msg.id,
                success,
                context: this.sovereignState // Phase 4: Return shared context to Intent
            });
        } finally {
            this.isProcessing = false;
        }
        this.processQueue();
    }

    async broadcastPreCheck(msg) {
        const syncBudget = this.config.hub?.syncBudget || 30000;
        console.log(`[CBA Hub] Awaiting Handshake for ${msg.cmd} (Budget: ${syncBudget / 1000}s)...`);

        const relevantSentinels = Array.from(this.sentinels.entries())
            .filter(([id, s]) => s.priority <= 10);

        if (relevantSentinels.length === 0) return true;

        const allSelectors = [...new Set(relevantSentinels.flatMap(([id, s]) => s.selectors || []))];

        // v2.0 Phase 2: Add AI context (screenshot) if deep analysis is capability-flagged
        let screenshotB64 = null;
        if (relevantSentinels.some(([id, s]) => s.capabilities?.includes('vision'))) {
            try {
                const screenshotBuffer = await this.page.screenshot({ type: 'jpeg', quality: 80 });
                screenshotB64 = screenshotBuffer.toString('base64');
                console.log(`[CBA Hub] Screenshot captured for AI analysis (${Math.round(screenshotB64.length / 1024)}KB)`);
            } catch (e) {
                console.warn('[CBA Hub] Screenshot capture failed:', e.message);
            }
        }

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

        // Standardize broadcast
        this.broadcast({
            jsonrpc: '2.0',
            method: 'starlight.pre_check',
            params: {
                command: msg,
                blocking: blockingElements,
                screenshot: screenshotB64
            },
            id: nanoid()
        });

        // Use standard pendingRequests logic
        const promises = relevantSentinels.map(([id, s]) => {
            return new Promise((resolve, reject) => {
                this.pendingRequests.set(id, { resolve, reject, layer: s.layer });
            });
        });

        try {
            const results = await Promise.race([
                Promise.all(promises),
                new Promise((_, r) => setTimeout(() => r('timeout'), syncBudget))
            ]);
            console.log(`[CBA Hub] Handshake COMPLETED for ${msg.cmd}.`);

            // Phase 3: Check for Stability Wait requests
            const waitRequest = results.find(res => res && res.method === 'starlight.wait');
            if (waitRequest) {
                const delay = waitRequest.params?.retryAfterMs || 1000;
                console.log(`[CBA Hub] Stability VETO from Sentinel. Waiting ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                return false;
            }

            return true;
        } catch (e) {
            if (e === 'timeout') {
                const missing = Array.from(this.pendingRequests.values()).map(r => r.layer).join(', ');
                console.warn(`[CBA Hub] Handshake TIMEOUT: Missing signals from [${missing}] within ${syncBudget}ms.`);
                this.pendingRequests.clear();
            }
            return false;
        }
    }

    async executeCommand(msg, retry = true) {
        try {
            if (msg.cmd === 'goto') await this.page.goto(msg.url);
            else if (msg.cmd === 'click') await this.page.click(msg.selector);
            else if (msg.cmd === 'fill') await this.page.fill(msg.selector, msg.text);
            return true;
        } catch (e) {
            console.warn(`[CBA Hub] Command failure on ${msg.selector}: ${e.message}`);

            // Phase 7: Predictive Self-Healing
            if (retry && msg.goal && this.historicalMemory.has(msg.goal)) {
                const altSelector = this.historicalMemory.get(msg.goal);
                if (altSelector !== msg.selector) {
                    console.log(`[CBA Hub] SELF-HEALING: Attempting historical substitute for "${msg.goal}" -> ${altSelector}`);
                    msg.selector = altSelector;
                    const success = await this.executeCommand(msg, false);
                    if (success) {
                        this.totalSavedTime += 180; // ROI: 3 mins manual debugging avoided
                    }
                    return success;
                }
            }

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

    async broadcast(msg) {
        const data = JSON.stringify(msg);
        await this.recordTrace('SEND', 'All', msg, msg.method === 'starlight.pre_check');
        for (const s of this.sentinels.values()) {
            if (s.ws.readyState === WebSocket.OPEN) s.ws.send(data);
        }
    }

    async broadcastToClient(clientId, msg) {
        const data = JSON.stringify(msg);
        await this.recordTrace('SEND', clientId, msg);
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(data);
        });
    }

    async generateReport() {
        console.log("[CBA Hub] Generating Hero Story Report...");
        const totalSavedMins = Math.floor(this.totalSavedTime / 60);
        const html = `
    <!DOCTYPE html>
        <html>
            <head>
                <title>CBA Hero Story: Navigational Proof</title>
                <style>
                    body { font-family: 'Inter', -apple-system, sans-serif; background: #0f172a; color: white; padding: 2rem; max-width: 1200px; margin: auto; }
                    .hero-header { text-align: center; padding: 3rem; background: linear-gradient(135deg, #1e293b, #0f172a); border-radius: 12px; margin-bottom: 2rem; border: 1px solid #334155; }
                    .card { background: #1e293b; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid #334155; position: relative; }
                    .hijack { border-left: 6px solid #f43f5e; background: rgba(244, 63, 94, 0.05); }
                    .command { border-left: 6px solid #3b82f6; background: rgba(59, 130, 246, 0.05); }
                    .tag { position: absolute; top: 1rem; right: 1rem; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.7rem; font-weight: bold; text-transform: uppercase; }
                    .tag-hijack { background: #f43f5e; }
                    .tag-command { background: #3b82f6; }
                    img { max-width: 100%; border-radius: 6px; margin-top: 1rem; border: 1px solid #475569; }
                    .flex { display: flex; gap: 1.5rem; margin-top: 1rem; }
                    .roi-dashboard { margin-top: 4rem; padding: 2rem; background: #064e3b; border-radius: 12px; border: 2px solid #10b981; text-align: center; }
                    .roi-value { font-size: 3rem; font-weight: 800; color: #10b981; margin: 1rem 0; }
                    .meta { color: #94a3b8; font-size: 0.85rem; margin-bottom: 0.5rem; font-family: monospace; }
                    .card-title { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem; font-size: 1.25rem; font-weight: bold; }
                    .badge { padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: bold; }
                    .badge-success { background: #10b981; }
                    .badge-danger { background: #f43f5e; }
                    .badge-warning { background: #f59e0b; color: #0f172a; }
                    .badge-info { background: #3b82f6; }
                    h1, h3 { margin: 0; }
                    p { color: #cbd5e1; line-height: 1.6; }
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
                            <div class="card-title">
                                <span>${item.cmd.toUpperCase()}: ${item.cmd === 'goto' ? item.url : (item.selector || item.goal)}</span>
                                <span class="badge ${item.success ? 'badge-success' : 'badge-danger'}">${item.success ? 'SUCCESS' : 'FAILURE'}</span>
                                ${item.selfHealed ? '<span class="badge badge-warning">SELF-HEALED</span>' : ''}
                                ${item.predictiveWait ? '<span class="badge badge-info">AURA STABILIZED</span>' : ''}
                            </div>
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

    async saveMissionTrace() {
        console.log(`[CBA Hub]Saving Mission Trace(${this.missionTrace.length} events)...`);
        const traceFile = path.join(process.cwd(), 'mission_trace.json');
        fs.writeFileSync(traceFile, JSON.stringify(this.missionTrace, null, 2));
        console.log("[CBA Hub] Mission Trace saved to mission_trace.json");
    }
}

new CBAHub();
