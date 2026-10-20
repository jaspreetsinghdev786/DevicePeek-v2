/* Peak Preview – isolated-world helper inside Peak Preview device frames only.
 * Reports the frame's URL/title to its parent (the workspace page or the floating
 * widget), and in the workspace also reports/apply scroll positions for "Sync scroll".
 */
(() => {
  'use strict';
  if (window === window.top) return;
  const raw = window.name;
  if (typeof raw !== 'string' || raw.slice(0, 5) !== 'ppv1:') return;
  const anc = location.ancestorOrigins;
  if (!anc || anc.length !== 1) return;

  let cfg;
  try { cfg = JSON.parse(decodeURIComponent(raw.slice(5))); } catch (_) { return; }
  const id = cfg && cfg.id;
  if (!id) return;

  const extOrigin = 'chrome-extension://' + chrome.runtime.id;
  const isFloat = cfg.float === true;
  if (!isFloat && anc[0] !== extOrigin) return;
  const parentOrigin = anc[0];
  const target = parentOrigin && parentOrigin !== 'null' ? parentOrigin : '*';

  const post = (msg) => {
    try { window.parent.postMessage(Object.assign({ __pp: 1, id }, msg), target); } catch (_) {}
  };

  /* URL + title (every new document reports at least once) */
  let lastKey = '';
  const report = () => {
    const key = location.href + '\u0000' + document.title;
    if (key === lastKey) return;
    lastKey = key;
    post({ type: 'url', url: location.href, title: document.title || '' });
  };
  document.addEventListener('DOMContentLoaded', report);
  window.addEventListener('load', report);
  setInterval(report, 800);

  if (isFloat) return; // scroll sync is a workspace feature

  /* Scroll sync */
  const scroller = () => document.scrollingElement || document.documentElement;
  let suppressUntil = 0;
  let queued = false;
  window.addEventListener('scroll', () => {
    if (queued || Date.now() < suppressUntil) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (Date.now() < suppressUntil) return;
      const max = scroller().scrollHeight - window.innerHeight;
      post({ type: 'scroll', ratio: max > 0 ? window.scrollY / max : 0 });
    });
  }, { passive: true });

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== extOrigin) return;
    const d = e.data;
    if (!d || d.__pp !== 1) return;
    if (d.type === 'scrollTo' && typeof d.ratio === 'number') {
      const max = scroller().scrollHeight - window.innerHeight;
      suppressUntil = Date.now() + 160;
      window.scrollTo({ top: Math.round(Math.max(0, Math.min(1, d.ratio)) * max), behavior: 'instant' });
    }
  });
})();
