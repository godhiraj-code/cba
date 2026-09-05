import { Coordinator, Intent, IntentResult, Outcome, SentinelDefinition, SentinelDescription } from './core';

export type Mission = {
    goal: string;
    context?: Record<string, unknown>;
    constraints?: Record<string, unknown>;
    steps?: Array<string | Omit<Intent, 'id'>>;
};

export type AgentExecution = Parameters<SentinelDefinition['execute']>[1];
export type AgentDefinition = Pick<SentinelDefinition, 'id' | 'name' | 'version' | 'priority' | 'capacity' | 'capabilities'> & {
    canHandle: SentinelDefinition['offer'];
    run: SentinelDefinition['execute'];
    verify?: (intent: Readonly<Intent>, outcome: Extract<Outcome, { status: 'completed' }>,
        execution: AgentExecution) => boolean | Promise<boolean>;
};

export type RunError = { code: string; message: string; details?: unknown };
export type RunStep = {
    index: number;
    intentId: string;
    goal: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    result?: IntentResult;
    error?: RunError;
};
export type MissionRun = {
    id: string;
    goal: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    mission: Mission;
    steps: RunStep[];
    error?: RunError;
};
export type RunHandle = {
    readonly id: string;
    readonly done: Promise<MissionRun>;
    cancel(): boolean;
};

export class AgentPlatform {
    constructor(options?: {
        coordinator?: Coordinator;
        coordinatorOptions?: Omit<NonNullable<ConstructorParameters<typeof Coordinator>[0]>, 'fallbackOnError'>;
        maxRuns?: number;
    });
    readonly coordinator: Coordinator;
    register(agent: AgentDefinition): () => boolean;
    agents(): SentinelDescription[];
    submit(mission: string | Mission, options?: { signal?: AbortSignal }): RunHandle;
    run(mission: string | Mission, options?: { signal?: AbortSignal }): Promise<MissionRun>;
    getRun(id: string): MissionRun | undefined;
    listRuns(): MissionRun[];
    cancel(id: string): boolean;
}
