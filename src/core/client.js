'use strict';

const WebSocket = require('ws');
const { METHODS, PROTOCOL_VERSION, normalizeIntent } = require('./contract');
const { RpcPeer } = require('./rpc');
const { openConnection } = require('./connection');
const { ProtocolError, ERROR_CODES } = require('./errors');

class Starlight {
    constructor(options = {}) {
        this.url = typeof options === 'string' ? options : options.url || 'ws://127.0.0.1:8080';
        this.name = typeof options === 'string' ? 'intent-client' : options.name || 'intent-client';
        this.token = typeof options === 'string' ? undefined : options.token;
        this.reconnectAttempts = typeof options === 'string' ? 1 : options.reconnectAttempts ?? 1;
        this.reconnectDelayMs = typeof options === 'string' ? 100 : options.reconnectDelayMs ?? 100;
        this.requestTimeoutMs = typeof options === 'string' ? 30_000 : options.requestTimeoutMs ?? 30_000;
        for (const [name, value, min, max] of [
            ['reconnectAttempts', this.reconnectAttempts, 0, 10],
            ['reconnectDelayMs', this.reconnectDelayMs, 0, 60_000],
            ['requestTimeoutMs', this.requestTimeoutMs, 1, 86_400_000]
        ]) {
            if (!Number.isInteger(value) || value < min || value > max) {
                throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, `${name} must be an integer between ${min} and ${max}`);
            }
        }
        this.socket = null;
        this.peer = null;
        this.connecting = null;
        this.registered = false;
        this.stopping = false;
    }

    async connect() {
        if (this.connecting) return this.connecting;
        if (this.registered && this.socket?.readyState === WebSocket.OPEN) return this;
        this.stopping = false;
        this.connecting = (async () => {
            const { socket, ready } = openConnection(this.url);
            this.socket = socket;
            socket.once('close', () => { if (this.socket === socket) this.registered = false; });
            await ready;
            this.peer = new RpcPeer(this.socket);
            await this.peer.call(METHODS.REGISTER, {
                role: 'client',
                name: this.name,
                protocolVersion: PROTOCOL_VERSION,
                token: this.token
            });
            if (this.stopping) throw new ProtocolError(ERROR_CODES.DISCONNECTED, 'client was closed');
            this.registered = true;
            return this;
        })();
        try {
            return await this.connecting;
        } catch (error) {
            this.socket?.terminate();
            this.registered = false;
            throw error;
        } finally {
            this.connecting = null;
        }
    }

    async intent(goal, context = {}, constraints = {}) {
        if (!this.peer || this.stopping) throw new Error('client is not connected');
        const intent = normalizeIntent(typeof goal === 'object' ? goal : { goal, context, constraints });
        for (let attempt = 0; ; attempt++) {
            try {
                return await this.peer.call(METHODS.INTENT, intent, this.requestTimeoutMs);
            } catch (error) {
                if (this.stopping || attempt >= this.reconnectAttempts ||
                    !['DISCONNECTED', 'TIMEOUT'].includes(error.code)) throw error;
                await new Promise(resolve => setTimeout(resolve, this.reconnectDelayMs * (attempt + 1)));
                if (this.stopping) throw error;
                await this.connect();
            }
        }
    }

    async cancel(intentId) {
        if (!this.peer) throw new Error('client is not connected');
        return this.peer.call(METHODS.CANCEL, { intentId });
    }

    close() {
        this.stopping = true;
        this.registered = false;
        this.socket?.close(1000, 'client shutdown');
    }
}

module.exports = { Starlight };
