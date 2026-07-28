import {
    Coordinator,
    Intent,
    IntentResult,
    Outcome,
    ProtocolHub,
    Sentinel,
    Starlight,
    digestToken
} from '@starlight-protocol/starlight';

const token = 'type-contract-token-000000000';
const hub = new ProtocolHub({ tokenDigests: [digestToken(token)] });
const coordinator = new Coordinator({ maxAttempts: 2 });
const intent: Intent = { id: 'typed-intent', goal: 'Prove declarations' };
const outcome: Outcome = { status: 'completed', evidence: [] };
// @ts-expect-error completed outcomes cannot carry retry controls
const invalidCompleted: Outcome = { status: 'completed', retryAfterMs: 1 };
// @ts-expect-error failed outcomes require a structured non-optional error
const invalidFailed: Outcome = { status: 'failed' };
void invalidCompleted;
void invalidFailed;
const sentinel = new Sentinel({
    name: 'typed-sentinel',
    token,
    handle: async (): Promise<Outcome> => outcome
});
const client = new Starlight({ token });

async function consume(): Promise<IntentResult> {
    await hub.start();
    await sentinel.connect();
    await client.connect();
    coordinator.cancel(intent.id || '');
    await client.cancel(intent.id || '');
    return client.intent(intent);
}

void consume;
