export interface OTelConfig {
    enabled?: boolean;
    serviceName?: string;
    endpoint?: string;
    headers?: Record<string, string>;
    exportIntervalMs?: number;
}

export interface Span {
    end(): void;
    setStatus(status: { code: number; message?: string }): void;
    setAttribute(key: string, value: unknown): void;
    addEvent(name: string, attributes?: Record<string, unknown>): void;
    recordException?(error: Error): void;
}

export class StarlightOTel {
    constructor(config?: OTelConfig);
    init(): boolean;
    startMissionSpan(missionId: string, attributes?: Record<string, unknown>): Span;
    startCommandSpan(command: string, attributes?: Record<string, unknown>): Span;
    startPreCheckSpan(intentId: string): Span;
    recordMission(durationMs: number, success: boolean, attributes?: Record<string, unknown>): void;
    recordPreCheck(durationMs: number, response: string): void;
    recordSentinelChange(delta: number, sentinelName: string): void;
    recordError(errorType: string, attributes?: Record<string, unknown>): void;
    recordHijack(sentinelName: string, reason: string): void;
    setSpanError(span: Span, error: Error): void;
    addSpanEvent(span: Span, name: string, attributes?: Record<string, unknown>): void;
    getTraceHeaders(): Record<string, string>;
}

export function getOTel(config?: OTelConfig): StarlightOTel;
export const SpanStatusCode: Record<string, number>;
export const SpanKind: Record<string, number>;
