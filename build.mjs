#!/usr/bin/env node
/*
 * Runxi Cheng — homepage generator.
 *
 *   node build.mjs
 *
 * Reads data/content.js (the single source of truth) and writes plain static files:
 *   index.html   the homepage (all content present without JavaScript)
 *   404.html     a small on-brand "not found" page (GitHub Pages serves it automatically)
 *   robots.txt, .nojekyll, and sitemap.xml once the public address is configured (meta.url or SITE_URL)
 *
 * Zero dependencies: Node 18+ only (developed on Node 22). No npm install needed.
 * Styles live in assets/css/style.css, enhancements in assets/js/main.js.
 */
import { readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ═════════════════════════ configuration ═════════════════════════ */

const ROOT = dirname(fileURLToPath(import.meta.url));
const C = (await import(pathToFileURL(join(ROOT, 'data', 'content.js')).href + `?t=${Date.now()}`)).default;
const warnings = [];                       // printed after the build; nothing here stops it
const warn = (msg) => warnings.push(msg);

// Public address of the site, used for the canonical / Open Graph / JSON-LD / sitemap URLs and the printed CV.
// Taken from the SITE_URL environment variable, else meta.url in content.js. It is never guessed: until it is
// configured, everything that needs an absolute address (canonical, og:url, the JSON-LD url, sitemap.xml, the
// address on printed copies) is left out and the build says so, rather than pointing at a host that may not exist.
const SITE_URL = process.env.SITE_URL || C.meta.url ? ensureSlash(process.env.SITE_URL || C.meta.url) : '';
if (!SITE_URL) warn('the public address is not configured, so the canonical link, og:url, the JSON-LD url/@id/image, sitemap.xml and the address on printed copies are left out. The social card is inert too: og:image/twitter:image need an absolute URL, so they are omitted and twitter:card falls back to "summary" — assets/img/og-image.png is unused until the host is set. 404.html falls back to treating the site as the root of its domain: it carries its own copy of the few styles it needs, so it looks right wherever it is served, but its link home points at "/", which is wrong if the site ends up at a project subpath (user.github.io/homepage/). Once it is confirmed, set meta.url in data/content.js (or run SITE_URL=https://… node build.mjs), then run node _tools/og.mjs, node build.mjs and node _tools/cv.mjs.');
// Prefix for local asset URLs in index.html ('' = relative to the page, e.g. "assets/css/style.css").
const BASE = '';
// How many news items to show before a "Show N earlier items" button (0 = always show all).
// The fold only appears when it would hide at least two items. Five keeps News to about half a phone screen,
// so Publications — the section most visitors come for — is reachable without a long scroll.
const NEWS_VISIBLE = 5;
// Author lists longer than this are shortened to their first AUTHORS_KEEP names (+ "and N more"), JS only.
const AUTHORS_COLLAPSE_OVER = 12;
const AUTHORS_KEEP = 6;

/* ═════════════════════════ setup & helpers ═════════════════════════ */

// "/" for a user site or a custom domain; used by 404.html, which is served at any depth.
const ROOT_PATH = SITE_URL ? new URL(SITE_URL).pathname : '/';
const SITE_HOST = SITE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');

function ensureSlash(u) { return u.endsWith('/') ? u : `${u}/`; }

// Browser UI colours (theme-color) are read from --paper in style.css, so there is a single source.
const CSS_TEXT = readFileSync(join(ROOT, 'assets/css/style.css'), 'utf8');
const THEME = (() => {
  const block = (re) => (re.exec(CSS_TEXT) || [])[1] || '';
  const paper = (b) => /--paper:\s*(#[0-9a-f]{3,8})/i.exec(b)?.[1];
  const light = paper(block(/:root\s*\{([^}]*)\}/));
  const darkMq = block(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/);
  const darkExplicit = block(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
  const norm = (b) => b.replace(/\s+/g, ' ').trim();
  if (norm(darkMq) !== norm(darkExplicit)) warn('style.css: the two dark-theme token blocks (prefers-color-scheme and [data-theme="dark"]) differ; keep them identical.');
  if (!light || !paper(darkExplicit)) warn('style.css: could not read --paper for the theme-color meta tags.');
  return { light: light || '#ffffff', dark: paper(darkExplicit) || '#000000' };
})();

const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isExternal = (u) => /^(https?:|mailto:|tel:|#|\/)/.test(u);
const asset = (u) => (isExternal(u) ? u : BASE + u);                 // relative URL for index.html
const absolute = (u) => (/^https?:/.test(u) ? u : SITE_URL + u.replace(/^\//, '')); // absolute URL for meta tags
const rel = (u) => (/^https?:/.test(u) ? ' rel="noopener"' : '');
const version = (f) => createHash('sha1').update(readFileSync(join(ROOT, f))).digest('hex').slice(0, 8); // cache-busting
const stripTags = (s) => s.replace(/<[^>]+>/g, '');
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ── a few rules lifted out of style.css, so 404.html can carry its own fallback styling ──
   Rules are copied VERBATIM from the stylesheet (never retyped here) and a missing selector is a build
   warning, so the inline copy cannot quietly drift away from the real one. See notFoundCss() below. */
function cssRule(selector) {
  const m = new RegExp(`^[ \\t]*${reEscape(selector)}\\s*\\{`, 'm').exec(CSS_TEXT);
  if (!m) { warn(`style.css: the rule "${selector}" has moved or been renamed, so the fallback styles inlined into 404.html are incomplete; update the list in build.mjs (notFoundCss).`); return ''; }
  let i = m.index + m[0].length;
  for (let depth = 1; i < CSS_TEXT.length && depth > 0; i++) {
    if (CSS_TEXT[i] === '{') depth++;
    else if (CSS_TEXT[i] === '}') depth--;
  }
  return CSS_TEXT.slice(m.index, i).replace(/^[ \t]+/gm, '').trim();
}

/* ── display typography (screen text only: never used for attributes that machines read, BibTeX, JSON-LD or meta) ── */
const NBSP = '\u00A0';
/** Curly quotes and apostrophes, plus no-break spaces that keep "ICML 2025", "arXiv 2025" and "Prof. Yuan" together.
 *  Works on raw or escaped text (&quot; pairs become “ ”). */
function smart(s) {
  return String(s)
    .replace(/(\w)'(\w)/g, '$1’$2')                     // Master's, don't
    .replace(/'(\d0s)\b/g, '’$1')                       // '90s
    .replace(/([\w.,;:!?)\]’])'/g, '$1’')               // closing quote, authors'
    .replace(/'/g, '‘')                                 // anything left opens a quote
    .replace(/(?:&quot;|")([^"&]*?)(?:&quot;|")/g, '“$1”')
    .replace(/\b([A-Z][A-Za-z]*[A-Z]\)?|arXiv) (\d{4})\b/g, `$1${NBSP}$2`) // venue + year
    .replace(/\b(Prof|Dr|Fig|Eq|No|Vol|pp)\. (?=\S)/g, `$1.${NBSP}`)
    .replace(/ ([—–])([ \u00A0])/g, `${NBSP}$1$2`);   // a spaced dash stays with the word before it, never opens a line
}
/** Mark hyphenated compounds so a line break treats them well. Escaped text in, HTML out.
 *  Two strengths. `nw` never breaks: a compound that a break would leave with a one- or two-letter stub (top-k, co-first,
 *  re-allocation), or that carries a figure or an acronym (CET-6, 2.8B-scale, WUDI-Merging, MoE-layer). `cpd` is every
 *  other compound (data-free, next-generation). It may break at its own hyphen, and only there (style.css): one
 *  unbreakable 15-letter word is enough to stretch the line before it into gaps. */
const keepTogether = (s) => s.replace(/[^\s<>]+/g, (w) => {
  const plain = w.replace(/&\w+;/g, '_');
  if (!/[\w)\]]-[\w(]/.test(plain) || plain.length > 20) return w;
  const parts = plain.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').split('-');
  const fragile = /\d/.test(plain) || parts[0].length <= 2 || parts.at(-1).length <= 2
    || parts.some((x) => (x.match(/\p{Lu}/gu) || []).length >= 2);
  return `<span class="${fragile ? 'nw' : 'cpd'}">${w}</span>`;
});
/** Plain text → typeset HTML. */
const tx = (s = '') => keepTogether(smart(esc(s)));
/** Names in hyphenated text never take a hyphen: the places on the CV (Microsoft Research Asia, Tencent) and any word
 *  written with a capital inside it (NeurIPS, arXiv, OptMerge, ImageNet, REVIVE). Chromium hyphenates no capitalised
 *  word anyway; Safari would print "Neur-IPS" and "Ten-cent". One `.proper` per name, so a line may still break
 *  between its words. Typeset HTML in; a compound (keepTogether) is already safe and is left alone. */
const PLACES = [...new Set([...C.experience.map((e) => e.org), ...C.education.map((e) => e.school)].filter(Boolean))];
const PLACE_RE = new RegExp(`(?<![\\p{L}\\p{N}-])(?:${PLACES.map(reEscape).join('|')})(?![\\p{L}\\p{N}-])`, 'gu');
const isCamel = (w) => /^[^-]*(?:\p{Ll}\p{Lu}|\p{Lu}{2})[^-]*$/u.test(w) && w.match(/\p{L}/gu).length >= 5;
const onText = (html, f) => html.replace(/(^|>)([^<]+)/g, (m, open, text) => open + f(text));
const keepNames = (html) => onText(onText(html, (t) => t.replace(PLACE_RE, '<span class="proper">$&</span>')),
  (t) => t.replace(/\S+/g, (w) => (isCamel(w) ? `<span class="proper">${w}</span>` : w)));
/** Plain text → typeset HTML for a hyphenated block. */
const txp = (s = '') => keepNames(tx(s));
/** Break points for the capitalised words of paper titles and venue lines, as in TeX's \hyphenation{}. Chromium never
 *  hyphenates a capitalised English word, so justified title case would otherwise open wide gaps whenever the next
 *  word does not fit. The points follow TeX's US English patterns (two letters before a break, three after); a word
 *  listed whole never breaks. The last word never breaks either: a title does not close on "thesis" any more than a
 *  paragraph closes on "ters." (`.end`). Compounds, acronyms and names (Self-Taught, OptMerge, Kendall's) are left
 *  alone. A new capitalised word of five letters or more gets a build warning.
 *  In a title the break point is an empty `.hy` whose soft hyphen is generated by the CSS, not a character in the
 *  text: a copied title, a search engine and the CV's text layer all get the word whole. A venue line and the
 *  earlier-title line keep a real soft hyphen instead (`txShy`), because VoiceOver on an iPhone reads each
 *  piece of a paragraph that an element splits as an item of its own ("Con", "fer", "ence on Neu"); a title sits in
 *  a heading and a link, which it reads whole. cv.mjs takes both kinds out before it prints. */
const CAP_BREAKS = new Map(`Adap-tive An-nual As-so-ci-a-tion Bud-get Ca-pa-bil-i-ties Char-ac-ter-i-za-tion Col-lapse
  Com-pu-ta-tional Con-di-tional Con-fer-ence Dif-fi-culty Dis-en-tan-gle-ment Dis-til-la-tion Ear-lier Edit-ing
  Em-pir-i-cal En-hanc-ing Es-ti-ma-tion Ex-perts Graft-ing Guid-ing Hard-ware Hi-er-ar-chi-cal In-for-ma-tion
  In-ter-fer-ence In-ter-na-tional Knowl-edge Lan-guage Large Learn-ing Lin-guis-tics Log-its Ma-chine Meet-ing
  Meth-ods Mem-ory Merg-ing Mit-i-ga-tion Mix-ture Modal-i-ties Model Mod-els Mul-ti-modal Nat-u-ral Neu-ral Neu-ron
  Off-line Pa-pers Prob-lems Pro-cess-ing Rank-ing Re-al-lo-ca-tion Rea-son-ers Rea-son-ing Rep-re-sen-ta-tions
  Sam-pling Scal-ing Se-quen-tial Should Spec-tral Stack Started Syn-the-sis Sys-tems Tech-ni-cal Train-ing Uni-fy-ing
  Vec-tors Weight Who-ever`.split(/\s+/).map((w) => [w.replace(/-/g, ''), w.split('-')]));
const SHY = '\u00AD';
const capBreaks = (s = '') => {
  const toks = String(s).split(' ');
  return toks.map((t, i) => t.replace(/^(\P{L}*)(\p{Lu}\p{Ll}{4,})(\P{L}*)$/u, (m, a, w, b) => {
    const parts = CAP_BREAKS.get(w);
    if (!parts) { warn(`"${w}" has no break points; add it to CAP_BREAKS in build.mjs (whole if it must not break)`); return m; }
    return a + (i === toks.length - 1 ? w : parts.join(SHY)) + b;
  })).join(' ');
};
const txBreaks = (s = '') => tx(capBreaks(s)).replaceAll(SHY, '<span class="hy"></span>');
const txShy = (s = '') => tx(capBreaks(s));
/** Bind a short last word to the one before it, so a paragraph does not end on a lone word ('author.').
 *  `pair` is for justified text (JUSTIFIED below), which is all of it since 2026-10-09. There the non-breaking space
 *  costs more: Chromium will not hyphenate the word before it, so binding "language model." moves both words down at
 *  once and leaves the line above them full of gaps. It binds only when the two words together are that short, or
 *  when the word before is a compound ("co-first author."): that breaks at its own hyphen or not at all
 *  (keepTogether), so the space takes nothing from it. */
const WIDOW = 14;
const JUSTIFIED = 9;
const isCompound = (w) => /[\p{L}\p{N}]-\p{L}/u.test(w);
const noWidow = (s = '', pair = Infinity) => String(s).trim()
  .replace(/(\S+) (\S{1,14})$/, (m, a, b) => (a.length + b.length <= pair || isCompound(a) ? a + NBSP + b : m));
/** The same for an HTML field (bio, news, points): the last space of the visible text, never one inside a tag. */
function noWidowHtml(html = '', pair = Infinity) {
  const parts = String(html).trim().split(/(<[^>]*>)/);   // odd indexes are tags
  let tail = 0;
  for (let i = parts.length - 1; i >= 0; i -= 2) {
    const t = parts[i], k = t.lastIndexOf(' ');
    if (k < 0) { tail += t.length; if (tail > WIDOW) return html; continue; }
    tail += t.length - k - 1;
    if (tail > WIDOW) return html;
    const before = parts.filter((x, j) => j % 2 === 0 && j < i).join('') + t.slice(0, k);
    const prev = /\S*$/.exec(before)[0];
    if (tail + prev.length > pair && !isCompound(prev)) return html;
    parts[i] = t.slice(0, k) + NBSP + t.slice(k + 1);
    return parts.join('');
  }
  return html;
}
/** Justified prose: the last four words of a paragraph are never hyphenated. So it cannot end on a fragment such as
 *  "ters.", and a short last line does not open with one ("sta- / bility and efficiency."); the CSS property for
 *  that, hyphenate-limit-last, is not in Chromium. Measured on this page against the last word alone: half as many
 *  such lines, for one or two more lines with wide gaps. Typeset HTML in. The words may sit inside closing tags
 *  (`<b>…</b>`) and contain compounds (keepTogether); text that ends in "</b>." is left as it is. */
const END_WORDS = 4;
const END_TOKEN = '(?:<span class="(?:cpd|nw|proper)">[^<>]*</span>|[^<>\\s])+';
const END_RE = new RegExp(`(?<=^|[\\s>])((?:${END_TOKEN}[ \\u00A0]+){0,${END_WORDS - 1}}${END_TOKEN})((?:</[a-z]+>)*\\s*)$`);
const endWord = (html) => html.replace(END_RE, (m, w, close) => (
  !/\s/.test(w) && w.length < 6 ? m : `<span class="end">${w}</span>${close}`));   // one word under six letters never hyphenates (6 3 3)
/** HTML field (bio, news, points) → the same treatment applied to its text nodes only. */
const txh = (html = '') => keepNames(onText(String(html), (text) => keepTogether(smart(text))));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** '2025.02' → <time datetime="2025-02">Feb 2025</time>, '2026' → <time datetime="2026">2026</time>; anything else
 *  (e.g. 'Present') is returned as text. */
function time(s) {
  const m = /^(\d{4})(?:[.-](\d{2}))?$/.exec(s.trim());
  if (!m) return esc(s.trim());
  return m[2] ? `<time datetime="${m[1]}-${m[2]}">${MONTHS[+m[2] - 1]} ${m[1]}</time>` : `<time datetime="${m[1]}">${m[1]}</time>`;
}
/** '2025.02 – 2026.02' → two <time>s joined by an en dash. */
const period = (p) => p.split(/\s*[–-]\s*(?=\d{4}|Present)/).map(time).join('<span class="dash">–</span>');

/** Intrinsic image size (PNG header / JPEG SOF / SVG viewBox) so every <img> gets width + height (no layout shift). */
function imgSize(file) {
  const f = join(ROOT, file);
  if (!existsSync(f)) { console.warn(`  ! missing image: ${file}`); return { w: 0, h: 0 }; }
  const b = readFileSync(f);
  if (/\.png$/i.test(file)) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (/\.webp$/i.test(file) && b.toString('latin1', 8, 12) === 'WEBP') {
    const kind = b.toString('latin1', 12, 16);
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  }
  if (/\.svg$/i.test(file)) {
    const vb = /viewBox="\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(b.toString('utf8', 0, 3000));
    if (vb) return { w: 1200, h: Math.round((+vb[2] / +vb[1]) * 1200) };
  }
  if (/\.jpe?g$/i.test(file)) {
    for (let i = 2; i < b.length;) {
      if (b[i] !== 0xff) break;
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return { w: 0, h: 0 };
}

/* ═════════════════════════ icons (inline SVG, inherit currentColor) ═════════════════════════ */

const svg = (body, fill = false) =>
  `<svg class="i" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"${fill ? ' fill="currentColor"' : ' fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;
const I = {
  email: svg('<rect x="3" y="5.5" width="18" height="13" rx="1.5"/><path d="m3.6 6.6 8.4 6.6 8.4-6.6"/>'),
  scholar: svg('<path d="M12 3 1.5 9.4 12 15.8l8.2-5v5.4H22V9.4z"/><path d="M5.4 13.2v4c1.7 2.1 4 3.3 6.6 3.3s4.9-1.2 6.6-3.3v-4L12 17.2z"/>', true),
  github: svg('<path d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-1.9c-3.12.68-3.78-1.33-3.78-1.33-.51-1.3-1.25-1.64-1.25-1.64-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.4-1.22.72-1.5-2.49-.28-5.1-1.25-5.1-5.54 0-1.22.43-2.22 1.15-3-.11-.29-.5-1.43.11-2.97 0 0 .94-.3 3.08 1.15a10.7 10.7 0 0 1 5.62 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.54.23 2.68.11 2.97.72.78 1.15 1.78 1.15 3 0 4.3-2.62 5.25-5.12 5.53.4.35.76 1.03.76 2.08v3.09c0 .3.2.65.78.54A11.2 11.2 0 0 0 12 .8Z"/>', true),
  web: svg('<circle cx="12" cy="12" r="8.75"/><path d="M3.25 12h17.5M12 3.25c2.4 2.5 3.6 5.4 3.6 8.75s-1.2 6.25-3.6 8.75c-2.4-2.5-3.6-5.4-3.6-8.75S9.6 5.75 12 3.25z"/>'),   // a globe: the homepage
  dblp: svg('<path d="M4.5 4.5h3.2v15H4.5zM9.9 4.5h3.2v15H9.9z"/><path d="m15.2 5.3 3-.8 3.4 14.2-3 .8z"/>'),       // a shelf of books: a bibliography database
  cv: svg('<path d="M12 3.5v11.5m-4.5-4.5L12 15l4.5-4.5"/><path d="M4.5 16.5v2.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5"/>'), // download
  paper: svg('<path d="M2.8 5.6c3-1 6.1-.6 9.2 1.3 3.1-1.9 6.2-2.3 9.2-1.3v13.1c-3-1-6.1-.6-9.2 1.3-3.1-1.9-6.2-2.3-9.2-1.3z"/><path d="M12 6.9V20"/>'), // open proceedings
  arxiv: svg('<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14.5 3.5V8H19M9 12h7M9 15.2h7M9 18.4h4.5"/>'),                           // preprint page
  pdf: svg('<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14.5 3.5V8H19"/><path d="M12.5 10.5v6.5m-2.6-2.6 2.6 2.6 2.6-2.6"/>'),       // page + download
  code: svg('<path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.6 4.8l-3.2 14.4"/>'),
  abstract: svg('<path d="M4 6h16M4 10h16M4 14h16M4 18h10"/>'),
  bibtex: svg('<path d="M9 4c-2 0-3 1-3 3v2c0 1.2-.8 2-2 2 1.2 0 2 .8 2 2v2c0 2 1 3 3 3M15 4c2 0 3 1 3 3v2c0 1.2.8 2 2 2-1.2 0-2 .8-2 2v2c0 2-1 3-3 3"/>'),  // a pair of braces: { }
  chevron: svg('<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="1.5"/><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  expand: svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
};

/* ═════════════════════════ data preparation ═════════════════════════ */

const P = C.person;
const OWNER = P.name;
const linkBy = (key) => P.links.find((l) => l.key === key);

// Publications are grouped by status; accepted work first. Within a group, papers on which the owner is first or
// co-first author come first, then newest first (ties keep their order in content.js). Entries the owner is not an
// author of (a role such as 'Contributor', name not on the byline) are listed apart, under "Other Contributions",
// so the groups above contain authored papers only. The bibliography numbers [n] follow this order and never change
// (not even when filtering), so the cross-references in News and Experience stay valid on screen and in print.
const onByline = (p) => p.authors.some((a) => a.replace(/\*+$/, '').trim() === OWNER);
const isContribution = (p) => Boolean(p.role) && !onByline(p);
const GROUPS = [
  { status: 'published', one: 'Conference Paper', many: 'Conference Papers' },
  { status: 'preprint', one: 'Preprint', many: 'Preprints' },
  { status: 'report', one: 'Technical Report', many: 'Technical Reports' },
  { status: 'contribution', one: 'Other Contributions', many: 'Other Contributions' },
];
const statusOf = (p) => (isContribution(p) ? 'contribution' : p.status);
/** 'first author' | 'co-first author' | '' — read from the byline ('*' = equal contribution), firstAuthor as a fallback.
 *  Equal contribution means the owner and at least one other author are starred and everyone before him is starred,
 *  so "Runxi Cheng*, Feng Xiong*" is co-first even though he is listed first — unless the paper sets `authorRole`,
 *  which always wins, because which of several equal contributors counts as "the" first author is the owner's call. */
function ownerRole(p) {
  if (p.authorRole !== undefined) return p.authorRole;
  const i = p.authors.findIndex((a) => a.replace(/\*+$/, '').trim() === OWNER);
  if (i < 0) return '';
  const star = (a) => /\*$/.test(a);
  if (star(p.authors[i]) && p.authors.some((a, j) => j !== i && star(a)) && p.authors.slice(0, i).every(star)) return 'co-first author';
  if (i === 0) return 'first author';
  return p.firstAuthor ? 'co-first author' : '';
}
const byRank = (list) => list.map((p, i) => ({ p, i }))
  .sort((a, b) => (ownerRole(a.p) ? 0 : 1) - (ownerRole(b.p) ? 0 : 1) || (b.p.year || 0) - (a.p.year || 0) || a.i - b.i)
  .map(({ p }) => p);
const groupPubs = new Map(GROUPS.map((g) => [g.status, byRank(C.publications.filter((p) => statusOf(p) === g.status))]));
const pubsOrdered = GROUPS.flatMap((g) => groupPubs.get(g.status));
const pubNo = new Map(pubsOrdered.map((p, i) => [p.id, i + 1]));
const pubById = new Map(C.publications.map((p) => [p.id, p]));
const groupOf = (p) => GROUPS.find((g) => g.status === statusOf(p));
const refN = (n) => `<span class="cite-n"><span aria-hidden="true">[${n}]</span><span class="vh">reference ${n}</span></span>`;

// PMLR keeps its proceedings PDFs on raw.githubusercontent.com, which often does not load from mainland China
// (much of this page's audience). When a paper also has an arXiv version, its "PDF" link goes to the arXiv PDF
// instead; "Paper" still opens the proceedings page. content.js keeps the original address.
const SLOW_PDF_HOST = /^https?:\/\/raw\.githubusercontent\.com\//i;
const buildNotes = new Set();              // informational lines printed after the build
function linksOf(p) {
  const l = { ...(p.links || {}) };
  const id = l.arxiv && /arxiv\.org\/(?:abs|pdf)\/([^?#\s]+?)(?:v\d+)?(?:\.pdf)?$/i.exec(l.arxiv)?.[1];
  if (l.pdf && SLOW_PDF_HOST.test(l.pdf) && id) {
    l.pdf = `https://arxiv.org/pdf/${id}`;
    buildNotes.add(`[${pubNo.get(p.id)}] ${p.short || p.id}: PDF link served from arXiv (${l.pdf}) instead of raw.githubusercontent.com`);
  }
  return l;
}

/** A bibliography cross-reference such as "[7]" (optionally preceded by the paper's short name). */
function cite(id, { withShort = false } = {}) {
  const p = pubById.get(id);
  if (!p) { console.warn(`  ! unknown paper id: ${id}`); return ''; }
  const n = pubNo.get(id);
  const name = withShort ? `<span class="cite-name">${tx(p.short)}</span>${p.role ? ` <span class="cite-role">(${tx(p.role.toLowerCase())})</span>` : ''} ` : '';
  return `<a class="cite" href="#pub-${esc(id)}">${name}${refN(n)}</a>`;
}

/** Which publication (if any) does a bold phrase in a news item name? Short name first, then title words. */
function pubForPhrase(phrase, hintId) {
  const plain = phrase.replace(/\u00A0/g, ' ').trim();
  const words = plain.split(/\s+/).length;
  const bySpecificity = [pubById.get(hintId), ...C.publications].filter(Boolean);
  return bySpecificity.find((p) => {
    if (!p.short) return false;
    if (plain.toLowerCase() === p.short.toLowerCase()) return true;
    if (new RegExp(`(^|[^\\w-])${reEscape(p.short)}($|[^\\w-])`).test(plain)) return true;
    return words >= 3 && p.title.toLowerCase().includes(plain.toLowerCase());
  });
}

/** News text with each paper name turned into a link to its bibliography entry, e.g. "Memory Grafting [6]". */
function newsText(n) {
  const used = new Set();
  let html = noWidowHtml(n.text, JUSTIFIED).replace(/<b>(.*?)<\/b>/g, (whole, inner) => {
    const p = pubForPhrase(stripTags(inner), n.paper);
    if (!p || used.has(p.id)) return whole;
    used.add(p.id);
    return `<a class="xref" href="#pub-${esc(p.id)}"><b>${inner}</b>${NBSP}${refN(pubNo.get(p.id))}</a>`;
  });
  html = txh(html);
  // A citation that closes the item ends the line anyway; otherwise the last word must not hyphenate (endWord).
  return n.paper && !used.has(n.paper) ? `${html} ${cite(n.paper)}` : endWord(html);
}

const lastUpdated = (() => {
  const m = /^(\d{4})-(\d{2})/.exec(C.meta.lastUpdated || '');
  return m ? { iso: `${m[1]}-${m[2]}`, text: `${MONTHS_LONG[+m[2] - 1]} ${m[1]}`, year: m[1] } : { iso: '', text: C.meta.lastUpdated || '', year: String(new Date().getFullYear()) };
})();

/* ═════════════════════════ section renderers ═════════════════════════ */

const secHead = (id, title, side = '', below = '') =>
  `<header class="sec-head row">${below ? `<div class="main"><h2 id="${id}-h">${esc(title)}</h2>${below}</div>` : `<h2 id="${id}-h" class="main">${esc(title)}</h2>`}${side ? `<div class="side">${side}</div>` : ''}</header>`;

/** Set the first few words of the bio in small caps — the book-typography "lead-in". */
function leadIn(html) {
  const plain = html.split('<')[0];
  const words = plain.split(/\s+/);
  let n = Math.min(5, words.length - 1);
  // Never end the lead-in on an abbreviation ("… by Prof." then "Chun Yuan"): the full stop reads as a
  // sentence break, so the small caps look like they stopped in the wrong place. Back off a word instead.
  while (n > 2 && /\.$/.test(words[n - 1])) n--;
  if (n < 2) return html;
  const lead = words.slice(0, n).join(' ');
  return `<span class="lead-in">${lead}</span>${html.slice(lead.length)}`;
}

function contactLinks() {
  return P.links.map((l) => {
    const isPdf = /\.pdf$/i.test(l.url);
    const text = l.key === 'email' ? l.url.replace(/^mailto:/, '') : l.label;
    const cls = ['email', 'cv'].includes(l.key) ? ` class="${l.key}"` : '';
    const extra = isPdf ? `<span class="fmt">PDF</span>` : '';
    return `<li${cls}><a href="${esc(asset(l.url))}"${rel(l.url)}${isPdf ? ' type="application/pdf"' : ''}>${I[l.key] || ''}<span class="lbl">${esc(text)}</span>${extra}</a></li>`;
  }).join('') +
    // Printed copies (the page doubles as a CV) also carry the homepage address, once it is configured.
    (SITE_URL ? `<li class="web print-only"><a href="${esc(SITE_URL)}">${I.web}<span class="lbl">Homepage</span></a></li>` : '');
}

function about() {
  const ph = imgSize(P.photo);
  const bio = C.bio.map((para, i) => `<p>${endWord(txh(i === 0 ? leadIn(noWidowHtml(para, JUSTIFIED)) : noWidowHtml(para, JUSTIFIED)))}</p>`).join('\n        ');
  const topics = (it) => (it.topics?.length ? `<ul class="int-topics">${it.topics.map((t) => `<li>${tx(t)}</li>`).join('')}</ul>` : '');
  const interests = C.interests.map((it) => `<li><span class="int-label">${tx(it.label)}</span>${topics(it)}</li>`).join('');
  return `<section id="about" class="sec sec-about" aria-labelledby="about-h">
    <div class="row intro">
      <div class="main">
        <h1 id="about-h" class="name"><span class="name-en">${esc(P.name)}</span> <span class="name-zh" lang="zh-Hans">${esc(P.nameZh)}</span></h1>
        <p class="standfirst"><span class="position">${tx(P.position)}</span> <span class="aff">${esc(P.affiliation)}<span class="sep" aria-hidden="true"> · </span><span class="loc">${esc(P.location)}</span></span></p>
        <ul class="contact" aria-label="Contact and profiles">${contactLinks()}</ul>
      </div>
      <div class="side">
        <figure class="portrait"><img src="${esc(asset(P.photo))}" alt="Portrait of ${esc(P.name)}" width="${ph.w}" height="${ph.h}" decoding="async" fetchpriority="high"></figure>
      </div>
    </div>
    <div class="row">
      <div class="main prose bio">
        ${bio}
      </div>
      <aside class="side interests" aria-labelledby="interests-h">
        <h2 id="interests-h" class="side-h">Research Interests</h2>
        <ul>${interests}</ul>
      </aside>
    </div>
  </section>`;
}

function news() {
  const limit = NEWS_VISIBLE > 0 && C.news.length > NEWS_VISIBLE + 1 ? NEWS_VISIBLE : C.news.length;
  const hidden = C.news.length - limit;
  const items = C.news.map((n, i) => `
        <li class="news-item${i >= limit ? ' news-older' : ''}"><span class="news-date">${time(n.date)}</span><p>${newsText(n)}</p></li>`).join('');
  const more = hidden ? `
      <button type="button" class="more" aria-expanded="false" aria-controls="news-list" data-more="Show ${hidden} earlier item${hidden > 1 ? 's' : ''}" data-less="Show fewer" hidden>${I.chevron}<span>Show ${hidden} earlier item${hidden > 1 ? 's' : ''}</span></button>` : '';
  return `<section id="news" class="sec" aria-labelledby="news-h">
    ${secHead('news', 'News')}
    <div class="row row-wide"><div class="main">
      <ol class="news" id="news-list">${items}
      </ol>${more}
    </div></div>
  </section>`;
}

/** Author byline: owner highlighted, "*" → superscript with an accessible "(equal contribution)". */
function authorsHTML(p) {
  const names = p.authors.map((a) => {
    const eq = /\*$/.test(a);
    const name = a.replace(/\*+$/, '').trim();
    const me = name === OWNER;
    return `<span class="au"><span class="nm${me ? ' me' : ''}">${smart(esc(name))}</span>${eq ? '<sup class="eq"><span aria-hidden="true">*</span><span class="vh"> (equal contribution)</span></sup>' : ''}</span>`;
  });
  return names.map((s, i) => (i < names.length - 1 ? s.replace(/<\/span>$/, ',</span>') : s)).join(' ');
}

/** BibTeX with a hanging indent: each line is a block whose wrapped continuation aligns after "key = {".
 *  The text content (and thus Copy) is unchanged — each span keeps its own trailing newline. */
function bibLines(src) {
  return src.replace(/\s+$/, '').split('\n').map((line, i, arr) => {
    const m = /^(\s*[\w-]+\s*=\s*\{?|\s*@\w+\{|\s*)/.exec(line);
    const hang = Math.min(m ? m[0].length : 0, 16);
    return `<span class="bl" style="--h:${hang}ch">${esc(line)}${i < arr.length - 1 ? '\n' : ''}</span>`;
  }).join('');
}

const STOP = new Set(['the', 'a', 'an', 'at', 'on', 'of', 'in', 'and', 'for', 'to']);
const words = (s) => stripTags(String(s)).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
  .filter((w) => w && !STOP.has(w)).map((w) => w.replace(/s$/, ''));
/** Badge text: the venue — or, when the venue is only a kind of publication ("Preprint", "Technical Report"),
 *  where and when the paper appeared ("arXiv 2025"). */
const GENERIC_VENUE = /^(preprint|technical report|report|working paper)$/i;
function badgeName(p) {
  const g = groupOf(p);
  const v = p.venue.trim();
  if (GENERIC_VENUE.test(v) || (g && v.toLowerCase() === g.one.toLowerCase())) return `${p.links?.arxiv ? 'arXiv' : v} ${p.year || ''}`.trim();
  return v;
}
/** The long venue line is left off screen when it only restates the badge and the group heading
 *  (it is kept for print, where the badges are not shown). */
function whereIsRedundant(p) {
  const shownVenue = badgeName(p) === p.venue.trim() ? p.venue : '';
  const known = new Set(words(`${badgeName(p)} ${shownVenue} ${p.venueNote || ''} ${groupOf(p)?.many || ''} arxiv ${p.year || ''}`));
  return words(p.venueFull || p.venue).every((w) => known.has(w));
}

/** Venue badge: accepted = solid accent outline; Oral = filled note; under review = dashed, muted; report = neutral. */
function venueBadge(p) {
  const note = (p.venueNote || '').trim();
  const kind = p.status === 'published' ? (/oral|spotlight|best/i.test(note) ? 'oral' : 'accepted') : p.status === 'report' ? 'report' : 'review';
  return `<span class="venue v-${kind}"><span class="v-name">${tx(badgeName(p))}</span>${note ? `<span class="v-note">${tx(note)}</span>` : ''}</span>`;
}

const LINKS = [['paper', 'Paper'], ['arxiv', 'arXiv'], ['pdf', 'PDF'], ['code', 'Code']];

/** A lighter WebP rendition made by _tools/thumbs.mjs (assets/papers/thumbs/<name>.webp); the original stays the
 *  full-size file behind the lightbox. Raster teasers without a current thumbnail produce a build warning. */
function thumbFor(file) {
  const thumb = `assets/papers/thumbs/${basename(file, extname(file))}.webp`;
  const src = join(ROOT, file), t = join(ROOT, thumb);
  if (!existsSync(t)) {
    if (/\.(png|jpe?g)$/i.test(file)) warn(`no thumbnail for ${file}; run node _tools/thumbs.mjs`);
    return '';
  }
  if (existsSync(src) && statSync(t).mtimeMs < statSync(src).mtimeMs) warn(`thumbnail older than ${file}; run node _tools/thumbs.mjs`);
  return thumb;
}

/** An optional high-resolution rendition for the lightbox, assets/papers/full/<name>.webp (or .png/.jpg), e.g. a
 *  figure rendered from the paper's vector source at 3× (see README). It is only fetched when the figure is opened. */
function fullFor(file) {
  const base = basename(file, extname(file));
  return ['.webp', '.png', '.jpg'].map((x) => `assets/papers/full/${base}${x}`).find((f) => existsSync(join(ROOT, f))) || '';
}

function figure(p) {
  if (!p.teaser) return '';
  const { w, h } = imgSize(p.teaser);
  const caption = p.teaserCaption || '';
  // The caption is the figure's description, so it is also the alt text (and the name of the link that enlarges it).
  const alt = caption || `Figure from “${p.title}”`;
  const thumb = thumbFor(p.teaser);
  const img = `<img src="${esc(asset(p.teaser))}" alt="${esc(smart(alt))}" width="${w}" height="${h}" loading="lazy" decoding="async">`;
  const pic = thumb ? `<picture><source type="image/webp" srcset="${esc(asset(thumb))}">${img}</picture>` : img;
  // The lightbox never enlarges a bitmap beyond its own pixels: data-lb-w/h is the largest sharp size in CSS px
  // (a high-resolution rendition counts at 2×, for retina screens). Vector figures scale freely.
  const isVector = /\.svg$/i.test(p.teaser);
  const full = isVector ? '' : fullFor(p.teaser);
  const big = full ? imgSize(full) : null;
  const lb = isVector ? '' : big ? ` data-lb-w="${Math.round(big.w / 2)}" data-lb-h="${Math.round(big.h / 2)}"` : ` data-lb-w="${w}" data-lb-h="${h}"`;
  const link = `<a class="plate-link" href="${esc(asset(full || p.teaser))}" data-caption="${esc(smart(caption))}"${lb}>${pic}<span class="plate-hint" aria-hidden="true">${I.expand}Enlarge</span></a>`;
  if (p.teaserWide) {
    // Wide figures run across the main column (Tufte's full-width figure) with their caption in the margin.
    return `
        <figure class="plate plate-wide" style="--ar:${w}/${h}">
          ${link}${caption ? `
          <figcaption><span class="fig-label">Figure</span> ${txp(noWidow(caption, JUSTIFIED))}</figcaption>` : ''}
        </figure>`;
  }
  // A figure more than twice as wide as the 16:10 card would fill less than half of it; that card hugs the figure.
  const hug = w / h > 2 * 16 / 10;
  return `
          <figure class="plate${hug ? ' plate-hug" style="--ar:' + w + '/' + h : ''}">${link}</figure>`;
}

function pubItem(p) {
  const n = pubNo.get(p.id);
  // The margin carries the venue badge and the owner's part (first / co-first author). An entry under "Other
  // Contributions" has neither: the heading already says what it is, and its venue line stays in view instead.
  const contrib = isContribution(p);
  const role = ownerRole(p);
  const links = linksOf(p);
  const primary = links.paper || links.arxiv || links.pdf;
  const title = primary ? `<a href="${esc(primary)}"${rel(primary)}>${txBreaks(p.title)}</a>` : txBreaks(p.title);
  const collapsible = p.authors.length > AUTHORS_COLLAPSE_OVER;
  const auId = `au-${p.id}`, absId = `abs-${p.id}`, bibId = `bib-${p.id}`;
  const more = collapsible ? ` <button type="button" class="au-more" aria-expanded="false" aria-controls="${auId}" data-keep="${AUTHORS_KEEP}" hidden>and ${p.authors.length - AUTHORS_KEEP} more</button>` : '';
  // Topics sit under the TL;DR, like a paper's keywords. Each separator belongs to the tag after it, so a wrapped
  // line never ends on a dangling "·".
  const tags = p.tags?.length ? `
          <p class="pub-tags"><span class="vh">Topics: </span>${p.tags.map((t, i) => (i
    ? ` <span class="tag"><span class="sep" aria-hidden="true">·</span>${NBSP}<span class="vh">, </span>${tx(t)}</span>`
    : `<span class="tag">${tx(t)}</span>`)).join('')}</p>` : '';
  const row = LINKS.filter(([k]) => links[k]).map(([k, label]) =>
    `<a class="pl" href="${esc(links[k])}"${rel(links[k])}>${I[k]}<span>${label}</span></a>`);
  // Abstract and BibTeX are native disclosures (<details>), so they start closed and open without JavaScript too.
  // With JavaScript, buttons in the links row drive them and the panels open below the whole row.
  const toggle = (id, icon, label) => `<button type="button" class="pl pl-toggle" aria-expanded="false" aria-controls="${id}" hidden>${icon}<span>${label}</span>${I.chevron}</button>`;
  const summary = (icon, label) => `<summary class="pl">${icon}<span>${label}</span>${I.chevron}</summary>`;
  const panels = [];
  if (p.abstract) {
    row.push(toggle(absId, I.abstract, 'Abstract'));
    panels.push(`
            <details class="pub-panel pub-abs" id="${absId}">${summary(I.abstract, 'Abstract')}
              <p class="abs-text">${endWord(txp(noWidow(p.abstract, JUSTIFIED)))}</p>
            </details>`);
  }
  if (p.bibtex) {
    row.push(toggle(bibId, I.bibtex, 'BibTeX'));
    panels.push(`
            <details class="pub-panel pub-bib" id="${bibId}">${summary(I.bibtex, 'BibTeX')}
              <div class="panel-bar"><p class="panel-h">BibTeX</p><button type="button" class="copy" data-copy="${bibId}" hidden>${I.copy}<span>Copy</span></button></div>
              <pre><code>${bibLines(p.bibtex)}</code></pre>
            </details>`);
  }
  // A note on the byline (e.g. why the owner's name is not on it): one quiet italic line under the authors.
  const note = p.authorsNote ? `
          <p class="pub-note">${endWord(txp(noWidow(p.authorsNote, JUSTIFIED)))}</p>` : '';
  const dup = !contrib && whereIsRedundant(p);
  const meta = contrib ? '' : `
          <p class="pub-meta"><span class="pub-venue">${venueBadge(p)}</span>${role ? `<span class="vh">, </span><span class="pub-role">${esc(role)}</span>` : ''}</p>`;
  const plate = p.teaserWide ? '' : figure(p);
  return `
      <li class="pub${p.teaserWide ? ' pub--wide' : ''}${contrib ? ' pub--contrib' : ''}${meta || plate || p.teaserWide ? '' : ' pub--bare'}" id="pub-${esc(p.id)}" data-selected="${p.selected ? 'true' : 'false'}"${ownerRole(p) ? ' data-first="true"' : ''}>
        <span class="pub-n">[${n}]</span>
        <div class="pub-head">
          <h4 class="pub-title">${title}</h4>${p.titleAlt ? `
          <p class="pub-alt">${txShy(noWidow(p.titleAlt, JUSTIFIED))}</p>` : ''}
          <p class="pub-authors${p.role ? ' is-byline' : ''}" id="${auId}"><span class="vh">${p.role ? 'Author byline: ' : 'Authors: '}</span>${authorsHTML(p)}${more}</p>
          <p class="pub-where${dup ? ' is-dup' : ''}">${txShy(noWidow(p.venueFull || p.venue, JUSTIFIED))}</p>${note}
        </div>${meta || plate ? `
        <div class="pub-side">${meta}${plate}
        </div>` : ''}${p.teaserWide ? figure(p) : ''}
        <div class="pub-body">${p.tldr ? `
          <p class="pub-tldr"><span class="tldr">TL;DR</span> ${endWord(txp(noWidow(p.tldr, JUSTIFIED)))}</p>` : ''}${tags}
          <div class="pub-links">${row.join('')}${panels.join('')}
          </div>
        </div>
      </li>`;
}

function publications() {
  const total = C.publications.length;
  const selected = C.publications.filter((p) => p.selected).length;
  const notes = `
        <p class="legend"><span class="ast" aria-hidden="true">*</span> Equal contribution</p>
        <p class="vh" id="pub-status" aria-live="polite"></p>`;
  // With JavaScript the list opens on "Selected" (the head script adds .pubs-sel before first paint);
  // without it every paper is shown and the filter stays hidden.
  const filter = selected && selected < total ? `
        <div class="filter" role="group" aria-label="Show publications" hidden>
          <button type="button" data-filter="selected" aria-pressed="false">Selected <span class="count">${selected}</span></button>
          <button type="button" data-filter="all" aria-pressed="true">All <span class="count">${total}</span></button>
        </div>` : '';
  const groups = GROUPS.map((g) => {
    const ps = groupPubs.get(g.status);
    if (!ps.length) return '';
    return `
    <div class="pub-group" data-group="${g.status}" data-has-selected="${ps.some((p) => p.selected)}">
      <h3 class="group-h">${ps.length === 1 ? g.one : g.many} <span class="g-count">(<span class="g-n" data-total="${ps.length}">${ps.length}</span><span class="vh"> ${ps.length === 1 ? 'paper' : 'papers'}</span>)</span></h3>
      <ol class="bib" start="${pubNo.get(ps[0].id)}">${ps.map(pubItem).join('')}
      </ol>
    </div>`;
  }).join('');
  return `<section id="publications" class="sec" aria-labelledby="publications-h">
    ${secHead('publications', 'Publications', notes, filter)}${groups}
  </section>`;
}

const points = (arr) => (arr?.length ? `<ul class="points">${arr.map((t) => `<li>${endWord(txh(noWidowHtml(t, JUSTIFIED)))}</li>`).join('')}</ul>` : '');
const metaSide = (e) => `<div class="side meta"><span class="when">${period(e.period)}</span>${e.location ? `<span class="where">${esc(e.location)}</span>` : ''}</div>`;

function experience() {
  const items = C.experience.map((e) => {
    const outputs = [...(e.outputs || [])].filter((id) => pubNo.has(id)).sort((a, b) => pubNo.get(a) - pubNo.get(b));
    return `
      <li class="entry row">
        <div class="main">
          <h3 class="entry-h">${tx(e.org)}</h3>
          <p class="entry-sub"><em>${tx(e.role)}</em>${e.unit ? `, ${tx(e.unit)}` : ''}</p>
          ${points(e.points)}${outputs.length ? `
          <p class="outputs"><span class="label">Related work</span> ${outputs.map((id) => cite(id, { withShort: true })).join('<span class="sep">, </span>')}</p>` : ''}
        </div>
        ${metaSide(e)}
      </li>`;
  }).join('');
  return `<section id="experience" class="sec" aria-labelledby="experience-h">
    ${secHead('experience', 'Research Experience')}
    <ol class="entries cv">${items}
    </ol>
  </section>`;
}

/** "Big Data Analysis (A-)" → the grade bound to its course with a no-break space; "A-" is set with a true minus sign. */
const courses = (s) => tx(s.replace(/ \(([A-D][+-]?|\d{1,3})\)/g, (m, g) => `${NBSP}(${g.replace(/-$/, '−')})`));

function education() {
  const items = C.education.map((e) => `
      <li class="entry row">
        <div class="main">
          <h3 class="entry-h">${tx(e.school)}</h3>
          <p class="entry-sub"><em>${tx(e.degree)}</em></p>${e.courses ? `
          <p class="courses"><span class="label">Coursework</span> ${courses(e.courses)}</p>` : ''}
        </div>
        ${metaSide(e)}
      </li>`).join('');
  return `<section id="education" class="sec" aria-labelledby="education-h">
    ${secHead('education', 'Education')}
    <ol class="entries cv">${items}
    </ol>
  </section>`;
}

function honors() {
  // One pattern per row, like Experience and Education: the honour and its awarding body in the reading column
  // ("Award, Organisation"), the year in the margin. The body is left out when the title already names it
  // ("… of Tsinghua University", "Beihang “Qixian Cup”"); an acronym such as CUMCM follows in parentheses.
  const GENERIC = /^(the|of|university|college|institute|school|national|academy)$/i;
  // The year margin is all-or-nothing: with only some years filled in, the gaps read as missing data rather
  // than as a deliberate list. Fill in every `year` in content.js and the column comes back on its own.
  const dated = C.honors.every((h) => h.year);
  if (!dated) {
    const missing = C.honors.filter((h) => !h.year);
    warn(`${missing.length} of ${C.honors.length} honors have no year, so the year column is left out entirely `
      + `(a half-filled margin reads as missing data). Add "year" to each of these in data/content.js and it returns: `
      + missing.map((h) => `“${h.title}”`).join(', '));
  }
  const items = C.honors.map((h) => {
    const org = (h.org || '').trim();
    const key = org.split(/\s+/).find((w) => !GENERIC.test(w)) || org;
    const named = !org || h.title.toLowerCase().includes(key.toLowerCase());
    const orgHtml = named ? '' : /^[A-Z&]{2,}$/.test(org)
      ? `${NBSP}<span class="org">(${esc(org)})</span>`
      : `<span class="sep">, </span><span class="org">${txp(noWidow(org, JUSTIFIED))}</span>`;
    const year = dated ? `<span class="when"><time datetime="${esc(h.year)}">${esc(h.year)}</time></span>` : '';
    return `
      <li class="honor row${dated ? '' : ' is-undated'}">
        <p class="main"><span class="honor-t">${txp(orgHtml ? h.title : noWidow(h.title, JUSTIFIED))}</span>${orgHtml}</p>${dated ? `
        <div class="side meta">${year}</div>` : ''}
      </li>`;
  }).join('');
  return `<section id="honors" class="sec" aria-labelledby="honors-h">
    ${secHead('honors', 'Honors & Awards')}
    <ul class="honors">${items}
    </ul>
  </section>`;
}

function projects() {
  const items = C.projects.map((e) => `
      <li class="entry row">
        <div class="main">
          <h3 class="entry-h">${tx(e.title)}</h3>
          <p class="entry-sub"><em>${tx(e.role)}</em></p>
          ${points(e.points)}
        </div>
        ${metaSide(e)}
      </li>`).join('');
  return `<section id="projects" class="sec" aria-labelledby="projects-h">
    ${secHead('projects', 'Projects')}
    <ol class="entries cv">${items}
    </ol>
  </section>`;
}

function skills() {
  return `<section id="skills" class="sec sec-compact" aria-labelledby="skills-h">
    ${secHead('skills', 'Skills')}
    <div class="row"><dl class="main skills">${C.skills.map((s) => `<div><dt>${esc(s.label)}</dt><dd>${txp(s.value)}</dd></div>`).join('')}</dl></div>
  </section>`;
}

/* ═════════════════════════ page chrome ═════════════════════════ */

const NAV_SECTIONS = [
  // One list drives both the navigation bar and the body, so emptying a list in content.js removes the section
  // and its nav link together — a bar linking to a heading that is not on the page is worse than a shorter bar.
  // No "About": the wordmark already links to the top of the page, and the shorter bar keeps the inline
  // navigation on the grid down to smaller windows.
  ['news', 'News', news, () => C.news],
  ['publications', 'Publications', publications, () => C.publications],
  ['experience', 'Experience', experience, () => C.experience],
  ['education', 'Education', education, () => C.education],
  ['honors', 'Honors', honors, () => C.honors],
  ['projects', 'Projects', projects, () => C.projects],
  ['skills', 'Skills', skills, () => C.skills],
];
const LIVE_SECTIONS = NAV_SECTIONS.filter(([, , , data]) => (data() || []).length);
const NAV = LIVE_SECTIONS.map(([id, label]) => [id, label]);

/** Research interests, then any keyword not already covered by one (compared case-insensitively). Names of people
 *  and institutions are keywords for search engines, not topics, so they are left out. */
function knowsAbout() {
  const out = [];
  const covered = (k) => out.some((o) => o.toLowerCase().includes(k.toLowerCase()));
  const names = new Set([P.name, P.affiliation, ...C.education.map((e) => e.school), ...C.experience.map((e) => e.org)]);
  for (const k of [...C.interests.flatMap((i) => [i.label, ...(i.topics || [])]), ...C.meta.keywords]) {
    if (/[㐀-鿿]/.test(k) || names.has(k) || covered(k)) continue;
    out.push(k);
  }
  return out;
}

function jsonLd() {
  const profiles = P.links.filter((l) => /^https?:/.test(l.url)).map((l) => l.url);
  const alumni = C.education.filter((e) => !/present/i.test(e.period)).map((e) => ({ '@type': 'CollegeOrUniversity', name: e.school }));
  // A student's affiliation is the university they are still at; anyone else works for an organisation.
  const studying = C.education.some((e) => e.school === P.affiliation && /present/i.test(e.period));
  const [locality, country] = [P.location.split(',')[0].trim(), P.location.split(',').pop().trim()];
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    ...(SITE_URL ? { '@id': `${SITE_URL}#person` } : {}),
    name: P.name,
    alternateName: P.nameZh,
    ...(SITE_URL ? { url: SITE_URL } : {}),
    jobTitle: P.position,
    ...(studying ? { affiliation: { '@type': 'CollegeOrUniversity', name: P.affiliation } } : { worksFor: { '@type': 'Organization', name: P.affiliation } }),
    alumniOf: alumni,
    email: `mailto:${P.email}`,
    ...(SITE_URL ? { image: absolute(P.photo) } : {}),   // schema.org wants an absolute URL; omitted until the host is known
    address: { '@type': 'PostalAddress', addressLocality: locality, addressCountry: country },
    sameAs: profiles,
    knowsAbout: knowsAbout(),
  };
  return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}

// Runs before first paint: marks JS as available, applies ?theme= or the saved theme, syncs the browser UI colour,
// and opens the publication list on "Selected" unless the address asks for ?pubs=all.
const themeBoot = `(function(){var d=document.documentElement,t=null,q=null,s=null;d.className+=' js';try{s=new URLSearchParams(location.search);q=s.get('theme')}catch(e){}if(!s||s.get('pubs')!=='all')d.className+=' pubs-sel';if(q==='dark'||q==='light')t=q;else{try{t=localStorage.getItem('theme')}catch(e){}if(t!=='dark'&&t!=='light')t=null}if(t){d.setAttribute('data-theme',t);var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].content=d.getAttribute('data-paper-'+t)}})();`;

function head({ title, description, canonical, robots = 'index, follow', assetBase = BASE, social = true, inlineCss = '' }) {
  // Open Graph needs an ABSOLUTE image URL — Facebook, LinkedIn and WeChat do not resolve a relative one, and a
  // relative value makes them drop the card entirely. Until the public address is configured there is nothing
  // truthful to emit, so the image tags are left out and the Twitter card falls back to the text-only "summary".
  const hasOgFile = existsSync(join(ROOT, 'assets/img/og-image.png'));
  const hasOg = hasOgFile && !!SITE_URL;
  // Versioned like the stylesheet: sites that cache a card by its address fetch a redrawn card as a new image.
  const shareFile = hasOgFile ? 'assets/img/og-image.png' : P.photo;
  const shareImg = SITE_URL ? `${absolute(shareFile)}?v=${version(shareFile)}` : '';
  const shareAlt = hasOgFile ? `${P.name}, ${smart(P.position)}, ${P.affiliation}` : `Portrait of ${P.name}`;
  const personTitle = `${P.name} (${P.nameZh})`;
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${robots}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME.light}">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME.dark}">
<script>${themeBoot}</script>
<link rel="preload" href="${assetBase}assets/fonts/EBGaramond-Roman.woff2" as="font" type="font/woff2" crossorigin>
${inlineCss ? `<style>
${inlineCss}
</style>
` : ''}<link rel="stylesheet" href="${assetBase}assets/css/style.css?v=${version('assets/css/style.css')}">
<link rel="icon" href="${assetBase}assets/img/favicon.svg?v=${version('assets/img/favicon.svg')}" type="image/svg+xml">${existsSync(join(ROOT, 'assets/img/apple-touch-icon.png')) ? `
<link rel="apple-touch-icon" href="${assetBase}assets/img/apple-touch-icon.png">` : ''}${social ? `
<meta name="keywords" content="${esc(C.meta.keywords.join(', '))}">
<meta name="author" content="${esc(P.name)}">
${canonical ? `<link rel="canonical" href="${canonical}">
` : ''}<meta property="og:type" content="profile">
<meta property="og:site_name" content="${esc(C.meta.siteTitle)}">
<meta property="og:title" content="${esc(personTitle)}">
<meta property="og:description" content="${esc(description)}">
${canonical ? `<meta property="og:url" content="${canonical}">
` : ''}<meta property="og:locale" content="en_US">
${shareImg ? `<meta property="og:image" content="${shareImg}">${hasOg ? `
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">` : ''}
<meta property="og:image:alt" content="${esc(shareAlt)}">
` : ''}<meta property="profile:first_name" content="${esc(P.name.split(' ')[0])}">
<meta property="profile:last_name" content="${esc(P.name.split(' ').slice(1).join(' '))}">
<meta name="twitter:card" content="${hasOg ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(personTitle)}">
<meta name="twitter:description" content="${esc(description)}">${shareImg ? `
<meta name="twitter:image" content="${shareImg}">
<meta name="twitter:image:alt" content="${esc(shareAlt)}">` : ''}
<script type="application/ld+json">
${jsonLd()}
</script>
<script src="${assetBase}assets/js/main.js?v=${version('assets/js/main.js')}" defer></script>` : ''}
</head>`;
}

const masthead = () => `<header class="masthead">
  <div class="bar">
    <a class="brand" href="#top">${esc(P.name)}</a>
    <nav class="nav" aria-label="Sections">
      <button type="button" class="nav-toggle" aria-expanded="false" aria-controls="nav-list" hidden><span class="nt-open">${I.menu}</span><span class="nt-close">${I.close}</span><span class="vh nav-prefix"></span><span class="nav-current" data-default="Contents">Contents</span></button>
      <ul id="nav-list">${NAV.map(([id, label]) => `<li><a href="#${id}">${label}</a></li>`).join('')}</ul>
    </nav>
    <button type="button" class="theme-toggle" aria-label="Switch to dark theme" title="Switch to dark theme" hidden><span class="t-sun">${I.sun}</span><span class="t-moon">${I.moon}</span></button>
  </div>
</header>`;

const footer = () => `<footer class="colophon">
  <div class="row">
    <div class="main">
      <p>© ${lastUpdated.year} ${esc(P.name)} <span lang="zh-Hans" class="zh">${esc(P.nameZh)}</span><span class="sep" aria-hidden="true"> · </span><span class="updated">Last updated <time datetime="${lastUpdated.iso}">${lastUpdated.text}</time></span></p>
    </div>
    <div class="side"><a class="to-top" href="#top">${I.up}<span>Back to top</span></a></div>
  </div>
</footer>`;

const lightbox = () => `<dialog class="lightbox" id="lightbox" aria-labelledby="lb-cap">
  <figure>
    <div class="lb-plate"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" width="1200" height="600"></div>
    <p class="lb-hint">Scroll sideways to see the whole figure</p>
    <figcaption id="lb-cap">Figure</figcaption>
  </figure>
  <button type="button" class="lb-close" aria-label="Close figure">${I.close}</button>
</dialog>`;

/* ═════════════════════════ pages ═════════════════════════ */

const htmlOpen = `<html lang="en" data-paper-light="${THEME.light}" data-paper-dark="${THEME.dark}">`;
const indexHtml = `<!doctype html>
${htmlOpen}
${head({ title: C.meta.siteTitle, description: C.meta.description, canonical: SITE_URL })}
<body id="top">
<a class="skip" href="#main">Skip to main content</a>
${masthead()}
<main id="main" class="page">
  ${about()}
  ${LIVE_SECTIONS.map(([, , render]) => render()).join('\n  ')}
</main>
${footer()}
${lightbox()}
</body>
</html>
`;

/* 404.html is served for ANY address under the site, so it cannot use the page-relative asset URLs that
   index.html uses: "assets/css/style.css" requested at /a/b/c would resolve to /a/b/assets/…. It therefore
   links its stylesheet root-relatively, from ROOT_PATH — which is right for a domain root or a user site,
   and right for a project subpath (user.github.io/homepage/) only once the public address is configured.
   Rather than leave the one page a lost visitor sees at the mercy of that, the handful of rules it actually
   uses are also inlined below, lifted verbatim from style.css. The external sheet still wins wherever it
   loads (it comes later in the head, and brings the real Garamond); where it does not — an unconfigured
   subpath deploy, a local file:// preview, a stylesheet that simply fails — the page keeps its paper
   palette, both themes, the serif fallback and its focus ring instead of dropping to unstyled Times. */
const notFoundCss = () => [
  ':root', ':root:not([data-theme="light"])', ':root[data-theme="dark"]',   // tokens, light + dark
  '*, *::before, *::after', 'html', 'body', 'p, ul, ol, dl, dd, figure, h1, h2, h3, h4, pre',
  ':focus-visible', '.i', '[lang|="zh"]', 'a', 'a:hover',                   // base
  '.nf-body', '.notfound', '.nf-code', '.notfound h1', '.nf-text', '.nf-home', '.nf-home a', '.nf-home a:hover span', '.nf-home .zh',
].map((s) => (s === ':root:not([data-theme="light"])' ? `@media (prefers-color-scheme: dark) {\n${cssRule(s)}\n}` : cssRule(s)))
  .filter(Boolean)
  .join('\n')
  .replace(/\s*\/\*[^]*?\*\/\s*/g, ' ')          // the explanatory comments stay in style.css, not here
  .replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n')
  // the real sheet dampens this transition under @media (prefers-reduced-motion: reduce); so does the copy
  + '\n@media (prefers-reduced-motion: reduce) { a { transition: none; } }';

const notFoundHtml = `<!doctype html>
${htmlOpen}
${head({ title: `Page not found · ${P.name}`, description: C.meta.description, canonical: SITE_URL, robots: 'noindex', assetBase: ROOT_PATH, social: false, inlineCss: notFoundCss() })}
<body class="nf-body">
<main class="notfound" id="main">
  <p class="nf-code" aria-hidden="true">404</p>
  <h1>Page not found</h1>
  <p class="nf-text">The page you were looking for is not here. It may have moved, or the address may be mistyped.</p>
  <p class="nf-home"><a href="${ROOT_PATH}">${I.arrow}<span>${esc(P.name)} <span lang="zh-Hans" class="zh">${esc(P.nameZh)}</span> — homepage</span></a></p>
</main>
</body>
</html>
`;

const sitemap = SITE_URL && `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}</loc>${lastUpdated.iso ? `
    <lastmod>${lastUpdated.iso}</lastmod>` : ''}
  </url>
</urlset>
`;

const robots = `User-agent: *
Allow: /
Disallow: /_
${SITE_URL ? `
Sitemap: ${SITE_URL}sitemap.xml
` : ''}`;

/* ═════════════════════════ social card freshness ═════════════════════════ */

// _tools/og.mjs stores the fields it drew in a tEXt chunk "og-key" of og-image.png; compare them with content.js
// so a renamed position, new interest, new photo or new address does not leave a stale card behind.
(() => {
  const f = join(ROOT, 'assets/img/og-image.png');
  if (!existsSync(f)) return;
  const png = readFileSync(f);
  let stored = null;
  for (let o = 8; o + 8 <= png.length;) {
    const len = png.readUInt32BE(o), type = png.toString('latin1', o + 4, o + 8);
    if (type === 'tEXt') {
      const data = png.subarray(o + 8, o + 8 + len), nul = data.indexOf(0);
      if (data.toString('latin1', 0, nul) === 'og-key') { try { stored = JSON.parse(data.subarray(nul + 1).toString('utf8')); } catch { /* ignore */ } }
    }
    if (type === 'IEND') break;
    o += 12 + len;
  }
  if (!stored) { warn('assets/img/og-image.png was not made by _tools/og.mjs (no og-key); run node _tools/og.mjs to be sure it matches the page.'); return; }
  const now = {
    name: P.name, nameZh: P.nameZh, position: P.position, affiliation: P.affiliation, location: P.location,
    interests: C.interests.map((i) => i.label), host: SITE_HOST,
    photo: createHash('sha1').update(readFileSync(join(ROOT, P.photo))).digest('hex').slice(0, 12),
  };
  const stale = Object.keys(now).filter((k) => JSON.stringify(now[k]) !== JSON.stringify(stored[k]));
  if (stale.length) warn(`the social card assets/img/og-image.png is out of date (${stale.join(', ')} changed); run node _tools/og.mjs${stale.includes('host') ? ' with the same SITE_URL' : ''}.`);
})();

/* ═════════════════════════ privacy guard & write ═════════════════════════ */

// Never publish a phone number: refuse to write if anything phone-like slipped into the output.
const PHONE = /\+?86[\s-]?1\d{2}[\s-]?\d{4}[\s-]?\d{4}|(?<![\d.])1[3-9]\d{9}(?!\d)/;
for (const [name, text] of [['index.html', indexHtml], ['404.html', notFoundHtml]]) {
  if (PHONE.test(stripTags(text))) throw new Error(`Phone-number-like string found in ${name}; refusing to write.`);
}
// Linked local PDFs ship with the site too, so scan their text streams and warn loudly if one carries a phone number.
for (const l of P.links.filter((x) => /\.pdf$/i.test(x.url) && !isExternal(x.url))) {
  const f = join(ROOT, l.url);
  if (!existsSync(f)) { console.warn(`  ! linked file missing: ${l.url}`); continue; }
  const raw = readFileSync(f);
  let text = raw.toString('latin1');
  for (const m of text.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length, end = text.indexOf('endstream', start);
    try { text += inflateSync(raw.subarray(start, end), { finishFlush: 2 }).toString('latin1'); } catch { /* not a deflate stream */ }
  }
  const literals = [...text.matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((m) => m[1]).join('');
  if (PHONE.test(literals) || PHONE.test(text)) console.warn(`\n  WARNING: ${l.url} contains a phone-number-like string. Redact the PDF before publishing.\n`);
}

// The downloadable CV should say what the page says: warn when it is older than the content it should match.
{
  const cv = P.links.find((l) => l.key === 'cv' && !isExternal(l.url));
  const f = cv && join(ROOT, cv.url);
  if (f && existsSync(f) && statSync(f).mtimeMs < statSync(join(ROOT, 'data/content.js')).mtimeMs) {
    warn(`${cv.url} is older than data/content.js; if the CV should change too, run node _tools/cv.mjs (it prints this page as the CV) or replace the file.`);
  }
}

const out = { 'index.html': indexHtml, '404.html': notFoundHtml, 'robots.txt': robots, '.nojekyll': '' };
if (sitemap) out['sitemap.xml'] = sitemap;
else if (existsSync(join(ROOT, 'sitemap.xml'))) rmSync(join(ROOT, 'sitemap.xml'));   // a stale sitemap would name the old host
// Keep the development folders (screenshots, design drafts) out of the published repository; _tools/ stays.
if (!existsSync(join(ROOT, '.gitignore'))) out['.gitignore'] = '_shots/\n_variants/\n.DS_Store\n';
for (const [file, text] of Object.entries(out)) writeFileSync(join(ROOT, file), text);
console.log(`Built ${Object.keys(out).join(', ')}  (index ${(indexHtml.length / 1024).toFixed(1)} KB, ${C.publications.length} publications, ${C.news.length} news, site ${SITE_URL || 'address not configured'})`);
for (const n of buildNotes) console.log(`  · ${n}`);
for (const w of warnings) console.warn(`  ! ${w}`);
