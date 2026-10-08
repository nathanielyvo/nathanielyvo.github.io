#!/usr/bin/env node
// Lighter renditions of the paper figures for the page itself; the original stays the full-size file behind the
// lightbox. Run it after adding or replacing a figure in assets/papers/, then run `node build.mjs`:
//
//   node _tools/thumbs.mjs            (only figures whose thumbnail is missing or older than the figure)
//   node _tools/thumbs.mjs --force    (all of them)
//
// Writes assets/papers/thumbs/<name>.webp: 800 px wide for figures in the margin column, 1200 px for wide ones
// (about twice their display width), aiming for < 60 KB. PNG/JPEG figures always get one. SVG figures only when
// the SVG is heavy (e.g. it embeds bitmaps) and the WebP is clearly smaller; small vector SVGs are left alone.
// The WebP is encoded by a headless Edge/Chrome (see edge.mjs), so no image packages are needed.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openEdge } from './edge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = (await import(pathToFileURL(join(ROOT, 'data', 'content.js')).href)).default;
const force = process.argv.includes('--force');
const TARGET = 60 * 1024;
const OUT = join(ROOT, 'assets/papers/thumbs');
mkdirSync(OUT, { recursive: true });

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const jobs = C.publications.filter((p) => p.teaser && !/^https?:/.test(p.teaser)).map((p) => ({ file: p.teaser, wide: !!p.teaserWide }));

const edge = await openEdge();
try {
  await edge.load('about:blank');
  for (const { file, wide } of jobs) {
    const src = join(ROOT, file);
    const ext = extname(file).toLowerCase();
    if (!existsSync(src) || !MIME[ext]) { console.warn(`  skip ${file} (missing or unsupported)`); continue; }
    const dest = join(OUT, `${basename(file, extname(file))}.webp`);
    if (!force && existsSync(dest) && statSync(dest).mtimeMs >= statSync(src).mtimeMs) { console.log(`  up to date  ${file}`); continue; }
    const buf = readFileSync(src);
    const isSvg = ext === '.svg';
    const gz = isSvg ? gzipSync(buf).length : buf.length;   // what the browser would actually transfer
    if (isSvg && gz <= TARGET) {
      if (existsSync(dest)) rmSync(dest);
      console.log(`  keep vector ${file} (${(gz / 1024).toFixed(0)} KB gzipped)`);
      continue;
    }
    const maxW = wide ? 1200 : 800;
    const dataUrl = `data:${MIME[ext]};base64,${buf.toString('base64')}`;
    const result = await edge.evaluate(`(async () => {
      const img = new Image();
      img.src = ${JSON.stringify(dataUrl)};
      await img.decode();
      const nw = img.naturalWidth || 1200, nh = img.naturalHeight || 800;
      const w = ${isSvg} ? ${maxW} : Math.min(${maxW}, nw), h = Math.round(w * nh / nw);   // vectors scale up cleanly
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      let q = 0.86, url = c.toDataURL('image/webp', q);
      while (url.length * 0.75 > ${TARGET} && q > 0.6) { q -= 0.06; url = c.toDataURL('image/webp', q); }
      return { url, w, h, q: Math.round(q * 100) / 100 };
    })()`);
    const webp = Buffer.from(result.url.split(',')[1], 'base64');
    if (webp.length > gz * 0.8) {
      if (existsSync(dest)) rmSync(dest);
      console.log(`  keep original ${file} (WebP ${(webp.length / 1024).toFixed(0)} KB is not clearly smaller than ${(gz / 1024).toFixed(0)} KB)`);
      continue;
    }
    writeFileSync(dest, webp);
    console.log(`  wrote ${join('assets/papers/thumbs', basename(dest))}  ${result.w}x${result.h}  q${result.q}  ${(webp.length / 1024).toFixed(0)} KB  (was ${(gz / 1024).toFixed(0)} KB)${webp.length > TARGET ? '  ! over 60 KB' : ''}`);
  }
} finally {
  edge.close();
}
