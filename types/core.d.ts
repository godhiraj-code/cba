export type Intent = {
    id?: string;
    goal: string;
    context?: Record<string, unknown>;
    constraints?: Record<string, unknown>;
};

export type Claim = boolean | number | {
    accept?: boolean;
    score?: number;
    reason?: string;
    metadata?: unknown;
};

export type Outcome = {
    status: 'completed' | 'failed' | 'unhandled' | 'retry';
    value?: unknown;
    evidence?: unknown;
    error?: string | { message?: string; [key: string]: unknown };
    retryAfterMs?: number;
};

export type SentinelDefinition = {
    id?: string;
    name: string;
    version?: string;
    priority?: number;
    capacity?: number;
    capabilities?: string[];
    offer(intent: Readonly<Intent>, execution: { signal: AbortSignal }): Claim | Promise<Claim>;
    execute(intent: Readonly<Intent>, execution: {
        signal: AbortSignal;
        attempt: number;
        claim: Exclude<Claim, boolean | number>;
        history: unknown[];
    }): Outcome | Promise<Outcome>;
    cancel?(intent: Intent): void | Promise<void>;
};

export type IntentResult = {
    intentId: string;
    goal: string;
    status: 'completed';
    sentinel: {
        id: string;
        name: string;
        version: string;
        priority: number;
        capabilities: string[];
    };
    value?: unknown;
    evidence?: unknown;
    attempts: unknown[];
    durationMs: number;
};

export class ProtocolError extends Error {
    code: string;
    details?: unknown;
}

export class Coordinator {
    constructor(options?: {
        offerTimeoutMs?: number;
        executionTimeoutMs?: number;
        schedulingTimeoutMs?: number;
        maxAttempts?: number;
        intentHistoryTtlMs?: number;
        maxIntentHistory?: number;
    });
    register(sentinel: SentinelDefinition): () => boolean;
    unregister(id: string): boolean;
    list(): Array<{ id: string; name: string; version: string; priority: number; capabilities: string[] }>;
    dispatch(intent: string | Intent, options?: {
        offerTimeoutMs?: number;
        executionTimeoutMs?: number;
        schedulingTimeoutMs?: number;
        maxAttempts?: number;
        signal?: AbortSignal;
    }): Promise<IntentResult>;
    clearIntent(id: string): boolean;
    drain(timeoutMs?: number): Promise<void>;
    on(event: string, listener: (...args: unknown[]) => void): this;
}

export class ProtocolHub {
    constructor(options?: {
        host?: string;
        port?: number;
        path?: string;
        maxPayload?: number;
        heartbeatIntervalMs?: number;
        shutdownTimeoutMs?: number;
        rateLimit?: { max?: number; windowMs?: number };
        coordinator?: Coordinator;
        authenticate?: (
            registration: Record<string, unknown>,
            context: { request: unknown }
        ) => boolean | Promise<boolean>;
        authorize?: (request: {
            role: string;
            registration: Record<string, unknown>;
            method: string;
            params: Record<string, unknown>;
            request: unknown;
        }) => boolean | Promise<boolean>;
        offerTimeoutMs?: number;
        executionTimeoutMs?: number;
        maxAttempts?: number;
    });
    coordinator: Coordinator;
    start(): Promise<{ host: string; port: number; url: string }>;
    address(): { host: string; port: number; url: string } | null;
    close(): Promise<void>;
}

export class Sentinel {
    constructor(options: {
        url?: string;
        id?: string;
        name: string;
        version?: string;
        priority?: number;
        capacity?: number;
        capabilities?: string[];
        token?: string;
        reconnect?: boolean;
        minReconnectDelayMs?: number;
        maxReconnectDelayMs?: number;
        canHandle?: (intent: Intent) => Claim | Promise<Claim>;
        handle: (intent: Intent, execution: { attempt: number; claim: Claim; history: unknown[] }) => Outcome | Promise<Outcome>;
        onCancel?: (intentId: string) => void | Promise<void>;
    });
    connect(): Promise<this>;
    run(options?: { signal?: AbortSignal }): Promise<void>;
    close(): void;
}

export class Starlight {
    constructor(options?: string | {
        url?: string;
        name?: string;
        token?: string;
        reconnectAttempts?: number;
        reconnectDelayMs?: number;
    });
    connect(): Promise<this>;
    intent(goal: string | Intent, context?: Record<string, unknown>, constraints?: Record<string, unknown>): Promise<IntentResult>;
    close(): void;
}

export const PROTOCOL_VERSION: string;
export const METHODS: Readonly<Record<string, string>>;
export const OUTCOME_STATUSES: readonly string[];
export const ERROR_CODES: Readonly<Record<string, string>>;
