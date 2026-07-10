'use strict';

const { Sentinel } = require('../src/core');

const sentinel = new Sentinel({
    name: 'my-computer-agent',
    capabilities: ['computer-use'],
    canHandle: intent => ({ score: intent.context.device === 'desktop' ? 0.9 : 0.3 }),
    handle: async intent => {
        // Call Playwright, an LLM, computer-use, a mobile driver, or anything else here.
        return {
            status: 'completed',
            value: { handled: intent.goal },
            evidence: []
        };
    }
});

sentinel.connect().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
