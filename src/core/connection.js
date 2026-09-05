'use strict';

const WebSocket = require('ws');

function openConnection(url, timeoutMs = 10_000) {
    const socket = new WebSocket(url, { handshakeTimeout: timeoutMs });
    const ready = new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
        socket.once('close', () => reject(new Error('connection closed before registration')));
    });
    return { socket, ready };
}

module.exports = { openConnection };
