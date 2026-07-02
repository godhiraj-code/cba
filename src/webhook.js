/**
 * Webhook Notifier - Starlight Protocol Phase 10
 * Sends mission notifications to Slack/Teams/Discord webhooks.
 * 
 * Part of Enterprise Observability - enables real-time team visibility.
 */

const https = require('https');
const http = require('http');

// Phase 3 Performance: Connection pooling with keepAlive
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

class WebhookNotifier {
    constructor(config) {
        this.enabled = config?.enabled || false;
        this.urls = config?.urls || [];
        this.notifyOn = config?.notifyOn || ['failure'];
        this.includeTrace = config?.includeTrace || false;

        // Use pooled agents
        this.httpAgent = httpAgent;
        this.httpsAgent = httpsAgent;

        if (this.enabled && this.urls.length > 0) {
            console.log(`[Webhook] Enabled with ${this.urls.length} endpoint(s), connection pooling ON`);
        }
    }

    /**
     * Send notification for a mission event.
     * @param {string} event - 'success' or 'failure'
     * @param {object} payload - Mission data
     */
    async notify(event, payload) {
        if (!this.enabled || this.urls.length === 0) return;
        if (!this.notifyOn.includes(event)) return;

        console.log(`[Webhook] Sending ${event} notification...`);
        const message = this.formatMessage(event, payload);

        const results = await Promise.all(
            this.urls.map(url => this.sendWebhook(url, message))
        );

        const successCount = results.filter(r => r).length;
        console.log(`[Webhook] Sent to ${successCount}/${this.urls.length} endpoints`);
    }

    /**
     * Format message for Slack/Discord compatibility.
     * Uses Slack attachment format which Discord also supports.
     */
    formatMessage(event, payload) {
        const emoji = event === 'failure' ? '🔴' : '✅';
        const color = event === 'failure' ? '#dc2626' : '#16a34a';
        const status = event === 'failure' ? 'FAILED' : 'COMPLETED';

        // Build fields array
        const fields = [
            { title: 'Mission', value: payload.mission || 'Unknown', short: true },
            { title: 'Status', value: status, short: true },
            { title: 'Duration', value: this.formatDuration(payload.durationMs), short: true },
            { title: 'Interventions', value: `${payload.interventions || 0}`, short: true }
        ];

        // Add MTTR if available
        if (payload.mttr && payload.mttr > 0) {
            fields.push({ title: 'Avg MTTR', value: `${Math.round(payload.mttr)}ms`, short: true });
        }

        // Add error if failure
        if (event === 'failure' && payload.error) {
            fields.push({ title: 'Error', value: payload.error.substring(0, 100), short: false });
        }

        return {
            text: `${emoji} Starlight Mission ${status}`,
            attachments: [{
                color: color,
                fields: fields,
                footer: 'Starlight Protocol v4.0.0-alpha.1',
                footer_icon: 'https://www.dhirajdas.dev/favicon.ico',
                ts: Math.floor(Date.now() / 1000)
            }]
        };
    }

    formatDuration(ms) {
        if (!ms) return '0s';
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
    }

    /**
     * Send HTTP POST to webhook URL.
     * Supports both HTTP and HTTPS endpoints.
     */
    async sendWebhook(url, message) {
        return new Promise((resolve) => {
            try {
                const urlObj = new URL(url);
                const data = JSON.stringify(message);
                const isHttps = urlObj.protocol === 'https:';

                const options = {
                    hostname: urlObj.hostname,
                    port: urlObj.port || (isHttps ? 443 : 80),
                    path: urlObj.pathname + urlObj.search,
                    method: 'POST',
                    agent: isHttps ? this.httpsAgent : this.httpAgent, // Phase 3: Use pooled agent
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(data),
                        'User-Agent': 'Starlight-Protocol/3.0'
                    },
                    timeout: 10000
                };

                const lib = isHttps ? https : http;
                const req = lib.request(options, (res) => {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            console.log(`[Webhook] ✓ ${urlObj.hostname}: ${res.statusCode}`);
                            resolve(true);
                        } else {
                            console.error(`[Webhook] ✗ ${urlObj.hostname}: ${res.statusCode} - ${body}`);
                            resolve(false);
                        }
                    });
                });

                req.on('error', (e) => {
                    console.error(`[Webhook] ✗ ${urlObj.hostname}: ${e.message}`);
                    resolve(false);
                });

                req.on('timeout', () => {
                    console.error(`[Webhook] ✗ ${urlObj.hostname}: Timeout`);
                    req.destroy();
                    resolve(false);
                });

                req.write(data);
                req.end();
            } catch (e) {
                console.error(`[Webhook] Invalid URL "${url}": ${e.message}`);
                resolve(false);
            }
        });
    }
}

module.exports = WebhookNotifier;
