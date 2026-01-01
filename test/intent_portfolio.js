/**
 * CBA Mission: Dhiraj Das Portfolio
 * Tests semantic navigation and obstacle handling on a real website
 */

const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:8080');

const SITE_URL = 'https://www.dhirajdas.dev';

ws.on('open', () => {
    console.log('[Intent] 🛰️ Connected to Starlight Hub');
    console.log('[Intent] Mission: Navigate to website');
    console.log('='.repeat(50));

    // Step 1: Navigate to the website
    console.log('[Intent] Step 1: Navigating to website...');
    ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'starlight.intent',
        params: { cmd: 'goto', url: SITE_URL },
        id: 'nav-1'
    }));

    // Step 2: Click "View Projects" button (semantic goal)
    setTimeout(() => {
        console.log('[Intent] Step 2: Semantic Goal - "View Projects"');
        ws.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'starlight.intent',
            params: {
                cmd: 'click',
                goal: 'View Projects',
                context: { missionType: 'portfolio-exploration' }
            },
            id: 'goal-1'
        }));
    }, 4000);

    // Step 3: Navigate to Blog section
    setTimeout(() => {
        console.log('[Intent] Step 3: Semantic Goal - "Blog"');
        ws.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'starlight.intent',
            params: {
                cmd: 'click',
                goal: 'Blog',
                context: { section: 'navigation' }
            },
            id: 'goal-2'
        }));
    }, 7000);

    // Step 4: Click "Contact Me" in navigation
    setTimeout(() => {
        console.log('[Intent] Step 4: Semantic Goal - "Contact"');
        ws.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'starlight.intent',
            params: {
                cmd: 'click',
                goal: 'Contact',
                context: { section: 'navigation' }
            },
            id: 'goal-3'
        }));
    }, 10000);

    // Step 5: Final - Click "Say Hello"
    setTimeout(() => {
        console.log('[Intent] Step 5: Semantic Goal - "Say Hello"');
        ws.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'starlight.intent',
            params: {
                cmd: 'click',
                goal: 'Say Hello',
                context: { action: 'contact-cta' }
            },
            id: 'goal-4'
        }));
    }, 13000);

    // Mission complete
    setTimeout(() => {
        console.log('='.repeat(50));
        console.log('[Intent] 🎯 Mission complete. Generating report...');
        ws.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'starlight.finish',
            params: { reason: 'Portfolio exploration complete' },
            id: 'shutdown-1'
        }));
    }, 16000);
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.method === 'starlight.sovereign_update') {
        console.log('[Intent] Context Update:', JSON.stringify(msg.params.context, null, 2));
    } else if (msg.type === 'COMMAND_COMPLETE') {
        const status = msg.success ? '✅' : '❌';
        console.log(`[Intent] ${status} Command ${msg.id} - ${msg.success ? 'SUCCESS' : 'FAILED'}`);
    }
});

ws.on('error', (err) => {
    console.error('[Intent] WebSocket error:', err.message);
});

ws.on('close', () => {
    console.log('[Intent] Connection closed');
    process.exit(0);
});
