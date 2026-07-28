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
const LIMITS = Object.freeze({
    idLength: 128,
    goalLength: 10_000,
    nameLength: 200,
    capabilities: 100,
    priority: 1_000_000,
    capacity: 1_000,
    retryAfterMs: 60_000,
    maxAttempts: 10
});

function assertAllowedKeys(value, allowed, label) {
    const extra = Object.keys(value).filter(key => !allowed.includes(key));
    if (extra.length) {
        throw new ProtocolError(
            ERROR_CODES.INVALID_REQUEST,
            `${label} contains unsupported field(s): ${extra.join(', ')}`
        );
    }
}

function assertId(value, label = 'id') {
    const hasControlCharacter = typeof value === 'string' &&
        [...value].some(character => {
            const code = character.charCodeAt(0);
            return code <= 31 || code === 127;
        });
    if (typeof value !== 'string' || !value.length || value.length > LIMITS.idLength ||
        hasControlCharacter) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, `${label} must be a safe non-empty string`);
    }
}

function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, `${label} must be an object`);
    }
}

function normalizeIntent(input) {
    const source = typeof input === 'string' ? { goal: input } : input;
    assertPlainObject(source, 'intent');
    assertAllowedKeys(source, ['id', 'goal', 'context', 'constraints'], 'intent');

    if (typeof source.goal !== 'string' || !source.goal.trim() || source.goal.length > LIMITS.goalLength) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'intent.goal must be a non-empty string');
    }
    if (source.id !== undefined) assertId(source.id, 'intent.id');
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
    assertAllowedKeys(input, [
        'id', 'name', 'version', 'priority', 'capacity', 'capabilities', 'offer', 'execute', 'cancel'
    ], 'sentinel');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > LIMITS.nameLength) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'sentinel.name must be a non-empty string');
    }
    if (typeof input.offer !== 'function' || typeof input.execute !== 'function') {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'sentinel must implement offer() and execute()');
    }
    if (input.id !== undefined) assertId(input.id, 'sentinel.id');
    if (input.version !== undefined &&
        (typeof input.version !== 'string' || input.version.length > 50)) {
        throw new ProtocolError(
            ERROR_CODES.INVALID_REQUEST,
            'sentinel.version must be a string of at most 50 characters'
        );
    }

    const priority = input.priority === undefined ? 100 : input.priority;
    if (!Number.isInteger(priority) || priority < 0 || priority > LIMITS.priority) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'sentinel.priority must be a non-negative integer');
    }

    const capabilities = input.capabilities === undefined ? [] : input.capabilities;
    if (!Array.isArray(capabilities) || capabilities.length > LIMITS.capabilities ||
        capabilities.some(value => typeof value !== 'string' || !value.length || value.length > 100) ||
        new Set(capabilities).size !== capabilities.length) {
        throw new ProtocolError(
            ERROR_CODES.INVALID_REQUEST,
            'sentinel.capabilities must contain at most 100 unique non-empty strings'
        );
    }

    const capacity = input.capacity === undefined ? 1 : input.capacity;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > LIMITS.capacity) {
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
    assertAllowedKeys(value, ['accept', 'score', 'reason', 'metadata'], 'claim');
    if (value.accept === false) return null;

    const score = value.score === undefined ? 0.5 : value.score;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'offer score must be between 0 and 1');
    }
    if (value.reason !== undefined && typeof value.reason !== 'string') {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'claim.reason must be a string');
    }
    return {
        score,
        reason: value.reason,
        metadata: value.metadata === undefined ? undefined : value.metadata
    };
}

function normalizeOutcome(value) {
    assertPlainObject(value, 'execution result');
    if (!OUTCOME_STATUSES.includes(value.status)) {
        throw new ProtocolError(
            ERROR_CODES.INVALID_REQUEST,
            `execution status must be one of: ${OUTCOME_STATUSES.join(', ')}`
        );
    }
    const allowedByStatus = {
        completed: ['status', 'value', 'evidence'],
        failed: ['status', 'error', 'evidence'],
        unhandled: ['status', 'evidence'],
        retry: ['status', 'error', 'evidence', 'retryAfterMs']
    };
    assertAllowedKeys(value, allowedByStatus[value.status], `${value.status} outcome`);

    if (value.status === 'retry' && value.retryAfterMs !== undefined &&
        (!Number.isInteger(value.retryAfterMs) || value.retryAfterMs < 0 ||
            value.retryAfterMs > LIMITS.retryAfterMs)) {
        throw new ProtocolError(
            ERROR_CODES.INVALID_REQUEST,
            `retryAfterMs must be an integer between 0 and ${LIMITS.retryAfterMs}`
        );
    }
    if (value.status === 'failed' && value.error === undefined) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'failed outcomes require error');
    }
    if (value.error !== undefined) {
        const validString = typeof value.error === 'string' && value.error.length > 0;
        const validObject = value.error && typeof value.error === 'object' && !Array.isArray(value.error) &&
            typeof value.error.message === 'string' && value.error.message.length > 0 &&
            (value.error.code === undefined || typeof value.error.code === 'string') &&
            Object.keys(value.error).every(key => ['message', 'code'].includes(key));
        if (!validString && !validObject) {
            throw new ProtocolError(
                ERROR_CODES.INVALID_REQUEST,
                'outcome.error must be a non-empty string or a {message, code?} object'
            );
        }
    }
    return Object.freeze({ ...value });
}

module.exports = {
    METHODS,
    LIMITS,
    OUTCOME_STATUSES,
    PROTOCOL_VERSION,
    assertId,
    normalizeClaim,
    normalizeIntent,
    normalizeOutcome,
    normalizeSentinel
};
