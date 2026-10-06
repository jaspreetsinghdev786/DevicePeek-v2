// DevicePeek – the preview frame and its own Back/Forward history.
//
// Engines:
//   direct  – an <iframe> in the panel's shadow root. Same-site with the page, so cookies
//             and logins work. Default.
//   compat  – the iframe is hosted inside an extension page (preview.html). Used when the
//             desktop page's own CSP forbids frames. Easy to extend with other engines later.
//
// The frame agent (frame.js) says "hello" on every document it loads. A load without a hello
// means the document was blocked (X-Frame-Options / frame-ancestors that couldn't be removed)
// or is an error page.
(function (g) {
  'use strict';
  const NS = (g.DevicePeek = g.DevicePeek || {});

  const SANDBOX =
    'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock allow-presentation allow-orientation-lock';
  const ALLOW = 'autoplay; fullscreen; clipboard-read; clipboard-write; geolocation; camera; microphone';
  const BLOCK_GRACE_MS = 1500;

  function frameName(os, dpr) {
    return `__dp:${os}:${dpr}:${Math.random().toString(36).slice(2, 9)}`;
  }

  function sameDoc(a, b) {
    try {
      const x = new URL(a);
      const y = new URL(b);
      x.hash = '';
      y.hash = '';
      return x.href === y.href;
    } catch (e) {
      return a === b;
    }
  }

  // events: onState(state, info), onLocation(href, title), onScroll(ratio)
  function createPreview(container, events) {
    let iframe = null;
    let engine = 'direct';
    let os = 'ios';
    let dpr = 3;
    let state = 'idle'; // idle | loading | ready | blocked
    let connected = false; // a frame agent answered for the current document
    let helloSeen = false;
    let blockTimer = 0;
    let currentUrl = '';
    let title = '';
    // Own history, so the tab's Back button keeps working for the desktop page.
    let entries = [];
    let index = -1;
    let pendingHistoryUrl = null;
    let hardLoad = false;

    function setState(s, info) {
      state = s;
      events.onState(s, info || {});
    }

    function onWindowMessage(e) {
      if (!iframe || e.source !== iframe.contentWindow) return;
      const d = e.data;
      if (!d || d.__dp !== 1 || typeof d.evt !== 'string') return;
      switch (d.evt) {
        case 'hello':
          helloSeen = true;
          connected = true;
          clearTimeout(blockTimer);
          title = String(d.title || '');
          // After a hard load the requested URL is already recorded; a redirect replaces it.
          record(String(d.href || ''), hardLoad ? 'replace' : 'push');
          hardLoad = false;
          setState('ready');
          break;
        case 'loc':
          title = String(d.title || title);
          record(String(d.href || ''), d.kind === 'replace' ? 'replace' : 'push');
          break;
        case 'title':
          title = String(d.title || '');
          events.onLocation(currentUrl, title);
          break;
        case 'unload':
          helloSeen = false;
          connected = false;
          setState('loading');
          break;
        case 'frameload': // compat engine: inner document finished loading
          onLoad();
          break;
        case 'scroll':
          events.onScroll(Number(d.r) || 0);
          break;
        case 'metrics':
          if (events.onMetrics) events.onMetrics({ w: Number(d.w) || 0, h: Number(d.h) || 0, cw: Number(d.cw) || 0, dpr: Number(d.dpr) || 0 });
          break;
        case 'history':
          go(Math.trunc(Number(d.delta) || 0));
          break;
      }
    }
    window.addEventListener('message', onWindowMessage);

    function record(href, kind) {
      if (!href) return;
      if (pendingHistoryUrl && sameDoc(href, pendingHistoryUrl)) {
        pendingHistoryUrl = null;
        entries[index] = href;
      } else if (index >= 0 && href === entries[index]) {
        // unchanged
      } else if (kind === 'replace' && index >= 0) {
        entries[index] = href;
      } else {
        entries = entries.slice(0, index + 1);
        entries.push(href);
        if (entries.length > 100) entries.shift();
        index = entries.length - 1;
      }
      currentUrl = href;
      events.onLocation(href, title);
    }

    function onLoad() {
      clearTimeout(blockTimer);
      if (helloSeen) return;
      blockTimer = setTimeout(() => {
        if (!helloSeen) {
          connected = false;
          setState('blocked', { url: currentUrl });
        }
      }, BLOCK_GRACE_MS);
    }

    function build(url) {
      clearTimeout(blockTimer);
      if (iframe) iframe.remove();
      helloSeen = false;
      connected = false;
      hardLoad = true;
      const name = frameName(os, dpr);
      const f = document.createElement('iframe');
      f.setAttribute('title', 'Mobile preview');
      if (engine === 'compat') {
        const cfg = { url, name, sandbox: SANDBOX, allow: ALLOW };
        f.src = chrome.runtime.getURL('preview.html') + '#' + encodeURIComponent(JSON.stringify(cfg));
      } else {
        f.name = name;
        f.setAttribute('sandbox', SANDBOX);
        f.setAttribute('allow', ALLOW);
        f.src = url;
        f.addEventListener('load', onLoad);
      }
      iframe = f;
      container.appendChild(f); // a fresh element never adds tab history entries
      setState('loading');
    }

    // Hard load: new frame element (used for first load, device OS changes, recovery).
    function load(url) {
      currentUrl = url;
      record(url, 'push');
      build(url);
    }

    // Soft navigation inside the existing frame (no history entries, no element swap).
    function navigate(url) {
      if (!url) return;
      if (connected && iframe && iframe.contentWindow) {
        if (url === currentUrl) return;
        setState('loading');
        // A blocked target is caught by the load-without-hello check.
        iframe.contentWindow.postMessage({ __dp: 1, cmd: 'replace', url }, '*');
      } else {
        load(url);
      }
    }

    function reload() {
      if (connected && iframe && iframe.contentWindow) {
        setState('loading');
        iframe.contentWindow.postMessage({ __dp: 1, cmd: 'reload' }, '*');
      } else {
        build(currentUrl || entries[index] || location.href);
      }
    }

    function go(delta) {
      const target = index + delta;
      if (!delta || target < 0 || target >= entries.length) return;
      index = target;
      pendingHistoryUrl = entries[index];
      const url = entries[index];
      if (connected && iframe && iframe.contentWindow) {
        setState('loading');
        iframe.contentWindow.postMessage({ __dp: 1, cmd: 'replace', url }, '*');
      } else {
        currentUrl = url;
        build(url);
      }
      events.onLocation(url, '');
    }

    return {
      load,
      navigate,
      reload,
      back: () => go(-1),
      forward: () => go(1),
      canBack: () => index > 0,
      canForward: () => index < entries.length - 1,
      setScroll(r) {
        if (connected && iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ __dp: 1, cmd: 'scroll', r }, '*');
      },
      // Device OS / pixel ratio are read by the frame at document start, so they need a hard reload.
      setDevice(nextOs, nextDpr, { reload: doReload = true } = {}) {
        const changed = nextOs !== os || nextDpr !== dpr;
        os = nextOs;
        dpr = nextDpr;
        if (changed && doReload && iframe) build(currentUrl);
        return changed;
      },
      setEngine(next) {
        if (next === engine) return;
        engine = next;
        if (iframe) build(currentUrl);
      },
      get engine() {
        return engine;
      },
      get url() {
        return currentUrl;
      },
      get title() {
        return title;
      },
      get state() {
        return state;
      },
      get element() {
        return iframe;
      },
      destroy() {
        clearTimeout(blockTimer);
        window.removeEventListener('message', onWindowMessage);
        if (iframe) iframe.remove();
        iframe = null;
      }
    };
  }

  NS.createPreview = createPreview;
  NS.previewSameDoc = sameDoc;
})(globalThis);
