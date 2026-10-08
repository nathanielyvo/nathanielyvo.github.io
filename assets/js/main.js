// Runxi Cheng — homepage enhancements. Everything on the page works without this file;
// it only adds: theme toggle, mobile contents menu, active-section highlighting, abstract/BibTeX
// disclosure with copy, the Selected/All publication filter, author-list folding, the news fold,
// and a figure lightbox.
(() => {
  'use strict';
  const d = document, root = d.documentElement;
  const $ = (s, c = d) => c.querySelector(s);
  const $$ = (s, c = d) => Array.from(c.querySelectorAll(s));
  // The page colours come from the stylesheet via build.mjs (data-paper-* on <html>), so they are defined once.
  const THEME_COLORS = { light: root.dataset.paperLight || '#fffff8', dark: root.dataset.paperDark || '#15130f' };

  /* ── theme: OS preference by default; an explicit choice is remembered ── */
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const current = () => root.getAttribute('data-theme') || (mq.matches ? 'dark' : 'light');
  const themeBtn = $('.theme-toggle');
  const paintTheme = () => {
    const t = current();
    if (themeBtn) {
      // One model for everyone: the button names the action it performs (tooltip and accessible name agree).
      const label = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
      themeBtn.setAttribute('aria-label', label);
      themeBtn.title = label;
    }
    if (root.hasAttribute('data-theme')) $$('meta[name="theme-color"]').forEach((m) => { m.content = THEME_COLORS[t]; });
  };
  if (themeBtn) {
    themeBtn.hidden = false;
    themeBtn.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) { /* storage unavailable */ }
      paintTheme();
    });
    mq.addEventListener?.('change', paintTheme);
    paintTheme();
  }

  /* ── mobile contents menu ── */
  const nav = $('.nav'), navBtn = $('.nav-toggle'), navCurrent = $('.nav-current'), navPrefix = $('.nav-prefix');
  const setNavOpen = (open) => { nav.classList.toggle('is-open', open); navBtn.setAttribute('aria-expanded', String(open)); };
  if (nav && navBtn) {
    navBtn.hidden = false;
    navBtn.addEventListener('click', () => setNavOpen(!nav.classList.contains('is-open')));
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) setNavOpen(false); });
    d.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('is-open')) { setNavOpen(false); navBtn.focus(); } });
    d.addEventListener('click', (e) => { if (!nav.contains(e.target)) setNavOpen(false); });
  }

  /* ── active section in the navigation ── */
  const navLinks = new Map($$('.nav a[href^="#"]').map((a) => [a.getAttribute('href').slice(1), a]));
  const sections = [...navLinks.keys()].map((id) => d.getElementById(id)).filter(Boolean);
  if ('IntersectionObserver' in window && sections.length) {
    const visible = new Set();
    const atBottom = () => window.innerHeight + window.scrollY >= root.scrollHeight - 4;
    const mark = () => {
      let active = sections.find((s) => visible.has(s));
      if (atBottom()) active = sections[sections.length - 1];
      navLinks.forEach((a) => a.removeAttribute('aria-current'));
      const link = active && navLinks.get(active.id);
      if (link) link.setAttribute('aria-current', 'location');
      const named = link && window.scrollY > 40;
      if (navCurrent) navCurrent.textContent = named ? link.textContent : navCurrent.dataset.default;
      // Announced as "Contents, current section: News" — or just "Contents" at the top of the page.
      if (navPrefix) navPrefix.textContent = named ? 'Contents, current section: ' : '';
    };
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => (en.isIntersecting ? visible.add(en.target) : visible.delete(en.target)));
      mark();
    }, { rootMargin: '-15% 0px -70% 0px' });
    sections.forEach((s) => io.observe(s));
    addEventListener('scroll', () => { if (atBottom() || window.scrollY <= 40) mark(); }, { passive: true });
  }

  /* ── live region for status messages ── */
  const status = $('#pub-status');
  const announce = (msg) => { if (status) { status.textContent = ''; setTimeout(() => { status.textContent = msg; }, 40); } };

  /* ── abstract / BibTeX disclosure ──
     The panels are native <details> (they open without JavaScript too). Here the buttons in the link row drive
     them instead of their summaries, so the row stays put; the button state follows the panel. */
  $$('.pl-toggle').forEach((btn) => {
    const panel = d.getElementById(btn.getAttribute('aria-controls'));
    if (!panel || !('open' in panel)) return;
    btn.hidden = false;
    const sync = () => btn.setAttribute('aria-expanded', String(panel.open));
    btn.addEventListener('click', () => { panel.open = !panel.open; });
    panel.addEventListener('toggle', sync);
    sync();
  });

  /* ── copy BibTeX (Clipboard API, with a fallback for file:// and older browsers) ── */
  const copyText = async (text) => {
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = d.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      d.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = d.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  };
  $$('.copy').forEach((btn) => {
    const panel = d.getElementById(btn.dataset.copy);
    const code = panel && $('pre', panel);
    if (!code) return;
    btn.hidden = false;
    const label = $('span', btn);
    let timer;
    btn.addEventListener('click', async () => {
      const ok = await copyText(code.textContent);
      label.textContent = ok ? 'Copied' : 'Press Cmd/Ctrl+C';
      btn.classList.toggle('is-done', ok);
      if (!ok) { const r = d.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      announce(ok ? 'BibTeX copied to clipboard.' : 'Copy failed; the BibTeX is selected, press Command or Control C.');
      clearTimeout(timer);
      timer = setTimeout(() => { label.textContent = 'Copy'; btn.classList.remove('is-done'); }, 2200);
    });
  });

  /* ── long author lists: show the first few names, expand on request ── */
  $$('.au-more').forEach((btn) => {
    const list = d.getElementById(btn.getAttribute('aria-controls'));
    if (!list) return;
    const names = $$('.au', list);
    const keep = +btn.dataset.keep || 6;
    const hiddenCount = names.length - keep;
    if (hiddenCount < 2) return;
    const set = (expanded) => {
      names.forEach((n, i) => n.classList.toggle('au-hidden', !expanded && i >= keep));
      btn.setAttribute('aria-expanded', String(expanded));
      btn.textContent = expanded ? 'show fewer' : `and ${hiddenCount} more`;
    };
    btn.hidden = false;
    set(false);
    btn.addEventListener('click', () => set(btn.getAttribute('aria-expanded') !== 'true'));
  });

  /* ── news: fold the oldest items ── */
  const newsMore = $('#news .more'), newsList = $('#news-list');
  if (newsMore && newsList) {
    newsMore.hidden = false;
    const label = $('span', newsMore);
    newsMore.addEventListener('click', () => {
      const open = newsMore.getAttribute('aria-expanded') !== 'true';
      newsList.classList.toggle('is-expanded', open);
      newsMore.setAttribute('aria-expanded', String(open));
      label.textContent = open ? newsMore.dataset.less : newsMore.dataset.more;
      if (open) {
        const first = $('.news-older', newsList);
        if (first) { first.tabIndex = -1; first.focus({ preventScroll: false }); }
      }
    });
  }

  /* ── publications: Selected (default with JavaScript) / All ──
     The head script adds .pubs-sel before first paint unless the address says ?pubs=all, so there is no flash;
     without JavaScript every paper is listed. The reference numbers [n] never change. */
  const filterBtns = $$('.filter [data-filter]');
  const pubs = $$('.pub');
  const groups = $$('.pub-group');
  const isShown = (p) => !root.classList.contains('pubs-sel') || p.dataset.selected === 'true';
  const applyFilter = (mode, { silent = false, updateUrl = true } = {}) => {
    root.classList.toggle('pubs-sel', mode === 'selected');
    filterBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === mode)));
    groups.forEach((g) => {
      const all = $$('.pub', g), shown = all.filter(isShown);
      const c = $('.g-n', g);
      if (c) c.textContent = mode === 'selected' && shown.length !== all.length ? `${shown.length} of ${all.length}` : String(all.length);
    });
    if (updateUrl) {
      try {
        const url = new URL(location.href);
        if (mode === 'all') url.searchParams.set('pubs', 'all'); else url.searchParams.delete('pubs');
        history.replaceState(history.state, '', url);
      } catch (e) { /* file:// or sandboxed */ }
    }
    if (!silent) {
      const n = pubs.filter(isShown).length;
      announce(mode === 'selected' ? `Showing ${n} selected publications of ${pubs.length}.` : `Showing all ${pubs.length} publications.`);
    }
  };
  if (filterBtns.length) {
    $('.filter').hidden = false;
    filterBtns.forEach((b) => b.addEventListener('click', () => applyFilter(b.dataset.filter)));
    applyFilter(root.classList.contains('pubs-sel') ? 'selected' : 'all', { silent: true, updateUrl: false });
  } else {
    root.classList.remove('pubs-sel');
  }

  // A link to a publication that "Selected" hides switches to All (clicks, back/forward, and the initial hash).
  const reveal = (hash) => {
    if (!hash || !/^#pub-/.test(hash)) return;
    const target = d.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) return;
    if (!isShown(target)) applyFilter('all');
    target.classList.remove('is-flash');
    void target.offsetWidth;
    target.classList.add('is-flash');
    setTimeout(() => target.classList.remove('is-flash'), 2000);
    return target;
  };
  d.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#pub-"]');
    if (!a) return;
    const t = d.getElementById(a.getAttribute('href').slice(1));
    if (t && !isShown(t)) applyFilter('all');
  });
  addEventListener('hashchange', () => reveal(location.hash));
  if (location.hash) {
    const t = reveal(location.hash);
    if (t) requestAnimationFrame(() => t.scrollIntoView());
  }

  /* ── figure lightbox ── */
  const dlg = $('#lightbox');
  if (dlg && typeof dlg.showModal === 'function') {
    const img = $('img', dlg), cap = $('figcaption', dlg);
    let opener = null;
    d.addEventListener('click', (e) => {
      const a = e.target.closest('.plate-link');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      const src = $('img', a);
      opener = a;
      img.src = a.getAttribute('href');
      const caption = a.dataset.caption || (src && src.alt) || 'Figure';
      // The caption is shown right below, so the image's alt text would only repeat it.
      img.alt = src && src.alt !== caption ? src.alt : '';
      const w = src && +src.getAttribute('width'), h = src && +src.getAttribute('height');
      // data-lb-w/h: the largest size (CSS px) the file can be shown at and stay sharp; vector figures have none.
      const lbW = +a.dataset.lbW || 0, lbH = +a.dataset.lbH || 0;
      if (w && h) {
        img.width = w; img.height = h;
        img.style.setProperty('--lb-ar', String(w / h));
        img.style.setProperty('--lb-h', `${lbH || h}px`);
        if (lbW) img.style.setProperty('--lb-w', `${lbW}px`); else img.style.removeProperty('--lb-w');
      }
      // Very wide figures on a narrow screen: show them tall enough to read, in a pane that scrolls sideways.
      dlg.classList.toggle('is-wide', Boolean(w && h && w / h > 2.4 && innerWidth < 700));
      const pane = $('.lb-plate', dlg);
      if (pane) pane.scrollLeft = 0;
      cap.textContent = caption;
      dlg.showModal();
      $('.lb-close', dlg).focus();
    });
    $('.lb-close', dlg).addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => { if (opener) { opener.focus(); opener = null; } });
  }
})();
