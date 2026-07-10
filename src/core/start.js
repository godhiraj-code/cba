'use strict';

const { ProtocolHub } = require('./hub');

const port = Number(process.env.PORT || process.env.STARLIGHT_PORT || 8080);
const host = process.env.HOST || process.env.STARLIGHT_HOST || '127.0.0.1';
const hub = new ProtocolHub({ host, port });

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
