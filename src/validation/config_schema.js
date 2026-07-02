/**
 * Configuration Schema Definition
 * Part of Phase 8.5: Hardening & Optimization
 * 
 * Defines the comprehensive validation schema for config.json
 */

const CONFIG_SCHEMA = {
    type: 'object',
    required: ['hub', 'sentinel'],
    properties: {
        hub: {
            type: 'object',
            required: ['port', 'syncBudget'],
            properties: {
                port: { type: 'integer', minimum: 1024, maximum: 65535, default: 8080 },
                host: { type: 'string', default: '127.0.0.1' },
                browser: {
                    type: 'object',
                    properties: {
                        engine: { type: 'string', enum: ['chromium', 'firefox', 'webkit'], default: 'chromium' },
                        headless: { type: 'boolean', default: false },
                        mobile: {
                            type: 'object',
                            properties: {
                                enabled: { type: 'boolean' },
                                device: { type: ['string', 'null'] }
                            }
                        }
                    }
                },
                network: {
                    type: 'object',
                    properties: {
                        emulation: { type: 'string', enum: ['online', 'offline', '4g', '3g', '3g-slow'], default: 'online' }
                    }
                },
                syncBudget: { type: 'integer', minimum: 1000, default: 30000 },
                missionTimeout: { type: 'integer', minimum: 1000, default: 180000 },
                heartbeatTimeout: { type: 'integer', minimum: 1000, default: 5000 },
                lockTTL: { type: 'integer', minimum: 1000, default: 5000 },
                entropyThrottle: { type: 'integer', minimum: 50, default: 100 },
                screenshotMaxAge: { type: 'integer', minimum: 3600000, default: 86400000 },
                traceMaxEvents: { type: 'integer', minimum: 10, default: 500 },
                shadowDom: {
                    type: 'object',
                    properties: {
                        enabled: { type: 'boolean', default: true },
                        maxDepth: { type: 'integer', minimum: 1, maximum: 20, default: 5 }
                    }
                },
                quorumThreshold: { type: 'number', minimum: 0, maximum: 1, default: 1 },
                consensusTimeout: { type: 'integer', minimum: 1000, default: 5000 },
                maxPreCheckRetries: { type: 'integer', minimum: 1, maximum: 20, default: 3 },
                ghostMode: { type: 'boolean', default: false },
                security: {
                    type: 'object',
                    properties: {
                        authToken: { type: ['string', 'null'] },
                        jwtSecret: { type: ['string', 'null'] },
                        authRequired: { type: 'boolean', default: false },
                        allowedOrigins: { type: 'array', items: { type: 'string' } },
                        maxMessageBytes: { type: 'integer', minimum: 1024, default: 1048576 },
                        tokenExpiry: { type: 'integer', minimum: 60 },
                        piiRedaction: { type: 'boolean', default: true },
                        inputValidation: { type: 'boolean', default: true },
                        ssl: {
                            type: 'object',
                            properties: {
                                enabled: { type: 'boolean' },
                                keyPath: { type: ['string', 'null'] },
                                certPath: { type: ['string', 'null'] }
                            }
                        },
                        rateLimiting: {
                            type: 'object',
                            properties: {
                                enabled: { type: 'boolean' },
                                maxRequests: { type: 'integer', minimum: 1 },
                                windowMs: { type: 'integer', minimum: 1000 }
                            }
                        }
                    }
                }
            }
        },
        aura: {
            type: 'object',
            properties: {
                predictiveWaitMs: { type: 'integer', minimum: 0 },
                bucketSizeMs: { type: 'integer', minimum: 100 }
            }
        },
        sentinel: {
            type: 'object',
            properties: {
                settlementWindow: { type: 'number', minimum: 0 },
                reconnectDelay: { type: 'number', minimum: 0 },
                heartbeatInterval: { type: 'number', minimum: 0 }
            }
        },
        vision: {
            type: 'object',
            properties: {
                model: { type: 'string' },
                timeout: { type: 'integer', minimum: 1 },
                ollamaUrl: { type: 'string', format: 'uri' }
            }
        },
        webhooks: {
            type: 'object',
            properties: {
                enabled: { type: 'boolean' },
                urls: { type: 'array', items: { type: 'string', format: 'uri' } },
                notifyOn: { type: 'array', items: { type: 'string', enum: ['success', 'failure'] } }
            }
        }
    }
};

/**
 * Validates a configuration object against the schema
 * @param {Object} config - The configuration object to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateConfig(config) {
    const errors = [];

    function validateNode(schema, data, path = '') {
        if (!schema) return;

        // Type check
        if (schema.type === 'object') {
            if (typeof data !== 'object' || data === null) {
                errors.push(`${path}: Expected object, got ${typeof data}`);
                return;
            }

            // Required properties
            if (schema.required) {
                for (const req of schema.required) {
                    if (!(req in data)) {
                        errors.push(`${path}: Missing required property '${req}'`);
                    }
                }
            }

            // Properties
            if (schema.properties) {
                for (const [key, value] of Object.entries(data)) {
                    if (key in schema.properties) {
                        validateNode(schema.properties[key], value, path ? `${path}.${key}` : key);
                    } else {
                        // Unknown property - allowed in JSON usually, but we could warn
                    }
                }
            }
        } else if (schema.type === 'array') {
            if (!Array.isArray(data)) {
                errors.push(`${path}: Expected array`);
                return;
            }
            if (schema.items) {
                data.forEach((item, i) => validateNode(schema.items, item, `${path}[${i}]`));
            }
        } else {
            // Primitive types
            const types = Array.isArray(schema.type) ? schema.type : [schema.type];
            const isValidType = types.some(t => {
                if (t === 'integer') return Number.isInteger(data);
                if (t === 'number') return typeof data === 'number';
                if (t === 'null') return data === null;
                return typeof data === t;
            });

            if (!isValidType) {
                errors.push(`${path}: Expected ${types.join('|')}, got ${typeof data}`);
            }

            if (typeof data === 'number') {
                if (schema.minimum !== undefined && data < schema.minimum) {
                    errors.push(`${path}: Value ${data} below minimum ${schema.minimum}`);
                }
                if (schema.maximum !== undefined && data > schema.maximum) {
                    errors.push(`${path}: Value ${data} above maximum ${schema.maximum}`);
                }
            }

            if (typeof data === 'string' && schema.enum) {
                if (!schema.enum.includes(data)) {
                    errors.push(`${path}: Value '${data}' not in allowed values: ${schema.enum.join(', ')}`);
                }
            }
        }
    }

    validateNode(CONFIG_SCHEMA, config);
    return { valid: errors.length === 0, errors };
}

module.exports = { validateConfig, CONFIG_SCHEMA };
