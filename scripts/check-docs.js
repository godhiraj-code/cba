'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const files = ['README.md', 'CHANGELOG.md', 'GOVERNANCE.md', 'CONTRIBUTING.md', 'tck/README.md',
    ...['docs', 'spec'].flatMap(directory => fs.readdirSync(path.join(root, directory))
        .filter(name => name.endsWith('.md')).map(name => `${directory}/${name}`))];
let links = 0;
for (const file of files) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1].split('#')[0];
        if (!target || /^[a-z]+:/i.test(target)) continue;
        const resolved = path.resolve(root, path.dirname(file), decodeURI(target));
        assert(fs.existsSync(resolved), `${file}: missing link target ${target}`);
        links++;
    }
}
process.stdout.write(`documentation links: ${files.length} documents, ${links} local targets verified\n`);
