'use strict';

const { Coordinator } = require('../src/core');

const protocol = new Coordinator();

protocol.register({
    name: 'example-heuristic',
    priority: 100,
    capabilities: ['demo'],
    offer: intent => intent.goal.startsWith('Say ') ? 1 : false,
    execute: intent => ({
        status: 'completed',
        value: intent.goal.slice(4),
        evidence: { handledBy: 'a deterministic heuristic' }
    })
});

async function mission() {
    // The mission contains intent only. It knows nothing about the implementation.
    const result = await protocol.dispatch('Say hello');
    console.log(JSON.stringify(result, null, 2));
}

mission().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
