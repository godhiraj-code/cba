'use strict';

const crypto = require('node:crypto');
const { Coordinator, ProtocolError, ERROR_CODES } = require('../core');
const { normalizeIntent, normalizeOutcome } = require('../core/contract');
const { snapshot } = require('../core/json');

function invalid(message) {
    return new ProtocolError(ERROR_CODES.INVALID_REQUEST, message);
}

function normalizeMission(input) {
    const source = typeof input === 'string' ? { goal: input } : input;
    if (!source || typeof source !== 'object' || Array.isArray(source) ||
        Object.keys(source).some(key => !['goal', 'context', 'constraints', 'steps'].includes(key))) {
        throw invalid('mission accepts goal, context, constraints, and optional steps');
    }
    const { goal, context, constraints } = normalizeIntent({
        goal: source.goal, context: source.context, constraints: source.constraints
    });
    if (Object.hasOwn(context, 'mission')) throw invalid('context.mission is reserved for execution history');
    const inputs = source.steps === undefined ? [goal] : source.steps;
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100) {
        throw invalid('mission.steps must contain between 1 and 100 intents');
    }
    const steps = inputs.map(input => {
        if (input && typeof input === 'object' && Object.hasOwn(input, 'id')) {
            throw invalid('step IDs are assigned by the platform');
        }
        const step = normalizeIntent(input);
        if (Object.hasOwn(step.context, 'mission')) throw invalid('context.mission is reserved for execution history');
        for (const key of Object.keys(step.constraints)) {
            if (Object.hasOwn(constraints, key)) throw invalid(`step cannot redefine mission constraint '${key}'`);
        }
        return { goal: step.goal, context: step.context, constraints: step.constraints };
    });
    return snapshot({ goal, context, constraints, steps });
}

function errorDetails(error) {
    const result = {
        code: typeof error?.code === 'string' ? error.code : ERROR_CODES.INTERNAL,
        message: error instanceof Error ? error.message : String(error)
    };
    if (error?.details !== undefined) result.details = error.details;
    // Agent exceptions may contain non-serializable data; reports still need to be readable.
    try { return snapshot(result); } catch { return snapshot({ code: result.code, message: result.message }); }
}

class AgentPlatform {
    constructor(options = {}) {
        this.coordinator = options.coordinator || new Coordinator({
            ...options.coordinatorOptions, fallbackOnError: false
        });
        this.maxRuns = options.maxRuns ?? 100;
        if (!Number.isInteger(this.maxRuns) || this.maxRuns < 1 || this.maxRuns > 100_000) {
            throw invalid('maxRuns must be an integer between 1 and 100000');
        }
        this.records = new Map();
    }

    register(agent) {
        if (!agent || typeof agent.canHandle !== 'function' || typeof agent.run !== 'function' ||
            (agent.verify !== undefined && typeof agent.verify !== 'function')) {
            throw invalid('agent must implement canHandle() and run(), with optional verify()');
        }
        const { id, name, version, priority, capacity, capabilities } = agent;
        return this.coordinator.register({
            id, name, version, priority, capacity, capabilities,
            offer: (intent, execution) => agent.canHandle(intent, execution),
            execute: async (intent, execution) => {
                let completedOutcome;
                try {
                    const raw = normalizeOutcome(await agent.run(intent, execution));
                    const outcome = snapshot(Object.fromEntries(
                        Object.entries(raw).filter(([, value]) => value !== undefined)
                    ));
                    if (outcome.status === 'completed' && agent.verify) {
                        completedOutcome = outcome;
                        const verified = await agent.verify(intent, outcome, execution);
                        if (verified !== true) return {
                            status: 'failed',
                            error: { code: 'VERIFICATION_FAILED', message: `agent '${name}' failed completion verification` },
                            evidence: outcome.evidence
                        };
                    }
                    return outcome;
                } catch (error) {
                    // A thrown error may follow a side effect. Only an explicit unhandled/retry
                    // outcome authorizes fallback/retry; never silently repeat ambiguous work.
                    return {
                        status: 'failed',
                        ...(completedOutcome?.evidence === undefined ? {} : { evidence: completedOutcome.evidence }),
                        error: { code: typeof error?.code === 'string' ? error.code : 'AGENT_ERROR',
                            message: error instanceof Error ? error.message : String(error) }
                    };
                }
            }
        });
    }

    agents() { return this.coordinator.list(); }

    submit(input, options = {}) {
        const mission = normalizeMission(input);
        if (this.records.size >= this.maxRuns) {
            const settled = [...this.records].find(([, record]) => record.report.status !== 'running');
            if (!settled) throw new ProtocolError(ERROR_CODES.RESOURCE_EXHAUSTED, 'all retained runs are active');
            this.records.delete(settled[0]);
        }
        const id = crypto.randomUUID();
        const controller = new AbortController();
        const record = {
            controller,
            report: { id, goal: mission.goal, status: 'running', startedAt: new Date().toISOString(),
                mission, steps: [] },
            done: null
        };
        this.records.set(id, record);
        const onAbort = () => this.cancel(id);
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener('abort', onAbort, { once: true });
        // Defer execution until the caller has received its cancellation handle.
        record.done = Promise.resolve().then(() => this.execute(record)).finally(() => {
            options.signal?.removeEventListener('abort', onAbort);
        });
        return Object.freeze({ id, done: record.done, cancel: () => this.cancel(id) });
    }

    async run(input, options) { return this.submit(input, options).done; }

    getRun(id) {
        const record = this.records.get(id);
        return record ? snapshot(record.report) : undefined;
    }

    listRuns() { return [...this.records.keys()].map(id => this.getRun(id)); }

    cancel(id) {
        const record = this.records.get(id);
        if (!record || record.report.status !== 'running' || record.controller.signal.aborted) return false;
        record.controller.abort(new ProtocolError(ERROR_CODES.CANCELLED, `run '${id}' was cancelled`));
        return true;
    }

    async execute(record) {
        const { report, controller } = record;
        const { mission } = report;
        const startedAt = Date.now();
        for (let index = 0; index < mission.steps.length; index++) {
            const step = mission.steps[index];
            const intent = {
                id: `${report.id}:${index + 1}`,
                goal: step.goal,
                context: { ...mission.context, ...step.context,
                    mission: { id: report.id, goal: mission.goal, step: index + 1,
                        results: report.steps.map(previous => previous.result) } },
                constraints: { ...mission.constraints, ...step.constraints }
            };
            if (controller.signal.aborted) {
                report.status = 'cancelled';
                report.error = errorDetails(controller.signal.reason);
                break;
            }
            const progress = { index: index + 1, intentId: intent.id, goal: step.goal, status: 'running' };
            report.steps.push(progress);
            try {
                progress.result = await this.coordinator.dispatch(intent, { signal: controller.signal });
                progress.status = 'completed';
            } catch (error) {
                progress.status = controller.signal.aborted ? 'cancelled' : 'failed';
                progress.error = errorDetails(error);
                report.status = progress.status;
                report.error = progress.error;
                break;
            }
        }
        if (report.status === 'running') report.status = 'completed';
        report.finishedAt = new Date().toISOString();
        report.durationMs = Date.now() - startedAt;
        return snapshot(report);
    }
}

module.exports = { AgentPlatform };
