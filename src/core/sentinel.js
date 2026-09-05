'use strict';

const WebSocket = require('ws');
const { METHODS, PROTOCOL_VERSION } = require('./contract');
const { ProtocolError, ERROR_CODES } = require('./errors');
const { RpcPeer } = require('./rpc');
const { openConnection } = require('./connection');
const { ExecutionGate } = require('./gate');
const { normalizeIntent, normalizeSentinel } = require('./contract');

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
        normalizeSentinel({ name: this.name, capacity: this.capacity, priority: this.priority,
            capabilities: this.capabilities, offer: this.canHandle, execute: this.handle });
        this.gate = new ExecutionGate(this.capacity);
        this.executions = new Map();
        this.connecting = null;
        this.registered = false;
    }

    async connect() {
        if (this.connecting) return this.connecting;
        if (this.registered && this.socket?.readyState === WebSocket.OPEN) return this;
        this.connecting = this.connectAndRegister();
        try { return await this.connecting; } catch (error) {
            this.socket?.terminate();
            this.registered = false;
            throw error;
        } finally { this.connecting = null; }
    }

    async connectAndRegister() {
        const { socket, ready } = openConnection(this.url);
        this.socket = socket;
        socket.once('close', () => {
            if (this.socket === socket) this.registered = false;
            for (const record of this.executions.values()) {
                if (record.socket === socket) record.controller.abort(new ProtocolError(
                    ERROR_CODES.DISCONNECTED, 'sentinel connection closed'));
            }
        });
        await ready;
        this.peer = new RpcPeer(this.socket);
        this.peer.handle(METHODS.OFFER, ({ intent }) => this.canHandle(normalizeIntent(intent)));
        this.peer.handle(METHODS.EXECUTE, params => this.execute(params, socket));
        this.peer.handle(METHODS.CANCEL, params => {
            for (const record of this.executions.values()) {
                if (record.intentId === params.intentId && record.socket === socket) {
                    record.controller.abort(new ProtocolError(ERROR_CODES.CANCELLED, 'remote execution cancelled'));
                }
            }
            return this.onCancel(params.intentId);
        });
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
        this.registered = true;
        return this;
    }

    async execute(params, socket) {
        const intent = normalizeIntent(params.intent);
        const key = `${intent.id}:${params.attempt}`;
        if (this.executions.has(key)) throw new ProtocolError(ERROR_CODES.INTENT_CONFLICT, 'attempt is already running');
        const controller = new AbortController();
        this.executions.set(key, { controller, socket, intentId: intent.id });
        let release;
        try {
            release = await this.gate.acquire(controller.signal);
            controller.signal.throwIfAborted();
            return await this.handle(intent, { signal: controller.signal,
                attempt: params.attempt, claim: params.claim, history: params.history });
        } finally {
            this.executions.delete(key);
            release?.();
        }
    }

    close() {
        this.stopping = true;
        this.registered = false;
        for (const record of this.executions.values()) record.controller.abort(new ProtocolError(
            ERROR_CODES.CANCELLED, 'sentinel shutdown'));
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
