'use strict';

const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const { Coordinator } = require('./coordinator');
const { METHODS, PROTOCOL_VERSION } = require('./contract');
const { ProtocolError, ERROR_CODES } = require('./errors');
const { RpcPeer } = require('./rpc');
const { createTokenAuthenticator, digestToken } = require('./auth');

function isLoopback(host) {
    return ['127.0.0.1', '::1', 'localhost'].includes(String(host).toLowerCase());
}

function rejectExtraFields(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, `${label} must be an object`);
    }
    const extra = Object.keys(value).filter(key => !allowed.includes(key));
    if (extra.length) {
        throw new ProtocolError(
            ERROR_CODES.INVALID_REQUEST,
            `${label} contains unsupported field(s): ${extra.join(', ')}`
        );
    }
}

class ProtocolHub {
    constructor(options = {}) {
        this.host = options.host || '127.0.0.1';
        this.port = options.port ?? 8080;
        this.path = options.path;
        this.maxPayload = options.maxPayload ?? 1_048_576;
        this.allowAnonymousLoopback = options.allowAnonymousLoopback === true;
        if (this.allowAnonymousLoopback && !isLoopback(this.host)) {
            throw new ProtocolError(
                ERROR_CODES.INVALID_REQUEST,
                'anonymous mode is restricted to an explicit loopback host'
            );
        }
        this.authenticate = options.authenticate ||
            (options.tokenDigests ? createTokenAuthenticator(options.tokenDigests) : null);
        this.authorize = options.authorize || null;
        this.rateLimit = {
            max: options.rateLimit?.max ?? 0,
            windowMs: options.rateLimit?.windowMs ?? 60_000
        };
        if (!Number.isInteger(this.rateLimit.max) || this.rateLimit.max < 0 ||
            !Number.isInteger(this.rateLimit.windowMs) || this.rateLimit.windowMs < 1) {
            throw new ProtocolError(
                ERROR_CODES.INVALID_REQUEST,
                'rateLimit.max must be non-negative and windowMs must be positive integers'
            );
        }
        this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
        this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 30_000;
        for (const [name, value, minimum, maximum] of [
            ['port', this.port, 0, 65535],
            ['maxPayload', this.maxPayload, 1, 1_073_741_824],
            ['heartbeatIntervalMs', this.heartbeatIntervalMs, 0, 3_600_000],
            ['shutdownTimeoutMs', this.shutdownTimeoutMs, 1, 3_600_000]
        ]) {
            if (!Number.isInteger(value) || value < minimum || value > maximum) {
                throw new ProtocolError(ERROR_CODES.INVALID_REQUEST,
                    `${name} must be an integer between ${minimum} and ${maximum}`);
            }
        }
        this.coordinator = options.coordinator || new Coordinator(options);
        this.server = null;
        this.connections = new Set();
        this.heartbeatTimer = null;
        this.draining = false;
    }

    start() {
        if (this.server) return Promise.resolve(this.address());
        return new Promise((resolve, reject) => {
            const server = new WebSocketServer({
                host: this.host,
                port: this.port,
                path: this.path,
                maxPayload: this.maxPayload
            });
            this.server = server;
            server.on('connection', (socket, request) => this.accept(socket, request));
            server.once('error', reject);
            server.once('listening', () => {
                server.off('error', reject);
                this.startHeartbeat();
                resolve(this.address());
            });
        });
    }

    address() {
        const address = this.server?.address();
        if (!address || typeof address === 'string') return null;
        const host = address.address === '::' ? '127.0.0.1' : address.address;
        return { host, port: address.port, url: `ws://${host}:${address.port}${this.path || ''}` };
    }

    accept(socket, request) {
        if (this.draining) {
            socket.close(1013, 'hub is draining');
            return;
        }
        const connection = {
            socket,
            request,
            role: null,
            registering: false,
            closed: false,
            registration: null,
            principalId: null,
            unregister: null,
            activeIntentIds: new Map(),
            alive: true,
            rateWindowStartedAt: Date.now(),
            rateCount: 0
        };
        this.connections.add(connection);
        socket.on('pong', () => { connection.alive = true; });
        const peer = new RpcPeer(socket);
        const remoteCall = (method, params, signal) => peer.call(
            method,
            params,
            undefined,
            signal
        );

        peer.handle(METHODS.REGISTER, async params => {
            if (connection.role || connection.registering) {
                throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'connection is already registered');
            }
            connection.registering = true;
            if (!params || !['client', 'sentinel'].includes(params.role)) {
                throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, "role must be 'client' or 'sentinel'");
            }
            rejectExtraFields(params, [
                'role', 'id', 'name', 'version', 'protocolVersion', 'priority',
                'capacity', 'capabilities', 'token'
            ], 'registration');
            if (typeof params.name !== 'string' || !params.name.trim() || params.name.length > 200) {
                throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'name must be a non-empty string');
            }
            if (params.role === 'client' &&
                ['id', 'version', 'priority', 'capacity', 'capabilities'].some(key => params[key] !== undefined)) {
                throw new ProtocolError(
                    ERROR_CODES.INVALID_REQUEST,
                    'client registration contains Sentinel-only fields'
                );
            }
            if (typeof params.protocolVersion !== 'string' || !params.protocolVersion.length ||
                params.protocolVersion.length > 20) {
                throw new ProtocolError(
                    ERROR_CODES.INVALID_REQUEST,
                    'protocolVersion must be a non-empty string of at most 20 characters'
                );
            }
            const requestedMajor = params.protocolVersion.split('.')[0];
            const supportedMajor = PROTOCOL_VERSION.split('.')[0];
            if (requestedMajor !== supportedMajor) {
                throw new ProtocolError(
                    ERROR_CODES.UNSUPPORTED_VERSION,
                    `protocol version '${params.protocolVersion || 'missing'}' is not compatible with ${PROTOCOL_VERSION}`
                );
            }
            let principalId = `anonymous:${params.name}`;
            if (!this.allowAnonymousLoopback) {
                const authentication = this.authenticate &&
                    await this.authenticate(params, { request });
                const validIdentity = authentication === true ||
                    (typeof authentication === 'string' && authentication.length > 0) ||
                    (authentication && typeof authentication === 'object' &&
                        typeof authentication.principalId === 'string' && authentication.principalId.length > 0);
                if (!validIdentity) {
                    throw new ProtocolError(ERROR_CODES.UNAUTHORIZED, 'registration was rejected');
                }
                if (typeof authentication === 'string' && authentication.length) {
                    principalId = authentication;
                } else if (typeof authentication === 'object' &&
                    typeof authentication.principalId === 'string' && authentication.principalId.length) {
                    principalId = authentication.principalId;
                } else {
                    // Boolean hooks retain a stable credential-derived principal when a token exists.
                    principalId = typeof params.token === 'string' && params.token.length >= 16
                        ? `presented:${digestToken(params.token)}`
                        : `registration:${params.name}`;
                }
            }

            if (connection.closed || socket.readyState !== 1 || this.draining) {
                throw new ProtocolError(ERROR_CODES.DISCONNECTED, 'connection closed during registration');
            }

            let unregister;
            if (params.role === 'sentinel') {
                unregister = this.coordinator.register({
                    id: params.id,
                    name: params.name,
                    version: params.version,
                    priority: params.priority,
                    capacity: params.capacity,
                    capabilities: params.capabilities,
                    offer: (intent, execution) => remoteCall(METHODS.OFFER, { intent }, execution.signal),
                    // Keep the capacity slot until the remote operation actually replies or disconnects.
                    // The Coordinator still enforces the caller's execution deadline and sends cancel.
                    execute: (intent, execution) => peer.call(METHODS.EXECUTE, {
                        intent,
                        attempt: execution.attempt,
                        claim: execution.claim,
                        history: execution.history
                    }, null),
                    cancel: intent => peer.notify(METHODS.CANCEL, { intentId: intent.id })
                });
            }
            connection.role = params.role;
            connection.registration = { ...params, token: undefined };
            connection.principalId = principalId;
            connection.unregister = unregister;
            return { registered: true, role: params.role, protocolVersion: PROTOCOL_VERSION };
        });

        peer.handle(METHODS.INTENT, async params => {
            if (this.draining) {
                throw new ProtocolError(ERROR_CODES.DRAINING, 'hub is draining');
            }
            if (connection.role !== 'client') {
                throw new ProtocolError(ERROR_CODES.FORBIDDEN, 'only a registered client can submit intents');
            }
            if (this.authorize && !(await this.authorize({
                role: connection.role,
                registration: connection.registration,
                method: METHODS.INTENT,
                params,
                request
            }))) {
                throw new ProtocolError(ERROR_CODES.UNAUTHORIZED, 'intent was not authorized');
            }
            this.consumeRateLimit(connection);
            const intent = params.id !== undefined ? params : { ...params, id: crypto.randomUUID() };
            connection.activeIntentIds.set(intent.id, (connection.activeIntentIds.get(intent.id) || 0) + 1);
            try {
                return await this.coordinator.dispatch(intent, { owner: connection.principalId });
            } finally {
                const remaining = connection.activeIntentIds.get(intent.id) - 1;
                if (remaining) connection.activeIntentIds.set(intent.id, remaining);
                else connection.activeIntentIds.delete(intent.id);
            }
        });

        peer.handle(METHODS.CANCEL, async params => {
            if (connection.role !== 'client') {
                throw new ProtocolError(ERROR_CODES.FORBIDDEN, 'only a registered client can cancel intents');
            }
            rejectExtraFields(params, ['intentId'], 'cancellation');
            if (typeof params.intentId !== 'string' || !params.intentId) {
                throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'intentId must be a non-empty string');
            }
            if (this.authorize && !(await this.authorize({
                role: connection.role,
                registration: connection.registration,
                method: METHODS.CANCEL,
                params,
                request
            }))) {
                throw new ProtocolError(ERROR_CODES.UNAUTHORIZED, 'cancellation was not authorized');
            }
            if (!connection.activeIntentIds.has(params.intentId)) return { cancelled: false };
            return {
                cancelled: this.coordinator.cancel(params.intentId, connection.principalId)
            };
        });

        socket.once('close', () => {
            connection.closed = true;
            connection.unregister?.();
            this.connections.delete(connection);
        });
    }

    consumeRateLimit(connection, now = Date.now()) {
        if (!this.rateLimit.max) return;
        if (now - connection.rateWindowStartedAt >= this.rateLimit.windowMs) {
            connection.rateWindowStartedAt = now;
            connection.rateCount = 0;
        }
        connection.rateCount++;
        if (connection.rateCount > this.rateLimit.max) {
            throw new ProtocolError(
                ERROR_CODES.RATE_LIMITED,
                'client intent rate limit exceeded',
                { retryAfterMs: Math.max(0, this.rateLimit.windowMs - (now - connection.rateWindowStartedAt)) }
            );
        }
    }

    startHeartbeat() {
        if (!this.heartbeatIntervalMs || this.heartbeatTimer) return;
        this.heartbeatTimer = setInterval(() => {
            for (const connection of this.connections) {
                if (!connection.alive) {
                    connection.socket.terminate();
                    continue;
                }
                connection.alive = false;
                connection.socket.ping();
            }
        }, this.heartbeatIntervalMs);
        this.heartbeatTimer.unref?.();
    }

    async close() {
        if (!this.server) return;
        const server = this.server;
        this.server = null;
        this.draining = true;
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
        const serverClosed = new Promise(resolve => server.close(resolve));
        let drainError;
        try {
            await this.coordinator.drain(this.shutdownTimeoutMs);
        } catch (error) {
            drainError = error;
        }
        const connections = [...this.connections];
        for (const connection of connections) connection.socket.close(1001, 'hub shutdown');
        const terminateTimer = setTimeout(() => {
            for (const connection of connections) connection.socket.terminate();
        }, Math.min(this.shutdownTimeoutMs, 1_000));
        try { await serverClosed; } finally {
            clearTimeout(terminateTimer);
            this.connections.clear();
        }
        if (drainError) throw drainError;
    }
}

module.exports = { ProtocolHub };
