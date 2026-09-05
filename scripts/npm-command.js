'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Invoke npm through Node on Windows, avoiding shell concatenation of temporary paths.
function npmCommand(args) {
    if (process.platform !== 'win32') return { command: 'npm', args };
    const candidates = [process.env.npm_execpath,
        ...(process.env.PATH || '').split(path.delimiter).map(directory =>
            path.join(directory, 'node_modules/npm/bin/npm-cli.js'))];
    const executable = candidates.find(candidate => candidate && fs.existsSync(candidate));
    if (!executable) throw new Error('Cannot locate npm-cli.js; run this check using npm run release:gate');
    return { command: process.execPath, args: [executable, ...args] };
}

module.exports = { npmCommand };
