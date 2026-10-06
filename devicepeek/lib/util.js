// DevicePeek – small helpers shared by the popup and the content scripts.
(function (g) {
  'use strict';
  const NS = (g.DevicePeek = g.DevicePeek || {});

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function debounce(fn, ms) {
    let t = 0;
    const d = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
    d.cancel = () => clearTimeout(t);
    return d;
  }

  // Runs fn at most once per animation frame with the latest arguments.
  function rafThrottle(fn) {
    let id = 0;
    let last;
    const r = (...args) => {
      last = args;
      if (!id) {
        id = requestAnimationFrame(() => {
          id = 0;
          fn(...last);
        });
      }
    };
    r.cancel = () => {
      cancelAnimationFrame(id);
      id = 0;
    };
    return r;
  }

  // Runs fn at most once per `ms`, always including the trailing call.
  function throttle(fn, ms) {
    let lastRun = 0;
    let t = 0;
    let last;
    const run = () => {
      lastRun = Date.now();
      t = 0;
      fn(...last);
    };
    const th = (...args) => {
      last = args;
      const wait = ms - (Date.now() - lastRun);
      if (wait <= 0) run();
      else if (!t) t = setTimeout(run, wait);
    };
    th.cancel = () => clearTimeout(t);
    return th;
  }

  // False once the extension was reloaded/updated and this script is orphaned.
  function contextAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  async function send(msg) {
    if (!contextAlive()) throw new Error('context-invalidated');
    return chrome.runtime.sendMessage(msg);
  }

  function errorText(e) {
    return String((e && e.message) || e || 'Unknown error');
  }

  function slug(s) {
    return (
      String(s || '')
        .toLowerCase()
        .replace(/^www\./, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'page'
    );
  }

  // Tiny DOM builder. Avoids innerHTML so pages with Trusted Types never interfere.
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  NS.util = { clamp, debounce, rafThrottle, throttle, contextAlive, send, errorText, slug, h };
})(globalThis);
