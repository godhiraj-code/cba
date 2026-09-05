'use strict';

const { EventEmitter } = require('node:events');
const {
    normalizeClaim,
    normalizeIntent,
    normalizeOutcome,
    normalizeSentinel
} = require('./contract');
const { ProtocolError, ERROR_CODES } = require('./errors');
const { ExecutionGate } = require('./gate');
const { snapshot } = require('./json');

function boundedInteger(value, label, minimum, maximum) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
        throw new ProtocolError(
            ERROR_CODES.INVALID_REQUEST,
            `${label} must be an integer between ${minimum} and ${maximum}`
        );
    }
    return value;
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value).sort().map(key => [key, canonicalize(value[key])])
        );
    }
    return value;
}

function fingerprint(intent) {
    try {
        return JSON.stringify(canonicalize({
            goal: intent.goal,
            context: intent.context,
            constraints: intent.constraints
        }));
    } catch {
        throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'intent must contain JSON-serializable data');
    }
}

function delay(ms, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!ms) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function withTimeout(operation, timeoutMs, message, parentSignal, observeOperation) {
    const controller = new AbortController();
    if (parentSignal?.aborted) {
        controller.abort(parentSignal.reason);
        return Promise.reject(parentSignal.reason);
    }

    let abortFromParent;
    const cancelled = new Promise((_resolve, reject) => {
        abortFromParent = () => {
            controller.abort(parentSignal.reason);
            reject(parentSignal.reason);
        };
        parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    });

    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
            const error = new ProtocolError(ERROR_CODES.TIMEOUT, message);
            controller.abort(error);
            reject(error);
        }, timeoutMs);
    });

    const operationPromise = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw controller.signal.reason;
        return operation(controller.signal);
    });
    observeOperation?.(operationPromise);
    return Promise.race([
        operationPromise,
        timeout,
        cancelled
    ]).finally(() => {
        clearTimeout(timer);
        parentSignal?.removeEventListener('abort', abortFromParent);
    });
}

class Coordinator extends EventEmitter {
    emit(event, ...args) {
        // Observability must not change execution or replay semantics.
        for (const listener of this.rawListeners(event)) {
            try { listener.apply(this, args); } catch (error) {
                if (event !== 'observer.error') this.emit('observer.error', { event, error });
            }
        }
        return this.listenerCount(event) > 0;
    }

    constructor(options = {}) {
        super();
        this.offerTimeoutMs = options.offerTimeoutMs ?? 2_000;
        this.executionTimeoutMs = options.executionTimeoutMs ?? 30_000;
        this.maxAttempts = options.maxAttempts ?? 2;
        this.schedulingTimeoutMs = options.schedulingTimeoutMs ?? this.executionTimeoutMs;
        this.intentHistoryTtlMs = options.intentHistoryTtlMs ?? 300_000;
        this.maxIntentHistory = options.maxIntentHistory ?? 1_000;
        this.fallbackOnError = options.fallbackOnError ?? true;
        if (typeof this.fallbackOnError !== 'boolean') {
            throw new ProtocolError(ERROR_CODES.INVALID_REQUEST, 'fallbackOnError must be a boolean');
        }
        boundedInteger(this.offerTimeoutMs, 'offerTimeoutMs', 1, 300_000);
        boundedInteger(this.executionTimeoutMs, 'executionTimeoutMs', 1, 3_600_000);
        boundedInteger(this.schedulingTimeoutMs, 'schedulingTimeoutMs', 1, 3_600_000);
        boundedInteger(this.maxAttempts, 'maxAttempts', 1, 10);
        boundedInteger(this.intentHistoryTtlMs, 'intentHistoryTtlMs', 1, 86_400_000);
        boundedInteger(this.maxIntentHistory, 'maxIntentHistory', 1, 1_000_000);
        this.sentinels = new Map();
        this.intentHistory = new Map();
        this.activeIntents = new Set();
        this.activeControllers = new Map();
        this.draining = false;
        this.sequence = 0;
    }

    register(definition) {
        const sentinel = normalizeSentinel(definition);
        if (this.sentinels.has(sentinel.id)) {
            throw new ProtocolError(
                ERROR_CODES.DUPLICATE_SENTINEL,
                `sentinel '${sentinel.id}' is already registered`
            );
        }
        const record = {
            ...sentinel,
            order: this.sequence++,
            gate: new ExecutionGate(sentinel.capacity)
        };
        this.sentinels.set(record.id, record);
        this.emit('sentinel.registered', this.describe(record));
        return () => this.sentinels.get(record.id) === record && this.unregister(record.id);
    }

    unregister(id) {
        const sentinel = this.sentinels.get(id);
        if (!sentinel) return false;
        this.sentinels.delete(id);
        sentinel.gate.close(new ProtocolError(
            ERROR_CODES.DISCONNECTED,
            `sentinel '${sentinel.name}' was unregistered`
        ));
        this.emit('sentinel.unregistered', this.describe(sentinel));
        return true;
    }

    list() {
        return [...this.sentinels.values()].map(sentinel => this.describe(sentinel));
    }

    describe(sentinel) {
        return {
            id: sentinel.id,
            name: sentinel.name,
            version: sentinel.version,
            priority: sentinel.priority,
            capacity: sentinel.capacity,
            active: sentinel.gate.active,
            capabilities: [...sentinel.capabilities]
        };
    }

    dispatch(input, options = {}) {
        if (this.draining) {
            return Promise.reject(new ProtocolError(
                ERROR_CODES.DRAINING,
                'coordinator is draining and cannot accept new intents'
            ));
        }
        const intent = normalizeIntent(input);
        const intentFingerprint = fingerprint(intent);
        this.pruneIntentHistory(Date.now(), false);
        const existing = this.intentHistory.get(intent.id);
        if (existing) {
            if (existing.owner !== options.owner) {
                return Promise.reject(new ProtocolError(
                    ERROR_CODES.FORBIDDEN,
                    `intent id '${intent.id}' belongs to a different principal`
                ));
            }
            if (existing.fingerprint !== intentFingerprint) {
                return Promise.reject(new ProtocolError(
                    ERROR_CODES.INTENT_CONFLICT,
                    `intent id '${intent.id}' was already used with different content`
                ));
            }
            this.emit('intent.replayed', { intent, state: existing.state });
            return existing.promise;
        }
        this.pruneIntentHistory();
        if (this.intentHistory.size >= this.maxIntentHistory) {
            return Promise.reject(new ProtocolError(
                ERROR_CODES.RESOURCE_EXHAUSTED,
                'intent history capacity is exhausted by active work',
                { maxIntentHistory: this.maxIntentHistory }
            ));
        }

        const record = {
            fingerprint: intentFingerprint,
            owner: options.owner,
            createdAt: Date.now(),
            state: 'running',
            promise: null
        };
        const controller = new AbortController();
        const abortFromCaller = () => controller.abort(options.signal.reason);
        if (options.signal?.aborted) controller.abort(options.signal.reason);
        else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
        this.activeControllers.set(intent.id, controller);
        record.promise = Promise.resolve().then(() =>
            this.executeIntent(intent, { ...options, signal: controller.signal }));
        this.intentHistory.set(intent.id, record);
        this.activeIntents.add(record.promise);
        record.promise.then(
            () => {
                record.state = 'completed';
                record.settledAt = Date.now();
                this.activeIntents.delete(record.promise);
                this.activeControllers.delete(intent.id);
                options.signal?.removeEventListener('abort', abortFromCaller);
            },
            () => {
                record.state = 'failed';
                record.settledAt = Date.now();
                this.activeIntents.delete(record.promise);
                this.activeControllers.delete(intent.id);
                options.signal?.removeEventListener('abort', abortFromCaller);
            }
        );
        return record.promise;
    }

    cancel(intentId, owner) {
        const record = this.intentHistory.get(intentId);
        if (!record || record.owner !== owner) return false;
        const controller = this.activeControllers.get(intentId);
        if (!controller || controller.signal.aborted) return false;
        controller.abort(new ProtocolError(
            ERROR_CODES.CANCELLED,
            `intent '${intentId}' was cancelled`
        ));
        this.emit('intent.cancelled', { intentId });
        return true;
    }

    async drain(timeoutMs = 30_000) {
        boundedInteger(timeoutMs, 'drain timeout', 1, 3_600_000);
        this.draining = true;
        const active = [...this.activeIntents];
        if (!active.length) return;
        let timer;
        const timeout = new Promise((_resolve, reject) => {
            timer = setTimeout(() => {
                const error = new ProtocolError(ERROR_CODES.TIMEOUT,
                    `coordinator did not drain within ${timeoutMs}ms`);
                for (const controller of this.activeControllers.values()) controller.abort(error);
                reject(error);
            }, timeoutMs);
        });
        try {
            await Promise.race([Promise.allSettled(active), timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    pruneIntentHistory(now = Date.now(), makeRoom = true) {
        for (const [id, record] of this.intentHistory) {
            const timestamp = record.settledAt || record.createdAt;
            if (record.state !== 'running' && now - timestamp > this.intentHistoryTtlMs) {
                this.intentHistory.delete(id);
            }
        }
        while (makeRoom && this.intentHistory.size >= this.maxIntentHistory) {
            const settled = [...this.intentHistory].find(([, record]) => record.state !== 'running');
            if (!settled) break;
            this.intentHistory.delete(settled[0]);
        }
    }

    clearIntent(id) {
        const record = this.intentHistory.get(id);
        if (!record || record.state === 'running') return false;
        return this.intentHistory.delete(id);
    }

    async executeIntent(intent, options = {}) {
        const startedAt = Date.now();
        const offerTimeoutMs = options.offerTimeoutMs ?? this.offerTimeoutMs;
        const executionTimeoutMs = options.executionTimeoutMs ?? this.executionTimeoutMs;
        const maxAttempts = options.maxAttempts ?? this.maxAttempts;
        const schedulingTimeoutMs = options.schedulingTimeoutMs ?? this.schedulingTimeoutMs;
        const signal = options.signal;

        boundedInteger(offerTimeoutMs, 'offerTimeoutMs', 1, 300_000);
        boundedInteger(executionTimeoutMs, 'executionTimeoutMs', 1, 3_600_000);
        boundedInteger(schedulingTimeoutMs, 'schedulingTimeoutMs', 1, 3_600_000);
        boundedInteger(maxAttempts, 'maxAttempts', 1, 10);

        this.emit('intent.received', intent);
        const offers = await Promise.all([...this.sentinels.values()].map(async sentinel => {
            try {
                const claim = await withTimeout(
                    childSignal => sentinel.offer(intent, {
                        signal: childSignal,
                        sentinel: this.describe(sentinel)
                    }),
                    offerTimeoutMs,
                    `sentinel '${sentinel.name}' did not answer the offer in time`,
                    signal
                );
                return { sentinel, claim: normalizeClaim(claim) };
            } catch (error) {
                this.emit('sentinel.offer_error', { intent, sentinel: this.describe(sentinel), error });
                return { sentinel, claim: null };
            }
        }));

        if (signal?.aborted) throw signal.reason;

        const candidates = offers
            .filter(entry => entry.claim)
            .sort((a, b) =>
                b.claim.score - a.claim.score ||
                a.sentinel.priority - b.sentinel.priority ||
                a.sentinel.order - b.sentinel.order
            );

        if (candidates.length === 0) {
            const error = new ProtocolError(ERROR_CODES.NO_SENTINEL, `no sentinel claimed intent '${intent.goal}'`);
            this.emit('intent.failed', { intent, error });
            throw error;
        }

        const history = [];
        for (const candidate of candidates) {
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                const selected = snapshot(this.describe(candidate.sentinel));
                let release;
                let executionOperation;
                let acquisitionOperation;
                try {
                    release = await withTimeout(
                        childSignal => candidate.sentinel.gate.acquire(childSignal),
                        schedulingTimeoutMs,
                        `sentinel '${candidate.sentinel.name}' remained busy for too long`,
                        signal,
                        operation => { acquisitionOperation = operation; }
                    );
                    this.emit('sentinel.selected', { intent, sentinel: selected, claim: candidate.claim, attempt });
                    const rawOutcome = await withTimeout(
                        childSignal => {
                            const notifyCancellation = () => {
                                if (!candidate.sentinel.cancel) return;
                                Promise.resolve().then(() => candidate.sentinel.cancel(intent)).catch(error => {
                                    this.emit('sentinel.cancel_error', { intent, sentinel: selected, error });
                                });
                            };
                            childSignal.addEventListener('abort', notifyCancellation, { once: true });
                            return Promise.resolve().then(() => candidate.sentinel.execute(intent, {
                                signal: childSignal,
                                attempt,
                                claim: candidate.claim,
                                history: snapshot(history)
                            })).finally(() => childSignal.removeEventListener('abort', notifyCancellation));
                        },
                        executionTimeoutMs,
                        `sentinel '${candidate.sentinel.name}' timed out executing '${intent.goal}'`,
                        signal,
                        operation => { executionOperation = operation; }
                    );
                    const outcome = normalizeOutcome(rawOutcome);
                    history.push({ sentinel: selected, attempt, status: outcome.status });

                    if (outcome.status === 'completed') {
                        const result = snapshot({
                            intentId: intent.id,
                            goal: intent.goal,
                            status: 'completed',
                            sentinel: selected,
                            ...(outcome.value === undefined ? {} : { value: outcome.value }),
                            ...(outcome.evidence === undefined ? {} : { evidence: outcome.evidence }),
                            attempts: history,
                            durationMs: Date.now() - startedAt
                        });
                        this.emit('intent.completed', result);
                        return result;
                    }
                    if (outcome.status === 'failed') {
                        const error = new ProtocolError(
                            ERROR_CODES.INTENT_FAILED,
                            outcome.error?.message || outcome.error || `sentinel '${candidate.sentinel.name}' failed the intent`,
                            { intentId: intent.id, sentinel: selected, cause: outcome.error,
                                ...(outcome.evidence === undefined ? {} : { evidence: outcome.evidence }), attempts: history }
                        );
                        this.emit('intent.failed', { intent, error });
                        throw error;
                    }
                    if (outcome.status === 'unhandled') break;
                    if (outcome.status === 'retry') {
                        if (attempt === maxAttempts) break;
                        await delay(outcome.retryAfterMs ?? 0, signal);
                    }
                } catch (error) {
                    if (signal?.aborted) {
                        if (signal.reason instanceof ProtocolError) {
                            signal.reason.details = { intentId: intent.id, attempts: [...history, {
                                sentinel: selected, attempt, status: 'error', error: 'execution cancelled'
                            }] };
                        }
                        throw signal.reason;
                    }
                    if (error instanceof ProtocolError && error.code === ERROR_CODES.INTENT_FAILED) throw error;
                    history.push({
                        sentinel: selected,
                        attempt,
                        status: 'error',
                        error: error instanceof Error ? error.message : String(error)
                    });
                    this.emit('sentinel.execution_error', { intent, sentinel: selected, attempt, error });
                    if (!this.fallbackOnError) {
                        throw new ProtocolError(error.code || ERROR_CODES.INTERNAL,
                            error instanceof Error ? error.message : String(error),
                            { intentId: intent.id, attempts: history });
                    }
                    break;
                } finally {
                    if (release) {
                        const releaseWhenStopped = release;
                        if (executionOperation) executionOperation.then(releaseWhenStopped, releaseWhenStopped);
                        else releaseWhenStopped();
                    } else if (acquisitionOperation) {
                        acquisitionOperation.then(acquired => acquired(), () => {});
                    }
                }
            }
        }

        const error = new ProtocolError(
            ERROR_CODES.NO_SENTINEL,
            `all claiming sentinels left intent '${intent.goal}' unhandled`,
            { intentId: intent.id, attempts: history }
        );
        this.emit('intent.failed', { intent, error });
        throw error;
    }
}

module.exports = { Coordinator };
