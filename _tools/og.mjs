#!/usr/bin/env node
// Renders the social-sharing card assets/img/og-image.png (1200×630) from data/content.js, so the card never goes
// stale. Run it after changing the name, position, affiliation, location, research interests, photo or site address:
//
//   node _tools/og.mjs                         (address from meta.url in content.js; none if it is not set)
//   SITE_URL=https://example.org/ node _tools/og.mjs
//
// The fields used are stored in the PNG itself (a tEXt chunk "og-key"); build.mjs compares them with content.js
// and warns when the card needs to be regenerated. Uses a headless Edge/Chrome (see edge.mjs); no npm packages.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openEdge } from './edge.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = (await import(pathToFileURL(join(ROOT, 'data', 'content.js')).href)).default;
const P = C.person;

// Same rule as build.mjs: SITE_URL, then meta.url. The address is never guessed; without one the card shows no host.
const siteUrl = process.env.SITE_URL || C.meta.url || '';
const host = siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** The inputs of the card, in a fixed order; build.mjs recomputes the same object. */
export const ogKey = () => ({
  name: P.name, nameZh: P.nameZh, position: P.position, affiliation: P.affiliation, location: P.location,
  interests: C.interests.map((i) => i.label), host,
  photo: createHash('sha1').update(readFileSync(join(ROOT, P.photo))).digest('hex').slice(0, 12),
});

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const curly = (s) => String(s).replace(/(\w)'(\w)/g, '$1’$2').replace(/'/g, '’');
const b64 = (f) => readFileSync(join(ROOT, f)).toString('base64');
const photoType = /\.png$/i.test(P.photo) ? 'image/png' : 'image/jpeg';

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "EB Garamond"; src: url(data:font/woff2;base64,${b64('assets/fonts/EBGaramond-Roman.woff2')}) format("woff2"); font-weight: 400 800; font-style: normal; }
@font-face { font-family: "EB Garamond"; src: url(data:font/woff2;base64,${b64('assets/fonts/EBGaramond-Italic.woff2')}) format("woff2"); font-weight: 400 800; font-style: italic; }
html, body { margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; background: #fffff8; color: #1d1b17; font-family: "EB Garamond", serif;
  font-variant-numeric: oldstyle-nums; -webkit-font-smoothing: antialiased; }
.frame { position: absolute; inset: 26px; border: 1px solid #e0dccf; }
.card { position: absolute; inset: 0; padding: 84px 92px 0; }
.text { max-width: 640px; }   /* clear of the photo, which now runs the full height of the card */
.kicker { font-size: 25px; letter-spacing: .2em; font-variant-caps: all-small-caps; color: #6b665c; white-space: nowrap; }
h1 { margin: 16px 0 0 -5px; font-size: 118px; font-weight: 400; line-height: 1; letter-spacing: -.012em; white-space: nowrap; }
.zh { margin-top: 16px; font-family: "Songti SC", "STSong", "Noto Serif CJK SC", serif; font-size: 36px; letter-spacing: .12em; color: #6b665c; }
.pos { margin-top: 26px; font-style: italic; font-size: 36px; line-height: 1.2; color: #45413a; }
.rule { width: 64px; height: 3px; margin-top: 32px; background: #8b1d1d; }
.int { margin-top: 24px; font-size: 27px; line-height: 1.38; color: #45413a; }
.int > span { white-space: nowrap; }
.int .dot { color: #8b1d1d; margin: 0 .14em 0 .38em; }   /* rides on the label before it, so a wrap never opens a line with "·" */
.host { position: absolute; left: 92px; bottom: 60px; font-size: 22px; letter-spacing: .2em; font-variant-caps: all-small-caps; color: #8b1d1d; }
/* 3:4, the photograph's own ratio, so the card shows all of it; top and bottom sit on the text margins */
.photo { position: absolute; top: 92px; right: 92px; width: 333px; height: 444px; box-sizing: border-box; border: 1px solid #e0dccf; background: #fff; padding: 10px; }
.photo img { display: block; width: 100%; height: 100%; object-fit: cover; }
</style></head><body>
<div class="frame"></div>
<div class="card">
  <div class="text">
    <div class="kicker">${esc(P.affiliation)} · ${esc(P.location)}</div>
    <h1>${esc(P.name)}</h1>
    <div class="zh" lang="zh-Hans">${esc(P.nameZh)}</div>
    <div class="pos">${esc(curly(P.position))}</div>
    <div class="rule"></div>
    <div class="int">${C.interests.map((i, k, all) => `<span>${esc(curly(i.label))}${k < all.length - 1 ? '<span class="dot">·</span>' : ''}</span>`).join(' ')}</div>
  </div>
  <div class="photo"><img src="data:${photoType};base64,${b64(P.photo)}" alt=""></div>
</div>
${host ? `<div class="host">${esc(host)}</div>` : ''}
</body></html>`;

/** Insert a tEXt chunk just before IEND. */
function withText(png, keyword, text) {
  const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'utf8')]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const type = Buffer.from('tEXt', 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0);
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, iend), len, type, data, crc, png.subarray(iend)]);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = mkdtempSync(join(tmpdir(), 'og-'));
  const page = join(dir, 'card.html');
  writeFileSync(page, html);
  const edge = await openEdge({ width: 1200, height: 630 });
  try {
    await edge.load(pathToFileURL(page).href);
    // Warn if a name is too long for one line rather than silently clipping it.
    const overflow = await edge.evaluate(`[...document.querySelectorAll('h1, .kicker')].some((e) => e.scrollWidth > e.clientWidth + 1) || document.querySelector('.int').getBoundingClientRect().bottom > 540`);
    if (overflow) console.warn('  ! some text does not fit its place on the card (long name, affiliation or interests); check the image');
    const shot = await edge.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
    const png = withText(Buffer.from(shot.result.data, 'base64'), 'og-key', JSON.stringify(ogKey()));
    writeFileSync(join(ROOT, 'assets/img/og-image.png'), png);
    console.log(`wrote assets/img/og-image.png (1200x630, ${(png.length / 1024).toFixed(0)} KB, host ${host || 'none'})`);
  } finally {
    edge.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
