export type Intent = {
    id?: string;
    goal: string;
    context?: Record<string, unknown>;
    constraints?: Record<string, unknown>;
};

export type ClaimObject = {
    accept?: boolean;
    score?: number;
    reason?: string;
    metadata?: unknown;
};
export type Claim = boolean | number | ClaimObject;

export type OutcomeError = string | { message: string; code?: string };
export type Outcome =
    | {
        status: 'completed';
        value?: unknown;
        evidence?: unknown;
        error?: never;
        retryAfterMs?: never;
    }
    | {
        status: 'failed';
        error: OutcomeError;
        evidence?: unknown;
        value?: never;
        retryAfterMs?: never;
    }
    | {
        status: 'unhandled';
        evidence?: unknown;
        value?: never;
        error?: never;
        retryAfterMs?: never;
    }
    | {
        status: 'retry';
        error?: OutcomeError;
        evidence?: unknown;
        retryAfterMs?: number;
        value?: never;
    };

export type Attempt = {
    sentinel: SentinelDescription;
    attempt: number;
    status: 'completed' | 'failed' | 'unhandled' | 'retry' | 'error';
    error?: string;
};

export type SentinelDescription = {
    id: string;
    name: string;
    version: string;
    priority: number;
    capacity: number;
    active: number;
    capabilities: string[];
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
        claim: ClaimObject;
        history: Attempt[];
    }): Outcome | Promise<Outcome>;
    cancel?(intent: Intent): void | Promise<void>;
};

export type IntentResult = {
    intentId: string;
    goal: string;
    status: 'completed';
    sentinel: SentinelDescription;
    value?: unknown;
    evidence?: unknown;
    attempts: Attempt[];
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
        owner?: string;
        signal?: AbortSignal;
    }): Promise<IntentResult>;
    clearIntent(id: string): boolean;
    cancel(id: string, owner?: string): boolean;
    drain(timeoutMs?: number): Promise<void>;
    on(event: string, listener: (...args: unknown[]) => void): this;
}

export type AuthenticationResult = boolean | string | { principalId: string };

export class ProtocolHub {
    constructor(options?: {
        host?: string;
        port?: number;
        path?: string;
        maxPayload?: number;
        heartbeatIntervalMs?: number;
        shutdownTimeoutMs?: number;
        rateLimit?: { max?: number; windowMs?: number };
        allowAnonymousLoopback?: boolean;
        tokenDigests?: string[];
        coordinator?: Coordinator;
        authenticate?: (
            registration: Record<string, unknown>,
            context: { request: unknown }
        ) => AuthenticationResult | Promise<AuthenticationResult>;
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
    cancel(intentId: string): Promise<{ cancelled: boolean }>;
    close(): void;
}

export const PROTOCOL_VERSION: string;
export const METHODS: Readonly<Record<string, string>>;
export const OUTCOME_STATUSES: readonly string[];
export const ERROR_CODES: Readonly<Record<string, string>>;
export const TOKEN_DIGEST_ALGORITHM: 'sha256';
export function digestToken(token: string): string;
export function createTokenAuthenticator(
    tokenDigests: string[]
): (registration: Record<string, unknown>) => string | false;
