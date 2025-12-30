const WebSocket = require('ws');
const path = require('path');

async function runMission() {
    const ws = new WebSocket('ws://localhost:8080');

    ws.on('open', () => {
        console.log("[Intent] Connected to Hub. Starting Learning Test...");

        const testFile = 'file:///' + path.join(__dirname, 'learning_test.html').replace(/\\/g, '/');
        const mission = [
            { method: 'starlight.intent', params: { cmd: 'goto', url: testFile }, id: 1 },
            { method: 'starlight.intent', params: { goal: 'COLLECT DATA' }, id: 2 },
            { method: 'starlight.finish', params: {}, id: 3 }
        ];

        let step = 0;
        const sendNext = () => {
            if (step < mission.length) {
                console.log(`[Intent] Sending: ${mission[step].method}`);
                ws.send(JSON.stringify({ jsonrpc: '2.0', ...mission[step] }));
            }
        };

        ws.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.type === 'COMMAND_COMPLETE' && msg.success) {
                step++;
                sendNext();
            }
        });

        sendNext();
    });

    ws.on('error', (e) => console.error("[Intent] WS Error:", e.message));
}

runMission();
