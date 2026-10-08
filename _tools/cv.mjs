#!/usr/bin/env node
// Prints the homepage as the downloadable CV (assets/Runxi_Cheng_CV.pdf), so the PDF linked from the page says
// exactly what the page says: same authors, titles, venues and roles, from the same data/content.js.
//
//   node build.mjs && node _tools/cv.mjs
//
// It uses the page's own print stylesheet (A4, one column, black on white). The previous PDF is kept in
// _variants/ (not published). No phone number can reach the PDF: build.mjs refuses to write a page that has one,
// and this script checks the PDF text again. Uses a headless Edge/Chrome (see edge.mjs); no npm packages.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openEdge } from './edge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = (await import(pathToFileURL(join(ROOT, 'data', 'content.js')).href)).default;
const cvLink = C.person.links.find((l) => l.key === 'cv')?.url || 'assets/Runxi_Cheng_CV.pdf';
const OUT = join(ROOT, cvLink);
const TITLE = `${C.person.name}, Curriculum Vitae`;

// A throwaway local server: fonts do not load from file:// pages.
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.pdf': 'application/pdf' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const edge = await openEdge({ width: 1200, height: 900 });
try {
  await edge.send('Emulation.setEmulatedMedia', { media: 'print' });
  await edge.load(`${origin}/index.html?theme=light`);
  await edge.evaluate(`document.title = ${JSON.stringify(TITLE)}; true`);
  const r = await edge.send('Page.printToPDF', {
    paperWidth: 8.27, paperHeight: 11.69, preferCSSPageSize: true, printBackground: false,
    displayHeaderFooter: false, generateTaggedPDF: true, generateDocumentOutline: true,
  });
  if (!r.result?.data) throw new Error(`printToPDF failed: ${JSON.stringify(r.error || r)}`);
  const pdf = Buffer.from(r.result.data, 'base64');

  // Checks: no address of this temporary server, and nothing phone-like, in the PDF.
  let text = pdf.toString('latin1');
  for (const m of text.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length, end = text.indexOf('endstream', start);
    try { text += inflateSync(pdf.subarray(start, end), { finishFlush: 2 }).toString('latin1'); } catch { /* not deflate */ }
  }
  if (/127\.0\.0\.1|localhost/.test(text)) throw new Error('the PDF links to the temporary local server; not written');
  if (/\+?86[\s-]?1\d{2}[\s-]?\d{4}[\s-]?\d{4}|(?<![\d.])1[3-9]\d{9}(?!\d)/.test(text)) throw new Error('phone-like string in the PDF; not written');

  if (existsSync(OUT)) {
    mkdirSync(join(ROOT, '_variants'), { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const keep = join(ROOT, '_variants', `Runxi_Cheng_CV.before-${stamp}.pdf`);
    if (!existsSync(keep)) copyFileSync(OUT, keep);
  }
  writeFileSync(OUT, pdf);
  const pages = (text.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  console.log(`wrote ${cvLink} (${pages} pages, ${(pdf.length / 1024).toFixed(0)} KB); the previous file is in _variants/`);
} finally {
  edge.close();
  server.close();
}
