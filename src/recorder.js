/**
 * Action Recorder - Captures user actions and generates intent files
 * Part of Phase 13.5: Test Recorder Feature
 */

const fs = require('fs');
const path = require('path');

class ActionRecorder {
    constructor() {
        this.isRecording = false;
        this.recordedSteps = [];
        this.startUrl = null;
        this.startTime = null;
        this.page = null;
        this.listeners = [];
    }

    /**
     * Start recording user actions on the given page.
     * @param {Page} page - Playwright page object
     */
    async startRecording(page) {
        if (this.isRecording) {
            console.log('[Recorder] Already recording');
            return;
        }

        this.page = page;
        this.isRecording = true;
        this.recordedSteps = [];
        this.startTime = new Date();
        this.startUrl = page.url();

        console.log('[Recorder] 🔴 Recording started');

        // Expose recording functions
        try {
            await page.exposeFunction('__cba_recordClick', (data) => {
                this.recordedSteps.push({
                    action: 'click',
                    goal: data.goal,
                    selector: data.selector,
                    tagName: data.tagName,
                    timestamp: Date.now()
                });
                console.log(`[Recorder] Click: "${data.goal}"`);
            });
        } catch (e) {
            // Function might already be exposed
            console.log('[Recorder] Click function already exposed');
        }

        try {
            await page.exposeFunction('__cba_recordFill', (data) => {
                this.recordedSteps.push({
                    action: 'fill',
                    goal: data.goal,
                    selector: data.selector,
                    value: data.value,
                    timestamp: Date.now()
                });
                console.log(`[Recorder] Fill: "${data.goal}" = "${data.value}"`);
            });
        } catch (e) {
            console.log('[Recorder] Fill function already exposed');
        }

        // Inject recording script into current page and on every navigation
        const injectRecordingScript = async () => {
            if (!this.isRecording) return;
            try {
                await page.evaluate(() => {
                    if (window.__cba_recording_injected) return;
                    window.__cba_recording_injected = true;

                    // Click handler with improved goal extraction
                    document.addEventListener('click', (e) => {
                        const el = e.target;

                        // Smart goal extraction - prioritize clean, short text
                        function extractGoal(element) {
                            // 1. Prefer aria-label (always clean)
                            const ariaLabel = element.getAttribute('aria-label');
                            if (ariaLabel) return ariaLabel;

                            // 2. Prefer title attribute
                            const title = element.getAttribute('title');
                            if (title) return title;

                            // 3. Get text but clean it up
                            let text = element.innerText || element.textContent || '';

                            // Take only the first line (avoid nav menus)
                            text = text.split('\n')[0];

                            // Remove emojis and special characters
                            text = text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '');

                            // Clean whitespace
                            text = text.replace(/\s+/g, ' ').trim();

                            // If text is too long or empty, try alternatives
                            if (!text || text.length > 50) {
                                // Try the element's id or class
                                if (element.id) return element.id;
                                if (element.className && typeof element.className === 'string') {
                                    return element.className.split(' ')[0];
                                }
                                return element.tagName.toLowerCase();
                            }

                            return text.substring(0, 40);
                        }

                        const goal = extractGoal(el);

                        const selector = el.id ? `#${el.id}` :
                            el.className && typeof el.className === 'string'
                                ? `.${el.className.split(' ').filter(c => c).join('.')}`
                                : el.tagName.toLowerCase();

                        if (typeof window.__cba_recordClick === 'function') {
                            window.__cba_recordClick({
                                goal: goal,
                                selector: selector,
                                tagName: el.tagName.toLowerCase()
                            });
                        }
                    }, true);

                    // Input handler
                    document.addEventListener('change', (e) => {
                        const el = e.target;
                        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                            const goal = el.placeholder ||
                                el.getAttribute('aria-label') ||
                                el.name ||
                                el.id ||
                                el.type;

                            const selector = el.id ? `#${el.id}` :
                                el.name ? `[name="${el.name}"]` :
                                    el.placeholder ? `[placeholder="${el.placeholder}"]` :
                                        el.tagName.toLowerCase();

                            if (typeof window.__cba_recordFill === 'function') {
                                window.__cba_recordFill({
                                    goal: goal,
                                    selector: selector,
                                    value: el.value
                                });
                            }
                        }
                    }, true);

                    console.log('[CBA Recorder] Event listeners injected');
                });
            } catch (e) {
                console.log('[Recorder] Could not inject script:', e.message);
            }
        };

        // Navigation listener - inject script and record URL
        const navHandler = async (frame) => {
            if (frame === page.mainFrame()) {
                const url = frame.url();
                if (url && url !== 'about:blank') {
                    this.recordedSteps.push({
                        action: 'goto',
                        url: url,
                        timestamp: Date.now()
                    });
                    console.log(`[Recorder] Navigation: ${url}`);
                }
                // Re-inject script on new page
                await injectRecordingScript();
            }
        };
        page.on('framenavigated', navHandler);
        this.listeners.push({ event: 'framenavigated', handler: navHandler });

        // Inject into current page
        await injectRecordingScript();

        console.log('[Recorder] Event listeners attached');
    }

    /**
     * Stop recording and return recorded steps.
     * @returns {object[]} Array of recorded steps
     */
    stopRecording() {
        if (!this.isRecording) {
            console.log('[Recorder] Not recording');
            return [];
        }

        this.isRecording = false;
        console.log(`[Recorder] ⏹️ Recording stopped. ${this.recordedSteps.length} steps captured.`);

        // Note: Can't fully remove injected scripts, but stopping the flag prevents new recordings
        return this.recordedSteps;
    }

    /**
     * Generate a test file from recorded steps.
     * @param {string} testDir - Directory to save test file
     * @param {string} name - Optional test name
     * @returns {string} Path to generated file
     */
    generateTestFile(testDir, name = null) {
        const steps = this.recordedSteps;
        if (steps.length === 0) {
            console.log('[Recorder] No steps to generate');
            return null;
        }

        const timestamp = this.startTime.toISOString().replace(/[:.]/g, '-');
        const testName = name || `recorded_${timestamp}`;
        const fileName = `intent_${testName}.js`;
        const filePath = path.join(testDir, fileName);

        // Filter and deduplicate steps
        const filteredSteps = this._processSteps(steps);

        // Generate test code
        const code = this._generateCode(filteredSteps, testName);

        fs.writeFileSync(filePath, code);
        console.log(`[Recorder] ✅ Test file generated: ${fileName}`);

        return fileName;
    }

    /**
     * Process steps to remove duplicates and noise.
     */
    _processSteps(steps) {
        const processed = [];
        let lastAction = null;

        for (const step of steps) {
            // Skip duplicate consecutive clicks
            if (step.action === 'click' && lastAction?.action === 'click' &&
                step.goal === lastAction.goal) {
                continue;
            }

            // Skip duplicate consecutive navigations (same URL)
            if (step.action === 'goto' && lastAction?.action === 'goto' &&
                step.url === lastAction.url) {
                continue;
            }

            // Skip about:blank navigations
            if (step.action === 'goto' && step.url === 'about:blank') {
                continue;
            }

            // Skip empty goals
            if (step.action === 'click' && (!step.goal || step.goal.trim() === '')) {
                continue;
            }

            // Skip clicks with suspiciously long goals (likely captured parent container)
            if (step.action === 'click' && step.goal && step.goal.length > 40 &&
                (step.goal.includes('  ') || step.goal.split(' ').length > 6)) {
                continue;
            }

            processed.push(step);
            lastAction = step;
        }

        return processed;
    }

    /**
     * Generate intent runner code from steps.
     */
    _generateCode(steps, testName) {
        // Helper to sanitize goal text for JavaScript strings
        const sanitizeGoal = (text) => {
            if (!text) return '';
            return text
                .replace(/\r?\n/g, ' ')  // Replace newlines with spaces
                .replace(/\s+/g, ' ')     // Collapse multiple spaces
                .trim()
                .substring(0, 50)          // Limit length
                .replace(/'/g, "\\'");     // Escape single quotes
        };

        const stepsCode = steps.map(step => {
            if (step.action === 'goto') {
                return `    await runner.goto('${step.url}');`;
            } else if (step.action === 'click') {
                const goal = sanitizeGoal(step.goal);
                return `    await runner.clickGoal('${goal}');`;
            } else if (step.action === 'fill') {
                const goal = sanitizeGoal(step.goal);
                const value = (step.value || '').replace(/'/g, "\\'");
                return `    await runner.fill('${step.selector}', '${value}');  // ${goal}`;
            }
            return '';
        }).filter(s => s).join('\n');

        return `/**
 * Auto-recorded Test: ${testName}
 * Generated: ${this.startTime.toISOString()}
 * Source URL: ${this.startUrl}
 */

const IntentRunner = require('../src/intent_runner');

async function runMission() {
    const runner = new IntentRunner();
    
    try {
        await runner.connect();
        console.log('[Mission] Starting recorded test: ${testName}');
        
${stepsCode}
        
        console.log('[Mission] ✅ All recorded steps completed!');
        await runner.finish('Recorded test complete');
    } catch (error) {
        console.error('[Mission] ❌ Test failed:', error.message);
        await runner.finish('Mission failed: ' + error.message);
        process.exit(1);
    }
}

runMission();
`;
    }

    /**
     * Get current recorded steps (for live preview).
     */
    getSteps() {
        return this.recordedSteps;
    }
}

module.exports = ActionRecorder;
