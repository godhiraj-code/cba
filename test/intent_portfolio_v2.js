/**
 * CBA Mission: Portfolio (Event-Driven Version)
 * 
 * This is the refactored version of intent_portfolio.js using the
 * IntentRunner for reliable, event-driven test execution instead of
 * fragile setTimeout-based patterns.
 * 
 * Usage: node test/intent_portfolio_v2.js
 */

const IntentRunner = require('../src/intent_runner');

const SITE_URL = 'https://www.dhirajdas.dev';

async function runMission() {
    const runner = new IntentRunner();

    try {
        await runner.connect();
        console.log('[Mission] Starting portfolio exploration...\n');

        // Step 1: Navigate to the website
        console.log('[Mission] Step 1: Navigating to website...');
        await runner.goto(SITE_URL);
        console.log('[Mission] ✅ Navigation complete\n');

        // Step 2: Click "View Projects" (semantic goal)
        console.log('[Mission] Step 2: Semantic Goal - "View Projects"');
        await runner.clickGoal('View Projects', { missionType: 'portfolio-exploration' });
        console.log('[Mission] ✅ View Projects clicked\n');

        // Step 3: Navigate to Blog
        console.log('[Mission] Step 3: Semantic Goal - "Blog"');
        await runner.clickGoal('Blog', { section: 'navigation' });
        console.log('[Mission] ✅ Blog clicked\n');

        // Step 4: Contact section
        console.log('[Mission] Step 4: Semantic Goal - "Contact"');
        await runner.clickGoal('Contact', { section: 'navigation' });
        console.log('[Mission] ✅ Contact clicked\n');

        // Step 5: Say Hello CTA
        console.log('[Mission] Step 5: Semantic Goal - "Say Hello"');
        await runner.clickGoal('Say Hello', { action: 'contact-cta' });
        console.log('[Mission] ✅ Say Hello clicked\n');

        // Mission complete
        console.log('='.repeat(50));
        console.log('[Mission] 🎯 All steps completed successfully!');
        await runner.finish('Portfolio exploration complete');

    } catch (error) {
        console.error('[Mission] ❌ Mission failed:', error.message);
        await runner.finish('Mission failed: ' + error.message);
        process.exit(1);
    }
}

runMission();
