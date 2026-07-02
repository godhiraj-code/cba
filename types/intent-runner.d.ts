export interface IntentRunnerOptions {
    hubUrl?: string;
    authToken?: string;
    layer?: string;
    registrationTimeout?: number;
}

export interface CommandResult {
    success?: boolean;
    error?: string;
    [key: string]: unknown;
}

declare class IntentRunner {
    constructor(hubUrl?: string, options?: IntentRunnerOptions);
    constructor(options?: IntentRunnerOptions);
    connect(): Promise<void>;
    close(): void;
    goto(url: string): Promise<CommandResult>;
    click(selector: string): Promise<CommandResult>;
    clickGoal(goal: string, context?: Record<string, unknown>): Promise<CommandResult>;
    fill(selector: string, text: string): Promise<CommandResult>;
    fillGoal(goal: string, text: string, context?: Record<string, unknown>): Promise<CommandResult>;
    select(selector: string, value: string): Promise<CommandResult>;
    selectGoal(goal: string, value: string, context?: Record<string, unknown>): Promise<CommandResult>;
    hover(selector: string): Promise<CommandResult>;
    hoverGoal(goal: string, context?: Record<string, unknown>): Promise<CommandResult>;
    check(selector: string): Promise<CommandResult>;
    checkGoal(goal: string, context?: Record<string, unknown>): Promise<CommandResult>;
    uncheck(selector: string): Promise<CommandResult>;
    uncheckGoal(goal: string, context?: Record<string, unknown>): Promise<CommandResult>;
    scrollTo(selector: string): Promise<CommandResult>;
    scrollToGoal(goal: string, context?: Record<string, unknown>): Promise<CommandResult>;
    scrollToBottom(): Promise<CommandResult>;
    press(key: string): Promise<CommandResult>;
    type(text: string): Promise<CommandResult>;
    upload(selector: string, files: string | string[]): Promise<CommandResult>;
    uploadGoal(goal: string, files: string | string[]): Promise<CommandResult>;
    checkpoint(name: string, options?: { timeout?: number }): Promise<CommandResult>;
    finish(reason?: string): Promise<void>;
    requestPageContext(): Promise<Record<string, unknown>>;
    executeNL(instruction: string): Promise<Array<Record<string, unknown>>>;
    executeFeature(featurePath: string, scenarioName?: string | null): Promise<Array<Record<string, unknown>>>;
    documentMission(tracePath: string, outputName?: string): string;
    getNLIStatus(): Promise<Record<string, unknown>>;
}

export = IntentRunner;
