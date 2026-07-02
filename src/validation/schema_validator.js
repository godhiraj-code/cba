/**
 * Canonical Starlight Protocol message validation.
 *
 * The protocol contract lives in schemas/starlight.protocol.schema.json.
 * Runtime validation, tests, and future code generation should all use it.
 */

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'schemas', 'starlight.protocol.schema.json');

class SchemaValidator {
    constructor(options = {}) {
        this.schemaPath = options.schemaPath || SCHEMA_PATH;
        this.schema = JSON.parse(fs.readFileSync(this.schemaPath, 'utf8'));
        this.ajv = new Ajv2020({
            allErrors: true,
            strict: true,
            strictTypes: false,
            strictRequired: false,
            allowUnionTypes: true
        });
        addFormats(this.ajv);
        this.validateMessage = this.ajv.compile(this.schema);
    }

    validate(msg) {
        const valid = this.validateMessage(msg);
        if (valid) return { valid: true, errors: [] };

        const errors = (this.validateMessage.errors || []).map(error => {
            const location = error.instancePath || '/';
            return `${location} ${error.message}`.trim();
        });
        return { valid: false, errors };
    }
}

module.exports = { SchemaValidator, SCHEMA_PATH };
