/**
 * Auto-recorded Test: recorder_002
 * Generated: 2026-01-01T13:42:03.844Z
 * Source URL: about:blank
 */

const IntentRunner = require('../src/intent_runner');

async function runMission() {
    const runner = new IntentRunner();

    try {
        await runner.connect();
        console.log('[Mission] Starting recorded test: recorder_002');

        await runner.goto('https://www.dhirajdas.dev/');
        await runner.clickGoal('About');
        await runner.clickGoal('Learn more about me →');
        await runner.goto('https://www.dhirajdas.dev/about');
        await runner.clickGoal('Blog');
        await runner.goto('https://www.dhirajdas.dev/blog');
        await runner.clickGoal('h3');
        await runner.goto('https://www.dhirajdas.dev/blog/starlight-mission-control-observability-roi');
        await runner.clickGoal('Tools');
        await runner.clickGoal('a');
        await runner.goto('https://www.dhirajdas.dev/locator-game');
        await runner.clickGoal('Tools');
        await runner.clickGoal('‍️');
        await runner.goto('https://www.dhirajdas.dev/pom-generator');

        console.log('[Mission] ✅ All recorded steps completed!');
        await runner.finish('Recorded test complete');
    } catch (error) {
        console.error('[Mission] ❌ Test failed:', error.message);
        await runner.finish('Mission failed: ' + error.message);
        process.exit(1);
    }
}

runMission();
