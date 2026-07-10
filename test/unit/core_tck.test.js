'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runCoreTck } = require('../../tck/src/core_tck');

test('the reference Hub passes the black-box core TCK', async () => {
    const report = await runCoreTck();
    assert.equal(report.failed, 0);
    assert.equal(report.passed, 9);
});
