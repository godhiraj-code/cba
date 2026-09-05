'use strict';

const { ProtocolError, ERROR_CODES } = require('./errors');

// Local agents must see the same data that a JSON transport would carry.
// Copy before freezing so callers retain ownership of their input objects.
function snapshot(value) {
    const ancestors = new Set();
    function copy(input) {
        if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
        if (typeof input === 'number' && Number.isFinite(input)) return input;
        if (!input || typeof input !== 'object' || ancestors.has(input) ||
            (!Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input)))) {
            throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'data must contain only finite, acyclic JSON values');
        }
        ancestors.add(input);
        const result = Array.isArray(input)
            ? Array.from(input, copy)
            : Object.fromEntries(Object.entries(input).map(([key, item]) => [key, copy(item)]));
        ancestors.delete(input);
        return Object.freeze(result);
    }
    return copy(value);
}

module.exports = { snapshot };
