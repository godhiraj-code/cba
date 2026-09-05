#!/usr/bin/env node
'use strict';

const { ProtocolHub, digestToken } = require('../src/core');

function usage() {
    process.stdout.write(
        'Usage: starlight-core [--host=127.0.0.1] [--port=8080] [--allow-anonymous-loopback]\n' +
        'Options: --offer-timeout-ms=2000 --execution-timeout-ms=30000 --scheduling-timeout-ms=30000 --max-attempts=2\n' +
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
    const supported = /^--(host|port|offer-timeout-ms|execution-timeout-ms|scheduling-timeout-ms|max-attempts)=.+$/;
    for (const arg of process.argv.slice(2)) {
        if (arg !== '--allow-anonymous-loopback' && !supported.test(arg)) throw new Error(`unknown option: ${arg}`);
    }
    const host = hostArg?.slice(7) || process.env.STARLIGHT_HOST || process.env.HOST || '127.0.0.1';
    const port = Number(portArg?.slice(7) || process.env.STARLIGHT_PORT || process.env.PORT || 8080);
    const allowAnonymousLoopback = process.argv.includes('--allow-anonymous-loopback') ||
        process.env.STARLIGHT_ALLOW_ANONYMOUS_LOOPBACK === 'true';
    const limits = {};
    for (const [flag, key] of [['offer-timeout-ms', 'offerTimeoutMs'], ['execution-timeout-ms', 'executionTimeoutMs'],
        ['scheduling-timeout-ms', 'schedulingTimeoutMs'], ['max-attempts', 'maxAttempts']]) {
        const argument = process.argv.find(value => value.startsWith(`--${flag}=`));
        if (argument) limits[key] = Number(argument.slice(flag.length + 3));
    }
    const token = process.env.STARLIGHT_AUTH_TOKEN;
    if (!allowAnonymousLoopback && !token) {
        throw new Error(
            'STARLIGHT_AUTH_TOKEN is required; use --allow-anonymous-loopback only for local development'
        );
    }
    const hub = new ProtocolHub({
        ...limits,
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
