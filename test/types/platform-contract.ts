import { AgentPlatform, AgentDefinition, Mission, MissionRun } from '@starlight-protocol/starlight';
import { AgentPlatform as PlatformExport } from '@starlight-protocol/starlight/platform';

const agent: AgentDefinition = {
    name: 'typed-agent',
    canHandle: intent => intent.goal === 'Check',
    run: async (_intent, { signal }) => {
        signal.throwIfAborted();
        return { status: 'completed', value: 42 };
    },
    verify: (_intent, outcome) => outcome.value === 42
};
const platform: PlatformExport = new AgentPlatform({ coordinatorOptions: { maxAttempts: 2 } });
const unregister = platform.register(agent);
const mission: Mission = { goal: 'Check', steps: ['Check'] };
const handle = platform.submit(mission);
const result: Promise<MissionRun> = handle.done;
platform.agents()[0].active;
platform.getRun(handle.id)?.steps[0].result?.sentinel.name;
handle.cancel();
unregister();
// @ts-expect-error agents must state what they can handle
platform.register({ name: 'missing-claim', run: () => ({ status: 'completed' }) });
// @ts-expect-error verification returns a boolean, not a fabricated outcome
const invalid: AgentDefinition = { ...agent, verify: () => ({ status: 'completed' }) };
void result;
void invalid;
