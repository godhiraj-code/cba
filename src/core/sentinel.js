'use strict';

const WebSocket = require('ws');
const { METHODS, PROTOCOL_VERSION } = require('./contract');
const { ProtocolError, ERROR_CODES } = require('./errors');
const { RpcPeer } = require('./rpc');

function openSocket(url, options) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url, options);
        socket.once('open', () => resolve(socket));
        socket.once('error', reject);
    });
}

function wait(ms, signal) {
    if (signal?.aborted) return Promise.resolve();
    return new Promise(resolve => {
        const onAbort = () => {
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

class Sentinel {
    constructor(options) {
        if (!options || typeof options.handle !== 'function') {
            throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'sentinel.handle must be a function');
        }
        if (typeof options.name !== 'string' || !options.name.trim()) {
            throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'sentinel.name must be a non-empty string');
        }
        this.url = options.url || 'ws://127.0.0.1:8080';
        this.name = options.name.trim();
        this.id = options.id;
        this.version = options.version || '0.0.0';
        this.priority = options.priority ?? 100;
        this.capacity = options.capacity ?? 1;
        this.capabilities = options.capabilities || [];
        this.token = options.token;
        this.canHandle = options.canHandle || (() => true);
        this.handle = options.handle;
        this.onCancel = options.onCancel || (() => {});
        this.reconnect = options.reconnect !== false;
        this.minReconnectDelayMs = options.minReconnectDelayMs ?? 250;
        this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 10_000;
        this.socket = null;
        this.peer = null;
        this.stopping = false;
    }

    async connect() {
        if (this.socket?.readyState === WebSocket.OPEN) return this;
        this.socket = await openSocket(this.url);
        this.peer = new RpcPeer(this.socket);
        this.peer.handle(METHODS.OFFER, ({ intent }) => this.canHandle(intent));
        this.peer.handle(METHODS.EXECUTE, params => this.handle(params.intent, {
            attempt: params.attempt,
            claim: params.claim,
            history: params.history
        }));
        this.peer.handle(METHODS.CANCEL, params => this.onCancel(params.intentId));
        await this.peer.call(METHODS.REGISTER, {
            role: 'sentinel',
            id: this.id,
            name: this.name,
            version: this.version,
            protocolVersion: PROTOCOL_VERSION,
            priority: this.priority,
            capacity: this.capacity,
            capabilities: this.capabilities,
            token: this.token
        });
        return this;
    }

    close() {
        this.stopping = true;
        this.socket?.close(1000, 'sentinel shutdown');
    }

    async run(options = {}) {
        const signal = options.signal;
        let delayMs = this.minReconnectDelayMs;
        this.stopping = false;
        const onAbort = () => this.socket?.close(1000, 'sentinel aborted');
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            while (!this.stopping && !signal?.aborted) {
                try {
                    await this.connect();
                    delayMs = this.minReconnectDelayMs;
                    await new Promise(resolve => {
                        if (this.socket.readyState === WebSocket.CLOSED) return resolve();
                        this.socket.once('close', resolve);
                    });
                } catch (error) {
                    if (!this.reconnect || this.stopping || signal?.aborted) throw error;
                }
                if (!this.reconnect || this.stopping || signal?.aborted) break;
                const jitter = Math.floor(Math.random() * Math.max(1, delayMs * 0.2));
                await wait(delayMs + jitter, signal);
                delayMs = Math.min(this.maxReconnectDelayMs, delayMs * 2);
            }
        } finally {
            signal?.removeEventListener('abort', onAbort);
        }
    }
}

module.exports = { Sentinel };
