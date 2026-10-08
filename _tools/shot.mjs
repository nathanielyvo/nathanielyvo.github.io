#!/usr/bin/env node
// Full-page screenshot via headless Microsoft Edge + CDP.
// Usage: node shot.mjs <url-or-file> <out.png> [--width 1440] [--height 900] [--dark] [--mobile] [--viewport-only] [--scale 1] [--y 0 --h 1200]
//        [--print]  emulate print media   [--nojs]  disable JavaScript
// Prints page exceptions / console errors to stderr. Emulates prefers-color-scheme (light by default, --dark) and reduced motion.
// Examples:
//   node shot.mjs index.html /tmp/desk.png
//   node shot.mjs index.html /tmp/mob.png --mobile --dark
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
if (argv.length < 2) {
  console.error('usage: node shot.mjs <url-or-file> <out.png> [--width N] [--height N] [--dark] [--mobile] [--viewport-only] [--scale N]');
  process.exit(1);
}
let [target, out] = argv;
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? Number(argv[i + 1]) : d; };
const mobile = flag('--mobile');
const width = opt('--width', mobile ? 390 : 1440);
const height = opt('--height', mobile ? 844 : 900);
const scale = opt('--scale', mobile ? 2 : 1);
const dark = flag('--dark');
const viewportOnly = flag('--viewport-only');
if (!/^[a-z]+:\/\//.test(target)) target = 'file://' + resolve(target);

const EDGE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const port = 9300 + Math.floor(Math.random() * 500);
const prof = mkdtempSync(join(tmpdir(), 'shot-'));
const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = () => { try { proc.kill('SIGKILL'); } catch {} try { rmSync(prof, { recursive: true, force: true }); } catch {} };
const timer = setTimeout(() => { console.error('timeout'); cleanup(); process.exit(2); }, 60000);

try {
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    await sleep(150);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch {}
  }
  if (!wsUrl) throw new Error('could not connect to Edge');
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const events = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method) events.push(d);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
  if (mobile) await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  await send('Emulation.setEmulatedMedia', { media: flag('--print') ? 'print' : '', features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  if (flag('--nojs')) await send('Emulation.setScriptExecutionDisabled', { value: true });
  await send('Page.navigate', { url: target });
  for (let i = 0; i < 100; i++) { await sleep(100); if (events.some((e) => e.method === 'Page.loadEventFired')) break; }
  await send('Runtime.evaluate', { expression: 'document.fonts && document.fonts.ready.then(()=>1)', awaitPromise: true });
  // A full-page capture never scrolls, so load lazy images first (otherwise figures far down the page stay blank).
  // Growing the viewport to the page height works with JavaScript disabled too; the original size is restored after.
  {
    const m0 = await send('Page.getLayoutMetrics');
    const fullH = Math.ceil((m0.result.cssContentSize || m0.result.contentSize).height);
    await send('Emulation.setDeviceMetricsOverride', { width, height: Math.min(fullH, 16000), deviceScaleFactor: scale, mobile });
    await sleep(1500);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
  }
  await sleep(1200);
  // surface console errors / exceptions
  for (const e of events) {
    if (e.method === 'Runtime.exceptionThrown') console.error('[page exception]', e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text);
    if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') console.error('[console.error]', e.params.args.map((a) => a.value ?? a.description).join(' '));
    if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') console.error('[log]', e.params.entry.text, e.params.entry.url || '');
  }
  let clip;
  if (!viewportOnly) {
    const m = await send('Page.getLayoutMetrics');
    const cs = m.result.cssContentSize || m.result.contentSize;
    const full = Math.ceil(cs.height);
    // --y / --h capture a vertical slice of the full page (handy for inspecting long pages at full resolution)
    const y = Math.max(0, Math.min(opt('--y', 0), full - 1));
    const h = Math.min(opt('--h', full), full - y, 16000);
    clip = { x: 0, y, width, height: h, scale: 1 };
    console.log(`page height: ${full} css px`);
  }
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !viewportOnly, ...(clip ? { clip } : {}) });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log(`saved ${out} (${width}x${clip ? clip.height : height} css px, ${dark ? 'dark' : 'light'}${mobile ? ', mobile' : ''})`);
  ws.close();
} catch (e) {
  console.error('error:', e.message);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  cleanup();
}
