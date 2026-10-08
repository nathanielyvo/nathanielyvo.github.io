// Minimal headless Microsoft Edge (or Chrome) session over the DevTools protocol, shared by thumbs.mjs and og.mjs.
// No npm packages: Node 22's built-in fetch and WebSocket do the work.
//   const edge = await openEdge();  await edge.send('Page.navigate', { url });  ...  edge.close();
// Set BROWSER=/path/to/chrome to use another Chromium-based browser.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.BROWSER,
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openEdge({ width = 1200, height = 800, scale = 1 } = {}) {
  const exe = CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error('No Chromium-based browser found; set BROWSER=/path/to/browser');
  const port = 9300 + Math.floor(Math.random() * 500);
  const prof = mkdtempSync(join(tmpdir(), 'edge-'));
  const proc = spawn(exe, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--force-color-profile=srgb', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank',
  ], { stdio: 'ignore' });
  const kill = () => { try { proc.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} };

  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    await sleep(150);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
  }
  if (!wsUrl) { kill(); throw new Error('could not connect to the browser'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });

  /** Evaluate an expression (awaiting promises) and return its value, or throw the page's exception. */
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  /** Load an HTML document and wait for its load event and web fonts. */
  const load = async (url) => {
    events.length = 0;
    await send('Page.navigate', { url });
    for (let i = 0; i < 150; i++) { await sleep(100); if (events.some((e) => e.method === 'Page.loadEventFired')) break; }
    await evaluate('document.fonts ? document.fonts.ready.then(() => true) : true');
  };
  return { send, evaluate, load, events, close: () => { try { ws.close(); } catch {} kill(); } };
}
