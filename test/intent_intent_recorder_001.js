/**
 * Auto-recorded Test: intent_recorder_001
 * Generated: 2026-01-01T13:33:54.998Z
 * Source URL: about:blank
 */

const IntentRunner = require('../src/intent_runner');

async function runMission() {
    const runner = new IntentRunner();

    try {
        await runner.connect();
        console.log('[Mission] Starting recorded test: intent_recorder_001');

        await runner.goto('https://www.dhirajdas.dev/');
        await runner.clickGoal('Blog');
        await runner.goto('https://www.dhirajdas.dev/blog');
        await runner.clickGoal('Beyond the Black Box');
        await runner.goto('https://www.dhirajdas.dev/blog/starlight-mission-control-observability-roi');
        await runner.clickGoal('About');
        await runner.goto('https://www.dhirajdas.dev/');
        await runner.clickGoal('Learn more about me');
        await runner.goto('https://www.dhirajdas.dev/about');
        await runner.clickGoal('Tools');
        await runner.clickGoal('Locator Arena');
        await runner.goto('https://www.dhirajdas.dev/locator-game');

        console.log('[Mission] ✅ All recorded steps completed!');
        await runner.finish('Recorded test complete');
    } catch (error) {
        console.error('[Mission] ❌ Test failed:', error.message);
        await runner.finish('Mission failed: ' + error.message);
        process.exit(1);
    }
}

runMission();
