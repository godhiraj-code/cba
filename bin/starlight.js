#!/usr/bin/env node

/**
 * Starlight Autonomous CLI Orchestrator.
 *
 * Supports the protocol objective directly:
 * - mission files
 * - URL probes
 * - natural-language intents
 *
 * The Hub and Sentinels run as background child processes and are cleaned up
 * when the objective finishes.
 */

const { runCli } = require('../src/protocol_objective');

runCli(process.argv.slice(2)).then(code => {
    process.exitCode = code;
}).catch(error => {
    process.stderr.write(`Starlight objective failed: ${error.message}\n`);
    process.exitCode = 1;
});
