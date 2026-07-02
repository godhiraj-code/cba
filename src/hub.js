const { BrowserAdapter } = require('./browser_adapter');
const { WebSocketServer, WebSocket } = require('ws');
const { nanoid } = require('nanoid');
const fs = require('fs');
const path = require('path');
const TelemetryEngine = require('./telemetry');
const ActionRecorder = require('./recorder');
const WebhookNotifier = require('./webhook');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { version: PACKAGE_VERSION } = require('../package.json');

// Phase 1 Security: Import security modules
const { JWTHandler } = require('./auth/jwt_handler');
const { SchemaValidator } = require('./validation/schema_validator');
const { PIIRedactor } = require('./utils/pii_redactor');
const { AtomicLock } = require('./sync/atomic_lock');
const { InteractiveElementCache } = require('./cache/element_cache');

// Security: HTML escaping to prevent XSS
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

class CBAHub {
    constructor(port = 8080, headless = false) {
        // Load configuration
        this.config = this.loadConfig();
        this.headless = headless || this.config.hub?.headless || false;

        this.port = port || this.config.hub?.port || 8080;
        this.host = process.env.STARLIGHT_HOST || this.config.hub?.host || '127.0.0.1';
        this.authToken = process.env.STARLIGHT_AUTH_TOKEN || this.config.hub?.security?.authToken || null;
        this.authRequired = this.config.hub?.security?.authRequired === true ||
            !!this.authToken ||
            !!(this.config.hub?.security?.jwtSecret || process.env.STARLIGHT_JWT_SECRET);
        this.clients = new Map();

        // Create HTTP or HTTPS server based on SSL config
        const sslConfig = this.config.hub?.security?.ssl;
        const requestHandler = (req, res) => {
            if (req.url === '/health') {
                const status = {
                    status: this.isShuttingDown ? 'shutting_down' : (this.ready ? 'healthy' : 'starting'),
                    ready: this.ready,
                    version: PACKAGE_VERSION,
                    protocol: 'starlight/1.0.0',
                    uptime: process.uptime(),
                    sentinels: Array.from(this.sentinels?.values() || []).map(s => ({
                        layer: s.layer,
                        priority: s.priority,
                        capabilities: s.capabilities
                    })),
                    mission: {
                        active: (this.commandQueue?.length || 0) > 0 || this.isProcessing,
                        queueLength: this.commandQueue?.length || 0,
                        isLocked: this.isLocked || false
                    },
                    security: {
                        authEnabled: this.authRequired,
                        sslEnabled: sslConfig?.enabled || false
                    }
                };
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(status, null, 2));
            } else {
                res.writeHead(404);
                res.end();
            }
        };

        if (sslConfig?.enabled && sslConfig.keyPath && sslConfig.certPath) {
            const sslOptions = {
                key: fs.readFileSync(sslConfig.keyPath),
                cert: fs.readFileSync(sslConfig.certPath)
            };
            this.server = https.createServer(sslOptions, requestHandler);
            console.log('[CBA Hub] SSL enabled - using WSS (secure WebSocket)');
        } else {
            this.server = http.createServer(requestHandler);
        }

        const maxPayload = this.config.hub?.security?.maxMessageBytes || 1024 * 1024;
        this.wss = new WebSocketServer({
            server: this.server,
            maxPayload,
            verifyClient: ({ origin }, done) => {
                const allowedOrigins = this.config.hub?.security?.allowedOrigins || [];
                if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
                    done(true);
                    return;
                }
                done(false, 403, 'Origin not allowed');
            }
        });
        this.browserAdapter = null;  // Phase 14.1: Cross-browser adapter
        this.browser = null;
        this.page = null;
        this.sentinels = new Map();
        this.isLocked = false;
        this.lockOwner = null;
        this.lockTimeout = null;
        this.commandQueue = [];
        this.pendingRequests = new Map();
        this.activeRequestIds = new Set();
        this.retryTimers = new Set();
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
        this.ready = false;
        this.isProcessing = false;
        this.isShuttingDown = false;
        this.recorder = new ActionRecorder();  // Phase 13.5: Test Recorder

        // Phase 8.5: Performance & Safety
        this.memoryLock = new AtomicLock({ ttl: 5000 });
        this.elementCache = new InteractiveElementCache();

        // Phase 1 Security: Initialize security handlers
        this.jwtHandler = new JWTHandler({
            secret: this.config.hub?.security?.jwtSecret || process.env.STARLIGHT_JWT_SECRET,
            expiresIn: this.config.hub?.security?.tokenExpiry || 3600
        });
        this.schemaValidator = new SchemaValidator();
        this.piiRedactor = new PIIRedactor({ enabled: this.config.hub?.security?.piiRedaction !== false });

        if (!fs.existsSync(this.screenshotsDir)) fs.mkdirSync(this.screenshotsDir);

        this.cleanupScreenshots();
        this.loadHistoricalMemory();
        this.telemetry = new TelemetryEngine(path.join(process.cwd(), 'telemetry.json'));
        this.webhooks = new WebhookNotifier(this.config.webhooks);
        this.recoveryTimes = []; // Track recovery times for MTTR
        this.temporalMetrics = []; // Phase 17.4: Temporal Ghosting metrics
    }

    loadConfig() {
        const configPath = path.join(process.cwd(), 'config.json');
        if (!fs.existsSync(configPath)) return {};

        let config;
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (error) {
            throw new Error(`Could not parse config.json: ${error.message}`);
        }

        const { validateConfig } = require('./validation/config_schema');
        const validation = validateConfig(config);
        if (!validation.valid) {
            throw new Error(`Invalid config.json:\n- ${validation.errors.join('\n- ')}`);
        }

        console.log('[CBA Hub] Configuration validated successfully');
        return config;
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

    async setupNetworkInterception() {
        const networkConfig = this.config.network?.chaos || {};

        if (!networkConfig.enabled) {
            return;
        }

        console.log('[CBA Hub] Phase 9: Traffic Sovereign ENABLED');

        // Extract config values outside the callback to avoid scope issues
        const blockPatterns = networkConfig.blockPatterns || [];
        const latency = networkConfig.latencyMs || 0;

        await this.page.route('**/*', async (route) => {
            const url = route.request().url();

            // Check block patterns
            for (const pattern of blockPatterns) {
                if (url.includes(pattern)) {
                    console.log(`[CBA Hub] BLOCKED: ${url}`);
                    await route.abort('blockedbyclient');
                    return;
                }
            }

            // Apply latency if configured
            if (latency > 0) {
                await new Promise(r => setTimeout(r, latency));
            }

            // Continue with request
            await route.continue();
        });

        console.log(`[CBA Hub] Traffic rules: block=${blockPatterns.length} patterns, latency=${latency}ms`);
    }

    async init() {
        // Mission Safety Timeout from config
        const missionTimeout = this.config.hub?.missionTimeout || 180000;
        this.missionTimeoutHandle = setTimeout(() => {
            console.warn("[CBA Hub] MISSION TIMEOUT REACHED. Closing browser...");
            this.shutdown('Mission timeout');
        }, missionTimeout);

        // Initialize HTTP server
        if (!this.isLoopbackHost(this.host) && !this.authRequired) {
            throw new Error('Authentication is required when the Hub listens on a non-loopback host');
        }

        await new Promise((resolve, reject) => {
            const onError = error => {
                this.server.off('listening', onListening);
                reject(error);
            };
            const onListening = () => {
                this.server.off('error', onError);
                console.log(`[CBA Hub] Starting Starlight Hub: The Hero's Journey...`);
                console.log(`[CBA Hub] WebSocket/HTTP Server listening on ${this.host}:${this.port}`);
                resolve();
            };
            this.server.once('error', onError);
            this.server.once('listening', onListening);
            this.server.listen(this.port, this.host);
        });

        // Phase 14.1/14.2: Cross-Browser & Mobile Support via Adapter Pattern
        console.log(`[CBA Hub] Initializing browser adapter...`);
        const browserConfig = this.config.hub?.browser || {};
        this.browserAdapter = await BrowserAdapter.create(browserConfig);

        this.browser = await this.browserAdapter.launch({ headless: this.headless });

        // Phase 14.2: Create context with mobile device emulation if configured
        const contextOptions = {};
        if (browserConfig.mobile?.enabled && browserConfig.mobile?.device) {
            contextOptions.mobile = browserConfig.mobile;
            console.log(`[CBA Hub] 📱 Mobile emulation enabled: ${browserConfig.mobile.device}`);
        }
        await this.browserAdapter.newContext(contextOptions);
        this.page = await this.browserAdapter.newPage();

        // Phase 14.2: Apply network emulation if configured (Chromium only)
        const networkEmulation = this.config.hub?.network?.emulation;
        if (networkEmulation && networkEmulation !== 'online') {
            const success = await this.browserAdapter.setNetworkConditions(networkEmulation);
            if (success) {
                console.log(`[CBA Hub] 📡 Network emulation: ${networkEmulation.toUpperCase()}`);
            }
        }

        // Log browser capabilities for diagnostics
        const capabilities = this.browserAdapter.getCapabilities();
        console.log(`[CBA Hub] Browser Engine: ${this.browserAdapter.browserType}`);
        console.log(`[CBA Hub] Capabilities:`, capabilities);

        // Phase 9: Traffic Sovereign - Network Interception
        await this.setupNetworkInterception();

        this.wss.on('connection', (ws) => {
            const id = nanoid();
            this.clients.set(id, {
                id,
                ws,
                authenticated: false,
                role: null,
                layer: null,
                registeredAt: null
            });
            ws.on('message', async (data) => {
                try {
                    const msg = JSON.parse(data);
                    if (!this.validateProtocol(msg)) {
                        console.error(
                            `[CBA Hub] RECV INVALID PROTOCOL from ${id}:`,
                            this.piiRedactor.redactObject(msg)
                        );
                        this.sendRpcError(ws, msg?.id, -32600, 'Invalid Request');
                        return;
                    }
                    if (msg.method !== 'starlight.pulse') {
                        console.log(`[CBA Hub] RECV: ${msg.method} from ${this.sentinels.get(id)?.layer || 'Unknown'}`);
                    }
                    await this.recordTrace('RECV', id, msg, msg.method === 'starlight.intent'); // Record snapshot for intents
                    await this.handleMessage(id, ws, msg);
                } catch (e) {
                    console.error(`[CBA Hub] Parse Error from ${id}:`, e.message);
                    this.sendRpcError(ws, null, -32700, 'Parse error');
                }
            });
            ws.on('close', () => this.handleDisconnect(id));
        });

        this.healthCheckInterval = setInterval(() => this.checkSystemHealth(), 1000);

        // Setup the initial page with all handlers
        await this.setupPage();
        this.ready = true;
        console.log('[CBA Hub] Protocol runtime is ready.');
    }

    /**
     * Setup page with all required handlers, observers, and exposed functions.
     * This is called both in init() and when creating a new page for recording.
     */
    async setupPage() {
        if (!this.page) return;

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

        try {
            await this.page.exposeFunction('onMutation', (mutation) => {
                // v2.0 Phase 3: Broadcast entropy on mutation
                this.broadcastEntropy();
                this.broadcastMutation(mutation);
            });
        } catch (e) {
            // Function might already be exposed in this context
        }
    }

    broadcastEntropy() {
        const now = Date.now();
        // Phase 8.5: Increased throttle to 500ms (Issue 12)
        const throttle = this.config.hub?.entropyThrottle || 500;
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
        // Phase 9: Added Shadow DOM traversal support
        const shadowEnabled = this.config.hub?.shadowDom?.enabled !== false;
        const maxDepth = this.config.hub?.shadowDom?.maxDepth || 5;

        const resolveStart = Date.now();
        const target = await this.page.evaluate(({ goalText, shadowEnabled, maxDepth }) => {

            const normalizedGoal = goalText.toLowerCase();

            function escapeCssText(text) {
                if (!text) return '';
                return text.replace(/["\\]/g, '\\$&').replace(/\n/g, ' ').trim();
            }

            // Helper: Recursively collect elements from shadow roots
            function collectElements(root, selector, depth = 0) {
                if (depth > maxDepth) return [];
                let elements = Array.from(root.querySelectorAll(selector));

                if (shadowEnabled) {
                    // Find all elements that might have shadow roots
                    const allElements = root.querySelectorAll('*');
                    for (const el of allElements) {
                        if (el.shadowRoot) {
                            elements = elements.concat(collectElements(el.shadowRoot, selector, depth + 1));
                        }
                    }
                }
                return elements;
            }

            // Helper: Generate a selector that pierces shadow DOM
            function generateShadowSelector(element) {
                const path = [];
                let current = element;

                while (current && current !== document.body) {
                    if (current.id) {
                        path.unshift(`#${current.id}`);
                        break;
                    } else if (current.className && typeof current.className === 'string') {
                        path.unshift(`.${current.className.split(' ').filter(c => c).join('.')}`);
                    } else {
                        path.unshift(current.tagName?.toLowerCase() || '*');
                    }

                    // Check if we're crossing a shadow boundary
                    if (current.getRootNode() instanceof ShadowRoot) {
                        const shadowHost = current.getRootNode().host;
                        path.unshift('>>>'); // Playwright shadow-piercing combinator
                        current = shadowHost;
                    } else {
                        current = current.parentElement;
                    }
                }
                return path.join(' ');
            }

            // ═══════════════════════════════════════════════════════════════════════════
            // UNIVERSAL SEMANTIC RESOLVER - Works on ANY website
            // ═══════════════════════════════════════════════════════════════════════════

            // Phase 1: EXHAUSTIVE element discovery - scan EVERYTHING that could be interactive
            const INTERACTIVE_SELECTORS = [
                // Standard interactive elements
                'button', 'a', 'input', 'select', 'textarea', 'summary',
                // ARIA roles
                '[role="button"]', '[role="link"]', '[role="menuitem"]', '[role="tab"]',
                '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="option"]',
                // Event handlers (only valid CSS selectors)
                '[onclick]', '[onmousedown]', '[onmouseup]', '[ontouchstart]',
                // Accessibility markers
                '[tabindex]', '[aria-haspopup]', '[aria-expanded]',
                // Common class patterns
                '[class*="btn"]', '[class*="button"]', '[class*="link"]',
                '[class*="cart"]', '[class*="menu"]', '[class*="nav"]', '[class*="action"]',
                // Icons (simplified - no compound selectors that might fail)
                'svg', '[class*="icon"]',
                // Custom data attributes
                '[data-action]', '[data-toggle]', '[data-target]', '[data-testid]'
            ].join(', ');


            const allInteractive = collectElements(document, INTERACTIVE_SELECTORS);

            // Phase 2: MULTI-STRATEGY text extraction - get text from EVERY possible source
            function extractAllText(el) {
                const texts = [];

                // Direct element text
                const innerText = (el.innerText || '').trim();
                const textContent = (el.textContent || '').trim();
                if (innerText) texts.push(innerText);
                else if (textContent && textContent.length < 100) texts.push(textContent);

                // Phase 14: Generic Semantic Class Extraction
                // Check for semantic meaning in class names regardless of text content
                // e.g. "shopping_cart_link" -> "shopping cart link"
                if (el.classList && el.classList.length > 0) {
                    const semanticKeywords = ['cart', 'menu', 'login', 'signin', 'sign-in', 'search', 'user', 'profile', 'account', 'home'];
                    const classes = Array.from(el.classList);

                    const semanticClass = classes.find(c => semanticKeywords.some(k => c.toLowerCase().includes(k)));
                    if (semanticClass) {
                        // Convert snake_case or kebab-case to space-separated text
                        const extracted = semanticClass.replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
                        // Only add if not already present/similar
                        if (extracted && !texts.some(t => t.toLowerCase() === extracted.toLowerCase())) {
                            texts.push(extracted);
                        }
                    }
                }

                // Input value
                if (el.value) texts.push(el.value);

                // Standard accessibility attributes
                ['aria-label', 'aria-labelledby', 'aria-describedby', 'title', 'alt', 'placeholder',
                    'data-tooltip', 'data-title', 'data-label', 'data-testid', 'data-cy', 'data-test'].forEach(attr => {
                        const val = el.getAttribute(attr);
                        if (val) {
                            // For aria-labelledby/describedby, get referenced element's text
                            if (attr === 'aria-labelledby' || attr === 'aria-describedby') {
                                const ref = document.getElementById(val);
                                if (ref) texts.push((ref.innerText || ref.textContent || '').trim());
                            } else {
                                texts.push(val);
                            }
                        }
                    });

                // Parent element's aria-label (for icons inside buttons)
                const parent = el.parentElement;
                if (parent) {
                    const parentAriaLabel = parent.getAttribute('aria-label');
                    if (parentAriaLabel) texts.push(parentAriaLabel);
                    // Parent's title
                    const parentTitle = parent.getAttribute('title');
                    if (parentTitle) texts.push(parentTitle);
                }

                // Screen-reader-only text (common accessibility pattern)
                const srText = el.querySelector('.sr-only, .visually-hidden, .screen-reader-text, .screenreader');
                if (srText) texts.push((srText.innerText || srText.textContent || '').trim());

                // SVG title element
                const svgTitle = el.querySelector('title');
                if (svgTitle) texts.push((svgTitle.textContent || '').trim());

                // SVG use href (sprite reference like "#cart-icon")
                const useEl = el.querySelector('use');
                if (useEl) {
                    const href = useEl.getAttribute('xlink:href') || useEl.getAttribute('href');
                    if (href) texts.push(href.replace(/^#/, '').replace(/[-_]/g, ' '));
                }

                // Check child elements for text (for buttons with icon + text)
                const children = el.querySelectorAll('span, div, p');
                children.forEach(child => {
                    const childText = (child.innerText || '').trim();
                    if (childText && childText.length < 50) texts.push(childText);
                });

                return texts.map(t => t.toLowerCase()).filter(t => t.length > 0);
            }

            // Phase 3: FUZZY MATCHING with scoring
            function fuzzyMatch(goal, texts) {
                const goalWords = goal.split(/\s+/).filter(w => w.length > 2);

                for (const text of texts) {
                    // Exact match (highest priority)
                    if (text === goal) return { score: 100, type: 'exact' };

                    // Contains goal as substring
                    if (text.includes(goal)) return { score: 95, type: 'contains' };

                    // Goal contains text (for short labels like "Cart")
                    if (goal.includes(text) && text.length > 2) return { score: 90, type: 'reverse-contains' };
                }

                // Word-based matching
                for (const text of texts) {
                    const textWords = text.split(/\s+/);

                    // All goal words present
                    if (goalWords.every(w => text.includes(w))) return { score: 85, type: 'all-words' };

                    // Primary word match (longest word in goal)
                    const primary = goalWords.reduce((a, b) => a.length > b.length ? a : b, '');
                    if (primary.length > 2 && text.includes(primary)) return { score: 70, type: 'primary-word' };

                    // Any word match
                    const matchedWords = goalWords.filter(w => text.includes(w));
                    if (matchedWords.length > 0) {
                        return { score: 50 + (30 * matchedWords.length / goalWords.length), type: 'partial-words' };
                    }
                }

                return { score: 0, type: 'none' };
            }

            // Find best match across all interactive elements
            // Prioritize primary interactive elements (button, input, a) over containers
            const PRIMARY_TAGS = ['BUTTON', 'INPUT', 'A', 'SELECT'];
            let bestMatch = null;
            let bestScore = 0;

            for (const el of allInteractive) {
                const texts = extractAllText(el);
                const result = fuzzyMatch(normalizedGoal, texts);

                // Boost score for primary interactive elements with high matches
                let adjustedScore = result.score;
                if (PRIMARY_TAGS.includes(el.tagName) && result.score >= 70) {
                    adjustedScore += 10; // Prefer buttons/links over divs
                }

                // Extra boost for visible text match on button/link
                const visibleText = (el.innerText || el.value || '').toLowerCase().trim();
                if (PRIMARY_TAGS.includes(el.tagName) && visibleText === normalizedGoal) {
                    adjustedScore = 110; // Guaranteed best match
                }

                if (adjustedScore > bestScore) {
                    bestScore = adjustedScore;
                    bestMatch = el;

                    // If we found an exact text match on a button/link, stop
                    if (adjustedScore >= 110) break;
                }
            }


            const match = bestMatch;



            if (match) {
                // Check if element is inside shadow DOM
                const isInShadow = match.getRootNode() instanceof ShadowRoot;

                if (isInShadow && shadowEnabled) {
                    console.log('[CBA Debug] Element found in Shadow DOM, generating pierce selector');
                    return { selector: generateShadowSelector(match), inShadow: true };
                }

                const tagName = match.tagName.toLowerCase();

                // For input elements, use value attribute if present
                if (tagName === 'input' && match.value) {
                    const inputType = match.type || 'text';
                    const safeValue = escapeCssText(match.value);
                    return { selector: `input[type="${inputType}"][value="${safeValue}"]`, inShadow: false, valueMatch: true };
                }

                // Generate a unique selector - prefer text-based for links/buttons
                const textContent = escapeCssText((match.innerText || match.textContent || '').trim());

                // For links and buttons with text, use text-based selector for precision
                if ((tagName === 'a' || tagName === 'button') && textContent && textContent.length < 50) {
                    return { selector: `${tagName}:has-text("${textContent}")`, inShadow: false, textMatch: true };
                }

                // Standard CSS selector fallback
                if (match.id) return { selector: `#${match.id}`, inShadow: false };
                if (match.className && typeof match.className === 'string') {
                    // Generate a more specific selector with nth-child if possible
                    const classList = match.className.split(' ').filter(c => c);
                    return { selector: `.${classList.join('.')}`, inShadow: false };
                }
                return { selector: match.tagName.toLowerCase(), inShadow: false };
            }

            return null;
        }, { goalText: goal, shadowEnabled, maxDepth });

        console.log(`[CBA Hub] Semantic resolution for "${goal}" took ${Date.now() - resolveStart}ms`);

        if (target) {

            if (target.inShadow) {
                console.log(`[CBA Hub] Phase 9: Shadow DOM element resolved for "${goal}" -> ${target.selector}`);
            }
            return { selector: target.selector, selfHealed: false, shadowPierced: target.inShadow };
        }

        if (this.historicalMemory.has(goal)) {
            console.log(`[CBA Hub] Phase 7: Semantic resolution failed. Using Predictive Memory for "${goal}" -> ${this.historicalMemory.get(goal)}`);
            return { selector: this.historicalMemory.get(goal), selfHealed: true };
        }

        return null;
    }

    /**
     * Resolve a form input by semantic goal (label text, placeholder, aria-label).
     * This enables fillGoal('Search') to find inputs without hardcoded selectors.
     */
    async resolveFormIntent(goal) {
        const shadowEnabled = this.config.hub?.shadowDom?.enabled !== false;
        const maxDepth = this.config.hub?.shadowDom?.maxDepth || 5;

        const target = await this.page.evaluate(({ goalText, shadowEnabled, maxDepth }) => {
            const normalizedGoal = goalText.toLowerCase();

            // Collect all form inputs including shadow DOM
            function collectInputs(root, depth = 0) {
                if (depth > maxDepth) return [];
                let inputs = Array.from(root.querySelectorAll('input, textarea, select'));

                if (shadowEnabled) {
                    const allElements = root.querySelectorAll('*');
                    for (const el of allElements) {
                        if (el.shadowRoot) {
                            inputs = inputs.concat(collectInputs(el.shadowRoot, depth + 1));
                        }
                    }
                }
                return inputs;
            }

            const inputs = collectInputs(document);

            // ═══════════════════════════════════════════════════════════════════════════
            // UNIVERSAL FORM RESOLVER - Works on ANY form structure
            // ═══════════════════════════════════════════════════════════════════════════

            // Extract ALL possible text associations for an input
            function extractFormText(input) {
                const texts = [];

                // 1. Associated <label> by for attribute
                if (input.id) {
                    const label = document.querySelector(`label[for="${input.id}"]`);
                    if (label) texts.push((label.innerText || label.textContent || '').trim());
                }

                // 2. Wrapping <label> element
                const parentLabel = input.closest('label');
                if (parentLabel) texts.push((parentLabel.innerText || parentLabel.textContent || '').trim());

                // 3. Preceding sibling text (common pattern: "Email: [input]")
                const prevSibling = input.previousElementSibling;
                if (prevSibling && (prevSibling.tagName === 'LABEL' || prevSibling.tagName === 'SPAN')) {
                    texts.push((prevSibling.innerText || prevSibling.textContent || '').trim());
                }

                // 4. Standard attributes
                ['placeholder', 'aria-label', 'name', 'title', 'id', 'data-label', 'data-placeholder', 'autocomplete'].forEach(attr => {
                    const val = input.getAttribute(attr);
                    if (val) texts.push(val.replace(/[-_]/g, ' '));
                });

                // 5. aria-labelledby reference
                const labelledBy = input.getAttribute('aria-labelledby');
                if (labelledBy) {
                    const ref = document.getElementById(labelledBy);
                    if (ref) texts.push((ref.innerText || ref.textContent || '').trim());
                }

                // 6. Parent fieldset legend
                const fieldset = input.closest('fieldset');
                if (fieldset) {
                    const legend = fieldset.querySelector('legend');
                    if (legend) texts.push((legend.innerText || '').trim());
                }

                return texts.map(t => t.toLowerCase()).filter(t => t.length > 0);
            }

            // Fuzzy matching with scoring
            function fuzzyMatchForm(goal, texts) {
                const goalWords = goal.split(/[\s/]+/).filter(w => w.length > 1);

                for (const text of texts) {
                    if (text === goal) return { score: 100 };
                    if (text.includes(goal)) return { score: 95 };
                    if (goal.includes(text) && text.length > 2) return { score: 90 };
                }

                for (const text of texts) {
                    if (goalWords.every(w => text.includes(w))) return { score: 85 };
                    const matched = goalWords.filter(w => text.includes(w));
                    if (matched.length > 0) return { score: 50 + (30 * matched.length / goalWords.length) };
                }

                return { score: 0 };
            }

            // Find best matching input
            let bestMatch = null;
            let bestScore = 0;

            for (const input of inputs) {
                const texts = extractFormText(input);
                const result = fuzzyMatchForm(normalizedGoal, texts);

                if (result.score > bestScore) {
                    bestScore = result.score;
                    bestMatch = input;
                    if (result.score >= 95) break;
                }
            }

            const match = bestMatch;


            if (match) {
                // Generate selector
                if (match.id) return { selector: `#${match.id}` };
                if (match.name) return { selector: `[name="${match.name}"]` };
                if (match.placeholder) return { selector: `[placeholder="${match.placeholder}"]` };
                if (match.className && typeof match.className === 'string') {
                    return { selector: `.${match.className.split(' ').filter(c => c).join('.')}` };
                }
                return { selector: match.tagName.toLowerCase() };
            }
            return null;
        }, { goalText: goal, shadowEnabled, maxDepth });

        if (target) {
            console.log(`[CBA Hub] Form input resolved for "${goal}" -> ${target.selector}`);
            return { selector: target.selector, selfHealed: false };
        } else {
            console.log(`[CBA Hub] Form resolution FAILED for "${goal}" - no matching input found`);
        }


        // Fallback: Check historical memory for form fills
        const formKey = `fill:${goal}`;
        if (this.historicalMemory.has(formKey)) {
            console.log(`[CBA Hub] Phase 7: Form resolution failed. Using Predictive Memory for "${goal}" -> ${this.historicalMemory.get(formKey)}`);
            return { selector: this.historicalMemory.get(formKey), selfHealed: true };
        }

        return null;
    }

    /**
     * Resolve a select dropdown by semantic goal (label text, name, aria-label).
     */
    async resolveSelectIntent(goal) {
        const target = await this.page.evaluate((goalText) => {
            const normalizedGoal = goalText.toLowerCase();
            const selects = Array.from(document.querySelectorAll('select'));

            // Match by associated label
            let match = selects.find(select => {
                if (select.id) {
                    const label = document.querySelector(`label[for="${select.id}"]`);
                    if (label && (label.innerText || label.textContent || '').toLowerCase().includes(normalizedGoal)) {
                        return true;
                    }
                }
                return false;
            });

            // Match by aria-label
            if (!match) {
                match = selects.find(s => (s.getAttribute('aria-label') || '').toLowerCase().includes(normalizedGoal));
            }

            // Match by name
            if (!match) {
                match = selects.find(s => (s.getAttribute('name') || '').toLowerCase().includes(normalizedGoal));
            }

            if (match) {
                if (match.id) return { selector: `#${match.id}` };
                if (match.name) return { selector: `[name="${match.name}"]` };
                return { selector: 'select' };
            }
            return null;
        }, goal);

        if (target) {
            console.log(`[CBA Hub] Select resolved for "${goal}" -> ${target.selector}`);
            return { selector: target.selector, selfHealed: false };
        }

        const formKey = `select:${goal}`;
        if (this.historicalMemory.has(formKey)) {
            return { selector: this.historicalMemory.get(formKey), selfHealed: true };
        }
        return null;
    }

    /**
     * Resolve a checkbox by semantic goal (label text, aria-label).
     */
    async resolveCheckboxIntent(goal) {
        const target = await this.page.evaluate((goalText) => {
            const normalizedGoal = goalText.toLowerCase();
            const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"], input[type="radio"]'));

            // Match by associated label text (label wrapping or for= attribute)
            let match = checkboxes.find(cb => {
                // Check parent label
                const parentLabel = cb.closest('label');
                if (parentLabel && (parentLabel.innerText || parentLabel.textContent || '').toLowerCase().includes(normalizedGoal)) {
                    return true;
                }
                // Check for= label
                if (cb.id) {
                    const label = document.querySelector(`label[for="${cb.id}"]`);
                    if (label && (label.innerText || label.textContent || '').toLowerCase().includes(normalizedGoal)) {
                        return true;
                    }
                }
                return false;
            });

            // Match by aria-label
            if (!match) {
                match = checkboxes.find(cb => (cb.getAttribute('aria-label') || '').toLowerCase().includes(normalizedGoal));
            }

            if (match) {
                if (match.id) return { selector: `#${match.id}` };
                if (match.name) return { selector: `[name="${match.name}"]` };
                return { selector: `input[type="${match.type}"]` };
            }
            return null;
        }, goal);

        if (target) {
            console.log(`[CBA Hub] Checkbox resolved for "${goal}" -> ${target.selector}`);
            return { selector: target.selector, selfHealed: false };
        }

        const formKey = `check:${goal}`;
        if (this.historicalMemory.has(formKey)) {
            return { selector: this.historicalMemory.get(formKey), selfHealed: true };
        }
        return null;
    }

    loadHistoricalMemory() {
        // Load persistent memory file (from previous sessions)
        const memoryFile = path.join(process.cwd(), 'starlight_memory.json');
        if (fs.existsSync(memoryFile)) {
            try {
                const memory = JSON.parse(fs.readFileSync(memoryFile, 'utf8'));
                Object.entries(memory).forEach(([goal, selector]) => {
                    this.historicalMemory.set(goal, selector);
                });
                console.log(`[CBA Hub] 🧠 Loaded ${Object.keys(memory).length} learned mappings from starlight_memory.json`);
            } catch (e) {
                console.warn('[CBA Hub] Could not load starlight_memory.json:', e.message);
            }
        }

        // Also load from mission trace (for backward compatibility)
        const traceFile = path.join(process.cwd(), 'mission_trace.json');
        if (fs.existsSync(traceFile)) {
            try {
                const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
                if (trace.length === 0) return;

                const firstIntent = trace.find(e => e.method === 'starlight.intent');
                const traceStart = firstIntent ? firstIntent.timestamp : trace[0].timestamp;

                trace.forEach(event => {
                    // 1. Learn Selectors (From Intents OR Recordings)
                    const isLearnable = event.method === 'starlight.intent' ||
                        event.method === 'starlight.click' ||
                        event.method === 'starlight.fill' ||
                        event.method?.startsWith('starlight.action');

                    if (isLearnable && event.params?.goal && event.params?.selector) {
                        this.historicalMemory.set(event.params.goal, event.params.selector);
                    }

                    // 2. Learn Checkpoints for ROI and MTTR
                    if (event.method === 'starlight.checkpoint') {
                        console.log(`  [✓] Verified Milestone: ${event.params.name || event.params.goal}`);
                    }

                    // 3. Learn Entropy Auras (Phase 7.2)
                    if (event.method === 'starlight.entropy_stream' || event.method === 'starlight.stability') {
                        const relTime = event.timestamp - traceStart;
                        const bucket = Math.floor(relTime / 500);
                        this.historicalAuras.add(bucket);
                    }
                });
                console.log(`[CBA Hub] Phase 7 Intelligence Audit:`);
                console.log(`  - Learned Selectors: ${this.historicalMemory.size}`);
                console.log(`  - Temporal Auras: ${this.historicalAuras.size}`);
            } catch (e) {
                console.warn("[CBA Hub] Failed to load historical memory:", e.message);
            }
        }

        // Phase 17.4: Load Temporal Ghosting Metrics
        const ghostFile = path.join(process.cwd(), 'temporal_ghosting.json');
        if (fs.existsSync(ghostFile)) {
            try {
                const metrics = JSON.parse(fs.readFileSync(ghostFile, 'utf8'));
                metrics.forEach(m => {
                    const key = `${m.command}:${m.selector || ''}`;
                    // Store the max latency seen for this target to use as a stability hint
                    const existing = this.historicalMemory.get(`ghost:${key}`) || 0;
                    this.historicalMemory.set(`ghost:${key}`, Math.max(existing, m.latency_ms));
                });
                console.log(`  - Temporal Ghosting: ${metrics.length} observations loaded.`);
            } catch (e) {
                console.warn("[CBA Hub] Failed to load temporal ghosting metrics:", e.message);
            }
        }
    }

    /**
     * Save learned goal→selector mappings to persistent storage.
     * Called on shutdown to ensure learning persists across sessions.
     */
    async saveHistoricalMemory() {
        if (this.historicalMemory.size === 0) {
            return; // Nothing new to merge
        }

        const memoryFile = path.join(process.cwd(), 'starlight_memory.json');

        // Phase 8.5: Atomic Locking (Issue 13)
        // Ensure we don't write concurrently
        let acquired = false;
        try {
            acquired = await this.memoryLock.acquire('memory', 'hub');
            if (!acquired) {
                console.warn('[CBA Hub] Failed to acquire lock for memory save. Skipping.');
                return;
            }

            // Load existing memory from disk to merge (in case other tools updated it)
            let existingMemory = {};
            if (fs.existsSync(memoryFile)) {
                try {
                    existingMemory = JSON.parse(fs.readFileSync(memoryFile, 'utf8'));
                } catch (e) {
                    console.warn('[CBA Hub] Start fresh: Could not parse starlight_memory.json');
                }
            }

            // Merge: current session's memory overrides disk if keys conflict
            const allMappings = { ...existingMemory };
            this.historicalMemory.forEach((selector, goal) => {
                // Skip ghost metrics (they're saved separately)
                if (!goal.startsWith('ghost:')) {
                    allMappings[goal] = selector;
                }
            });

            // Atomic write using temp file
            const tempFile = memoryFile + '.tmp';
            fs.writeFileSync(tempFile, JSON.stringify(allMappings, null, 2));
            fs.renameSync(tempFile, memoryFile);
            console.log(`[CBA Hub] 🧠 Memory saved: ${Object.keys(allMappings).length} mappings`);

        } catch (e) {
            console.error('[CBA Hub] Failed to save memory:', e.message);
        } finally {
            if (acquired) {
                this.memoryLock.release('memory', 'hub');
            }
        }
    }

    /**
     * Learn a successful goal→selector mapping.
     * Called after successful command execution with semantic goal.
     */
    learnMapping(goal, selector, cmd = null) {
        if (!goal || !selector) return;

        // Store with command prefix for more specific recall
        const key = cmd ? `${cmd}:${goal}` : goal;
        const existing = this.historicalMemory.get(key);

        if (existing !== selector) {
            this.historicalMemory.set(key, selector);
            // Also store without prefix for backward compatibility
            if (cmd) {
                this.historicalMemory.set(goal, selector);
            }
            console.log(`[CBA Hub] 🧠 LEARNED: ${key} -> ${selector}`);
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

    /**
     * Broadcast to all connected clients (browsers/debuggers)
     */
    broadcastToClients(msg) {
        const payload = JSON.stringify(msg);
        for (const client of this.wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
                // Determine if client is a sentinel to avoid double-broadcast if managing separately
                // But wss.clients includes everyone.
                client.send(payload);
            }
        }
    }

    /**
     * Broadcast to Sentinels with PRIORITY sorting.
     * Higher priority sentinels receive message first.
     */
    broadcastToSentinels(msg) {
        const payload = JSON.stringify(msg);

        // Lower numbers are higher priority in the Starlight specification.
        const sortedSentinels = Array.from(this.sentinels.values())
            .sort((a, b) => (a.priority || 10) - (b.priority || 10));

        for (const s of sortedSentinels) {
            if (s.ws.readyState === WebSocket.OPEN) {
                s.ws.send(payload);
            }
        }
    }

    /**
     * Periodic system health check & Heartbeat
     */
    checkSentinelConnections(now = Date.now()) {
        for (const [id, s] of this.sentinels) {
            if (now - s.lastSeen > (this.config.hub?.heartbeatTimeout || 30000)) {
                console.warn(`[CBA Hub] Sentinel ${s.layer} timed out (${Math.round((now - s.lastSeen) / 1000)}s silent). Terminating.`);
                s.ws.terminate();
                this.handleDisconnect(id);
            } else {
                // Send Ping
                if (s.ws.readyState === WebSocket.OPEN) {
                    s.ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'starlight.ping', params: { timestamp: now } }));
                }
            }
        }

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
        const safeData = this.piiRedactor.redactObject(data);
        const rawSnapshot = includeSnapshot ? await this.takeDOMSnapshot() : null;
        const snapshot = rawSnapshot ? this.piiRedactor.redact(rawSnapshot) : null;

        this.missionTrace.push({
            timestamp: Date.now(),
            humanTime: new Date().toLocaleTimeString(),
            method: safeData.method || type,
            params: safeData.params || safeData,
            snapshot
        });

        // Immediate learning from recordings:
        if (type === 'RECORDER' && safeData.params?.goal && safeData.params?.selector) {
            this.historicalMemory.set(safeData.params.goal, safeData.params.selector);
        }

        // Trace rotation: keep only the last N events
        const maxEvents = this.config.hub?.traceMaxEvents || 500;
        if (this.missionTrace.length > maxEvents) {
            this.missionTrace = this.missionTrace.slice(-maxEvents);
        }
    }

    async takeDOMSnapshot() {
        if (!this.page || this.page.isClosed()) return null;
        // Stability: Opt-in snapshots with size limit to prevent OOM
        if (!this.config.hub?.enableSnapshots) return null;
        try {
            const html = await this.page.content();
            const maxSize = this.config.hub?.snapshotMaxBytes || 100000; // 100KB default
            if (html.length > maxSize) {
                return html.substring(0, maxSize) + '\n<!-- [TRUNCATED] -->';
            }
            return html;
        } catch (e) { return null; }
    }

    /**
     * Phase 13: NLI - Extract page context for context-aware command generation.
     * 
     * Uses UNIVERSAL HTML selectors to work on ANY website.
     * Returns buttons, inputs, links, products (best-effort), and headings.
     * 
     * @returns {Promise<object>} Page context object
     */
    async getPageContext() {
        if (!this.page || this.page.isClosed()) {
            return { error: 'No page available', buttons: [], inputs: [], links: [], products: [], headings: [] };
        }

        try {
            const context = await this.page.evaluate(() => {
                const MAX_ITEMS = 20; // Limit items to avoid overwhelming LLM
                const result = {
                    url: window.location.href,
                    title: document.title,
                    buttons: [],
                    inputs: [],
                    links: [],
                    products: [],
                    headings: []
                };

                // Helper: Find label for an input element
                function findLabelFor(input) {
                    // Try aria-label first
                    if (input.getAttribute('aria-label')) return input.getAttribute('aria-label');

                    // Try explicit label
                    if (input.id) {
                        const label = document.querySelector(`label[for="${input.id}"]`);
                        if (label) return label.textContent.trim();
                    }

                    // Try parent label
                    const parentLabel = input.closest('label');
                    if (parentLabel) {
                        const labelText = parentLabel.textContent.replace(input.value || '', '').trim();
                        if (labelText) return labelText;
                    }

                    // Try placeholder
                    if (input.placeholder) return input.placeholder;

                    // Try name or id as last resort
                    return input.name || input.id || null;
                }

                // Helper: Generate a readable selector (not for execution, just for LLM context)
                function getReadableSelector(el) {
                    if (el.id) return `#${el.id}`;
                    if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
                    if (el.name) return `[name="${el.name}"]`;
                    if (el.className && typeof el.className === 'string') {
                        const firstClass = el.className.split(' ')[0];
                        if (firstClass) return `.${firstClass}`;
                    }
                    return el.tagName.toLowerCase();
                }

                // 1. BUTTONS - Universal detection
                const buttonSelectors = 'button, [role="button"], input[type="submit"], input[type="button"], .btn, [class*="button"], [class*="Button"]';
                document.querySelectorAll(buttonSelectors).forEach(el => {
                    if (result.buttons.length >= MAX_ITEMS) return;
                    const text = (el.textContent?.trim() || el.value || el.getAttribute('aria-label') || '').substring(0, 50);
                    if (text && text.length > 0 && !text.includes('\n')) {
                        result.buttons.push({ text, selector: getReadableSelector(el) });
                    }
                });

                // 2. INPUTS - Universal detection
                document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select').forEach(el => {
                    if (result.inputs.length >= MAX_ITEMS) return;
                    const label = findLabelFor(el);
                    if (label) {
                        result.inputs.push({
                            label: label.substring(0, 50),
                            type: el.type || el.tagName.toLowerCase(),
                            selector: getReadableSelector(el)
                        });
                    }
                });

                // 3. LINKS - Universal detection (visible, meaningful text)
                document.querySelectorAll('a[href]').forEach(el => {
                    if (result.links.length >= MAX_ITEMS) return;
                    const text = el.textContent?.trim();
                    if (text && text.length > 1 && text.length < 80 && !text.includes('\n')) {
                        result.links.push({
                            text: text.substring(0, 50),
                            href: el.href,
                            selector: getReadableSelector(el)
                        });
                    }
                });

                // 4. PRODUCTS - Best-effort heuristic detection for e-commerce sites
                // Look for common e-commerce patterns
                const productSelectors = '[class*="product"], [class*="item"], [data-product], [data-item], .card, .product-card, article';
                document.querySelectorAll(productSelectors).forEach(el => {
                    if (result.products.length >= MAX_ITEMS) return;

                    // Look for price
                    const priceEl = el.querySelector('[class*="price"], .price, [data-price]');
                    const priceText = priceEl ? priceEl.textContent.trim() : null;

                    // Look for product name
                    const nameEl = el.querySelector('[class*="name"], [class*="title"], h1, h2, h3, h4, .product-name, .item-name');
                    const nameText = nameEl ? nameEl.textContent.trim() : null;

                    // Only add if we found at least a name
                    if (nameText && nameText.length < 100) {
                        result.products.push({
                            name: nameText.substring(0, 60),
                            price: priceText ? priceText.substring(0, 20) : null
                        });
                    }
                });

                // 5. HEADINGS - For understanding page structure
                document.querySelectorAll('h1, h2').forEach(el => {
                    if (result.headings.length >= 5) return;
                    const text = el.textContent?.trim();
                    if (text && text.length < 100) {
                        result.headings.push(text.substring(0, 60));
                    }
                });

                return result;
            });

            console.log(`[CBA Hub] Page context extracted: ${context.buttons.length} buttons, ${context.inputs.length} inputs, ${context.links.length} links, ${context.products.length} products`);
            return context;

        } catch (e) {
            console.error('[CBA Hub] Error extracting page context:', e.message);
            return { error: e.message, buttons: [], inputs: [], links: [], products: [], headings: [] };
        }
    }

    validateProtocol(msg) {
        return this.schemaValidator.validate(msg).valid;
    }

    isLoopbackHost(host) {
        return ['127.0.0.1', 'localhost', '::1'].includes(String(host).toLowerCase());
    }

    timingSafeTokenEqual(actual, expected) {
        if (typeof actual !== 'string' || typeof expected !== 'string') return false;
        const actualBuffer = Buffer.from(actual);
        const expectedBuffer = Buffer.from(expected);
        return actualBuffer.length === expectedBuffer.length &&
            crypto.timingSafeEqual(actualBuffer, expectedBuffer);
    }

    authenticateRegistration(params) {
        if (!this.authRequired) {
            return { authenticated: true, tokenPayload: null };
        }

        const token = params.authToken;
        if (!token) {
            return { authenticated: false, error: 'Authentication token required' };
        }

        if (this.authToken && this.timingSafeTokenEqual(token, this.authToken)) {
            return { authenticated: true, tokenPayload: null };
        }

        try {
            return { authenticated: true, tokenPayload: this.jwtHandler.verifyToken(token) };
        } catch (error) {
            return { authenticated: false, error: error.message };
        }
    }

    inferClientRole(params, tokenPayload = null) {
        const requestedRole = params.role || params.clientType;
        const tokenRole = tokenPayload?.role;
        const role = tokenRole || requestedRole ||
            (params.capabilities?.includes('intent') || params.layer === 'IntentLayer' ? 'intent' : 'sentinel');
        return ['sentinel', 'intent', 'admin'].includes(role) ? role : null;
    }

    isMethodAllowed(role, method) {
        const permissions = {
            sentinel: new Set([
                'starlight.pulse', 'starlight.pong', 'starlight.context_update',
                'starlight.clear', 'starlight.wait', 'starlight.hijack',
                'starlight.resume', 'starlight.action', 'starlight.sidetalk',
                'starlight.error'
            ]),
            intent: new Set([
                'starlight.intent', 'starlight.finish', 'starlight.getPageContext',
                'starlight.warp_capture', 'starlight.warp_restore'
            ]),
            admin: new Set([
                'starlight.intent', 'starlight.finish', 'starlight.getPageContext',
                'starlight.warp_capture', 'starlight.warp_restore',
                'starlight.startRecording', 'starlight.stopRecording',
                'starlight.getRecordedSteps'
            ])
        };
        return permissions[role]?.has(method) || false;
    }

    sendRpcResult(ws, id, result) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
    }

    sendRpcError(ws, id, code, message, data = undefined) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: id || null,
            error: { code, message, ...(data === undefined ? {} : { data }) }
        }));
    }

    completeCommand(clientId, requestId, result) {
        this.activeRequestIds.delete(`${clientId}:${requestId}`);
        const client = this.clients.get(clientId);
        if (client?.ws) {
            this.sendRpcResult(client.ws, requestId, result);
        }

        this.broadcastToSentinels({
            type: 'COMMAND_COMPLETE',
            id: requestId,
            ...result
        });
    }

    handleDisconnect(id) {
        this.clients.delete(id);
        this.commandQueue = this.commandQueue.filter(command => command.clientId !== id);
        for (const [key, pending] of this.pendingRequests) {
            if (key.endsWith(`:${id}`)) {
                pending.reject?.(new Error('Sentinel disconnected'));
                this.pendingRequests.delete(key);
            }
        }
        for (const key of this.activeRequestIds) {
            if (key.startsWith(`${id}:`)) this.activeRequestIds.delete(key);
        }

        const s = this.sentinels.get(id);
        if (s) {
            console.log(`[CBA Hub] Sentinel Disconnected: ${s.layer}`);
            this.sentinels.delete(id);

            // Notify others
            this.broadcastToSentinels({
                jsonrpc: '2.0',
                method: 'starlight.sentinel_left',
                params: { layer: s.layer, id }
            });

            if (this.lockOwner === id) this.releaseLock('Sentinel disconnected');
        }
    }

    async handleMessage(id, ws, msg) {
        // Phase 1 Security: Validate message against schema
        const validation = this.schemaValidator.validate(msg);
        if (!validation.valid) {
            console.warn(`[CBA Hub] Rejected invalid message: ${validation.errors.join(', ')}`);
            ws.send(JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32600, message: 'Invalid Request', data: validation.errors },
                id: msg.id || null
            }));
            return;
        }

        const client = this.clients.get(id);
        const sentinel = this.sentinels.get(id);
        const params = msg.params;

        if (msg.method !== 'starlight.registration') {
            if (!client?.authenticated || !client.role) {
                this.sendRpcError(ws, msg.id, 4001, 'Registration required');
                ws.close(4001, 'Registration required');
                return;
            }
            if (!this.isMethodAllowed(client.role, msg.method)) {
                this.sendRpcError(ws, msg.id, 4003, `Method not allowed for role ${client.role}`);
                return;
            }
        }

        switch (msg.method) {
            case 'starlight.registration': {
                if (client?.authenticated) {
                    this.sendRpcError(ws, msg.id, 4002, 'Client is already registered');
                    return;
                }

                const authResult = this.authenticateRegistration(params);
                if (!authResult.authenticated) {
                    console.warn(`[CBA Hub] Rejected registration from ${params.layer}: ${authResult.error}`);
                    this.sendRpcError(ws, msg.id, 4001, 'Unauthorized');
                    ws.close(4001, 'Unauthorized');
                    return;
                }

                const role = this.inferClientRole(params, authResult.tokenPayload);
                if (!role) {
                    this.sendRpcError(ws, msg.id, 4002, 'Invalid client role');
                    ws.close(4002, 'Invalid client role');
                    return;
                }

                Object.assign(client, {
                    authenticated: true,
                    role,
                    layer: params.layer,
                    registeredAt: Date.now()
                });

                if (role === 'sentinel') {
                    this.sentinels.set(id, {
                        id,
                        role,
                        ws,
                        lastSeen: Date.now(),
                        layer: params.layer,
                        priority: params.priority,
                        selectors: params.selectors,
                        capabilities: params.capabilities,
                        protocolVersion: params.version || '1.0.0'
                    });
                }

                console.log(`[CBA Hub] Registered ${role}: ${params.layer}`);
                this.sendRpcResult(ws, msg.id, {
                    registered: true,
                    clientId: id,
                    role,
                    protocolVersion: '1.0.0'
                });
                break;
            }
            case 'starlight.pulse':
                if (sentinel) {
                    sentinel.lastSeen = Date.now();
                    sentinel.currentAura = params.data?.currentAura || [];
                }
                break;
            case 'starlight.pong':
                if (sentinel) {
                    sentinel.lastSeen = Date.now();
                    // console.log(`[CBA Hub] Pong from ${sentinel.layer}`);
                }
                break;
            case 'starlight.context_update':
                // Phase 4: Context Injection from Sentinels
                // Phase 12: Also handles A11y Sentinel accessibility reports
                if (params.context) {
                    console.log(`[CBA Hub] Context Injection from ${sentinel?.layer || 'Unknown'}:`, Object.keys(params.context));
                    this.sovereignState = { ...this.sovereignState, ...params.context };

                    // Phase 12: Store accessibility data for report generation
                    if (params.context.accessibility) {
                        console.log(`[CBA Hub] A11y Report: Score ${params.context.accessibility.score}, Violations: ${params.context.accessibility.violations?.length || 0}`);
                        this.a11yReport = params.context.accessibility;
                    }

                    // Use prioritized broadcast
                    this.broadcastToSentinels({
                        jsonrpc: '2.0',
                        method: 'starlight.sovereign_update',
                        params: { context: this.sovereignState },
                        id: nanoid()
                    });
                }
                break;
            case 'starlight.clear':
                {
                    const pendingKey = `${msg.id}:${id}`;
                    if (this.pendingRequests.has(pendingKey)) {
                        this.pendingRequests.get(pendingKey).resolve(msg);
                        this.pendingRequests.delete(pendingKey);
                    }
                }
                break;
            case 'starlight.wait':
                {
                    const pendingKey = `${msg.id}:${id}`;
                    if (this.pendingRequests.has(pendingKey)) {
                        this.pendingRequests.get(pendingKey).resolve(msg);
                        this.pendingRequests.delete(pendingKey);
                    }
                }
                break;
            case 'starlight.hijack':
                await this.handleHijack(id, params, msg.id);
                break;
            case 'starlight.resume':
                this.handleResume(id, params);
                break;
            case 'starlight.intent':
                // Phase 5: Handle Semantic Intent (Goal-based)
                // Only run default click resolver if cmd is 'click' or not set
                if (msg.params.goal && (!msg.params.cmd || msg.params.cmd === 'click')) {
                    console.log(`[CBA Hub] Resolving Click Goal: "${msg.params.goal}"`);
                    const result = await this.resolveSemanticIntent(msg.params.goal);
                    if (result) {
                        console.log(`[CBA Hub] ✓ Click Goal "${msg.params.goal}" resolved to: ${result.selector}`);
                        msg.params.selector = result.selector;
                        msg.params.selfHealed = result.selfHealed;
                        msg.params.cmd = 'click'; // Default semantic action


                        // Propagate hint from semantic context if available
                        if (result.stabilityHint) {
                            msg.params.stabilityHint = result.stabilityHint;
                        }

                        // ROI: If semantic resolution used history, count it as saved triage time
                        if (result.selfHealed) {
                            this.totalSavedTime += 120; // ROI: 2 mins triage avoided
                        }
                    } else {
                        console.error(`[CBA Hub] FAILED to resolve semantic goal: ${msg.params.goal}`);
                        // CRITICAL FIX: Record failed semantic goals in report
                        this.reportData.push({
                            type: 'COMMAND',
                            id: msg.id,
                            cmd: 'click',
                            goal: msg.params.goal,
                            selector: null,
                            url: null,
                            success: false,
                            forcedProceed: false,
                            selfHealed: false,
                            predictiveWait: false,
                            timestamp: new Date().toLocaleTimeString(),
                            beforeScreenshot: null,
                            afterScreenshot: null,
                            error: `Failed to resolve semantic goal: ${msg.params.goal}`
                        });
                        this.completeCommand(id, msg.id, {
                            success: false,
                            error: `Could not find element matching goal "${msg.params.goal}"`
                        });
                        return;
                    }
                }
                // Handle goal-based fill commands (semantic form resolution)
                if (msg.params.cmd === 'fill' && msg.params.goal && !msg.params.selector) {
                    console.log(`[CBA Hub] Resolving Form Goal: "${msg.params.goal}"`);
                    const result = await this.resolveFormIntent(msg.params.goal);
                    if (result) {
                        msg.params.selector = result.selector;
                        msg.params.selfHealed = result.selfHealed;
                        if (result.selfHealed) {
                            this.totalSavedTime += 120; // ROI: 2 mins triage avoided
                        }
                    } else {
                        console.error(`[CBA Hub] FAILED to resolve form goal: ${msg.params.goal}`);
                        this.reportData.push({
                            type: 'COMMAND',
                            id: msg.id,
                            cmd: 'fill',
                            goal: msg.params.goal,
                            selector: null,
                            url: null,
                            success: false,
                            forcedProceed: false,
                            selfHealed: false,
                            predictiveWait: false,
                            timestamp: new Date().toLocaleTimeString(),
                            beforeScreenshot: null,
                            afterScreenshot: null,
                            error: `Failed to resolve form goal: ${msg.params.goal}`
                        });
                        this.completeCommand(id, msg.id, {
                            success: false,
                            error: `Could not find form input matching "${msg.params.goal}"`
                        });
                        return;
                    }
                }
                // Handle goal-based select commands
                if (msg.params.cmd === 'select' && msg.params.goal && !msg.params.selector) {
                    console.log(`[CBA Hub] Resolving Select Goal: "${msg.params.goal}"`);
                    const result = await this.resolveSelectIntent(msg.params.goal);
                    if (result) {
                        msg.params.selector = result.selector;
                        msg.params.selfHealed = result.selfHealed;
                        if (result.selfHealed) this.totalSavedTime += 120;
                    } else {
                        console.error(`[CBA Hub] FAILED to resolve select goal: ${msg.params.goal}`);
                        this.completeCommand(id, msg.id, {
                            success: false,
                            error: `Could not find dropdown matching "${msg.params.goal}"`
                        });
                        return;
                    }
                }
                // Handle goal-based check/uncheck commands
                if ((msg.params.cmd === 'check' || msg.params.cmd === 'uncheck') && msg.params.goal && !msg.params.selector) {
                    console.log(`[CBA Hub] Resolving Checkbox Goal: "${msg.params.goal}"`);
                    const result = await this.resolveCheckboxIntent(msg.params.goal);
                    if (result) {
                        msg.params.selector = result.selector;
                        msg.params.selfHealed = result.selfHealed;
                        if (result.selfHealed) this.totalSavedTime += 120;
                    } else {
                        console.error(`[CBA Hub] FAILED to resolve checkbox goal: ${msg.params.goal}`);
                        this.completeCommand(id, msg.id, {
                            success: false,
                            error: `Could not find checkbox matching "${msg.params.goal}"`
                        });
                        return;
                    }
                }
                // Handle goal-based hover/scroll commands (use click resolver)
                if ((msg.params.cmd === 'hover' || msg.params.cmd === 'scroll') && msg.params.goal && !msg.params.selector) {
                    console.log(`[CBA Hub] Resolving ${msg.params.cmd} Goal: "${msg.params.goal}"`);
                    const result = await this.resolveSemanticIntent(msg.params.goal);
                    if (result) {
                        msg.params.selector = result.selector;
                        msg.params.selfHealed = result.selfHealed;
                        if (result.selfHealed) this.totalSavedTime += 120;
                    } else {
                        console.error(`[CBA Hub] FAILED to resolve ${msg.params.cmd} goal: ${msg.params.goal}`);
                        this.completeCommand(id, msg.id, {
                            success: false,
                            error: `Could not find element matching "${msg.params.goal}"`
                        });
                        return;
                    }
                }
                // Handle goal-based upload commands (use form resolver for file inputs)
                if (msg.params.cmd === 'upload' && msg.params.goal && !msg.params.selector) {
                    console.log(`[CBA Hub] Resolving Upload Goal: "${msg.params.goal}"`);
                    const result = await this.resolveFormIntent(msg.params.goal);
                    if (result) {
                        msg.params.selector = result.selector;
                        msg.params.selfHealed = result.selfHealed;
                        if (result.selfHealed) this.totalSavedTime += 120;
                    } else {
                        console.error(`[CBA Hub] FAILED to resolve upload goal: ${msg.params.goal}`);
                        this.completeCommand(id, msg.id, {
                            success: false,
                            error: `Could not find file input matching "${msg.params.goal}"`
                        });
                        return;
                    }
                }
                this.enqueueCommand(id, { ...msg.params, id: msg.id });
                break;
            case 'starlight.action':
                await this.executeSentinelAction(id, params, msg.id);
                break;
            case 'starlight.finish':
                await this.shutdown(params.reason || params.error);
                break;
            // Phase 13.5: Recording Protocol
            case 'starlight.startRecording':
                await this.handleStartRecording(id, params?.url);
                break;
            case 'starlight.stopRecording':
                await this.handleStopRecording(id, params);
                break;
            case 'starlight.getRecordedSteps':
                this.broadcastToClient(id, { type: 'RECORDED_STEPS', steps: this.recorder.getSteps() });
                break;

            // Phase 17: Inter-Sentinel Side-Talk
            case 'starlight.sidetalk':
                await this.handleSideTalk(id, params, sentinel);
                break;

            // Phase 17: Warp Context Capture
            case 'starlight.warp_capture':
                await this.handleWarpCapture(id, params);
                break;
            case 'starlight.warp_restore':
                await this.handleWarpRestore(id, params);
                break;

            // Phase 13: NLI Page Context Extraction
            case 'starlight.getPageContext': {
                const pageContext = await this.getPageContext();
                ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: msg.id,
                    result: pageContext
                }));
                break;
            }

            // Phase 8.5: Sentinel Error Protocol (Issue 16)
            case 'starlight.error':
                console.error(`[CBA Hub] 🚨 Error from Sentinel ${sentinel?.layer || 'Unknown'}:`, params.error);
                if (params.stack) {
                    console.error(`[CBA Hub] Sentinel Stack Trace:\n${params.stack}`);
                }

                // Add to report
                this.reportData.push({
                    type: 'SENTINEL_ERROR',
                    layer: sentinel?.layer || 'Unknown',
                    error: params.error,
                    stack: params.stack,
                    timestamp: new Date().toLocaleTimeString()
                });

                // Notify UI via broadcast
                this.broadcastToClients({
                    type: 'SENTINEL_ERROR',
                    layer: sentinel?.layer || 'Unknown',
                    error: params.error
                });
                break;
        }
    }

    // Phase 13.5: Recording Handlers
    async handleStartRecording(clientId, url = null) {
        try {
            console.log(`[CBA Hub] handleStartRecording called with URL: ${url}`);

            // Hard Reset: Ensure clean state for new recording
            if (this.page) {
                await this.page.close().catch(() => { });
                this.page = null;
            }

            // Close existing browser and create fresh one for recording (visible)
            if (this.browser) {
                await this.browser.close().catch(() => { });
                this.browser = null;
            }

            console.log('[CBA Hub] Launching NEW browser for recording session...');
            // Phase 14.1: Use adapter for recording sessions too
            if (!this.browserAdapter) {
                this.browserAdapter = await BrowserAdapter.create(this.config.hub?.browser || {});
            }
            this.browser = await this.browserAdapter.launch({ headless: false });
            const context = await this.browser.newContext();
            this.page = await context.newPage();

            const targetUrl = url || 'https://example.com';

            // Setup recorder callbacks
            this.recorder.onStopRequest = () => {
                console.log('[CBA Hub] HUD Stop Signal received');
                this.handleStopRecording(clientId, { name: `recorded_${nanoid(6)}` });
            };

            this.recorder.onStep = (step) => {
                console.log(`[CBA Hub] Learning [Live]: ${step.action} -> ${step.goal || step.url}`);
                this.recordTrace('RECORDER', 'Recorder', {
                    method: `starlight.${step.action}`,
                    params: step
                });
                this.saveMissionTrace();
            };

            // STEP 1: Expose functions BEFORE navigation (required by Playwright)
            await this.recorder.exposeFunctions(this.page);
            console.log('[CBA Hub] Recording functions exposed');

            // STEP 1.5: Add dialog handler that ACCEPTS dialogs (doesn't dismiss them)
            // This is critical for checkpoint prompts and stop confirms to work
            this.page.on('dialog', async dialog => {
                console.log(`[CBA Hub] Dialog detected: ${dialog.type()} - "${dialog.message()}"`);
                // Accept all dialogs with default value (prompts get empty string, confirms get true)
                await dialog.accept();
            });

            // STEP 2: Navigate to URL
            console.log(`[CBA Hub] Recording: Navigating to ${targetUrl}...`);
            await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            console.log(`[CBA Hub] Navigation complete: ${this.page.url()}`);

            // STEP 3: Inject HUD script (now page has document.body)
            await this.recorder.injectHUD(this.page);
            console.log('[CBA Hub] HUD injected');

            this.broadcastToClient(clientId, { type: 'RECORDING_STARTED' });
            console.log('[CBA Hub] Recording Session Active:', this.page.url());
        } catch (e) {
            console.error('[CBA Hub] Recording Launch Failed:', e.message);
            console.error(e.stack);
            this.broadcastToClient(clientId, { type: 'RECORDING_ERROR', error: e.message });
        }
    }

    async handleStopRecording(clientId, params) {
        try {
            this.recorder.stopRecording();
            await this.saveMissionTrace();
            const testDir = path.join(process.cwd(), 'test');
            const fileName = this.recorder.generateTestFile(testDir, params?.name);
            this.broadcastToClient(clientId, {
                type: 'RECORDING_STOPPED',
                fileName,
                steps: this.recorder.getSteps()
            });
        } catch (e) {
            console.error('[CBA Hub] Stop recording error:', e.message);
            this.broadcastToClient(clientId, { type: 'RECORDING_ERROR', error: e.message });
        }
    }

    async shutdown(reason = null) {
        if (this.isShuttingDown) return; // Prevent double shutdown
        const reasonText = reason instanceof Error ? reason.message : String(reason || 'Normal');
        console.log(`[CBA Hub] Shutdown initiated. Reason: ${reasonText}`);
        this.isShuttingDown = true;
        this.ready = false;

        // Only log as FAILURE if it actually contains failure markers or is an Error object
        const normalizedReason = reasonText.toLowerCase();
        const isActualFailure = reason && (
            reason instanceof Error ||
            normalizedReason.includes('failed') ||
            normalizedReason.includes('error') ||
            normalizedReason.includes('timeout') ||
            normalizedReason.includes('aborted')
        );

        if (isActualFailure) {
            console.log(`[CBA Hub] Mission Failure Recorded: ${reason}`);
            this.reportData.push({
                type: 'FAILURE',
                reason: reasonText,
                timestamp: new Date().toLocaleTimeString()
            });

            // Record in-progress command as failed
            if (this.currentCommand) {
                console.log(`[CBA Hub] Recording in-progress command as failed: ${this.currentCommand.goal || this.currentCommand.cmd}`);

                // Try to capture final state screenshot
                let interruptedScreenshot = null;
                if (this.page) {
                    try {
                        interruptedScreenshot = await this.takeScreenshot('INTERRUPTED_STATE');
                    } catch (e) {
                        console.warn('[CBA Hub] Could not capture interrupted state screenshot:', e.message);
                    }
                }

                this.reportData.push({
                    type: 'COMMAND',
                    id: this.currentCommand.id,
                    cmd: this.currentCommand.cmd,
                    goal: this.currentCommand.goal,
                    selector: this.currentCommand.selector,
                    url: this.currentCommand.url,
                    success: false,
                    forcedProceed: false,
                    selfHealed: false,
                    predictiveWait: false,
                    timestamp: new Date().toLocaleTimeString(),
                    beforeScreenshot: interruptedScreenshot, // Show state at interruption
                    afterScreenshot: interruptedScreenshot,  // Same screenshot for both
                    error: `Command interrupted: ${reasonText}`
                });
                this.currentCommand = null;
            }
        }

        console.log("[CBA Hub] Closing gracefully...");

        clearTimeout(this.missionTimeoutHandle);
        clearTimeout(this.lockTimeout);
        clearInterval(this.healthCheckInterval);
        this.memoryLock.shutdown();
        this.elementCache.clear();
        for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timeout);
            pending.resolve?.({
                jsonrpc: '2.0',
                method: 'starlight.wait',
                params: { severity: 'hard', reason: 'Hub shutting down' }
            });
        }
        this.pendingRequests.clear();
        for (const timer of this.retryTimers) clearTimeout(timer);
        this.retryTimers.clear();

        for (const command of this.commandQueue) {
            if (!command.internal) {
                this.completeCommand(command.clientId, command.id, {
                    success: false,
                    error: 'Hub shut down before command execution'
                });
            }
        }
        this.commandQueue = [];

        // Wait for any in-flight processing to finish
        let waitCount = 0;
        while (this.isProcessing && waitCount < 50) {
            await new Promise(r => setTimeout(r, 100));
            waitCount++;
        }

        // Phase 12: Wait for pending context updates (A11y reports) to arrive
        await new Promise(r => setTimeout(r, 500));

        console.log("[CBA Hub] Generating Hero Story Report...");
        await this.generateReport();
        await this.saveMissionTrace();
        await this.saveTemporalMetrics(); // Phase 17.4: Temporal Ghosting

        // Phase 10: Record Mission Telemetry
        const missionSuccess = this.reportData.every(item => item.type !== 'COMMAND' || item.success);
        this.telemetry.recordMission(
            missionSuccess,
            this.totalSavedTime,
            this.reportData.filter(i => i.type === 'HIJACK').length,
            this.recoveryTimes
        );

        // Phase 10: Send Webhook Notification
        await this.webhooks.notify(missionSuccess ? 'success' : 'failure', {
            mission: this.currentMissionName || 'Unknown',
            durationMs: Date.now() - (this.missionStartTime || Date.now()),
            interventions: this.reportData.filter(i => i.type === 'HIJACK').length,
            mttr: this.telemetry.getStats().avgRecoveryTimeMs,
            error: missionSuccess ? null : 'Mission had failures'
        });

        // Save learned memory before shutdown
        await this.saveHistoricalMemory();
        await this.saveTemporalMetrics();

        if (this.page && !this.page.isClosed()) await this.page.close();
        if (this.browser) await this.browser.close();

        for (const client of this.wss?.clients || []) {
            client.terminate();
        }

        await new Promise(resolve => {
            if (!this.wss) {
                resolve();
                return;
            }
            try {
                this.wss.close(() => resolve());
            } catch (error) {
                console.warn('[CBA Hub] WebSocket server close warning:', error.message);
                resolve();
            }
        });

        await new Promise(resolve => {
            if (!this.server?.listening) {
                resolve();
                return;
            }
            this.server.close(error => {
                if (error) {
                    console.warn('[CBA Hub] HTTP server close warning:', error.message);
                }
                resolve();
            });
        });

        console.log("[CBA Hub] Hub shutdown complete.");
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
        this.checkSentinelConnections(now);
        let healthy = true;
        for (const [id, s] of this.sentinels.entries()) {
            if (s.priority <= 5 && (now - s.lastSeen > this.heartbeatTimeout)) {
                console.error(`[CBA Hub] ERROR: Critical Sentinel ${s.layer} is UNRESPONSIVE.`);
                healthy = false;
            }
        }
        this.systemHealthy = healthy;
    }

    async handleHijack(id, msg, requestId = null) {
        if (!this.systemHealthy) return;
        const requested = this.sentinels.get(id);
        if (!requested) return;

        if (this.isLocked) {
            const current = this.sentinels.get(this.lockOwner);
            if (!current || requested.priority < current.priority) {
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

        // Broadcast HIJACK event to clients for test verification
        this.broadcastToClients({
            jsonrpc: '2.0',
            method: 'starlight.hijack',
            params: {
                sentinel: requested.layer,
                reason: msg.reason
            }
        });

        const pendingKey = requestId ? `${requestId}:${id}` : null;
        if (pendingKey && this.pendingRequests.has(pendingKey)) {
            this.pendingRequests.get(pendingKey).resolve({
                method: 'starlight.wait',
                params: {
                    retryAfterMs: lockTTL,
                    severity: 'soft',
                    reason: `Hijacked by ${requested.layer}`
                }
            });
        }
    }

    handleResume(id, msg) {
        if (this.lockOwner === id) {
            console.log(`[CBA Hub] RESUME from ${this.sentinels.get(id)?.layer || id}`);

            // ROI Tracking: Calculate duration
            const start = this.hijackStarts.get(id);
            if (start) {
                const durationMs = Date.now() - start;
                this.recoveryTimes.push(durationMs); // Track for MTTR
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
        if (this.lockTimeout) {
            clearTimeout(this.lockTimeout);
            this.lockTimeout = null;
        }
        this.processQueue();
    }

    enqueueCommand(clientId, msg) {
        const requestKey = `${clientId}:${msg.id}`;
        if (this.activeRequestIds.has(requestKey)) {
            this.sendRpcError(this.clients.get(clientId)?.ws, msg.id, 4009, 'Duplicate request ID');
            return;
        }
        this.activeRequestIds.add(requestKey);
        this.commandQueue.push({ clientId, ...msg });
        this.processQueue();
    }

    scheduleQueueProcessing(delay = 0) {
        const timer = setTimeout(() => {
            this.retryTimers.delete(timer);
            if (!this.isShuttingDown) this.processQueue();
        }, delay);
        this.retryTimers.add(timer);
    }

    async processQueue() {
        // Don't process if shutting down
        if (this.isShuttingDown) return;
        if (this.isLocked || this.commandQueue.length === 0 || !this.systemHealthy || this.isProcessing) return;

        if (!this.missionStartTime) this.missionStartTime = Date.now();

        this.isProcessing = true;
        try {
            const msg = this.commandQueue.shift();
            this.currentCommand = msg; // Track for failure reporting on shutdown
            if (msg.internal && msg.cmd === 'nop') {
                console.log("[CBA Hub] Processing RE_CHECK settling (500ms)...");
                await new Promise(r => setTimeout(r, 500));
                this.isProcessing = false;
                this.processQueue();
                return;
            }

            // Phase 17.4: Temporal Optimization (Ghost-Based Pacing)
            const ghostKey = `ghost:${msg.cmd}:${msg.selector || ''}`;
            if (this.historicalMemory.has(ghostKey)) {
                const ghostLatency = this.historicalMemory.get(ghostKey);
                msg.stabilityHint = Math.max(msg.stabilityHint || 0, ghostLatency);
                console.log(`[CBA Hub] TEMPORAL OPTIMIZATION: Applying Ghost Hint (${ghostLatency}ms) for ${msg.cmd}`);
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

            const preCheckResult = await this.broadcastPreCheck(msg);
            const forcedProceed = false;
            if (!preCheckResult.clear) {
                if (preCheckResult.hardBlock) {
                    const error = `Blocked by ${preCheckResult.sentinel || 'Sentinel'}: ${preCheckResult.reason}`;
                    console.error(`[CBA Hub] HARD BLOCK: ${error}`);
                    this.reportData.push({
                        type: 'COMMAND',
                        id: msg.id,
                        cmd: msg.cmd,
                        goal: msg.goal,
                        selector: msg.selector,
                        url: msg.url,
                        success: false,
                        hardBlocked: true,
                        forcedProceed: false,
                        selfHealed: false,
                        predictiveWait,
                        timestamp: new Date().toLocaleTimeString(),
                        beforeScreenshot: null,
                        afterScreenshot: null,
                        error
                    });
                    this.completeCommand(msg.clientId, msg.id, {
                        success: false,
                        hardBlocked: true,
                        error
                    });
                    this.isProcessing = false;
                    this.scheduleQueueProcessing();
                    return;
                }

                // Track pre-check retries for animation tolerance
                msg._preCheckRetries = (msg._preCheckRetries || 0) + 1;
                const maxRetries = this.config.hub?.maxPreCheckRetries || 3;

                if (msg._preCheckRetries >= maxRetries) {
                    const error = `Pre-check failed after ${maxRetries} attempts: ${preCheckResult.reason}`;
                    this.reportData.push({
                        type: 'COMMAND',
                        id: msg.id,
                        cmd: msg.cmd,
                        goal: msg.goal,
                        selector: msg.selector,
                        url: msg.url,
                        success: false,
                        hardBlocked: false,
                        forcedProceed: false,
                        selfHealed: false,
                        predictiveWait,
                        timestamp: new Date().toLocaleTimeString(),
                        beforeScreenshot: null,
                        afterScreenshot: null,
                        error
                    });
                    this.completeCommand(msg.clientId, msg.id, { success: false, error });
                    this.scheduleQueueProcessing();
                    return;
                } else {
                    const retryAfterMs = preCheckResult.retryAfterMs ?? 1000;
                    console.log(`[CBA Hub] Pre-check failed (${msg._preCheckRetries}/${maxRetries}) for ${msg.cmd}. Retrying in ${retryAfterMs}ms...`);
                    this.commandQueue.unshift(msg);
                    this.isProcessing = false;
                    this.scheduleQueueProcessing(retryAfterMs);
                    return;
                }
            }

            // v2.1: Robust Screenshot Timing (Wait for settlement)
            const beforeScreenshot = await this.takeScreenshot(`BEFORE_${msg.cmd}`);
            const originalSelector = msg.selector;
            let success = false;
            let commandError = null;
            try {
                success = await this.executeCommand(msg);
            } catch (e) {
                success = false;
                commandError = e.message;
                console.error(`[CBA Hub] Command execution error: ${commandError}`);
            }
            const selfHealed = originalSelector !== msg.selector;

            // Learn successful goal→selector mappings
            if (success && msg.goal && msg.selector) {
                this.learnMapping(msg.goal, msg.selector, msg.cmd);
            }

            // Brief wait for UI to reflect change before "AFTER" capture
            await new Promise(r => setTimeout(r, 500));
            const afterScreenshot = await this.takeScreenshot(`AFTER_${msg.cmd}`);

            this.reportData.push({
                type: 'COMMAND',
                id: msg.id,
                cmd: msg.cmd,
                goal: msg.goal,
                selector: msg.selector,
                url: msg.url,
                success,
                forcedProceed,
                selfHealed: selfHealed || msg.selfHealed,
                learned: success && msg.goal && msg.selector, // Track that we learned from this
                predictiveWait,
                timestamp: new Date().toLocaleTimeString(),
                beforeScreenshot,
                afterScreenshot,
                error: commandError
            });

            this.completeCommand(msg.clientId, msg.id, {
                success,
                error: commandError || (success ? null : `Command "${msg.cmd}" failed on ${msg.goal || msg.selector}`),
                context: this.sovereignState // Phase 4: Return shared context to Intent
            });
        } finally {
            this.currentCommand = null; // Clear tracking
            this.isProcessing = false;
        }
        this.processQueue();
    }

    async broadcastPreCheck(msg) {
        // Exit early if shutting down to prevent page.evaluate after browser closes
        if (this.isShuttingDown) return { clear: true };

        const syncBudget = this.config.hub?.syncBudget || 30000;
        const hint = msg.stabilityHint ? ` (Hint: ${msg.stabilityHint}ms)` : '';
        console.log(`[CBA Hub] Awaiting Handshake for ${msg.cmd}${hint} (Budget: ${syncBudget / 1000}s)...`);

        const relevantSentinels = Array.from(this.sentinels.entries());

        if (relevantSentinels.length === 0) return { clear: true };

        const allSelectors = [...new Set(relevantSentinels.flatMap(([, s]) => s.selectors || []))];

        // v2.0 Phase 2: Add AI context (screenshot) if deep analysis is capability-flagged
        let screenshotB64 = null;
        if (relevantSentinels.some(([, s]) => s.capabilities?.includes('vision'))) {
            try {
                const screenshotBuffer = await this.page.screenshot({ type: 'jpeg', quality: 80 });
                screenshotB64 = screenshotBuffer.toString('base64');
                console.log(`[CBA Hub] Screenshot captured for AI analysis (${Math.round(screenshotB64.length / 1024)}KB)`);
            } catch (e) {
                console.warn('[CBA Hub] Screenshot capture failed:', e.message);
            }
        }

        // Phase 9: Enhanced obstacle detection with Shadow DOM support
        const shadowEnabled = this.config.hub?.shadowDom?.enabled !== false;
        const maxDepth = this.config.hub?.shadowDom?.maxDepth || 5;

        const blockingElements = await this.page.evaluate(({ selectors, shadowEnabled, maxDepth }) => {
            const results = [];

            // Helper: Recursively search elements including shadow roots
            function findElements(root, selector, depth = 0) {
                if (depth > maxDepth) return [];
                let elements = [];
                try {
                    elements = Array.from(root.querySelectorAll(selector));
                } catch (e) { /* invalid selector for this context */ }

                if (shadowEnabled) {
                    const allElements = root.querySelectorAll('*');
                    for (const el of allElements) {
                        if (el.shadowRoot) {
                            elements = elements.concat(findElements(el.shadowRoot, selector, depth + 1));
                        }
                    }
                }
                return elements;
            }

            // Helper: Generate shadow-piercing selector
            function getShadowSelector(element) {
                const isInShadow = element.getRootNode() instanceof ShadowRoot;
                if (!isInShadow) return null;

                const path = [];
                let current = element;
                while (current && current !== document.body) {
                    if (current.id) {
                        path.unshift(`#${current.id}`);
                        break;
                    } else if (current.className && typeof current.className === 'string') {
                        path.unshift(`.${current.className.split(' ').filter(c => c).join('.')}`);
                    } else {
                        path.unshift(current.tagName?.toLowerCase() || '*');
                    }

                    if (current.getRootNode() instanceof ShadowRoot) {
                        const host = current.getRootNode().host;
                        path.unshift('>>>');
                        current = host;
                    } else {
                        current = current.parentElement;
                    }
                }
                return path.join(' ');
            }

            selectors.forEach(s => {
                const elements = findElements(document, s);
                elements.forEach(el => {
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    const isVisible = style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        style.opacity !== '0' &&
                        rect.width > 0 && rect.height > 0;

                    if (isVisible) {
                        const shadowSelector = getShadowSelector(el);
                        results.push({
                            selector: shadowSelector || s,
                            id: el.id,
                            tagName: el.tagName,
                            inputType: el.getAttribute('type'),
                            className: typeof el.className === 'string' ? el.className : '',
                            display: style.display,
                            rect: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
                            inShadow: !!shadowSelector
                        });
                    }
                });
            });
            return results;
        }, { selectors: allSelectors, shadowEnabled, maxDepth });

        // Phase 9: Extract page text for PII detection
        let pageText = '';
        if (relevantSentinels.some(([, s]) => s.capabilities?.includes('pii-detection'))) {
            try {
                pageText = await this.page.evaluate(() => document.body.innerText || '');
                console.log(`[CBA Hub] Page text extracted for PII scan (${pageText.length} chars)`);
            } catch (e) {
                console.warn('[CBA Hub] Page text extraction failed:', e.message);
            }
        }

        // Phase 12: Collect A11y snapshot for accessibility-capable Sentinels
        let a11ySnapshot = null;
        if (relevantSentinels.some(([, s]) => s.capabilities?.includes('accessibility'))) {
            try {
                a11ySnapshot = await this.getA11ySnapshot();
                console.log(`[CBA Hub] A11y snapshot collected (${a11ySnapshot.elements?.length || 0} elements)`);
            } catch (e) {
                console.warn('[CBA Hub] A11y snapshot failed:', e.message);
            }
        }

        // Get target element rect if we have a selector (for overlap checking)
        let targetRect = null;
        if (msg.selector) {
            try {
                targetRect = await this.page.evaluate((selector) => {
                    const el = document.querySelector(selector);
                    if (!el) return null;
                    const rect = el.getBoundingClientRect();
                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                }, msg.selector);
            } catch (e) {
                // Selector might not be valid yet, that's ok
            }
        }

        let viewport = null;
        try {
            viewport = this.page.viewportSize?.() || await this.page.evaluate(() => ({
                width: window.innerWidth,
                height: window.innerHeight
            }));
        } catch (e) {
            // Viewport is advisory; pre-checks can continue without it.
        }

        const quorumThreshold = this.config.hub?.quorumThreshold || 1.0;
        const consensusTimeout = this.config.hub?.consensusTimeout || 5000;
        const totalSentinels = relevantSentinels.length;
        const requiredConfidence = totalSentinels * quorumThreshold;
        const preCheckId = `precheck-${nanoid()}`;

        let receivedConfidence = 0;
        let receivedVeto = null;
        let responsesCount = 0;

        return new Promise((resolve) => {
            const cleanup = () => {
                relevantSentinels.forEach(([id]) => {
                    this.pendingRequests.delete(`${preCheckId}:${id}`);
                });
                clearTimeout(budgetTimer);
                clearTimeout(consensusTimer);
            };

            const budgetTimer = setTimeout(() => {
                const missing = relevantSentinels
                    .filter(([id]) => this.pendingRequests.has(`${preCheckId}:${id}`))
                    .map(([_, s]) => s.layer);
                if (missing.length > 0) {
                    console.warn(`[CBA Hub] Handshake TIMEOUT: Missing signals from [${missing.join(', ')}] after ${syncBudget}ms.`);
                }
                cleanup();
                resolve({
                    clear: false,
                    hardBlock: false,
                    reason: `Handshake timeout: ${missing.join(', ')}`,
                    retryAfterMs: 1000
                });
            }, syncBudget);

            let consensusTimer = null;

            relevantSentinels.forEach(([id, s]) => {
                this.pendingRequests.set(`${preCheckId}:${id}`, {
                    layer: s.layer,
                    resolve: (response) => {
                        responsesCount++;
                        const confidence = response.params?.confidence ?? 1.0;

                        if (response.method === 'starlight.wait') {
                            receivedVeto = response;
                            console.log(`[CBA Hub] Stability VETO from ${s.layer} (Confidence: ${confidence}).`);
                            cleanup();
                            resolve({
                                clear: false,
                                hardBlock: response.params?.severity === 'hard',
                                reason: response.params?.reason || `Veto from ${s.layer}`,
                                retryAfterMs: response.params?.retryAfterMs ?? 1000,
                                sentinel: s.layer
                            });
                            return;
                        }

                        if (response.method === 'starlight.clear') {
                            receivedConfidence += confidence;
                        }

                        // Check if quorum reached
                        if (receivedConfidence >= requiredConfidence && !receivedVeto) {
                            console.log(`[CBA Hub] Consensus MET (${receivedConfidence.toFixed(1)}/${requiredConfidence.toFixed(1)}). Proceeding...`);
                            cleanup();
                            resolve({ clear: true });
                        } else if (responsesCount === totalSentinels) {
                            // All responded but quorum not reached (shouldn't happen with default 1.0 unless confidence < 1)
                            console.log(`[CBA Hub] Handshake COMPLETED. Final confidence: ${receivedConfidence.toFixed(1)}/${requiredConfidence.toFixed(1)}`);
                            cleanup();
                            resolve({
                                clear: receivedConfidence >= requiredConfidence,
                                hardBlock: false,
                                reason: 'Insufficient consensus',
                                retryAfterMs: 1000
                            });
                        } else if (quorumThreshold < 1.0 && !consensusTimer) {
                            // Start consensus timeout once we have at least one response
                            consensusTimer = setTimeout(() => {
                                console.log(`[CBA Hub] Consensus TIMEOUT (${receivedConfidence.toFixed(1)}/${requiredConfidence.toFixed(1)}).`);
                                cleanup();
                                resolve({
                                    clear: receivedConfidence >= requiredConfidence,
                                    hardBlock: false,
                                    reason: 'Consensus timeout',
                                    retryAfterMs: 1000
                                });
                            }, consensusTimeout);
                        }
                    },
                    reject: () => {
                        responsesCount++;
                        if (responsesCount === totalSentinels && !receivedVeto) {
                            cleanup();
                            resolve({
                                clear: receivedConfidence >= requiredConfidence,
                                hardBlock: false,
                                reason: 'Sentinel disconnected during pre-check',
                                retryAfterMs: 1000
                            });
                        }
                    }
                });
            });

            this.broadcastToSentinels({
                jsonrpc: '2.0',
                method: 'starlight.pre_check',
                params: {
                    command: msg,
                    blocking: blockingElements,
                    targetRect,
                    viewport,
                    screenshot: screenshotB64,
                    page_text: pageText,
                    a11y_snapshot: a11ySnapshot
                },
                id: preCheckId
            });
        });
    }

    async executeCommand(msg, retry = true) {
        const startTime = Date.now();
        try {
            // Ensure browser is launched
            if (!this.browser) {
                console.log('[CBA Hub] Launching browser for execution...');

                // Phase 15: Use BrowserAdapter for Polymorphism
                if (!this.browserAdapter) {
                    this.browserAdapter = await BrowserAdapter.create(this.config.hub?.browser || {});
                }
                this.browser = await this.browserAdapter.launch({ headless: this.headless });

                const context = await this.browser.newContext();
                this.page = await context.newPage();
            }

            // Phase 15: Normalize Selectors (e.g. remove >>> for Firefox)
            if (this.browserAdapter && msg.selector && typeof msg.selector === 'string') {
                const originalSelector = msg.selector;
                msg.selector = this.browserAdapter.normalizeSelector(msg.selector);
                if (msg.selector !== originalSelector) {
                    console.log(`[CBA Hub] Normalized selector for ${this.browserAdapter.engine}: "${originalSelector}" -> "${msg.selector}"`);
                }
            }

            if (this.config.hub?.ghostMode && msg.cmd !== 'goto' && msg.cmd !== 'checkpoint') {
                console.log(`[CBA Hub] GHOST MODE: Timed ${msg.cmd} on ${msg.selector || 'target'}. Observation only.`);
                await new Promise(r => setTimeout(r, 50));
            } else {
                if (msg.cmd === 'goto') await this.page.goto(msg.url);
                else if (msg.cmd === 'click') await this.page.click(msg.selector);
                else if (msg.cmd === 'fill') await this.page.fill(msg.selector, msg.text);
                else if (msg.cmd === 'select') await this.page.selectOption(msg.selector, msg.value);
                else if (msg.cmd === 'hover') await this.page.hover(msg.selector);
                else if (msg.cmd === 'check') await this.page.check(msg.selector);
                else if (msg.cmd === 'uncheck') await this.page.uncheck(msg.selector);
                else if (msg.cmd === 'scroll') {
                    if (msg.selector) {
                        await this.page.locator(msg.selector).scrollIntoViewIfNeeded();
                    } else {
                        await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                    }
                }
                else if (msg.cmd === 'press') await this.page.keyboard.press(msg.key);
                else if (msg.cmd === 'type') await this.page.keyboard.type(msg.text);
                else if (msg.cmd === 'upload') {
                    // Handle file upload - msg.files can be single path string or array of paths
                    const files = Array.isArray(msg.files) ? msg.files : [msg.files];
                    await this.page.setInputFiles(msg.selector, files);
                }
                else if (msg.cmd === 'checkpoint') {
                    console.log(`[CBA Hub] 🚩 Checkpoint reached: ${msg.name}`);
                    this.recordTrace('CHECKPOINT', 'System', {
                        method: 'starlight.checkpoint',
                        params: { name: msg.name }
                    });
                }
            }

            // Phase 17.4: Track temporal ghosting metrics
            if (this.config.hub?.ghostMode) {
                this.recordTemporalGhosting(msg, Date.now() - startTime);
            }

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

    async executeSentinelAction(id, msg, requestId) {
        const client = this.clients.get(id);
        if (this.lockOwner !== id) {
            this.sendRpcError(client?.ws, requestId, 4003, 'Sentinel does not own the remediation lock');
            return;
        }

        console.log(`[CBA Hub] Sentinel Action: ${msg.cmd} ${msg.selector || ''}`);
        try {
            switch (msg.cmd) {
                case 'click':
                    try {
                        await this.page.click(msg.selector, { timeout: 2000, force: true });
                    } catch {
                        await this.page.dispatchEvent(msg.selector, 'click');
                    }
                    break;
                case 'fill':
                    await this.page.fill(msg.selector, msg.text);
                    break;
                case 'select':
                    await this.page.selectOption(msg.selector, msg.value);
                    break;
                case 'hover':
                    await this.page.hover(msg.selector);
                    break;
                case 'check':
                    await this.page.check(msg.selector);
                    break;
                case 'uncheck':
                    await this.page.uncheck(msg.selector);
                    break;
                case 'scroll':
                    if (msg.selector) {
                        await this.page.locator(msg.selector).scrollIntoViewIfNeeded();
                    } else {
                        await this.page.evaluate(() => window.scrollBy(0, window.innerHeight));
                    }
                    break;
                case 'press':
                    if (msg.selector) await this.page.press(msg.selector, msg.key);
                    else await this.page.keyboard.press(msg.key);
                    break;
                case 'type':
                    if (msg.selector) await this.page.type(msg.selector, msg.text);
                    else await this.page.keyboard.type(msg.text);
                    break;
                case 'upload':
                    await this.page.setInputFiles(msg.selector, msg.files);
                    break;
                case 'hide':
                    await this.page.locator(msg.selector).evaluateAll(elements => {
                        elements.forEach(element => {
                            element.style.setProperty('display', 'none', 'important');
                        });
                    });
                    break;
                case 'remove':
                    await this.page.locator(msg.selector).evaluateAll(elements => {
                        elements.forEach(element => element.remove());
                    });
                    break;
                case 'get_a11y_snapshot':
                    this.sendRpcResult(client.ws, requestId, {
                        success: true,
                        snapshot: await this.getA11ySnapshot()
                    });
                    return;
                default:
                    throw new Error(`Unsupported sentinel action: ${msg.cmd}`);
            }

            this.sendRpcResult(client.ws, requestId, { success: true });
        } catch (error) {
            console.error(`[CBA Hub] Sentinel action failed: ${error.message}`);
            this.sendRpcError(client?.ws, requestId, -32000, 'Sentinel action failed', error.message);
        }
    }

    /**
     * Phase 13: Get page context for NLI parsing.
     * Extracts semantic elements (buttons, inputs, products) to guide the LLM.
     */
    async getLegacyPageContext() {
        if (!this.page) return { error: 'No active page' };

        try {
            const context = await this.page.evaluate(() => {
                const data = {
                    url: window.location.href,
                    title: document.title,
                    headings: [],
                    buttons: [],
                    inputs: [],
                    links: [],
                    products: []
                };

                // Helper to get visible text
                const isVisible = (el) => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                };

                // Headings
                document.querySelectorAll('h1, h2, h3').forEach(h => {
                    if (isVisible(h) && h.innerText.trim()) data.headings.push(h.innerText.trim());
                });

                // Buttons (and inputs that act as buttons)
                document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]').forEach(b => {
                    if (isVisible(b)) {
                        const text = b.innerText || b.value || b.getAttribute('aria-label') || '';
                        if (text.trim()) data.buttons.push({ text: text.trim().slice(0, 50) });
                    }
                });

                // Inputs
                document.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach(i => {
                    if (isVisible(i) && !['button', 'submit', 'image'].includes(i.type)) {
                        let label = '';
                        if (i.labels && i.labels.length > 0) label = i.labels[0].innerText;
                        else if (i.placeholder) label = i.placeholder;
                        else if (i.getAttribute('aria-label')) label = i.getAttribute('aria-label');
                        else if (i.id) label = i.id;

                        data.inputs.push({
                            label: (label || 'unknown').trim().slice(0, 50),
                            type: i.type || 'text'
                        });
                    }
                });

                // Links (Navigation) - Enhanced with Generic Semantic Extraction
                document.querySelectorAll('a').forEach(a => {
                    if (isVisible(a)) {
                        let text = a.innerText.trim();

                        // Fallback to accessibility attributes
                        if (!text) text = a.getAttribute('aria-label') || a.getAttribute('data-test') || a.title;

                        // Phase 14: Generic Semantic Class Extraction
                        // If text is empty OR short/numeric (like a badge "1"), scan classes
                        if ((!text || text.length < 3 || !isNaN(text)) && a.classList && a.classList.length > 0) {
                            const semanticKeywords = ['cart', 'menu', 'login', 'signin', 'sign-in', 'search', 'user', 'profile', 'account', 'home'];
                            const classes = Array.from(a.classList);
                            const semanticClass = classes.find(c => semanticKeywords.some(k => c.toLowerCase().includes(k)));

                            if (semanticClass) {
                                // Convert snake_case or kebab-case
                                const extracted = semanticClass.replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
                                if (extracted) {
                                    // Append or replace
                                    text = text ? `${text} (${extracted})` : extracted;
                                }
                            }
                        }

                        if (text) {
                            data.links.push({ text: text.trim().slice(0, 50), href: a.href });
                        }
                    }
                });

                // Product Detection Heuristic (Price patterns)
                // Looks for elements containing "$" or "€" or "£" + digits
                const priceRegex = /[$€£]\s*\d+(?:\.\d{2})?/;
                const priceElements = Array.from(document.querySelectorAll('*')).filter(el =>
                    el.children.length === 0 && el.innerText && priceRegex.test(el.innerText) && isVisible(el)
                );

                priceElements.forEach(el => {
                    // Try to find a container for this product
                    const container = el.closest('.inventory_item, .product, .item, .card, div');
                    if (container) {
                        const nameEl = container.querySelector('.inventory_item_name, .product-name, h3, h4, .title');
                        const name = nameEl ? nameEl.innerText.trim() : 'Unknown Product';
                        const price = el.innerText.trim();
                        // Deduplicate
                        if (!data.products.some(p => p.name === name)) {
                            data.products.push({ name, price });
                        }
                    }
                });

                return data;
            });

            console.log(`[CBA Hub] Page Context extracted: ${context.buttons.length} buttons, ${context.inputs.length} inputs, ${context.products.length} products`);
            return context;
        } catch (e) {
            console.error(`[CBA Hub] Failed to extract page context: ${e.message}`);
            return { error: e.message };
        }
    }

    /**
     * Phase 12: Get DOM snapshot for A11y Sentinel accessibility auditing.
     * Extracts elements with their attributes and computed styles.
     */
    async getA11ySnapshot() {
        if (!this.page) return { elements: [], computed: [] };

        try {
            const snapshot = await this.page.evaluate(() => {
                const elements = [];
                const computed = [];

                // Collect all relevant elements
                const allElements = document.querySelectorAll('*');
                let count = 0;
                const maxElements = 500; // Limit for performance

                for (const el of allElements) {
                    if (count >= maxElements) break;

                    const tag = el.tagName;

                    // Handle SVG elements where className is SVGAnimatedString
                    const classStr = typeof el.className === 'string' ? el.className : (el.className?.baseVal || '');

                    // Collect element data
                    const elementData = {
                        tag: tag,
                        selector: el.id ? `#${el.id}` : (classStr ? `.${classStr.split(' ')[0]}` : tag.toLowerCase()),
                        text: (el.innerText || el.textContent || '').slice(0, 100).trim(),
                        hasLabel: !!el.labels?.length,
                        attributes: {
                            id: el.id || null,
                            className: classStr || null,
                            alt: el.getAttribute('alt'),
                            role: el.getAttribute('role'),
                            'aria-label': el.getAttribute('aria-label'),
                            'aria-labelledby': el.getAttribute('aria-labelledby'),
                            'aria-hidden': el.getAttribute('aria-hidden'),
                            href: el.getAttribute('href'),
                            type: el.getAttribute('type'),
                            for: el.getAttribute('for'),
                            title: el.getAttribute('title'),
                            tabindex: el.getAttribute('tabindex'),
                            width: el.getAttribute('width'),
                            height: el.getAttribute('height'),
                            src: el.getAttribute('src')?.slice(0, 100)
                        }
                    };

                    elements.push(elementData);

                    // Collect computed styles for text elements and interactive elements
                    if (['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'P', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LABEL', 'DIV'].includes(tag)) {
                        const styles = window.getComputedStyle(el);
                        computed.push({
                            tag: tag,
                            selector: elementData.selector,
                            text: elementData.text,
                            styles: {
                                color: styles.color,
                                backgroundColor: styles.backgroundColor,
                                fontSize: styles.fontSize,
                                fontWeight: styles.fontWeight,
                                outline: styles.outline,
                                outlineStyle: styles.outlineStyle,
                                boxShadow: styles.boxShadow
                            }
                        });
                    }

                    count++;
                }

                return { elements, computed };
            });

            console.log(`[CBA Hub] A11y snapshot collected: ${snapshot.elements.length} elements, ${snapshot.computed.length} with styles`);
            return snapshot;
        } catch (e) {
            console.error(`[CBA Hub] A11y snapshot failed: ${e.message}`);
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Phase 17: Inter-Sentinel Side-Talk
    // ─────────────────────────────────────────────────────────────────

    /**
     * Handle side-talk messages between Sentinels.
     * Routes messages without requiring direct Sentinel connections.
     * Handles Sentinel availability (offline/unavailable scenarios).
     */
    async handleSideTalk(senderId, params, senderSentinel) {
        const { from, to, topic, payload, replyTo, ttl = 5000 } = params;

        console.log(`[CBA Hub] Side-Talk: ${from} → ${to} (topic: ${topic})`);

        // Validate sender
        if (!senderSentinel || senderSentinel.layer !== from) {
            console.warn(`[CBA Hub] Side-Talk rejected: sender mismatch (${from})`);
            return;
        }

        // Build the side-talk envelope
        const envelope = {
            jsonrpc: '2.0',
            method: 'starlight.sidetalk',
            params: {
                from,
                to,
                topic,
                payload,
                replyTo,
                timestamp: new Date().toISOString()
            },
            id: `sidetalk-${nanoid(8)}`
        };

        // Track delivery status
        const deliveryStatus = {
            sent: 0,
            delivered: 0,
            unavailable: []
        };

        // Broadcast or direct message
        if (to === '*') {
            // Broadcast to all Sentinels except sender
            for (const [id, sentinel] of this.sentinels.entries()) {
                if (sentinel.layer !== from) {
                    const success = this.deliverSideTalk(sentinel, envelope);
                    deliveryStatus.sent++;
                    if (success) {
                        deliveryStatus.delivered++;
                    } else {
                        deliveryStatus.unavailable.push(sentinel.layer);
                    }
                }
            }
            console.log(`[CBA Hub] Side-Talk broadcast: ${deliveryStatus.delivered}/${deliveryStatus.sent} delivered`);
        } else {
            // Direct message to specific Sentinel
            const targetSentinel = Array.from(this.sentinels.entries())
                .find(([id, s]) => s.layer === to)?.[1];

            if (!targetSentinel) {
                console.warn(`[CBA Hub] Side-Talk: Target Sentinel '${to}' not found/unavailable`);

                // Notify sender of failed delivery
                this.deliverSideTalk(senderSentinel, {
                    jsonrpc: '2.0',
                    method: 'starlight.sidetalk_ack',
                    params: {
                        originalId: envelope.id,
                        status: 'undeliverable',
                        reason: `Sentinel '${to}' is not available`,
                        availableSentinels: Array.from(this.sentinels.values()).map(s => s.layer)
                    },
                    id: `sidetalk-ack-${nanoid(8)}`
                });
                return;
            }

            const success = this.deliverSideTalk(targetSentinel, envelope);
            if (!success) {
                console.warn(`[CBA Hub] Side-Talk: Failed to deliver to '${to}'`);
            }
        }

        // Log side-talk for debugging
        this.missionTrace.push({
            type: 'SIDETALK',
            from,
            to,
            topic,
            deliveryStatus,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Attempt to deliver a side-talk message to a Sentinel.
     * Returns true if sent successfully, false if Sentinel is unavailable.
     */
    deliverSideTalk(sentinel, envelope) {
        try {
            if (!sentinel.ws || sentinel.ws.readyState !== WebSocket.OPEN) {
                return false;
            }
            sentinel.ws.send(JSON.stringify(envelope));
            return true;
        } catch (e) {
            console.error(`[CBA Hub] Side-Talk delivery error: ${e.message}`);
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Phase 17: Starlight Warp (Context Serialization)
    // ─────────────────────────────────────────────────────────────────

    /**
     * Capture current browser context to a .warp file.
     * Security: All data is sanitized by default.
     */
    async handleWarpCapture(clientId, params) {
        const { reason = 'manual', sanitize = true, encrypt = false } = params;

        console.log(`[CBA Hub] Warp Capture requested (reason: ${reason}, sanitize: ${sanitize})`);

        // Security warning for unsanitized captures
        if (!sanitize) {
            console.warn('[CBA Hub] ⚠️ SECURITY WARNING: Creating unsanitized warp file!');
        }

        try {
            // Lazy-load warp module
            if (!this.warp) {
                const { StarlightWarp } = require('./warp');
                this.warp = new StarlightWarp(this.page, {
                    outputDir: this.config.warp?.outputDir || './warps',
                    sanitize,
                    encrypt,
                    encryptionKey: this.config.warp?.encryptionKey
                });
                await this.warp.initialize();
            }

            const filepath = await this.warp.capture(reason);

            this.broadcastToClient(clientId, {
                type: 'WARP_CAPTURED',
                success: true,
                filepath,
                sanitized: sanitize
            });

            // Add to mission trace
            this.missionTrace.push({
                type: 'WARP_CAPTURE',
                reason,
                filepath,
                sanitized: sanitize,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error(`[CBA Hub] Warp capture failed: ${error.message}`);
            this.broadcastToClient(clientId, {
                type: 'WARP_CAPTURED',
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Restore browser context from a .warp file.
     */
    async handleWarpRestore(clientId, params) {
        const { filepath, restoreUrl = true, restoreCookies = true, restoreStorage = true } = params;

        console.log(`[CBA Hub] Warp Restore requested: ${filepath}`);

        try {
            if (!this.warp) {
                const { StarlightWarp } = require('./warp');
                this.warp = new StarlightWarp(this.page, {
                    outputDir: this.config.warp?.outputDir || './warps'
                });
            }

            const data = await this.warp.restore(filepath, {
                restoreUrl,
                restoreCookies,
                restoreStorage
            });

            this.broadcastToClient(clientId, {
                type: 'WARP_RESTORED',
                success: true,
                url: data.url,
                sanitized: data._sanitized
            });

        } catch (error) {
            console.error(`[CBA Hub] Warp restore failed: ${error.message}`);
            this.broadcastToClient(clientId, {
                type: 'WARP_RESTORED',
                success: false,
                error: error.message
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
        const client = this.clients.get(clientId);
        if (client?.ws?.readyState === WebSocket.OPEN) {
            client.ws.send(data);
        }
    }

    async generateReport() {
        console.log("[CBA Hub] Generating Hero Story Report...");
        const totalSavedMins = Math.floor(this.totalSavedTime / 60);

        // Calculate overall mission success from reportData
        const failedCommands = this.reportData.filter(i => i.type === 'COMMAND' && !i.success);
        const hasFailure = this.reportData.some(i => i.type === 'FAILURE') || failedCommands.length > 0;
        const statusEmoji = hasFailure ? '❌' : '✅';
        const statusText = hasFailure ? 'Mission Failed' : 'Mission Complete';
        const statusColor = hasFailure ? '#f43f5e' : '#10B981';

        const html = `
    <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>CBA Hero Story: ${statusText}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
                    
                    :root {
                        --bg-primary: #0A0A0A;
                        --bg-secondary: #111111;
                        --bg-card: #141414;
                        --accent: #10B981;
                        --border: #222222;
                        --text-primary: #F9FAFB;
                        --text-secondary: #9CA3AF;
                    }

                    body { 
                        font-family: 'Inter', -apple-system, sans-serif; 
                        background: var(--bg-primary); 
                        color: var(--text-primary); 
                        padding: 3rem 1.5rem; 
                        max-width: 1000px; 
                        margin: auto; 
                        line-height: 1.6;
                    }

                    .hero-header { 
                        text-align: center; 
                        padding: 4rem 2rem; 
                        background: var(--bg-secondary); 
                        border-radius: 20px; 
                        margin-bottom: 3rem; 
                        border: 1px solid var(--border); 
                        position: relative;
                        overflow: hidden;
                    }

                    .hero-header::after {
                        content: '';
                        position: absolute;
                        top: 0; left: 0; right: 0; bottom: 0;
                        background: radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.1), transparent 70%);
                        pointer-events: none;
                    }

                    .hero-header h1 { font-size: 2.5rem; font-weight: 800; margin-bottom: 1rem; letter-spacing: -0.02em; }
                    .hero-header p { color: var(--text-secondary); font-size: 1.1rem; }

                    .card { 
                        background: var(--bg-card); 
                        border-radius: 16px; 
                        padding: 2rem; 
                        margin-bottom: 2rem; 
                        border: 1px solid var(--border); 
                        position: relative; 
                        transition: border-color 0.3s ease;
                    }

                    .card:hover { border-color: var(--accent); }

                    .hijack { border-left: 6px solid #f43f5e; }
                    .command { border-left: 6px solid var(--accent); }

                    .tag { 
                        position: absolute; 
                        top: 1.5rem; 
                        right: 1.5rem; 
                        padding: 0.4rem 1rem; 
                        border-radius: 20px; 
                        font-size: 0.75rem; 
                        font-weight: 700; 
                        text-transform: uppercase; 
                        letter-spacing: 0.05em;
                    }
                    .tag-hijack { background: #f43f5e; color: white; }
                    .tag-command { background: var(--accent); color: var(--bg-primary); }

                    img { 
                        max-width: 100%; 
                        border-radius: 12px; 
                        margin-top: 1.5rem; 
                        border: 1px solid var(--border); 
                        transition: transform 0.3s ease;
                    }
                    img:hover { transform: scale(1.02); }

                    .flex { display: flex; gap: 2rem; margin-top: 1.5rem; }
                    .flex > div { flex: 1; }

                    .roi-dashboard { 
                        margin-top: 5rem; 
                        padding: 4rem; 
                        background: var(--bg-secondary); 
                        border-radius: 24px; 
                        border: 1px solid var(--accent); 
                        text-align: center; 
                        position: relative;
                        overflow: hidden;
                    }

                    .roi-value { 
                        font-size: 4rem; 
                        font-weight: 800; 
                        color: var(--accent); 
                        margin: 1.5rem 0; 
                        letter-spacing: -0.03em;
                    }

                    /* Phase 12: Accessibility Dashboard */
                    .a11y-dashboard {
                        margin-top: 3rem;
                        padding: 2rem;
                        background: var(--bg-secondary);
                        border-radius: 16px;
                        border: 1px solid var(--border);
                    }
                    .a11y-header {
                        display: flex;
                        align-items: center;
                        gap: 1.5rem;
                        margin-bottom: 1.5rem;
                    }
                    .a11y-score {
                        width: 80px;
                        height: 80px;
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 1.5rem;
                        font-weight: 800;
                        border: 4px solid;
                    }
                    .a11y-score.good { border-color: var(--accent); color: var(--accent); }
                    .a11y-score.acceptable { border-color: #3b82f6; color: #3b82f6; }
                    .a11y-score.needs-work { border-color: #f59e0b; color: #f59e0b; }
                    .a11y-score.critical { border-color: #f43f5e; color: #f43f5e; }
                    .a11y-info h3 { margin: 0 0 0.5rem 0; font-size: 1.2rem; }
                    .a11y-violations {
                        display: grid;
                        gap: 0.5rem;
                        margin-top: 1rem;
                    }
                    .a11y-violation {
                        display: flex;
                        align-items: center;
                        gap: 0.75rem;
                        padding: 0.75rem;
                        background: rgba(255,255,255,0.03);
                        border-radius: 8px;
                    }
                    .violation-rule { font-weight: 600; min-width: 120px; }
                    .violation-wcag { color: var(--text-secondary); font-size: 0.8rem; min-width: 60px; }
                    .violation-msg { flex: 1; color: var(--text-secondary); font-size: 0.9rem; }

                    .meta { color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 0.5rem; font-family: 'JetBrains Mono', monospace; }
                    .card-title { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; font-size: 1.3rem; font-weight: 700; }
                    
                    .badge { padding: 0.3rem 0.8rem; border-radius: 20px; font-size: 0.75rem; font-weight: 800; text-transform: uppercase; }
                    .badge-success { background: var(--accent); color: var(--bg-primary); }
                    .badge-danger { background: #f43f5e; color: white; }
                    .badge-warning { background: #f59e0b; color: #0a0a0a; }
                    .badge-info { background: #3b82f6; color: white; }

                    code { background: rgba(255,255,255,0.05); padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9em; }
                    h1, h3 { margin: 0; }
                    p { color: var(--text-secondary); line-height: 1.8; }
                    i { opacity: 0.7; font-size: 0.9em; }
                </style>
            </head>
            <body>
                <div class="hero-header" style="border-color: ${statusColor};">
                    <h1>${statusEmoji} Starlight Protocol: ${statusText}</h1>
                    <p>Evidence-based automation for the modern web.</p>
                    ${hasFailure ? `<p style="color: ${statusColor}; font-weight: 700; margin-top: 1rem;">⚠️ ${failedCommands.length} command(s) failed during this mission.</p>` : ''}
                </div>

                <div id="timeline">
                    ${this.reportData.map(item => {
            if (item.type === 'HIJACK') {
                return `
                                <div class="card hijack">
                                    <span class="tag tag-hijack">Sentinel Intervention</span>
                                    <div class="meta">${escapeHtml(item.timestamp)}</div>
                                    <h3>Sovereign Correction: ${escapeHtml(item.sentinel)}</h3>
                                    <p><strong>Reason:</strong> ${escapeHtml(item.reason)}</p>
                                    <img src="screenshots/${escapeHtml(item.screenshot)}" alt="Obstacle Detected" />
                                </div>
                            `;
            } else if (item.type === 'FAILURE') {
                return `
                                <div class="card command" style="border-left: 4px solid #f43f5e; background: rgba(244, 63, 94, 0.05);">
                                    <span class="tag" style="background: #f43f5e; color: white;">Mission Failure</span>
                                    <div class="meta">${escapeHtml(item.timestamp)}</div>
                                    <h3 style="color: #f43f5e;">⚠️ Termination Reason</h3>
                                    <p style="font-size: 1.1rem; font-weight: 600;">${escapeHtml(item.reason)}</p>
                                </div>
                            `;
            } else {
                const status = item.success ? (item.forcedProceed ? 'FORCED' : 'SUCCESS') : 'FAILED';
                const badgeClass = item.success ? (item.forcedProceed ? 'badge-warning' : 'badge-success') : 'badge-danger';

                return `
                                <div class="card command">
                                    <div class="tag tag-command">Intent</div>
                                    <div class="meta">${escapeHtml(item.timestamp)} | ID: ${escapeHtml(item.id)}</div>
                                    <div class="card-title">
                                        <span>${escapeHtml(item.cmd).toUpperCase()}: ${item.cmd === 'goto' ? escapeHtml(item.url) : escapeHtml(item.goal || item.selector)}</span>
                                        <span class="badge ${badgeClass}">${status}</span>
                                    </div>
                                    <p>Resolved Selector: <code>${escapeHtml(item.selector) || 'N/A'}</code></p>
                                    ${item.selfHealed ? '<p>🛡️ <i>Self-Healed: Predictive anchor used due to DOM drift.</i></p>' : ''}
                                    ${item.predictiveWait ? '<p>⏳ <i>Aura Throttling: Slowed down for historical jitter.</i></p>' : ''}
                                    ${item.forcedProceed ? '<p>⚠️ <i>Forced Proceed: Handshake timed out or vetoed, proceeding anyway.</i></p>' : ''}
                                    <div class="flex">
                                        <div>
                                            <div class="meta">Before State</div>
                                            <img src="screenshots/${item.beforeScreenshot}" alt="Before State">
                                        </div>
                                        <div>
                                            <div class="meta">After State</div>
                                            <img src="screenshots/${item.afterScreenshot}" alt="After State">
                                        </div>
                                    </div>
                                </div>
                            `;
            }
        }).join('')}
                </div>

                ${this.a11yReport ? (() => {
                // Group violations by rule type for summary
                const violationsByRule = {};
                (this.a11yReport.violations || []).forEach(v => {
                    if (!violationsByRule[v.rule]) {
                        violationsByRule[v.rule] = { count: 0, wcag: v.wcag, impact: v.impact, samples: [] };
                    }
                    violationsByRule[v.rule].count++;
                    if (violationsByRule[v.rule].samples.length < 3) {
                        violationsByRule[v.rule].samples.push(v.message);
                    }
                });

                return `
                <div class="a11y-dashboard">
                    <h2>♿ Accessibility Audit</h2>
                    <div class="a11y-header">
                        <div class="a11y-score ${this.a11yReport.score >= 0.9 ? 'good' : this.a11yReport.score >= 0.7 ? 'acceptable' : this.a11yReport.score >= 0.5 ? 'needs-work' : 'critical'}">
                            ${Math.round(this.a11yReport.score * 100)}%
                        </div>
                        <div class="a11y-info">
                            <h3>${this.a11yReport.level || 'Unknown Level'}</h3>
                            <p>${this.a11yReport.violations?.length || 0} violations found | ${this.a11yReport.passes || 0} checks passed</p>
                        </div>
                    </div>
                    
                    ${Object.keys(violationsByRule).length > 0 ? `
                    <h4 style="margin-top: 1.5rem; margin-bottom: 1rem;">Violations by Category</h4>
                    <div class="a11y-violations">
                        ${Object.entries(violationsByRule).map(([rule, data]) => `
                            <div class="a11y-violation" style="flex-direction: column; align-items: flex-start;">
                                <div style="display: flex; gap: 0.75rem; align-items: center; width: 100%;">
                                    <span class="badge ${data.impact === 'critical' ? 'badge-danger' : data.impact === 'serious' ? 'badge-warning' : 'badge-info'}">${data.impact}</span>
                                    <span class="violation-rule">${rule}</span>
                                    <span class="violation-wcag">${data.wcag || ''}</span>
                                    <span style="margin-left: auto; font-weight: 700; color: var(--accent);">${data.count} issues</span>
                                </div>
                                <div style="margin-top: 0.5rem; padding-left: 0.5rem; border-left: 2px solid var(--border);">
                                    ${data.samples.map(s => `<div class="violation-msg" style="font-size: 0.85rem;">${s}</div>`).join('')}
                                    ${data.count > 3 ? `<div class="meta" style="margin-top: 0.25rem;">...and ${data.count - 3} more</div>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    ` : '<p class="meta">No accessibility violations detected! 🎉</p>'}
                </div>
                `;
            })() : ''}

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

    // Phase 17.4: Temporal Ghosting
    recordTemporalGhosting(msg, latency) {
        this.temporalMetrics.push({
            timestamp: new Date().toISOString(),
            command: msg.cmd,
            selector: msg.selector || null,
            latency_ms: latency,
            type: 'settlement_observation'
        });
        console.log(`[CBA Hub] 🌀 Ghost Observation: ${msg.cmd} latency = ${latency}ms`);
    }

    async saveTemporalMetrics() {
        if (this.temporalMetrics.length === 0) return;
        const metricsFile = path.join(process.cwd(), 'temporal_ghosting.json');
        fs.writeFileSync(metricsFile, JSON.stringify(this.temporalMetrics, null, 2));
        console.log(`[CBA Hub] Temporal Ghosting metrics saved to temporal_ghosting.json (${this.temporalMetrics.length} samples)`);
    }
}

module.exports = { CBAHub };

if (require.main === module) {
    const args = process.argv.slice(2);
    const headless = args.includes('--headless');
    const port = args.find(a => a.startsWith('--port='))?.split('=')[1] || 8080;

    const hub = new CBAHub(parseInt(port), headless);
    hub.init().catch(async (error) => {
        console.error('[CBA Hub] Startup failed:', error);
        try {
            await hub.shutdown(error);
        } catch (shutdownError) {
            console.error('[CBA Hub] Shutdown after startup failure also failed:', shutdownError);
        }
        process.exitCode = 1;
    });
}
