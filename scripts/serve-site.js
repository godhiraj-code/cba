'use strict';

// Local Pages preview, including byte ranges so native video seeking works.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../dist/site');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
    '.mp4': 'video/mp4', '.vtt': 'text/vtt', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400).end(); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    if (!pathname.startsWith('/starlight/')) { response.writeHead(404).end(); return; }
    const file = path.resolve(root, pathname.slice('/starlight/'.length) || 'index.html');
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404).end(); return;
    }
    const size = fs.statSync(file).size;
    let start = 0;
    let end = size - 1;
    if (request.headers.range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
        if (!match || Number(match[1]) >= size || (match[2] && Number(match[2]) < Number(match[1]))) {
            response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return;
        }
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        response.statusCode = 206;
        response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    response.setHeader('Content-Length', Math.max(0, end - start + 1));
    response.setHeader('Accept-Ranges', 'bytes');
    if (request.method === 'HEAD' || size === 0) { response.end(); return; }
    const stream = fs.createReadStream(file, { start, end });
    response.on('close', () => stream.destroy());
    stream.on('error', () => response.destroy());
    stream.pipe(response);
});
server.listen(4173, '127.0.0.1', () => process.stdout.write('Preview: http://127.0.0.1:4173/starlight/\n'));
