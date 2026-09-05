'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function readOrders(intent, signal) {
    const rows = JSON.parse(await fs.readFile(intent.context.inputPath, { encoding: 'utf8', signal }));
    if (!Number.isInteger(intent.constraints.maxRows) || intent.constraints.maxRows < 1 ||
        !Array.isArray(rows) || rows.length > intent.constraints.maxRows ||
        rows.some(row => !row || !Number.isSafeInteger(row.amountCents) || row.amountCents < 0)) {
        throw new Error('orders must have nonnegative integer amountCents and respect maxRows');
    }
    return rows;
}

function reportText(summary) {
    return `# Order summary\n\nOrders: ${summary.count}\nTotal (cents): ${summary.totalCents}\n`;
}

module.exports = [
    {
        name: 'order-analyst',
        capabilities: ['structured-data'],
        canHandle: intent => intent.goal === 'Summarize the order data',
        async run(intent, { signal }) {
            const rows = await readOrders(intent, signal);
            const totalCents = rows.reduce((total, row) => total + row.amountCents, 0);
            if (!Number.isSafeInteger(totalCents)) return { status: 'failed', error: 'total exceeds integer precision' };
            return {
                status: 'completed',
                value: { count: rows.length, totalCents },
                evidence: [{ kind: 'source', ref: pathToFileURL(path.resolve(intent.context.inputPath)).href }]
            };
        },
        async verify(intent, outcome, { signal }) {
            const rows = await readOrders(intent, signal);
            return outcome.value.count === rows.length &&
                BigInt(outcome.value.totalCents) === rows.reduce((total, row) => total + BigInt(row.amountCents), 0n);
        }
    },
    {
        name: 'report-writer',
        capabilities: ['documents'],
        canHandle: intent => intent.goal === 'Write the verified order summary',
        async run(intent, { signal }) {
            const summary = intent.context.mission.results.at(-1)?.value;
            if (!summary || !Number.isSafeInteger(summary.count) || !Number.isSafeInteger(summary.totalCents)) {
                return { status: 'failed', error: 'a completed order summary is required' };
            }
            const filename = path.resolve(intent.context.outputPath);
            await fs.mkdir(path.dirname(filename), { recursive: true });
            // Fail if the destination exists: repeating a mission never silently overwrites a report.
            await fs.writeFile(filename, reportText(summary), { flag: 'wx', signal });
            return {
                status: 'completed', value: { path: filename },
                evidence: [{ kind: 'artifact', ref: pathToFileURL(filename).href }]
            };
        },
        async verify(intent, outcome, { signal }) {
            const actual = await fs.readFile(outcome.value.path, { encoding: 'utf8', signal });
            return actual === reportText(intent.context.mission.results.at(-1).value);
        }
    }
];
