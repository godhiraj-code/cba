'use strict';

const { WebSocketServer } = require('ws');
const { Coordinator } = require('./coordinator');
const { METHODS, PROTOCOL_VERSION } = require('./contract');
const { ProtocolError, ERROR_CODES } = require('./errors');
const { RpcPeer } = require('./rpc');

class ProtocolHub {
    constructor(options = {}) {
        this.host = options.host || '127.0.0.1';
        this.port = options.port ?? 8080;
        this.path = options.path;
        this.maxPayload = options.maxPayload ?? 1_048_576;
        this.authenticate = options.authenticate || null;
        this.authorize = options.authorize || null;
        this.rateLimit = {
            max: options.rateLimit?.max ?? 0,
            windowMs: options.rateLimit?.windowMs ?? 60_000
        };
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
            unregister: null,
            alive: true,
            rateWindowStartedAt: Date.now(),
            rateCount: 0
        };
        this.connections.add(connection);
        socket.on('pong', () => { connection.alive = true; });
        const peer = new RpcPeer(socket);
        const remoteCall = (method, params, signal) => {
            const cancel = () => peer.notify(METHODS.CANCEL, { intentId: params.intent.id });
            signal?.addEventListener('abort', cancel, { once: true });
            return peer.call(method, params).finally(() => signal?.removeEventListener('abort', cancel));
        };

        peer.handle(METHODS.REGISTER, async params => {
            if (connection.role) {
                throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'connection is already registered');
            }
            if (!params || !['client', 'sentinel'].includes(params.role)) {
                throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, "role must be 'client' or 'sentinel'");
            }
            const requestedMajor = String(params.protocolVersion || '').split('.')[0];
            const supportedMajor = PROTOCOL_VERSION.split('.')[0];
            if (requestedMajor !== supportedMajor) {
                throw new ProtocolError(
                    'UNSUPPORTED_VERSION',
                    `protocol version '${params.protocolVersion || 'missing'}' is not compatible with ${PROTOCOL_VERSION}`
                );
            }
            if (this.authenticate && !(await this.authenticate(params, { request }))) {
                throw new ProtocolError(ERROR_CODES.UNAUTHORIZED, 'registration was rejected');
            }

            connection.role = params.role;
            connection.registration = { ...params, token: undefined };
            if (params.role === 'sentinel') {
                connection.unregister = this.coordinator.register({
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
            return { registered: true, role: params.role, protocolVersion: PROTOCOL_VERSION };
        });

        peer.handle(METHODS.INTENT, async params => {
            if (this.draining) {
                throw new ProtocolError(ERROR_CODES.DRAINING, 'hub is draining');
            }
            if (connection.role !== 'client') {
                throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'only a registered client can submit intents');
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
            return this.coordinator.dispatch(params);
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
