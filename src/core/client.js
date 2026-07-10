'use strict';

const WebSocket = require('ws');
const crypto = require('node:crypto');
const { METHODS, PROTOCOL_VERSION } = require('./contract');
const { RpcPeer } = require('./rpc');

function openSocket(url) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        socket.once('open', () => resolve(socket));
        socket.once('error', reject);
    });
}

class Starlight {
    constructor(options = {}) {
        this.url = typeof options === 'string' ? options : options.url || 'ws://127.0.0.1:8080';
        this.name = typeof options === 'string' ? 'intent-client' : options.name || 'intent-client';
        this.token = typeof options === 'string' ? undefined : options.token;
        this.reconnectAttempts = typeof options === 'string' ? 1 : options.reconnectAttempts ?? 1;
        this.reconnectDelayMs = typeof options === 'string' ? 100 : options.reconnectDelayMs ?? 100;
        this.socket = null;
        this.peer = null;
        this.connecting = null;
    }

    async connect() {
        if (this.socket?.readyState === WebSocket.OPEN) return this;
        if (this.connecting) return this.connecting;
        this.connecting = (async () => {
            this.socket = await openSocket(this.url);
            this.peer = new RpcPeer(this.socket);
            await this.peer.call(METHODS.REGISTER, {
                role: 'client',
                name: this.name,
                protocolVersion: PROTOCOL_VERSION,
                token: this.token
            });
            return this;
        })();
        try {
            return await this.connecting;
        } finally {
            this.connecting = null;
        }
    }

    async intent(goal, context = {}, constraints = {}) {
        if (!this.peer) throw new Error('client is not connected');
        const intent = typeof goal === 'object'
            ? { ...goal, id: goal.id || crypto.randomUUID() }
            : { id: crypto.randomUUID(), goal, context, constraints };
        for (let attempt = 0; ; attempt++) {
            try {
                return await this.peer.call(METHODS.INTENT, intent);
            } catch (error) {
                if (attempt >= this.reconnectAttempts ||
                    !['DISCONNECTED', 'TIMEOUT'].includes(error.code)) throw error;
                await new Promise(resolve => setTimeout(resolve, this.reconnectDelayMs * (attempt + 1)));
                await this.connect();
            }
        }
    }

    close() {
        this.socket?.close(1000, 'client shutdown');
    }
}

module.exports = { Starlight };
