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
            registration: null,
            principalId: null,
            unregister: null,
            activeIntentIds: new Set(),
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
            if (connection.role) {
                throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'connection is already registered');
            }
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
                if (!authentication) {
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
                    execute: (intent, execution) => remoteCall(METHODS.EXECUTE, {
                        intent,
                        attempt: execution.attempt,
                        claim: execution.claim,
                        history: execution.history
                    }, execution.signal),
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
            const intent = params.id ? params : { ...params, id: crypto.randomUUID() };
            connection.activeIntentIds.add(intent.id);
            try {
                return await this.coordinator.dispatch(intent, { owner: connection.principalId });
            } finally {
                connection.activeIntentIds.delete(intent.id);
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
        for (const connection of this.connections) connection.socket.close(1001, 'hub shutdown');
        this.connections.clear();
        await serverClosed;
        if (drainError) throw drainError;
    }
}

module.exports = { ProtocolHub };
