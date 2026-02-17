const WebSocket = require('ws');

const clusterId = 'docker-desktop'; // Try with a known ID or context
const url = `ws://127.0.0.1:8080/api/v1/clusters/${clusterId}/shell/stream`;

console.log('Connecting to:', url);
const ws = new WebSocket(url);

ws.on('open', () => {
    console.log('CONNECTED');
    ws.send(JSON.stringify({ t: 'stdin', d: Buffer.from('ls\n').toString('base64') }));
});

ws.on('message', (data) => {
    console.log('MESSAGE:', data.toString());
    const msg = JSON.parse(data.toString());
    if (msg.t === 'stdout') {
        process.stdout.write(Buffer.from(msg.d, 'base64').toString());
    }
});

ws.on('error', (err) => {
    console.error('ERROR:', err);
});

ws.on('close', (code, reason) => {
    console.log('CLOSED:', code, reason.toString());
    process.exit(0);
});

setTimeout(() => {
    console.log('Timing out...');
    ws.close();
}, 5000);
