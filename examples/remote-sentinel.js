'use strict';

const { Sentinel } = require('../src/core');

const sentinel = new Sentinel({
    token: process.env.STARLIGHT_AUTH_TOKEN,
    name: 'remote-word-counter',
    capabilities: ['text'],
    canHandle: intent => intent.goal === 'Count the words',
    handle: async intent => {
        if (typeof intent.context.text !== 'string') {
            return { status: 'failed', error: 'context.text must be a string' };
        }
        const words = intent.context.text.match(/\S+/g) || [];
        return {
            status: 'completed', value: { words: words.length },
            evidence: { method: 'non-whitespace token count', characters: intent.context.text.length }
        };
    }
});

sentinel.connect().catch(error => {
    console.error(error);
    sentinel.close();
    process.exitCode = 1;
});
process.once('SIGINT', () => sentinel.close());
process.once('SIGTERM', () => sentinel.close());
