// Record the README gif: drive the demo app in one browser while screenshotting the dashboard
// in another, so the capture shows flows appearing from real use rather than a static graph.
// Two browsers, not two tabs — Chrome throttles rendering in background tabs, so a
// backgrounded dashboard would paint stale frames.
import { mkdirSync, writeFileSync } from 'node:fs';

const FRAME_DIR = process.argv[2];
const FRAME_MS = 300;
mkdirSync(FRAME_DIR, { recursive: true });

async function connect(port) {
  const list = await (await fetch(`http://localhost:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) pending.get(m.id)(m.result);
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) =>
    new Promise((r) => {
      const n = ++id;
      pending.set(n, r);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return { send, close: () => ws.close() };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const demo = await connect(9222);
const board = await connect(9223);

for (const target of [demo, board]) {
  await target.send('Page.enable');
  await target.send('Emulation.setFocusEmulationEnabled', { enabled: true });
}
await demo.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 640, deviceScaleFactor: 1, mobile: false });
await board.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 640, deviceScaleFactor: 1, mobile: false });

await board.send('Page.navigate', { url: 'http://localhost:5173' });
await demo.send('Page.navigate', { url: 'http://localhost:5174' });
await wait(2500);

// Start recording the dashboard.
let frame = 0;
let recording = true;
const recorder = (async () => {
  while (recording) {
    const shot = await board.send('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      writeFileSync(`${FRAME_DIR}/f${String(frame).padStart(4, '0')}.png`, Buffer.from(shot.data, 'base64'));
      frame += 1;
    }
    await wait(FRAME_MS);
  }
})();

const ev = async (expression) =>
  (await demo.send('Runtime.evaluate', { expression, returnByValue: true })).result?.value;

const clickAt = async (selector) => {
  const box = await ev(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }); })()`);
  if (!box) return;
  const { x, y } = JSON.parse(box);
  await demo.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await demo.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
};

// A session with a story: navigate, start filling a form, hesitate, abandon it, come back,
// then hammer Save. Produces route changes, an abandonment, and a rage click.
await wait(1500);
await clickAt('nav button:nth-of-type(2)');
await wait(1800);
await clickAt('input[name=name]');
await wait(3000);                              // hesitation
await clickAt('nav button:nth-of-type(3)');    // abandons the form
await wait(2200);
await clickAt('nav button:nth-of-type(1)');
await wait(1800);
await clickAt('input[name=email]');
await wait(1600);
for (let i = 0; i < 4; i += 1) {               // the rage
  await clickAt('[data-telemetry-id=save-profile]');
  await wait(150);
}
await wait(4500);                              // let the dashboard poll catch up

recording = false;
await recorder;
console.log('frames:', frame);
demo.close();
board.close();
