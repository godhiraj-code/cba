'use strict';

const crypto = require('node:crypto');
const { ProtocolError, ERROR_CODES } = require('./errors');

class RpcPeer {
    constructor(socket, options = {}) {
        this.socket = socket;
        this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
        this.handlers = new Map();
        this.pending = new Map();
        socket.on('message', data => this.onMessage(data));
        socket.on('close', () => this.rejectPending(new ProtocolError(
            ERROR_CODES.DISCONNECTED,
            'protocol peer disconnected'
        )));
        socket.on('error', error => this.rejectPending(error));
    }

    handle(method, handler) {
        this.handlers.set(method, handler);
        return this;
    }

    call(method, params = {}, timeoutMs = this.requestTimeoutMs) {
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new ProtocolError(ERROR_CODES.TIMEOUT, `request '${method}' timed out`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try {
                this.send({ jsonrpc: '2.0', id, method, params });
            } catch (error) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(error);
            }
        });
    }

    notify(method, params = {}) {
        this.send({ jsonrpc: '2.0', method, params });
    }

    send(message) {
        if (this.socket.readyState !== 1) {
            throw new ProtocolError(ERROR_CODES.DISCONNECTED, 'protocol peer is not connected');
        }
        this.socket.send(JSON.stringify(message));
    }

    async onMessage(raw) {
        let message;
        try {
            message = JSON.parse(raw.toString());
        } catch {
            this.sendError(null, ERROR_CODES.INVALID_REQUEST, 'message must be valid JSON');
            return;
        }

        if (message && message.jsonrpc === '2.0' && message.id !== undefined &&
            (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))) {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            if (message.error) {
                const protocolCode = message.error.data?.protocolCode || String(message.error.code);
                pending.reject(new ProtocolError(
                    protocolCode,
                    message.error.message || 'remote protocol error',
                    message.error.data?.details
                ));
            } else {
                pending.resolve(message.result);
            }
            return;
        }

        if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
            this.sendError(message?.id ?? null, ERROR_CODES.INVALID_REQUEST, 'invalid JSON-RPC request');
            return;
        }

        const handler = this.handlers.get(message.method);
        if (!handler) {
            if (message.id !== undefined) {
                this.sendError(message.id, 'METHOD_NOT_FOUND', `unknown method '${message.method}'`);
            }
            return;
        }

        try {
            const result = await handler(message.params || {}, message);
            if (message.id !== undefined) this.send({ jsonrpc: '2.0', id: message.id, result: result ?? null });
        } catch (error) {
            if (message.id !== undefined) {
                this.sendError(
                    message.id,
                    error.code || ERROR_CODES.INTERNAL,
                    error instanceof Error ? error.message : String(error),
                    error.details
                );
            }
        }
    }

    sendError(id, code, message, data) {
        const rpcCodes = {
            [ERROR_CODES.INVALID_REQUEST]: -32600,
            METHOD_NOT_FOUND: -32601,
            [ERROR_CODES.INTERNAL]: -32603
        };
        const error = {
            code: rpcCodes[code] || -32000,
            message,
            data: { protocolCode: code }
        };
        if (data !== undefined) error.data.details = data;
        try {
            this.send({ jsonrpc: '2.0', id, error });
        } catch {
            // The peer is already gone; there is nowhere to report the error.
        }
    }

    rejectPending(error) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }
}

module.exports = { RpcPeer };
