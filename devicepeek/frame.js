// DevicePeek – agent inside preview frames (isolated world, preview frames only).
// Phone look (no scrollbars, touch cursor), reports URL/scroll to the panel and
// executes commands from it (navigate, reload, scroll).
(() => {
  if (window.top === window) return;
  if (!String(window.name || '').startsWith('__dp:')) return;
  if (globalThis.__devicepeekFrameAgent) return;
  globalThis.__devicepeekFrameAgent = true;

  const post = (msg) => {
    try {
      parent.postMessage(Object.assign({ __dp: 1 }, msg), '*');
    } catch (e) {}
  };

  // --- phone look ---------------------------------------------------------------
  const cursor =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Ccircle cx='14' cy='14' r='10' fill='rgba(0,0,0,0.22)' stroke='rgba(255,255,255,0.95)' stroke-width='2'/%3E%3C/svg%3E";
  const css = `
    *::-webkit-scrollbar{width:0!important;height:0!important;background:transparent!important}
    html{scrollbar-width:none!important}
    html, body, a, button, label, select, [role=button], *{cursor:url("${cursor}") 14 14, auto!important}
    input, textarea, [contenteditable]{cursor:text!important}
  `;
  try {
    // Constructed sheets aren't subject to the page's CSP.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch (e) {
    const addStyle = () => {
      const s = document.createElement('style');
      s.setAttribute('data-devicepeek', '');
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    };
    if (document.documentElement) addStyle();
    else document.addEventListener('DOMContentLoaded', addStyle, { once: true });
  }

  // --- location reporting --------------------------------------------------------
  let lastHref = location.href;
  post({ evt: 'hello', href: lastHref, title: document.title });

  const report = (kind) => {
    const href = location.href;
    if (href === lastHref) return;
    lastHref = href;
    post({ evt: 'loc', href, kind, title: document.title });
  };
  window.addEventListener('devicepeek:push', () => report('push'));
  window.addEventListener('devicepeek:replace', () => report('replace'));
  window.addEventListener('popstate', () => report('replace'));
  window.addEventListener('hashchange', () => report('push'));
  window.addEventListener('DOMContentLoaded', () => post({ evt: 'title', title: document.title }), { once: true });
  window.addEventListener('pagehide', () => post({ evt: 'unload' }));
  // Real layout viewport, so the panel can verify it matches the selected device.
  let metricsRaf = 0;
  const reportMetrics = () => {
    metricsRaf = 0;
    post({
      evt: 'metrics',
      w: window.innerWidth,
      h: window.innerHeight,
      cw: document.documentElement ? document.documentElement.clientWidth : 0,
      dpr: window.devicePixelRatio
    });
  };
  const metricsSoon = () => {
    if (!metricsRaf) metricsRaf = requestAnimationFrame(reportMetrics);
  };
  window.addEventListener('resize', metricsSoon);
  window.addEventListener('DOMContentLoaded', metricsSoon, { once: true });
  window.addEventListener('load', metricsSoon, { once: true });

  // Safety net for navigation methods we can't hook (cheap string compare).
  setInterval(() => {
    if (!document.hidden) report('push');
  }, 1500);

  // Plain link clicks would add entries to the tab's history (shared with the desktop page),
  // so the browser's Back button would move the preview instead of the page. Navigate with
  // location.replace() instead. Runs after the page's own handlers, so SPA routers win.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!a || a.hasAttribute('download')) return;
    const target = (a.getAttribute('target') || '').toLowerCase();
    if (target && target !== '_self' && target !== '_top' && target !== '_parent') return;
    let u;
    try {
      u = new URL(a.href, location.href);
    } catch (err) {
      return;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    e.preventDefault();
    if (u.href !== location.href) location.replace(u.href);
  });

  // --- scroll sync ---------------------------------------------------------------
  let scroller = null; // null = the document
  let lockUntil = 0;
  let raf = 0;
  const docEl = () => document.scrollingElement || document.documentElement;
  const metrics = () => {
    if (scroller && scroller.isConnected) return { top: scroller.scrollTop, max: scroller.scrollHeight - scroller.clientHeight };
    const s = docEl();
    return { top: s.scrollTop, max: s.scrollHeight - window.innerHeight };
  };
  const ratio = () => {
    const m = metrics();
    return m.max > 0 ? Math.min(1, Math.max(0, m.top / m.max)) : 0;
  };
  document.addEventListener(
    'scroll',
    (e) => {
      const t = e.target;
      if (t === document || t === document.documentElement || t === document.body) scroller = null;
      else if (t instanceof Element && t.clientHeight >= window.innerHeight * 0.5 && t.scrollHeight > t.clientHeight + 20) scroller = t;
      else return; // carousels, dropdowns etc.
      if (Date.now() < lockUntil || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        post({ evt: 'scroll', r: ratio() });
      });
    },
    { capture: true, passive: true }
  );
  const setScroll = (r) => {
    lockUntil = Date.now() + 200;
    const m = metrics();
    const top = Math.round(Math.min(1, Math.max(0, r)) * Math.max(0, m.max));
    if (scroller && scroller.isConnected) scroller.scrollTop = top;
    else window.scrollTo({ top, behavior: 'instant' });
  };

  // --- commands from the panel -----------------------------------------------------
  window.addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const d = e.data;
    if (!d || d.__dp !== 1 || typeof d.cmd !== 'string') return;
    switch (d.cmd) {
      case 'replace': {
        let u;
        try {
          u = new URL(String(d.url), location.href);
        } catch (err) {
          return;
        }
        if (!/^(https?|file):$/.test(u.protocol) || u.href === location.href) return;
        location.replace(u.href);
        break;
      }
      case 'reload':
        location.reload();
        break;
      case 'scroll':
        setScroll(Number(d.r) || 0);
        break;
      case 'ping':
        post({ evt: 'hello', href: location.href, title: document.title });
        break;
    }
  });
})();
