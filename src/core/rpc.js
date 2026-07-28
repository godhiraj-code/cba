'use strict';

const crypto = require('node:crypto');
const { ProtocolError, ERROR_CODES } = require('./errors');

class RpcPeer {
    constructor(socket, options = {}) {
        this.socket = socket;
        this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
        this.closeOnViolation = options.closeOnViolation !== false;
        this.handlers = new Map();
        this.pending = new Map();
        this.abandoned = new Map();
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

    call(method, params = {}, timeoutMs = this.requestTimeoutMs, signal) {
        const id = crypto.randomUUID();
        if (signal?.aborted) return Promise.reject(signal.reason);
        return new Promise((resolve, reject) => {
            const onAbort = () => {
                clearTimeout(timer);
                this.pending.delete(id);
                this.markAbandoned(id);
                reject(signal.reason);
            };
            const timer = setTimeout(() => {
                this.pending.delete(id);
                signal?.removeEventListener('abort', onAbort);
                this.markAbandoned(id);
                reject(new ProtocolError(ERROR_CODES.TIMEOUT, `request '${method}' timed out`));
            }, timeoutMs);
            signal?.addEventListener('abort', onAbort, { once: true });
            this.pending.set(id, { resolve, reject, timer, onAbort, signal });
            try {
                this.send({ jsonrpc: '2.0', id, method, params });
            } catch (error) {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
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
            this.protocolViolation('malformed JSON');
            return;
        }

        const isObject = message && typeof message === 'object' && !Array.isArray(message);
        const hasResult = isObject && Object.hasOwn(message, 'result');
        const hasError = isObject && Object.hasOwn(message, 'error');
        if (isObject && message.jsonrpc === '2.0' && message.id !== undefined &&
            (hasResult || hasError)) {
            if (hasResult === hasError ||
                Object.keys(message).some(key => !['jsonrpc', 'id', 'result', 'error'].includes(key))) {
                this.sendError(message.id ?? null, ERROR_CODES.INVALID_REQUEST, 'invalid JSON-RPC response');
                this.protocolViolation('invalid JSON-RPC response');
                return;
            }
            const pending = this.pending.get(message.id);
            if (!pending) {
                if (this.abandoned.has(message.id)) {
                    this.clearAbandoned(message.id);
                    return;
                }
                this.protocolViolation('unsolicited JSON-RPC response');
                return;
            }
            clearTimeout(pending.timer);
            pending.signal?.removeEventListener('abort', pending.onAbort);
            this.pending.delete(message.id);
            if (hasError) {
                const validData = !Object.hasOwn(message.error || {}, 'data') ||
                    (message.error.data && typeof message.error.data === 'object' &&
                     !Array.isArray(message.error.data) &&
                     typeof message.error.data.protocolCode === 'string' &&
                     Object.keys(message.error.data).every(key => ['protocolCode', 'details'].includes(key)));
                const validError = message.error && typeof message.error === 'object' &&
                    !Array.isArray(message.error) && Number.isInteger(message.error.code) &&
                    typeof message.error.message === 'string' &&
                    Object.keys(message.error).every(key => ['code', 'message', 'data'].includes(key)) &&
                    validData;
                if (!validError) {
                    pending.reject(new ProtocolError(
                        ERROR_CODES.INVALID_REQUEST,
                        'invalid JSON-RPC error object'
                    ));
                    this.protocolViolation('invalid JSON-RPC error object');
                    return;
                }
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

        if (!isObject || message.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
            !message.method.length || message.params === undefined ||
            !message.params || typeof message.params !== 'object' || Array.isArray(message.params) ||
            Object.keys(message).some(key => !['jsonrpc', 'id', 'method', 'params'].includes(key)) ||
            (message.id !== undefined && (typeof message.id !== 'string' || !message.id.length))) {
            this.sendError(message?.id ?? null, ERROR_CODES.INVALID_REQUEST, 'invalid JSON-RPC request');
            this.protocolViolation('invalid JSON-RPC request');
            return;
        }

        const handler = this.handlers.get(message.method);
        if (!handler) {
            if (message.id !== undefined) {
                this.sendError(message.id, 'METHOD_NOT_FOUND', `unknown method '${message.method}'`);
            }
            this.protocolViolation('unknown method');
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
            if ([
                ERROR_CODES.INVALID_REQUEST,
                ERROR_CODES.UNAUTHORIZED,
                ERROR_CODES.FORBIDDEN,
                ERROR_CODES.UNSUPPORTED_VERSION
            ].includes(error?.code)) {
                this.protocolViolation(error.code);
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
            pending.signal?.removeEventListener('abort', pending.onAbort);
            pending.reject(error);
        }
        this.pending.clear();
        for (const timer of this.abandoned.values()) clearTimeout(timer);
        this.abandoned.clear();
    }

    markAbandoned(id) {
        this.clearAbandoned(id);
        const timer = setTimeout(() => this.abandoned.delete(id), this.requestTimeoutMs);
        timer.unref?.();
        this.abandoned.set(id, timer);
    }

    clearAbandoned(id) {
        const timer = this.abandoned.get(id);
        if (timer) clearTimeout(timer);
        this.abandoned.delete(id);
    }

    protocolViolation(reason) {
        if (!this.closeOnViolation || this.socket.readyState !== 1) return;
        setImmediate(() => {
            if (this.socket.readyState === 1) this.socket.close(1008, reason.slice(0, 123));
        });
    }
}

module.exports = { RpcPeer };
