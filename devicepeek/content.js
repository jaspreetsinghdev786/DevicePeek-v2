// DevicePeek – content-script bootstrap (top frame only).
// Asks the service worker whether this tab had DevicePeek open (so it survives reloads and
// navigations), mounts/unmounts the panel, and forwards settings and URL changes to it.
(() => {
  'use strict';
  const NS = globalThis.DevicePeek;
  if (!NS || NS.__booted || window.top !== window) return;
  NS.__booted = true;

  const { send, contextAlive, errorText } = NS.util;
  const ANY_OPEN_KEY = 'devicepeek:anyOpen';

  let panel = null;
  let opening = null;
  let navWatch = null;
  let cssText = null;
  let orphanTimer = 0;

  // A previous extension version may have left its panel behind in this tab.
  function removeStale() {
    document.querySelectorAll(NS.PANEL_HOST_TAG).forEach((n) => n.remove());
  }

  async function loadCss() {
    if (cssText) return cssText;
    const res = await fetch(chrome.runtime.getURL('content.css'));
    if (!res.ok) throw new Error(`content.css: HTTP ${res.status}`);
    cssText = await res.text();
    return cssText;
  }

  const domReady = () =>
    document.readyState !== 'loading'
      ? Promise.resolve()
      : new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));

  function open(previewUrl) {
    if (panel) return Promise.resolve();
    if (opening) return opening;
    opening = (async () => {
      const [prefs, css] = await Promise.all([NS.prefs.load(), loadCss()]);
      await domReady();
      if (panel) return;
      removeStale();
      const initialUrl = prefs.followPage || !previewUrl ? location.href : previewUrl;
      panel = NS.createPanel({ prefs, initialUrl, cssText: css, onRequestClose: requestClose });
      panel.mount();
      navWatch = NS.createNavWatch((href) => panel && panel.onDesktopNavigate(href));
      orphanTimer = setInterval(() => {
        if (!contextAlive()) close({ animate: false }); // extension reloaded/updated
      }, 2000);
    })()
      .catch((e) => {
        console.error('[DevicePeek] could not open the preview:', errorText(e));
        panel = null;
        throw e;
      })
      .finally(() => {
        opening = null;
      });
    return opening;
  }

  async function close({ animate = true } = {}) {
    if (opening) await opening.catch(() => {});
    if (!panel) return;
    const p = panel;
    panel = null;
    clearInterval(orphanTimer);
    if (navWatch) navWatch.stop();
    navWatch = null;
    await p.unmount({ animate });
  }

  function requestClose() {
    close();
    send({ type: 'dp:closed' }).catch(() => {});
  }

  async function syncWithBackground() {
    let res;
    try {
      res = await send({ type: 'dp:hello' });
    } catch (e) {
      return; // service worker unavailable or extension reloaded
    }
    if (res && res.open) await open(res.previewUrl).catch(() => {});
    else if (panel) await close({ animate: false });
  }

  // ------------------------------------------------------------------ messages
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === 'dp:ping') {
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === 'dp:open') {
      open(null).then(
        () => sendResponse({ ok: true }),
        (e) => sendResponse({ ok: false, message: errorText(e) })
      );
      return true;
    }
    if (msg.type === 'dp:close') {
      close().then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  });

  NS.prefs.onChange((next) => {
    if (panel) panel.applyPrefs(next);
  });

  // Back/forward cache: the restored page may be out of date with the tab state.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) syncWithBackground();
  });

  // ------------------------------------------------------------------ boot
  (async () => {
    // Skip the service-worker round trip when DevicePeek isn't open in any tab.
    let maybeOpen = true;
    try {
      const r = await chrome.storage.session.get(ANY_OPEN_KEY);
      maybeOpen = r[ANY_OPEN_KEY] === true;
    } catch (e) {
      maybeOpen = true;
    }
    if (maybeOpen) syncWithBackground();
  })();
})();
