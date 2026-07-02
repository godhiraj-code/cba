export interface Command {
    cmd?: 'goto' | 'click' | 'fill' | 'select' | 'hover' | 'check' | 'uncheck' |
        'scroll' | 'press' | 'type' | 'upload' | 'screenshot' | 'checkpoint';
    goal?: string;
    selector?: string;
    text?: string;
    value?: string;
    url?: string;
    key?: string;
    files?: string | string[];
    name?: string;
    [key: string]: unknown;
}

export interface CommandResult {
    success: boolean;
    error?: string;
    [key: string]: unknown;
}

export interface PreCheckResult {
    clear: boolean;
    hardBlock?: boolean;
    reason?: string;
    retryAfterMs?: number;
    sentinel?: string;
}

export interface SemanticResolution {
    selector: string;
    selfHealed?: boolean;
    stabilityHint?: number;
}

export class CBAHub {
    constructor(port?: number, headless?: boolean);
    init(): Promise<void>;
    shutdown(reason?: string | Error | null): Promise<void>;
    resolveSemanticIntent(goal: string): Promise<SemanticResolution | null>;
    resolveFormIntent(goal: string): Promise<SemanticResolution | null>;
    resolveSelectIntent(goal: string): Promise<SemanticResolution | null>;
    resolveCheckboxIntent(goal: string): Promise<SemanticResolution | null>;
    broadcastPreCheck(command: Command): Promise<PreCheckResult>;
    executeCommand(command: Command, retry?: boolean): Promise<boolean>;
    getPageContext(): Promise<Record<string, unknown>>;
    getA11ySnapshot(): Promise<Record<string, unknown>>;
    validateProtocol(message: unknown): boolean;
}
