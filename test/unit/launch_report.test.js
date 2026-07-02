const test = require('node:test');
const assert = require('node:assert/strict');
const { buildData, renderMarkdown } = require('../../tools/generate_launch_report');

test('launch report generator discovers product assets and renders commercial wedge', () => {
    const data = buildData();

    assert.equal(data.product, 'Starlight Protocol');
    assert.ok(data.version);
    assert.ok(data.verdict.includes('Sentinel/Agent-powered QA reliability'));
    assert.ok(data.counts.sentinels >= 1, 'expected at least one sentinel');
    assert.ok(data.counts.missions >= 1, 'expected at least one demo mission');
    assert.ok(data.counts.schemas >= 1, 'expected at least one schema');
    assert.ok(Array.isArray(data.cta));
    assert.equal(data.cta.length, 3);

    const markdown = renderMarkdown(data);
    assert.match(markdown, /Starlight Protocol Launch Readiness Report/);
    assert.match(markdown, /Paid wedge/);
    assert.match(markdown, /Sentinel \/ Agent story/);
});
