'use strict';

const { ProtocolHub } = require('./hub');
const { digestToken } = require('./auth');

const port = Number(process.env.PORT || process.env.STARLIGHT_PORT || 8080);
const host = process.env.HOST || process.env.STARLIGHT_HOST || '127.0.0.1';
const token = process.env.STARLIGHT_AUTH_TOKEN;
const allowAnonymousLoopback = process.env.STARLIGHT_ALLOW_ANONYMOUS_LOOPBACK === 'true';
if (!token && !allowAnonymousLoopback) {
    throw new Error(
        'STARLIGHT_AUTH_TOKEN is required; set STARLIGHT_ALLOW_ANONYMOUS_LOOPBACK=true only for local development'
    );
}
const hub = new ProtocolHub({
    host,
    port,
    allowAnonymousLoopback,
    tokenDigests: token ? [digestToken(token)] : undefined
});

hub.start().then(address => {
    console.log(`Starlight protocol hub listening on ${address.url}`);
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
});

async function shutdown() {
    await hub.close();
    process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
