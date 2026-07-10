'use strict';

const crypto = require('node:crypto');
const { ProtocolError, ERROR_CODES } = require('./errors');

const PROTOCOL_VERSION = '1.0';
const METHODS = Object.freeze({
    REGISTER: 'starlight.register',
    INTENT: 'starlight.intent',
    OFFER: 'starlight.offer',
    EXECUTE: 'starlight.execute',
    CANCEL: 'starlight.cancel'
});

const OUTCOME_STATUSES = Object.freeze(['completed', 'failed', 'unhandled', 'retry']);

function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, `${label} must be an object`);
    }
}

function normalizeIntent(input) {
    const source = typeof input === 'string' ? { goal: input } : input;
    assertPlainObject(source, 'intent');

    if (typeof source.goal !== 'string' || !source.goal.trim()) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'intent.goal must be a non-empty string');
    }
    if (source.context !== undefined) assertPlainObject(source.context, 'intent.context');
    if (source.constraints !== undefined) assertPlainObject(source.constraints, 'intent.constraints');

    return Object.freeze({
        id: typeof source.id === 'string' && source.id ? source.id : crypto.randomUUID(),
        goal: source.goal.trim(),
        context: Object.freeze({ ...(source.context || {}) }),
        constraints: Object.freeze({ ...(source.constraints || {}) })
    });
}

function normalizeSentinel(input) {
    assertPlainObject(input, 'sentinel');
    if (typeof input.name !== 'string' || !input.name.trim()) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'sentinel.name must be a non-empty string');
    }
    if (typeof input.offer !== 'function' || typeof input.execute !== 'function') {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'sentinel must implement offer() and execute()');
    }

    const priority = input.priority === undefined ? 100 : input.priority;
    if (!Number.isInteger(priority) || priority < 0) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'sentinel.priority must be a non-negative integer');
    }

    const capabilities = input.capabilities === undefined ? [] : input.capabilities;
    if (!Array.isArray(capabilities) || capabilities.some(value => typeof value !== 'string')) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'sentinel.capabilities must be an array of strings');
    }

    const capacity = input.capacity === undefined ? 1 : input.capacity;
    if (!Number.isInteger(capacity) || capacity < 1) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'sentinel.capacity must be a positive integer');
    }

    return {
        id: typeof input.id === 'string' && input.id ? input.id : input.name.trim(),
        name: input.name.trim(),
        version: typeof input.version === 'string' ? input.version : '0.0.0',
        priority,
        capacity,
        capabilities: [...capabilities],
        offer: input.offer.bind(input),
        execute: input.execute.bind(input),
        cancel: typeof input.cancel === 'function' ? input.cancel.bind(input) : null
    };
}

function normalizeClaim(value) {
    if (value === false || value === null || value === undefined) return null;
    if (value === true) return { score: 0.5 };
    if (typeof value === 'number') value = { score: value };
    assertPlainObject(value, 'offer response');
    if (value.accept === false) return null;

    const score = value.score === undefined ? 0.5 : value.score;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'offer score must be between 0 and 1');
    }
    return {
        score,
        reason: typeof value.reason === 'string' ? value.reason : undefined,
        metadata: value.metadata === undefined ? undefined : value.metadata
    };
}

function normalizeOutcome(value) {
    if (value === undefined) value = { status: 'completed' };
    assertPlainObject(value, 'execution result');
    if (!OUTCOME_STATUSES.includes(value.status)) {
        throw new ProtocolError(
            ERROR_CODES.INVALID_REQUEST,
            `execution status must be one of: ${OUTCOME_STATUSES.join(', ')}`
        );
    }
    if (value.status === 'retry' && value.retryAfterMs !== undefined &&
        (!Number.isInteger(value.retryAfterMs) || value.retryAfterMs < 0)) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'retryAfterMs must be a non-negative integer');
    }
    return {
        status: value.status,
        value: value.value,
        evidence: value.evidence,
        error: value.error,
        retryAfterMs: value.retryAfterMs
    };
}

module.exports = {
    METHODS,
    OUTCOME_STATUSES,
    PROTOCOL_VERSION,
    normalizeClaim,
    normalizeIntent,
    normalizeOutcome,
    normalizeSentinel
};
