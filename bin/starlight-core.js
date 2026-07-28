#!/usr/bin/env node
'use strict';

const { ProtocolHub, digestToken } = require('../src/core');

function usage() {
    process.stdout.write(
        'Usage: starlight-core [--host=127.0.0.1] [--port=8080] [--allow-anonymous-loopback]\n' +
        'Set STARLIGHT_AUTH_TOKEN (minimum 16 characters) for authenticated operation.\n'
    );
}

async function main() {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        usage();
        return;
    }
    const hostArg = process.argv.find(value => value.startsWith('--host='));
    const portArg = process.argv.find(value => value.startsWith('--port='));
    const host = hostArg?.slice(7) || '127.0.0.1';
    const port = Number(portArg?.slice(7) || 8080);
    const allowAnonymousLoopback = process.argv.includes('--allow-anonymous-loopback');
    const token = process.env.STARLIGHT_AUTH_TOKEN;
    if (!allowAnonymousLoopback && !token) {
        throw new Error(
            'STARLIGHT_AUTH_TOKEN is required; use --allow-anonymous-loopback only for local development'
        );
    }
    const hub = new ProtocolHub({
        host,
        port,
        allowAnonymousLoopback,
        tokenDigests: token ? [digestToken(token)] : undefined
    });
    const address = await hub.start();
    process.stdout.write(`Starlight Hub listening on ${address.url}\n`);
    const shutdown = async () => {
        await hub.close();
        process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
