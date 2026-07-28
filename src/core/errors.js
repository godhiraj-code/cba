'use strict';

class ProtocolError extends Error {
    constructor(code, message, details) {
        super(message);
        this.name = 'ProtocolError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

const ERROR_CODES = Object.freeze({
    INVALID_REQUEST: 'INVALID_REQUEST',
    INTENT_CONFLICT: 'INTENT_CONFLICT',
    DUPLICATE_SENTINEL: 'DUPLICATE_SENTINEL',
    NO_SENTINEL: 'NO_SENTINEL',
    INTENT_FAILED: 'INTENT_FAILED',
    TIMEOUT: 'TIMEOUT',
    DISCONNECTED: 'DISCONNECTED',
    DRAINING: 'DRAINING',
    RATE_LIMITED: 'RATE_LIMITED',
    RESOURCE_EXHAUSTED: 'RESOURCE_EXHAUSTED',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    CANCELLED: 'CANCELLED',
    UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
    INTERNAL: 'INTERNAL'
});

module.exports = { ProtocolError, ERROR_CODES };
