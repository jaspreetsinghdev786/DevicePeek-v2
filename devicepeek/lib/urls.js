// DevicePeek – decides whether a tab URL can host the preview, with a readable reason when not.
(function (g) {
  'use strict';
  const NS = (g.DevicePeek = g.DevicePeek || {});

  const GENERIC = "Chrome doesn't let extensions run on its own pages (Settings, New Tab, Web Store). Open a website to use DevicePeek.";

  const BY_PROTOCOL = {
    'chrome:': "Chrome's own pages (chrome://…) can't be previewed. Open a normal website first.",
    'chrome-untrusted:': "Chrome's own pages can't be previewed. Open a normal website first.",
    'edge:': "Browser pages can't be previewed. Open a normal website first.",
    'brave:': "Browser pages can't be previewed. Open a normal website first.",
    'chrome-search:': "The New Tab page can't be previewed. Open a website first.",
    'chrome-extension:': "Extension pages can't be previewed.",
    'devtools:': "DevTools pages can't be previewed.",
    'view-source:': "View-source pages can't be previewed.",
    'about:': "Blank and about: pages can't be previewed. Open a website first.",
    'data:': "data: URLs can't be previewed. Open a website first.",
    'blob:': "Temporary blob: pages can't be previewed.",
    'javascript:': "This address can't be previewed."
  };

  function isWebStore(u) {
    return u.hostname === 'chromewebstore.google.com' || (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'));
  }

  // Returns { ok: true, file?: true } or { ok: false, reason, message }.
  function check(url) {
    if (!url) return { ok: false, reason: 'internal', message: GENERIC };
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return { ok: false, reason: 'invalid', message: "This tab doesn't have a valid web address." };
    }
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      if (isWebStore(u)) return { ok: false, reason: 'webstore', message: 'Chrome blocks all extensions on the Chrome Web Store.' };
      return { ok: true };
    }
    if (u.protocol === 'file:') return { ok: true, file: true };
    return { ok: false, reason: 'protocol', message: BY_PROTOCOL[u.protocol] || GENERIC };
  }

  // Parses what the user typed into the preview address bar.
  function parseTyped(text, base) {
    const s = String(text || '').trim();
    if (!s) return null;
    try {
      if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
        const u = new URL(s);
        return /^(https?|file):$/.test(u.protocol) ? u.href : null;
      }
      if (s.startsWith('/') || s.startsWith('?') || s.startsWith('#')) return new URL(s, base).href;
      if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) || /^localhost(:\d+)?(\/.*)?$/.test(s)) {
        return new URL((/^localhost/.test(s) ? 'http://' : 'https://') + s).href;
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  NS.urls = { check, parseTyped, GENERIC };
})(globalThis);
