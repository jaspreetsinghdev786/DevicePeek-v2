// DevicePeek – makes room for the panel on the desktop page ("side-by-side" mode).
//
// The page is narrowed with margin-right on <html>, so normal content reflows into the
// remaining width. position:fixed elements ignore that margin, so the ones that end up
// underneath the panel (headers, cookie bars, chat buttons, full-screen app shells) are found
// by hit-testing the panel area and nudged. All changes are inline styles set through the
// CSSOM (never blocked by a page's CSP); the original values are saved and restored exactly,
// including removing the style attribute again if the element had none.
(function (g) {
  'use strict';
  const NS = (g.DevicePeek = g.DevicePeek || {});
  const { debounce } = NS.util;

  const PROPS = ['max-width', 'right', 'translate'];
  const HTML_PROPS = ['margin-right', 'width', 'min-width', 'max-width'];

  function snapshot(el, props) {
    const rec = { hadAttr: el.hasAttribute('style'), props: {} };
    for (const p of props) rec.props[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)];
    return rec;
  }
  function restoreSnapshot(el, rec) {
    for (const [p, [v, prio]] of Object.entries(rec.props)) {
      if (v) el.style.setProperty(p, v, prio);
      else el.style.removeProperty(p);
    }
    if (!rec.hadAttr && el.style.length === 0) {
      // Chrome writes inline-style changes back to the attribute lazily; reading it first
      // flushes that, otherwise an empty style="" reappears after removeAttribute().
      el.getAttribute('style');
      el.removeAttribute('style');
    }
  }

  function createDock(getHost) {
    let width = 0;
    let running = false;
    let htmlSaved = null;
    const adjusted = new Map(); // element -> snapshot

    // ----- page width -----
    function setHtml() {
      const s = document.documentElement.style;
      s.setProperty('margin-right', `${width}px`, 'important');
      s.setProperty('width', 'auto', 'important');
      s.setProperty('min-width', '0px', 'important');
      s.setProperty('max-width', 'none', 'important');
    }
    function apply(w) {
      width = Math.max(0, Math.round(w));
      const html = document.documentElement;
      if (width > 0) {
        if (!htmlSaved) htmlSaved = snapshot(html, HTML_PROPS);
        setHtml();
      } else {
        if (htmlSaved) restoreSnapshot(html, htmlSaved);
        htmlSaved = null;
        restoreAll();
      }
    }
    // Re-applies the margin if the page rewrote the <html> style attribute.
    function ensure() {
      if (width > 0 && htmlSaved && document.documentElement.style.getPropertyValue('margin-right') !== `${width}px`) setHtml();
    }

    // ----- fixed elements -----
    function save(el) {
      adjusted.set(el, snapshot(el, PROPS));
    }
    function restore(el, rec) {
      restoreSnapshot(el, rec);
    }
    function restoreAll() {
      adjusted.forEach((rec, el) => restore(el, rec));
      adjusted.clear();
    }

    function fit(el, left) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.right <= left + 0.5) return;
      const cs = getComputedStyle(el);
      const anchoredRight = cs.left === 'auto' && cs.right !== 'auto';
      save(el);
      if (r.left < left * 0.5 || r.width > left) {
        // Wide element (header, banner, full-screen shell): constrain it to the page area.
        if (anchoredRight) el.style.setProperty('right', `${(parseFloat(cs.right) || 0) + width}px`, 'important');
        el.style.setProperty('max-width', `${Math.max(0, Math.floor(left - Math.max(0, r.left)))}px`, 'important');
      } else {
        // Small element sitting under the panel (chat button, toast): slide it left.
        // Keep the gap it had to the window edge, now measured from the panel edge.
        const gap = Math.max(0, document.documentElement.clientWidth - r.right);
        const shift = Math.ceil(Math.min(r.right - left + gap, r.left));
        if (anchoredRight) el.style.setProperty('right', `${(parseFloat(cs.right) || 0) + shift}px`, 'important');
        else if (!cs.translate || cs.translate === 'none') el.style.setProperty('translate', `${-shift}px 0`, 'important');
        else adjusted.delete(el);
      }
    }

    function scan(full) {
      if (!running || width <= 0) return;
      const host = getHost();
      if (full) restoreAll();
      else {
        adjusted.forEach((rec, el) => {
          if (!el.isConnected || getComputedStyle(el).position !== 'fixed') {
            restore(el, rec);
            adjusted.delete(el);
          }
        });
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const left = vw - width;
      if (left <= 0) return;

      // Outermost position:fixed ancestor-or-self, memoised for this scan.
      const memo = new Map();
      const root = document.documentElement;
      const fixedRoot = (n) => {
        if (!n || n === root || n === document.body || n === host) return null;
        if (memo.has(n)) return memo.get(n);
        const up = fixedRoot(n.parentElement);
        const r = up || (getComputedStyle(n).position === 'fixed' ? n : null);
        memo.set(n, r);
        return r;
      };

      const found = new Set();
      // 32 px grid over the panel area (small enough to catch a 40 px chat button).
      const right = Math.max(left + 2, document.documentElement.clientWidth - 2); // skip the scrollbar
      for (let x = left + 2; x <= right; x += 32) {
        for (let y = 2; y < vh; y += 32) collect(x, y);
        collect(x, vh - 2);
      }
      for (let y = 2; y < vh; y += 32) collect(right, y);
      function collect(x, y) {
        for (const el of document.elementsFromPoint(x, y)) {
          if (el === host) continue;
          const f = fixedRoot(el);
          if (f) found.add(f);
        }
      }
      for (const el of found) if (!adjusted.has(el)) fit(el, left);
    }

    const scanSoon = debounce(() => scan(false), 250);
    const scanFullSoon = debounce(() => scan(true), 200);
    const onClick = debounce(() => scan(false), 350);
    const mo = new MutationObserver(scanSoon); // body children only: portals, modals, banners

    function start() {
      if (running) return;
      running = true;
      window.addEventListener('scroll', scanSoon, { passive: true });
      window.addEventListener('resize', scanFullSoon);
      document.addEventListener('click', onClick, true);
      if (document.body) mo.observe(document.body, { childList: true });
      requestAnimationFrame(() => scan(true));
    }
    function stop() {
      running = false;
      window.removeEventListener('scroll', scanSoon);
      window.removeEventListener('resize', scanFullSoon);
      document.removeEventListener('click', onClick, true);
      mo.disconnect();
      scanSoon.cancel();
      scanFullSoon.cancel();
      onClick.cancel();
      restoreAll();
    }

    return {
      apply,
      start,
      stop,
      rescan: () => scanFullSoon(),
      get width() {
        return width;
      },
      ensure
    };
  }

  // Lets the page's own JS (sliders, grids) recalculate after the available width changed.
  function notifyPageResize() {
    try {
      window.dispatchEvent(new Event('resize'));
    } catch (e) {}
  }

  NS.createDock = createDock;
  NS.notifyPageResize = notifyPageResize;
})(globalThis);
