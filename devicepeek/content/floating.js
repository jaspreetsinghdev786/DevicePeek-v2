/* Peak Preview – floating mobile preview.
 *
 * Injected on demand (extension icon / shortcut) into the top frame of a web page.
 * Renders an extension-owned overlay inside an open Shadow DOM, promoted to the
 * browser's top layer, containing a live iframe of the current page at a device
 * viewport. The page underneath stays visible and interactive.
 *
 * Three honest states:
 *   live     – the page is running inside the preview iframe
 *   blocked  – the site refuses to be framed (headers are stripped; scripts or other domains can still block); fallbacks offered
 *   loading  – waiting for the page to start
 * Exact (DevTools-grade) emulation is offered as a separate action because it
 * changes the whole tab, not the widget.
 */
(() => {
  'use strict';
  if (window.top !== window) return;

  // ---- duplicate-injection & stale-instance protection --------------------
  const prev = window.__ppFloating;
  if (prev && typeof prev.alive === 'function' && prev.alive()) return;
  if (prev && typeof prev.destroy === 'function') { try { prev.destroy({ silent: true }); } catch (_) {} }
  document.querySelectorAll('peak-preview-root').forEach((n) => n.remove());

  const PD = self.PeakDevices;
  if (!PD) return;
  const { envFor, allDevices } = PD;

  // ---- constants ----------------------------------------------------------
  const STORE_KEY = 'floatSettings';
  const HEADER = 40, SUBBAR = 36, FOOTER = 28, PAD = 12, MARGIN = 8;
  const CW = 2 + PAD * 2;                               // horizontal chrome around the screen
  const CH = 2 + HEADER + SUBBAR + FOOTER + PAD * 2;    // vertical chrome around the screen
  const MIN_W = 296, MIN_H = 280;
  const RESPONSIVE = 'responsive';
  const DEFAULTS = {
    deviceId: 'iphone-14',
    rotated: false,
    lockAspect: true,
    follow: true,
    pinned: false,
    scale: null,        // preferred scale for device presets (aspect locked)
    size: null,         // outer size when aspect is unlocked / responsive
    pos: null,          // { side: 'left'|'right', dx, y }
    zoomPreset: null,   // 'fit' | 0.5 | 0.75 | 1 | null (manual)
    respScale: 1,
    respW: 390,
    respH: 720
  };
  const PERSIST = Object.keys(DEFAULTS);

  // ---- icons (Lucide-style, 24 grid, 1.8 stroke) ---------------------------
  const svg = (body, size = 16) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  const dot = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="1.25" fill="currentColor" stroke="none"/>`;
  const ICON = {
    grip: svg(dot(9, 6) + dot(15, 6) + dot(9, 12) + dot(15, 12) + dot(9, 18) + dot(15, 18)),
    chev: svg('<path d="m7 10 5 5 5-5"/>', 14),
    pin: svg('<path d="M9 3.5h6"/><path d="M10 3.5v5.2L7 12.5V14h10v-1.5l-3-3.8V3.5"/><path d="M12 14v6.5"/>'),
    min: svg('<path d="M5 12h14"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    rotate: svg('<rect x="3" y="9" width="12" height="12" rx="2"/><path d="M13 3h3a5 5 0 0 1 5 5v1"/><path d="m19 7 2 2 2-2"/>'),
    reload: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
    camera: svg('<path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/>'),
    more: svg(dot(5, 12) + dot(12, 12) + dot(19, 12)),
    phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7"/>', 14),
    compare: svg('<rect x="2.5" y="6" width="6" height="12" rx="1.5"/><rect x="10.5" y="4" width="11" height="10" rx="1.5"/><path d="M14 18h4"/>'),
    exact: svg('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="9" y="7.5" width="6" height="9" rx="1.2"/>'),
    external: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    reset: svg('<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/>'),
    alert: svg('<path d="M12 3.5 2.8 19.5h18.4L12 3.5Z"/><path d="M12 10v4"/>' + dot(12, 16.8), 20),
    corner: svg('<path d="M20 13 13 20M20 8 8 20"/>', 12)
  };

  // ---- small utilities ----------------------------------------------------
  const runtimeOk = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };
  function send(msg) {
    return new Promise((resolve) => {
      if (!runtimeOk()) { resolve(null); return; }
      try {
        chrome.runtime.sendMessage(msg, (res) => { void chrome.runtime.lastError; resolve(res || null); });
      } catch (_) { resolve(null); }
    });
  }
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  function viewportSize() {
    const de = document.documentElement;
    const std = document.compatMode === 'CSS1Compat' && de;
    return {
      w: (std && de.clientWidth) || window.innerWidth,
      h: (std && de.clientHeight) || window.innerHeight
    };
  }
  const stripHash = (u) => String(u || '').split('#')[0];
  function shortUrl(u) {
    try {
      const x = new URL(u);
      const path = x.pathname + x.search;
      return x.origin === location.origin ? (path || '/') : x.host + (path === '/' ? '' : path);
    } catch (_) { return u; }
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- instance state -----------------------------------------------------
  const state = Object.assign({}, DEFAULTS);
  let customDevices = [];
  let destroyed = false;
  let mode = 'idle';            // idle | open | minimized
  let opening = null;
  let host = null, shadow = null, el = {};
  const geom = { x: 0, y: 0, w: 0, h: 0 };
  const cleanups = [];
  const intervals = new Set();
  let loadSeq = 0, loadInfo = null;
  let status = 'idle';
  let previewUrl = '', previewTitle = '';
  let lastHostUrl = location.href;
  let pendingFollow = false;
  let followTimer = 0, rafId = 0, saveTimer = 0, toastTimer = 0, tipTimer = 0;
  let cspFrameViolation = null;
  let rulesError = '';
  let menuState = null;
  let observer = null;

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  // ---- devices & geometry -------------------------------------------------
  function deviceList() {
    return allDevices(customDevices).filter((d) => d.type === 'phone' || d.type === 'tablet');
  }
  const findDev = (id) => deviceList().find((d) => d.id === id) || null;
  const isResponsive = () => state.deviceId === RESPONSIVE;
  function baseDevice() {
    if (isResponsive()) return null;
    return findDev(state.deviceId) || findDev(DEFAULTS.deviceId) || deviceList()[0];
  }
  function viewportDims() {
    if (isResponsive()) return { w: state.respW, h: state.respH };
    const d = baseDevice();
    return state.rotated ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
  }
  const currentEnv = () => (isResponsive() ? null : envFor(baseDevice(), state.rotated));
  function osLabel() {
    const d = baseDevice();
    if (!d) return 'viewport only';
    return d.os === 'ios' ? 'iOS' : d.os === 'ipados' ? 'iPadOS' : 'Android';
  }
  function maxBox() {
    const vp = viewportSize();
    return { w: Math.max(MIN_W, vp.w - MARGIN * 2), h: Math.max(MIN_H, vp.h - MARGIN * 2) };
  }
  /** Outer size for a screen scale. Never narrower/shorter than the toolbar needs –
   *  at small zoom levels the screen is letterboxed inside the window instead. */
  function sizeForScale(s) {
    const v = viewportDims();
    return { w: Math.max(MIN_W, Math.round(v.w * s + CW)), h: Math.max(MIN_H, Math.round(v.h * s + CH)) };
  }
  function fitScale() {
    const v = viewportDims(), m = maxBox();
    return Math.min(1, (m.w - CW) / v.w, (m.h - CH) / v.h);
  }
  const minScale = () => 0.2;
  function clampScale(s) {
    const hi = fitScale();
    return clamp(s, Math.min(minScale(), hi), hi);
  }
  function currentScale() {
    if (isResponsive()) return state.respScale;
    const v = viewportDims();
    return Math.max(0.01, Math.min(1, (geom.w - CW) / v.w, (geom.h - CH) / v.h));
  }
  function syncResponsiveViewport() {
    if (!isResponsive()) return;
    state.respW = Math.max(120, Math.round((geom.w - CW) / state.respScale));
    state.respH = Math.max(120, Math.round((geom.h - CH) / state.respScale));
  }
  function clampPos() {
    const vp = viewportSize();
    geom.x = Math.round(clamp(geom.x, MARGIN, vp.w - geom.w - MARGIN));
    geom.y = Math.round(clamp(geom.y, MARGIN, vp.h - geom.h - MARGIN));
  }
  function rememberPos() {
    const vp = viewportSize();
    const right = geom.x + geom.w / 2 > vp.w / 2;
    state.pos = { side: right ? 'right' : 'left', dx: Math.round(right ? vp.w - geom.x - geom.w : geom.x), y: Math.round(geom.y) };
    save();
  }
  function restorePos() {
    const vp = viewportSize();
    const p = state.pos || { side: 'right', dx: 16, y: 16 };
    geom.x = p.side === 'right' ? vp.w - geom.w - p.dx : p.dx;
    geom.y = p.y;
    clampPos();
  }
  function sizeFromState() {
    const m = maxBox();
    if (isResponsive()) {
      const s = state.respScale;
      geom.w = clamp(Math.round(state.respW * s + CW), MIN_W, m.w);
      geom.h = clamp(Math.round(state.respH * s + CH), MIN_H, m.h);
      syncResponsiveViewport();
    } else if (state.lockAspect) {
      const s = clampScale(state.scale != null ? state.scale : Math.min(1, fitScale()));
      Object.assign(geom, sizeForScale(s));
    } else {
      const sz = state.size || sizeForScale(clampScale(Math.min(1, fitScale())));
      geom.w = clamp(sz.w, MIN_W, m.w);
      geom.h = clamp(sz.h, MIN_H, m.h);
    }
  }
  /** Resize while keeping the widget's nearer horizontal edge where it is. */
  function resizeKeepingAnchor(w, h) {
    const vp = viewportSize();
    const right = geom.x + geom.w / 2 > vp.w / 2;
    const oldRight = geom.x + geom.w;
    geom.w = w;
    geom.h = h;
    if (right) geom.x = oldRight - w;
    clampPos();
    applyGeom();
    rememberPos();
  }

  // ---- settings -----------------------------------------------------------
  async function loadSettings() {
    try {
      const got = await chrome.storage.local.get([STORE_KEY, 'settings']);
      Object.assign(state, DEFAULTS, got[STORE_KEY] || {});
      const s = got.settings || {};
      customDevices = Array.isArray(s.custom) ? s.custom.filter((d) => d && (d.type === 'phone' || d.type === 'tablet')) : [];
    } catch (_) { /* defaults */ }
    if (!isResponsive() && !findDev(state.deviceId)) state.deviceId = DEFAULTS.deviceId;
    if (!(state.respScale > 0)) state.respScale = 1;
  }
  function snapshot() {
    const o = {};
    for (const k of PERSIST) o[k] = state[k];
    return o;
  }
  function save(now) {
    clearTimeout(saveTimer);
    const run = () => {
      if (!runtimeOk()) return;
      try { chrome.storage.local.set({ [STORE_KEY]: snapshot() }); } catch (_) {}
    };
    if (now) run(); else saveTimer = setTimeout(run, 250);
  }

  // ---- styles -------------------------------------------------------------
  const HOST_CSS = [
    'all: initial !important', 'display: block !important', 'position: fixed !important',
    'inset: 0 !important', 'width: 100vw !important', 'height: 100vh !important',
    'margin: 0 !important', 'padding: 0 !important', 'border: 0 !important',
    'background: transparent !important', 'overflow: visible !important',
    'pointer-events: none !important', 'z-index: 2147483647 !important',
    'color-scheme: normal !important', 'opacity: 1 !important', 'visibility: visible !important',
    'transform: none !important', 'filter: none !important', 'contain: none !important'
  ].join(';');

  const CSS = `
:host { all: initial; }
.pp {
  position: fixed; inset: 0; pointer-events: none;
  font: 12.5px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--text); -webkit-font-smoothing: antialiased; text-align: left; letter-spacing: normal;
  --surface: #ffffff; --surface-2: #f6f7f9; --stage: #eceef2;
  --border: #e3e5ea; --border-strong: #d0d4dc;
  --text: #15171c; --muted: #646b78;
  --accent: #4f46e5; --accent-hover: #4338ca; --accent-soft: #eef0ff; --on-accent: #ffffff;
  --ok: #16a34a; --warn: #d97706;
  --hover: rgba(15, 17, 22, .06); --press: rgba(15, 17, 22, .11);
  --shadow: 0 0 0 1px rgba(15, 17, 22, .04), 0 2px 6px -2px rgba(15, 17, 22, .14), 0 22px 44px -14px rgba(15, 17, 22, .34);
  --tip-bg: #15171c; --tip-fg: #ffffff;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}
@media (prefers-color-scheme: dark) {
  .pp {
    --surface: #181a20; --surface-2: #1e2128; --stage: #0f1115;
    --border: #2a2e37; --border-strong: #3a3f4a;
    --text: #e8eaef; --muted: #9ba2af;
    --accent: #8b93ff; --accent-hover: #a5abff; --accent-soft: rgba(139, 147, 255, .16); --on-accent: #0f1115;
    --ok: #4ade80; --warn: #fbbf24;
    --hover: rgba(255, 255, 255, .07); --press: rgba(255, 255, 255, .12);
    --shadow: 0 0 0 1px rgba(0, 0, 0, .55), 0 2px 6px -2px rgba(0, 0, 0, .5), 0 22px 44px -14px rgba(0, 0, 0, .75);
    --tip-bg: #e8eaef; --tip-fg: #15171c;
  }
}
*, *::before, *::after { box-sizing: border-box; }
button { font: inherit; color: inherit; margin: 0; letter-spacing: inherit; text-transform: none; }
svg { display: block; flex: none; }
[hidden] { display: none !important; }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.gesturing, .gesturing * { user-select: none !important; -webkit-user-select: none !important; }

.frame { position: absolute; left: 0; top: 0; pointer-events: auto; }
.frame.moving { will-change: transform; }
.win {
  --surface: #17181c; --surface-2: #202228; --stage: transparent;
  --border: rgba(255, 255, 255, .08); --border-strong: rgba(255, 255, 255, .16);
  --text: #f1f2f5; --muted: #a3a8b5;
  --accent: #8b93ff; --accent-hover: #a5abff; --accent-soft: rgba(139, 147, 255, .2); --on-accent: #0f1115;
  --hover: rgba(255, 255, 255, .09); --press: rgba(255, 255, 255, .15);
  position: relative; width: 100%; height: 100%;
  display: flex; flex-direction: column;
  background: linear-gradient(150deg, #2e3037 0%, #131418 55%, #1d1e23 100%);
  border: 1px solid #44474f; border-radius: 14px; color: var(--text);
  box-shadow: inset 0 0 0 3px #0b0b0d, inset 0 0 0 4px rgba(255, 255, 255, .06), var(--shadow); overflow: hidden;
}
.frame[data-kind="phone"] .win { border-radius: 58px; }
.frame[data-kind="tablet"] .win { border-radius: 34px; }
.frame[data-cut="home"] .win { border-radius: 40px; }
.frame[data-kind="phone"]::before, .frame[data-kind="phone"]::after {
  content: ""; position: absolute; width: 3px; border-radius: 2px; background: #3a3d45; pointer-events: none;
}
.frame[data-kind="phone"]::before { left: -2px; top: 120px; height: 56px; box-shadow: 0 74px 0 #3a3d45; }
.frame[data-kind="phone"]::after { right: -2px; top: 170px; height: 88px; }
.island, .notch, .punch, .home { display: none; position: absolute; z-index: 2; pointer-events: none; }
.wrap[data-cut="island"] .island {
  display: block; left: 50%; top: calc(11px * var(--s, 1)); width: calc(126px * var(--s, 1)); height: calc(37px * var(--s, 1));
  margin-left: calc(-63px * var(--s, 1)); border-radius: 999px; background: #000;
}
.wrap[data-cut="notch"] .notch {
  display: block; left: 50%; top: 0; width: calc(164px * var(--s, 1)); height: calc(32px * var(--s, 1));
  margin-left: calc(-82px * var(--s, 1)); border-radius: 0 0 calc(20px * var(--s, 1)) calc(20px * var(--s, 1)); background: #000;
}
.notch::before, .notch::after { content: ""; position: absolute; top: 0; width: calc(12px * var(--s, 1)); height: calc(12px * var(--s, 1)); }
.notch::before { left: calc(-12px * var(--s, 1)); background: radial-gradient(circle at 0 100%, transparent calc(11.5px * var(--s, 1)), #000 calc(12px * var(--s, 1))); }
.notch::after { right: calc(-12px * var(--s, 1)); background: radial-gradient(circle at 100% 100%, transparent calc(11.5px * var(--s, 1)), #000 calc(12px * var(--s, 1))); }
.wrap[data-cut="punch"] .punch {
  display: block; left: 50%; top: calc(12px * var(--s, 1)); width: calc(14px * var(--s, 1)); height: calc(14px * var(--s, 1));
  margin-left: calc(-7px * var(--s, 1)); border-radius: 50%; background: #000; box-shadow: 0 0 0 1px #1b1c20;
}
.wrap[data-cut="island"] .home, .wrap[data-cut="notch"] .home, .wrap[data-cut="punch"] .home {
  display: block; left: 50%; bottom: calc(8px * var(--s, 1)); width: calc(134px * var(--s, 1)); height: calc(5px * var(--s, 1));
  margin-left: calc(-67px * var(--s, 1)); border-radius: 999px; background: #fff; mix-blend-mode: difference;
}
.wrap[data-cut="punch"] .home { width: calc(100px * var(--s, 1)); margin-left: calc(-50px * var(--s, 1)); }
.wrap[data-land="1"] .island { left: calc(11px * var(--s, 1)); top: 50%; width: calc(37px * var(--s, 1)); height: calc(126px * var(--s, 1)); margin: calc(-63px * var(--s, 1)) 0 0 0; }
.wrap[data-land="1"] .notch { left: 0; top: 50%; width: calc(32px * var(--s, 1)); height: calc(164px * var(--s, 1)); margin: calc(-82px * var(--s, 1)) 0 0 0; border-radius: 0 calc(20px * var(--s, 1)) calc(20px * var(--s, 1)) 0; }
.wrap[data-land="1"] .notch::before, .wrap[data-land="1"] .notch::after { display: none; }
.wrap[data-land="1"] .punch { left: calc(12px * var(--s, 1)); top: 50%; margin: calc(-7px * var(--s, 1)) 0 0 0; }
.wrap[data-land="1"] .home { left: auto; right: calc(8px * var(--s, 1)); bottom: 50%; width: calc(5px * var(--s, 1)); height: calc(134px * var(--s, 1)); margin: 0 0 calc(-67px * var(--s, 1)) 0; }
.frame.entering .win { animation: pp-in 170ms cubic-bezier(.2, .8, .2, 1); }
@keyframes pp-in { from { opacity: 0; transform: translateY(6px) scale(.985); } }

.bar {
  height: ${HEADER}px; flex: none; display: flex; align-items: center; gap: 2px;
  padding: 0 22px 0 26px; cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none;
}
.frame.moving .bar, .frame.moving .grip { cursor: grabbing; }
.grip {
  width: 22px; height: 28px; padding: 0; display: grid; place-items: center; flex: none;
  border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: grab; touch-action: none;
}
.grip:hover { color: var(--text); }
.devbtn {
  min-width: 0; max-width: 100%; height: 28px; padding: 0 6px 0 8px;
  display: inline-flex; align-items: center; gap: 4px; flex: 0 1 auto;
  border: 0; border-radius: 6px; background: transparent; cursor: pointer;
  font-size: 13px; font-weight: 600; color: var(--text);
}
.devbtn .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.devbtn svg { color: var(--muted); }
.devbtn:hover, .devbtn[aria-expanded="true"] { background: var(--hover); }
.spacer { flex: 1 1 auto; min-width: 6px; align-self: stretch; }
.ib {
  width: 28px; height: 28px; padding: 0; flex: none; display: grid; place-items: center;
  border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.ib:hover, .ib[aria-expanded="true"] { background: var(--hover); color: var(--text); }
.ib:active { background: var(--press); }
.ib[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); }

.sub {
  height: ${SUBBAR}px; flex: none; display: flex; align-items: center; gap: 2px;
  padding: 0 22px 0 30px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
  background: rgba(0, 0, 0, .28);
}
.dims { font: 500 12px/1 var(--mono); font-variant-numeric: tabular-nums; color: var(--text); white-space: nowrap; }
.zoom {
  height: 24px; margin-left: 8px; padding: 0 3px 0 7px; display: inline-flex; align-items: center; gap: 1px;
  border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--muted);
  font: 500 11.5px/1 var(--mono); font-variant-numeric: tabular-nums; cursor: pointer; white-space: nowrap;
  transition: border-color 120ms ease, color 120ms ease;
}
.zoom:hover, .zoom[aria-expanded="true"] { border-color: var(--border-strong); color: var(--text); }

.stage {
  position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden;
  background: var(--stage); display: grid; place-items: center;
}
.wrap {
  position: relative; overflow: hidden; background: #fff;
  box-shadow: 0 0 0 1px #000;
}
.screen { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.screen iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; color-scheme: normal; }
.shield { position: absolute; inset: 0; z-index: 4; }
.notice {
  position: absolute; inset: 0; z-index: 3; overflow: auto;
  display: flex; flex-direction: column; justify-content: center; gap: 10px;
  padding: 20px 18px; background: var(--surface); color: var(--text);
}
.notice .n-ic { color: var(--warn); }
.notice .n-title { font-size: 14px; font-weight: 650; letter-spacing: -.005em; }
.notice .n-why { font-size: 12.5px; color: var(--text); overflow-wrap: anywhere; }
.notice .n-body, .notice .n-foot { font-size: 12px; color: var(--muted); }
.notice .n-actions { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
.btn {
  height: 32px; padding: 0 12px; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border: 1px solid var(--border-strong); border-radius: 7px; background: var(--surface); color: var(--text);
  font-size: 12.5px; font-weight: 600; cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease;
}
.btn:hover { background: var(--surface-2); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.btn.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.toast {
  position: absolute; left: 50%; bottom: 10px; z-index: 5; max-width: calc(100% - 24px);
  transform: translate(-50%, 6px); opacity: 0; pointer-events: none;
  padding: 7px 12px; border-radius: 8px; background: var(--tip-bg); color: var(--tip-fg);
  font-size: 12px; font-weight: 550; box-shadow: 0 6px 16px rgba(0, 0, 0, .22);
  transition: opacity 150ms ease, transform 150ms ease;
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }

.foot {
  height: ${FOOTER}px; flex: none; display: flex; align-items: center; gap: 8px;
  padding: 0 34px 0 30px; border-top: 1px solid var(--border); color: var(--muted); font-size: 11.5px;
}
.status { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; border-radius: 4px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); flex: none; }
.foot[data-status="live"] .dot { background: var(--ok); }
.foot[data-status="blocked"] .dot { background: var(--warn); }
.foot[data-status="loading"] .dot { animation: pp-pulse 1s ease-in-out infinite; }
@keyframes pp-pulse { 50% { opacity: .3; } }
.path { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
.back {
  flex: none; border: 0; background: none; padding: 0 2px; cursor: pointer;
  color: var(--accent); font-size: 11.5px; font-weight: 600; white-space: nowrap; border-radius: 4px;
}
.back:hover { text-decoration: underline; }
.corner { position: absolute; right: 5px; bottom: 6px; color: var(--muted); opacity: .55; pointer-events: none; z-index: 6; }

.rz { position: absolute; z-index: 7; touch-action: none; }
.rz[data-dir="n"] { top: -4px; left: 14px; right: 14px; height: 8px; cursor: ns-resize; }
.rz[data-dir="s"] { bottom: -4px; left: 14px; right: 14px; height: 8px; cursor: ns-resize; }
.rz[data-dir="e"] { right: -4px; top: 14px; bottom: 14px; width: 8px; cursor: ew-resize; }
.rz[data-dir="w"] { left: -4px; top: 14px; bottom: 14px; width: 8px; cursor: ew-resize; }
.rz[data-dir="ne"] { top: -5px; right: -5px; width: 18px; height: 18px; cursor: nesw-resize; }
.rz[data-dir="nw"] { top: -5px; left: -5px; width: 18px; height: 18px; cursor: nwse-resize; }
.rz[data-dir="se"] { bottom: -5px; right: -5px; width: 18px; height: 18px; cursor: nwse-resize; }
.rz[data-dir="sw"] { bottom: -5px; left: -5px; width: 18px; height: 18px; cursor: nesw-resize; }

.launcher {
  position: absolute; left: 0; top: 0; pointer-events: auto; touch-action: none;
  height: 36px; padding: 0 12px 0 10px; display: inline-flex; align-items: center; gap: 8px;
  border: 1px solid var(--border-strong); border-radius: 18px; background: var(--surface); color: var(--text);
  box-shadow: var(--shadow); cursor: grab; font-size: 12.5px; font-weight: 600; white-space: nowrap;
  transition: background-color 120ms ease;
}
.launcher:hover { background: var(--surface-2); }
.launcher.moving { cursor: grabbing; }
.launcher svg { color: var(--accent); }
.launcher .ldims { font: 500 11.5px/1 var(--mono); color: var(--muted); }
.launcher.entering { animation: pp-pop 150ms ease-out; }
@keyframes pp-pop { from { opacity: 0; transform: var(--lt) scale(.9); } }

.menu {
  position: absolute; left: 0; top: 0; pointer-events: auto; min-width: 232px; max-width: 300px; overflow: auto;
  padding: 5px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: var(--shadow);
  animation: pp-fade 120ms ease-out;
}
@keyframes pp-fade { from { opacity: 0; } }
.menu .lbl { padding: 7px 8px 3px; font-size: 11px; font-weight: 650; color: var(--muted); letter-spacing: .02em; }
.menu .sep { height: 1px; margin: 5px 3px; background: var(--border); }
.menu .mi {
  width: 100%; min-height: 30px; padding: 0 8px; display: flex; align-items: center; gap: 9px;
  border: 0; border-radius: 6px; background: transparent; color: var(--text); text-align: left; cursor: pointer; font-size: 12.5px;
}
.menu .mi:hover, .menu .mi:focus-visible { background: var(--hover); outline: none; }
.menu .mi .ic { color: var(--muted); }
.menu .mi .tx { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu .mi .sb { color: var(--muted); font: 500 11.5px/1 var(--mono); font-variant-numeric: tabular-nums; }
.menu .mi .ck { width: 14px; color: var(--accent); visibility: hidden; }
.menu .mi[aria-checked="true"] .ck { visibility: visible; }
.menu .mi[aria-checked="true"] .tx { font-weight: 600; }
.menu .mi[aria-disabled="true"] { opacity: .45; cursor: default; }
.menu .mi[aria-disabled="true"]:hover { background: transparent; }
.menu .seg { display: flex; gap: 4px; padding: 3px 4px 5px; }
.menu .seg .mi {
  flex: 1; justify-content: center; min-height: 26px; padding: 0 4px;
  border: 1px solid var(--border); font: 500 11.5px/1 var(--mono);
}
.menu .seg .mi[aria-checked="true"] { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }

.tip {
  position: absolute; left: 0; top: 0; pointer-events: none; z-index: 10;
  max-width: 260px; padding: 5px 8px; border-radius: 6px;
  background: var(--tip-bg); color: var(--tip-fg); font-size: 11.5px; font-weight: 500; line-height: 1.35;
  opacity: 0; transition: opacity 120ms ease;
}
.tip.show { opacity: 1; }
.tip.wrap { white-space: normal; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;

  const RESIZE_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  const btn = (act, label, icon, extra = '') =>
    `<button type="button" class="ib" data-act="${act}" aria-label="${label}" data-tip="${label}" ${extra}>${icon}</button>`;

  const HTML = `
<div class="pp">
  <div class="frame" hidden>
    <section class="win" role="dialog" aria-label="Peak Preview – mobile preview of this page">
      <header class="bar">
        <button type="button" class="grip" aria-label="Move preview. Arrow keys nudge it." data-tip="Drag to move · arrow keys nudge">${ICON.grip}</button>
        <button type="button" class="devbtn" aria-haspopup="menu" aria-expanded="false" data-tip="Choose device"><span class="name"></span>${ICON.chev}</button>
        <span class="spacer"></span>
        ${btn('pin', 'Keep open on other pages', ICON.pin, 'aria-pressed="false"')}
        ${btn('min', 'Minimize', ICON.min)}
        ${btn('close', 'Close preview', ICON.close)}
      </header>
      <div class="sub">
        <span class="dims"></span>
        <button type="button" class="zoom" aria-haspopup="menu" aria-expanded="false" aria-label="Zoom" data-tip="Zoom"><span class="ztext"></span>${ICON.chev}</button>
        <span class="spacer"></span>
        ${btn('rotate', 'Rotate', ICON.rotate)}
        ${btn('reload', 'Reload preview', ICON.reload)}
        ${btn('shot', 'Screenshot of the preview', ICON.camera)}
        ${btn('more', 'More options', ICON.more, 'aria-haspopup="menu" aria-expanded="false"')}
      </div>
      <div class="stage">
        <div class="wrap"><div class="screen"></div><i class="island"></i><i class="notch"></i><i class="punch"></i><i class="home"></i></div>
        <div class="notice" hidden role="alert">
          <div class="n-ic">${ICON.alert}</div>
          <div class="n-title">This page can't be shown in the floating preview</div>
          <div class="n-why"></div>
          <div class="n-body">Peak Preview removes frame-blocking headers on this site, but something else still stops it loading here (for example a different domain or a script). You can still check it on a device:</div>
          <div class="n-actions">
            <button type="button" class="btn primary" data-act="exact">${ICON.exact}Emulate this tab instead</button>
            <button type="button" class="btn" data-act="workspace">${ICON.compare}Open comparison workspace</button>
          </div>
          <div class="n-foot">“Emulate this tab” turns the whole tab into the selected device, like Chrome DevTools. Click the Peak Preview icon again to stop.</div>
        </div>
        <div class="shield" hidden></div>
        <div class="toast" role="status" aria-live="polite"></div>
      </div>
      <footer class="foot" data-status="loading">
        <span class="status" tabindex="0" data-tip=""><i class="dot"></i><span class="stext">Loading…</span></span>
        <span class="path"></span>
        <button type="button" class="back" hidden data-tip="Load the page you're on">Back to page</button>
      </footer>
    </section>
    ${RESIZE_DIRS.map((d) => `<div class="rz" data-dir="${d}" aria-hidden="true"></div>`).join('')}
    <span class="corner" aria-hidden="true">${ICON.corner}</span>
  </div>
  <button type="button" class="launcher" hidden>${ICON.phone}<span class="ltext">Preview</span><span class="ldims"></span></button>
  <div class="menu" role="menu" hidden></div>
  <div class="tip" role="tooltip" hidden></div>
</div>`;

  // ---- build & bind -------------------------------------------------------
  function build() {
    host = document.createElement('peak-preview-root');
    host.setAttribute('popover', 'manual');
    host.setAttribute('data-state', 'open');
    host.style.cssText = HOST_CSS;
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${CSS}</style>${HTML}`;
    const $ = (s) => shadow.querySelector(s);
    el = {
      root: $('.pp'), frame: $('.frame'), win: $('.win'), bar: $('.bar'), grip: $('.grip'),
      devBtn: $('.devbtn'), devName: $('.devbtn .name'), dims: $('.dims'), zoom: $('.zoom'), zoomText: $('.ztext'),
      more: $('[data-act="more"]'), pin: $('[data-act="pin"]'), rotate: $('[data-act="rotate"]'),
      stage: $('.stage'), wrap: $('.wrap'), screen: $('.screen'), notice: $('.notice'), noticeWhy: $('.n-why'),
      shield: $('.shield'), toast: $('.toast'), foot: $('.foot'), status: $('.status'), statusText: $('.stext'),
      path: $('.path'), back: $('.back'), launcher: $('.launcher'), ldims: $('.ldims'),
      menu: $('.menu'), tip: $('.tip')
    };
    attachHost();
    bind();
    observer = new MutationObserver(() => {
      if (!destroyed && mode !== 'idle' && host && !host.isConnected) attachHost();
    });
    observer.observe(document.documentElement, { childList: true });
  }

  function attachHost() {
    (document.documentElement || document).appendChild(host);
    try { if (!host.matches(':popover-open')) host.showPopover(); } catch (_) { /* z-index fallback */ }
  }

  function bind() {
    // Keep the page from reacting to events that happen inside the widget.
    for (const t of ['keydown', 'keyup', 'keypress', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click',
      'dblclick', 'contextmenu', 'touchstart', 'touchend', 'touchmove', 'focusin', 'focusout', 'input', 'change']) {
      host.addEventListener(t, (e) => e.stopPropagation());
    }
    el.frame.addEventListener('wheel', (e) => { if (!e.composedPath().includes(el.menu)) e.preventDefault(); }, { passive: false });
    el.launcher.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

    el.bar.addEventListener('pointerdown', onBarPointerDown);
    el.bar.addEventListener('dblclick', (e) => { if (!e.target.closest('button:not(.grip)')) fitToWindow(); });
    el.grip.addEventListener('keydown', onGripKey);
    shadow.querySelectorAll('.rz').forEach((h) => h.addEventListener('pointerdown', onResizePointerDown));

    el.devBtn.addEventListener('click', () => toggleMenu(el.devBtn, deviceMenuItems, 'left'));
    el.zoom.addEventListener('click', () => toggleMenu(el.zoom, zoomMenuItems, 'left'));
    el.more.addEventListener('click', () => toggleMenu(el.more, moreMenuItems, 'right'));
    el.win.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b === el.more) return;
      onAction(b.dataset.act);
    });
    el.back.addEventListener('click', () => loadPreview(location.href));
    el.menu.addEventListener('keydown', onMenuKey);

    el.launcher.addEventListener('pointerdown', onLauncherPointerDown);
    el.launcher.addEventListener('click', () => restore());

    // tooltips
    el.root.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const t = e.target.closest('[data-tip]');
      if (t) queueTip(t);
    });
    el.root.addEventListener('pointerout', (e) => {
      const t = e.target.closest('[data-tip]');
      if (t && !t.contains(e.relatedTarget)) hideTip();
    });
    el.root.addEventListener('focusin', (e) => {
      const t = e.target.closest('[data-tip]');
      if (t && t.matches(':focus-visible')) showTip(t);
    });
    el.root.addEventListener('focusout', hideTip);
    el.root.addEventListener('pointerdown', hideTip, true);
    el.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuState) { e.preventDefault(); closeMenu(true); }
    });

    // page-level watchers
    on(window, 'resize', onViewportResize);
    on(window, 'message', onFrameMessage);
    on(window, 'popstate', checkHostUrl);
    on(window, 'hashchange', checkHostUrl);
    on(window, 'blur', () => closeMenu(false));
    on(window, 'pageshow', (e) => { if (e.persisted && mode !== 'idle') { send({ type: 'float:rules', uaEnv: currentEnv() }); reportState(); } });
    on(document, 'pointerdown', (e) => {
      if (!menuState) return;
      const path = e.composedPath();
      if (!path.includes(el.menu) && !path.includes(menuState.anchor)) closeMenu(false);
    }, true);
    on(document, 'securitypolicyviolation', (e) => {
      if (/^(frame-src|child-src|default-src)/.test(e.violatedDirective || '') && loadInfo &&
          String(e.blockedURI || '') && stripHash(loadInfo.url).startsWith(String(e.blockedURI))) {
        cspFrameViolation = { directive: e.violatedDirective, t: Date.now() };
      }
    });
    intervals.add(setInterval(checkHostUrl, 500));
    intervals.add(setInterval(() => { if (!runtimeOk()) destroy({ silent: true }); }, 2000));
  }

  // ---- painting -----------------------------------------------------------
  function applyGeom() {
    if (!el.frame) return;
    el.frame.style.width = geom.w + 'px';
    el.frame.style.height = geom.h + 'px';
    el.frame.style.transform = `translate3d(${geom.x}px, ${geom.y}px, 0)`;
    layoutScreen();
  }
  function schedule() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; applyGeom(); });
  }
  function layoutScreen() {
    syncResponsiveViewport();
    const v = viewportDims();
    const s = currentScale();
    el.wrap.style.width = Math.max(1, Math.round(v.w * s)) + 'px';
    el.wrap.style.height = Math.max(1, Math.round(v.h * s)) + 'px';
    el.screen.style.width = v.w + 'px';
    el.screen.style.height = v.h + 'px';
    el.screen.style.transform = `scale(${s})`;
    const d = baseDevice();
    const r = !d ? 2 : d.type === 'phone' ? Math.round((d.cut === 'home' ? 6 : 47) * s) : Math.round(22 * s);
    el.wrap.style.setProperty('--s', s);
    el.wrap.dataset.kind = d ? d.type : 'responsive';
    el.wrap.dataset.cut = d && d.cut ? d.cut : '';
    el.wrap.dataset.land = state.rotated && d ? '1' : '';
    el.frame.dataset.kind = d ? d.type : 'responsive';
    el.frame.dataset.cut = d && d.cut ? d.cut : '';
    el.wrap.style.borderRadius = Math.max(2, r) + 'px';
    el.dims.textContent = `${v.w} × ${v.h}`;
    el.dims.setAttribute('aria-label', `Viewport ${v.w} by ${v.h} CSS pixels`);
    el.zoomText.textContent = Math.round(s * 100) + '%';
    el.zoom.setAttribute('aria-label', `Zoom ${Math.round(s * 100)} percent`);
    el.ldims.textContent = `${v.w}×${v.h}`;
  }
  function paintChrome() {
    const d = baseDevice();
    el.devName.textContent = d ? d.name : 'Responsive';
    el.devBtn.setAttribute('aria-label', `Device: ${d ? d.name : 'Responsive'}. Change device`);
    el.pin.setAttribute('aria-pressed', String(!!state.pinned));
    const pinTip = state.pinned ? 'Pinned: stays open on other pages' : 'Keep open on other pages';
    el.pin.dataset.tip = pinTip;
    el.pin.setAttribute('aria-label', pinTip);
    el.launcher.setAttribute('aria-label', `Restore Peak Preview (${d ? d.name : 'Responsive'})`);
    el.launcher.querySelector('.ltext').textContent = d ? d.name : 'Responsive';
    paintStatus();
    paintFooter();
  }
  function setStatus(s) {
    status = s;
    paintStatus();
  }
  function paintStatus() {
    if (!el.foot) return;
    el.foot.dataset.status = status;
    const os = osLabel();
    let text = 'Loading…';
    let tip = 'Loading this page inside the preview…';
    if (status === 'live') {
      text = `Live · ${os}`;
      tip = isResponsive()
        ? 'Live page at a custom viewport size. No device user agent or touch emulation.'
        : `Live page at the device's CSS viewport. Page scripts see a ${os} user agent, touch input and the device screen size, and the page request uses the same user agent. It's still rendered by desktop Chrome, so fonts and browser UI can differ from a real device.`;
    } else if (status === 'blocked') {
      text = "Can't embed this page";
      tip = 'The site refused to load inside a frame. Use “Emulate this tab” or the comparison workspace.';
    }
    el.statusText.textContent = text;
    el.status.dataset.tip = tip;
    el.status.setAttribute('aria-label', `Status: ${text}. ${tip}`);
  }
  function paintFooter() {
    if (!el.path) return;
    el.path.textContent = previewUrl ? shortUrl(previewUrl) : '';
    el.path.title = previewTitle ? `${previewTitle}\n${previewUrl}` : previewUrl;
    el.back.hidden = !previewUrl || stripHash(previewUrl) === stripHash(location.href);
  }
  function toast(msg, ms = 2200) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast && el.toast.classList.remove('show'), ms);
  }

  // ---- tooltips -----------------------------------------------------------
  function queueTip(t) {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => showTip(t), 450);
  }
  function showTip(t) {
    clearTimeout(tipTimer);
    if (menuState || el.root.classList.contains('gesturing')) return;
    const text = t.dataset.tip;
    if (!text) return;
    const tip = el.tip;
    tip.textContent = text;
    tip.classList.toggle('wrap', text.length > 48);
    tip.hidden = false;
    const r = t.getBoundingClientRect();
    const vp = viewportSize();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = clamp(r.left + r.width / 2 - tw / 2, 6, vp.w - tw - 6);
    let y = r.bottom + 6;
    if (y + th > vp.h - 6) y = r.top - th - 6;
    tip.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    requestAnimationFrame(() => tip.classList.add('show'));
  }
  function hideTip() {
    clearTimeout(tipTimer);
    if (!el.tip) return;
    el.tip.classList.remove('show');
    el.tip.hidden = true;
  }

  // ---- menus --------------------------------------------------------------
  function deviceMenuItems() {
    const items = [];
    const groups = [['Phones', (d) => d.type === 'phone' && !d.custom], ['Tablets', (d) => d.type === 'tablet' && !d.custom], ['Custom sizes', (d) => d.custom]];
    for (const [label, test] of groups) {
      const list = deviceList().filter(test);
      if (!list.length) continue;
      items.push({ kind: 'label', text: label });
      for (const d of list) {
        items.push({ kind: 'radio', text: d.name, sub: `${d.w}×${d.h}`, checked: state.deviceId === d.id, onSelect: () => setDevice(d.id) });
      }
    }
    items.push({ kind: 'sep' });
    items.push({ kind: 'radio', text: 'Responsive', sub: 'free size', checked: isResponsive(), onSelect: () => setDevice(RESPONSIVE) });
    return items;
  }
  function zoomMenuItems() {
    const z = state.zoomPreset;
    return [
      { kind: 'radio', text: 'Fit to window', checked: z === 'fit', onSelect: () => setZoom('fit') },
      { kind: 'radio', text: '50%', checked: z === 0.5, onSelect: () => setZoom(0.5) },
      { kind: 'radio', text: '75%', checked: z === 0.75, onSelect: () => setZoom(0.75) },
      { kind: 'radio', text: '100%', checked: z === 1, onSelect: () => setZoom(1) }
    ];
  }
  function moreMenuItems() {
    const z = state.zoomPreset;
    return [
      { kind: 'label', text: 'Zoom' },
      { kind: 'seg', options: [
        { text: 'Fit', label: 'Fit to window', checked: z === 'fit', onSelect: () => setZoom('fit') },
        { text: '50%', checked: z === 0.5, onSelect: () => setZoom(0.5) },
        { text: '75%', checked: z === 0.75, onSelect: () => setZoom(0.75) },
        { text: '100%', checked: z === 1, onSelect: () => setZoom(1) }
      ] },
      { kind: 'sep' },
      { kind: 'check', text: 'Lock aspect ratio', checked: !isResponsive() && state.lockAspect, disabled: isResponsive(), onSelect: toggleLock },
      { kind: 'check', text: 'Follow page navigation', checked: state.follow, onSelect: toggleFollow },
      { kind: 'check', text: 'Keep open on other pages', checked: state.pinned, onSelect: togglePin },
      { kind: 'sep' },
      { kind: 'item', icon: ICON.compare, text: 'Compare all devices', onSelect: openWorkspace },
      { kind: 'item', icon: ICON.exact, text: 'Emulate this tab (exact mode)', disabled: isResponsive(), onSelect: startExact },
      { kind: 'item', icon: ICON.external, text: 'Open preview in this tab', onSelect: () => location.assign(previewUrl || location.href) },
      { kind: 'item', icon: ICON.reset, text: 'Reset size & position', onSelect: resetLayout }
    ];
  }

  function toggleMenu(anchor, build, align) {
    if (menuState && menuState.anchor === anchor) { closeMenu(true); return; }
    openMenu(anchor, build(), align);
  }
  function makeMenuItem(it, role) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mi';
    b.setAttribute('role', role);
    b.tabIndex = -1;
    if (role !== 'menuitem') b.setAttribute('aria-checked', String(!!it.checked));
    if (it.disabled) b.setAttribute('aria-disabled', 'true');
    if (it.label) b.setAttribute('aria-label', it.label);
    const ck = role === 'menuitem' ? '' : `<span class="ck">${ICON.check}</span>`;
    const ic = it.icon ? `<span class="ic">${it.icon}</span>` : '';
    const sb = it.sub ? `<span class="sb">${esc(it.sub)}</span>` : '';
    b.innerHTML = it.inSeg ? esc(it.text) : `${ck}${ic}<span class="tx">${esc(it.text)}</span>${sb}`;
    b.addEventListener('click', () => {
      if (it.disabled) return;
      closeMenu(true);
      it.onSelect();
    });
    return b;
  }
  function openMenu(anchor, items, align) {
    closeMenu(false);
    hideTip();
    const m = el.menu;
    m.replaceChildren();
    for (const it of items) {
      if (it.kind === 'label') {
        const d = document.createElement('div');
        d.className = 'lbl';
        d.setAttribute('role', 'presentation');
        d.textContent = it.text;
        m.appendChild(d);
      } else if (it.kind === 'sep') {
        const d = document.createElement('div');
        d.className = 'sep';
        d.setAttribute('role', 'separator');
        m.appendChild(d);
      } else if (it.kind === 'seg') {
        const g = document.createElement('div');
        g.className = 'seg';
        g.setAttribute('role', 'group');
        g.setAttribute('aria-label', 'Zoom');
        for (const o of it.options) g.appendChild(makeMenuItem(Object.assign({ inSeg: true }, o), 'menuitemradio'));
        m.appendChild(g);
      } else {
        m.appendChild(makeMenuItem(it, it.kind === 'check' ? 'menuitemcheckbox' : it.kind === 'radio' ? 'menuitemradio' : 'menuitem'));
      }
    }
    m.setAttribute('aria-label', anchor.getAttribute('aria-label') || 'Menu');
    m.hidden = false;
    m.style.maxHeight = '';
    const r = anchor.getBoundingClientRect();
    const vp = viewportSize();
    const mw = m.offsetWidth;
    let mh = m.offsetHeight;
    const left = clamp(align === 'right' ? r.right - mw : r.left, MARGIN, vp.w - mw - MARGIN);
    let top = r.bottom + 4;
    if (top + mh > vp.h - MARGIN) {
      if (r.top - 4 - mh >= MARGIN) top = r.top - 4 - mh;
      else { top = MARGIN; mh = vp.h - MARGIN * 2; m.style.maxHeight = mh + 'px'; }
    }
    m.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
    anchor.setAttribute('aria-expanded', 'true');
    menuState = { anchor };
    const focusables = menuButtons();
    const first = focusables.find((b) => b.getAttribute('aria-checked') === 'true') || focusables[0];
    if (first) first.focus({ preventScroll: true });
  }
  function closeMenu(returnFocus) {
    if (!menuState) return;
    const { anchor } = menuState;
    menuState = null;
    el.menu.hidden = true;
    el.menu.replaceChildren();
    anchor.setAttribute('aria-expanded', 'false');
    if (returnFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
  }
  const menuButtons = () => [...el.menu.querySelectorAll('.mi')].filter((b) => b.getAttribute('aria-disabled') !== 'true');
  function onMenuKey(e) {
    const list = menuButtons();
    if (!list.length) return;
    const i = list.indexOf(shadow.activeElement);
    let next = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % list.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Tab') { closeMenu(false); return; }
    if (next >= 0) { e.preventDefault(); list[next].focus({ preventScroll: true }); }
  }

  // ---- gestures -----------------------------------------------------------
  function track(e, target, onMove, onEnd) {
    const id = e.pointerId;
    try { target.setPointerCapture(id); } catch (_) {}
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved) {
        if (Math.abs(dx) + Math.abs(dy) < 3) return;
        moved = true;
      }
      onMove(dx, dy);
    };
    const end = (ev) => {
      if (ev.pointerId !== id) return;
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      target.removeEventListener('lostpointercapture', end);
      try { target.releasePointerCapture(id); } catch (_) {}
      onEnd(moved);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('lostpointercapture', end);
  }
  function swallowNextClick() {
    const kill = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    shadow.addEventListener('click', kill, true);
    setTimeout(() => shadow && shadow.removeEventListener('click', kill, true), 0);
  }
  function beginGesture(cls) {
    hideTip();
    closeMenu(false);
    el.shield.hidden = false;
    el.root.classList.add('gesturing');
    el.frame.classList.add(cls);
  }
  function endGesture(cls) {
    el.shield.hidden = true;
    el.root.classList.remove('gesturing');
    el.frame.classList.remove(cls);
  }

  function onBarPointerDown(e) {
    if (e.button !== 0 || mode !== 'open') return;
    if (e.target.closest('button:not(.grip)')) return;
    e.preventDefault();
    const ox = geom.x, oy = geom.y;
    beginGesture('moving');
    track(e, el.bar, (dx, dy) => {
      geom.x = ox + dx;
      geom.y = oy + dy;
      clampPos();
      schedule();
    }, (moved) => {
      endGesture('moving');
      if (moved) { rememberPos(); swallowNextClick(); }
    });
  }

  function onGripKey(e) {
    const step = e.shiftKey ? 64 : 16;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    geom.x += delta[0];
    geom.y += delta[1];
    clampPos();
    applyGeom();
    rememberPos();
  }

  function onResizePointerDown(e) {
    if (e.button !== 0 || mode !== 'open') return;
    e.preventDefault();
    const dir = e.currentTarget.dataset.dir;
    const start = { x: geom.x, y: geom.y, w: geom.w, h: geom.h };
    const vp = viewportSize();
    const locked = !isResponsive() && state.lockAspect;
    const vpRight = geom.x + geom.w / 2 > vp.w / 2;
    // Which edges stay put while resizing.
    const keepRight = dir.includes('w') || (!dir.includes('e') && locked && vpRight);
    const keepBottom = dir.includes('n');
    const maxW = keepRight ? start.x + start.w - MARGIN : vp.w - MARGIN - start.x;
    const maxH = keepBottom ? start.y + start.h - MARGIN : vp.h - MARGIN - start.y;
    const startScale = currentScale();
    beginGesture('resizing');
    track(e, e.currentTarget, (dx, dy) => {
      let w = start.w + (dir.includes('e') ? dx : dir.includes('w') ? -dx : 0);
      let h = start.h + (dir.includes('s') ? dy : dir.includes('n') ? -dy : 0);
      if (locked) {
        const v = viewportDims();
        // Scale changes continuously with the pointer, even when the screen is letterboxed.
        const sW = startScale + (w - start.w) / v.w;
        const sH = startScale + (h - start.h) / v.h;
        let s;
        if (dir === 'e' || dir === 'w') s = sW;
        else if (dir === 'n' || dir === 's') s = sH;
        else s = Math.max(sW, sH);
        const sMax = Math.min(1, (maxW - CW) / v.w, (maxH - CH) / v.h);
        s = clamp(s, Math.min(minScale(), sMax), sMax);
        ({ w, h } = sizeForScale(s));
      } else {
        w = clamp(w, MIN_W, dir.includes('e') || dir.includes('w') ? maxW : start.w);
        h = clamp(h, MIN_H, dir.includes('n') || dir.includes('s') ? maxH : start.h);
      }
      geom.w = Math.round(w);
      geom.h = Math.round(h);
      geom.x = keepRight ? start.x + start.w - geom.w : start.x;
      geom.y = keepBottom ? start.y + start.h - geom.h : start.y;
      schedule();
    }, (moved) => {
      endGesture('resizing');
      if (!moved) return;
      swallowNextClick();
      state.zoomPreset = null;
      if (locked) state.scale = currentScale();
      else state.size = { w: geom.w, h: geom.h };
      rememberPos();
    });
  }

  function onLauncherPointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = el.launcher.getBoundingClientRect();
    let lx = r.left, ly = r.top;
    track(e, el.launcher, (dx, dy) => {
      const vp = viewportSize();
      lx = clamp(r.left + dx, MARGIN, vp.w - r.width - MARGIN);
      ly = clamp(r.top + dy, MARGIN, vp.h - r.height - MARGIN);
      el.launcher.classList.add('moving');
      el.launcher.style.transform = `translate3d(${Math.round(lx)}px, ${Math.round(ly)}px, 0)`;
    }, (moved) => {
      el.launcher.classList.remove('moving');
      if (!moved) return;
      swallowNextClick();
      const vp = viewportSize();
      const right = lx + r.width / 2 > vp.w / 2;
      geom.x = right ? lx + r.width - geom.w : lx;
      geom.y = ly;
      clampPos();
      rememberPos();
      placeLauncher();
    });
  }
  function placeLauncher() {
    const vp = viewportSize();
    const lw = el.launcher.offsetWidth || 160, lh = el.launcher.offsetHeight || 36;
    const right = geom.x + geom.w / 2 > vp.w / 2;
    const lx = clamp(right ? geom.x + geom.w - lw : geom.x, MARGIN, vp.w - lw - MARGIN);
    const ly = clamp(geom.y, MARGIN, vp.h - lh - MARGIN);
    const t = `translate3d(${Math.round(lx)}px, ${Math.round(ly)}px, 0)`;
    el.launcher.style.transform = t;
    el.launcher.style.setProperty('--lt', t);
  }

  // ---- actions ------------------------------------------------------------
  function onAction(act) {
    switch (act) {
      case 'pin': togglePin(); break;
      case 'min': minimize(); break;
      case 'close': destroy(); break;
      case 'rotate': rotate(); break;
      case 'reload': loadPreview(previewUrl || location.href); break;
      case 'shot': screenshot(); break;
      case 'exact': startExact(); break;
      case 'workspace': openWorkspace(); break;
      default: break;
    }
  }

  function setDevice(id) {
    if (id === state.deviceId) return;
    const prevScale = currentScale();
    state.deviceId = id;
    state.rotated = false;
    if (isResponsive()) {
      const m = maxBox();
      state.respScale = Math.min(1, (m.w - CW) / state.respW, (m.h - CH) / state.respH);
      state.respScale = Math.max(0.25, Math.round(state.respScale * 100) / 100);
      const sz = sizeForScale(state.respScale);
      resizeKeepingAnchor(clamp(sz.w, MIN_W, m.w), clamp(sz.h, MIN_H, m.h));
    } else if (state.lockAspect) {
      const s = clampScale(state.zoomPreset === 'fit' ? fitScale() : (state.scale != null ? state.scale : prevScale));
      const sz = sizeForScale(s);
      resizeKeepingAnchor(sz.w, sz.h);
    } else {
      applyGeom();
    }
    paintChrome();
    save();
    loadPreview(previewUrl || location.href);
  }

  function rotate() {
    if (isResponsive()) {
      const t = state.respW;
      state.respW = state.respH;
      state.respH = t;
      const m = maxBox();
      const sz = sizeForScale(state.respScale);
      resizeKeepingAnchor(clamp(sz.w, MIN_W, m.w), clamp(sz.h, MIN_H, m.h));
    } else {
      state.rotated = !state.rotated;
      if (state.lockAspect) {
        const sz = sizeForScale(clampScale(state.scale != null ? state.scale : currentScale()));
        resizeKeepingAnchor(sz.w, sz.h);
      } else applyGeom();
      // Update what page scripts see on their next load (screen size / orientation).
      if (loadInfo && loadInfo.frame) loadInfo.frame.name = frameName();
    }
    save();
    toast(viewportDims().w > viewportDims().h ? 'Landscape' : 'Portrait', 1200);
  }

  function setZoom(z) {
    state.zoomPreset = z;
    const m = maxBox();
    if (isResponsive()) {
      const fit = Math.min(1, (m.w - CW) / state.respW, (m.h - CH) / state.respH);
      state.respScale = Math.max(0.25, z === 'fit' ? Math.floor(fit * 100) / 100 : Math.min(z, fit));
      const sz = sizeForScale(state.respScale);
      resizeKeepingAnchor(clamp(sz.w, MIN_W, m.w), clamp(sz.h, MIN_H, m.h));
    } else {
      const s = clampScale(z === 'fit' ? fitScale() : z);
      if (state.lockAspect) state.scale = s;
      const sz = sizeForScale(s);
      if (!state.lockAspect) state.size = sz;
      resizeKeepingAnchor(sz.w, sz.h);
      if (z !== 'fit' && s < z - 0.005) toast(`Shown at ${Math.round(s * 100)}% – ${Math.round(z * 100)}% doesn't fit this window`, 2600);
    }
    save();
  }
  function fitToWindow() { setZoom('fit'); }

  function toggleLock() {
    if (isResponsive()) return;
    state.lockAspect = !state.lockAspect;
    if (state.lockAspect) {
      state.scale = clampScale(currentScale());
      const sz = sizeForScale(state.scale);
      resizeKeepingAnchor(sz.w, sz.h);
    } else state.size = { w: geom.w, h: geom.h };
    save();
    toast(state.lockAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked – the device keeps its size, zoom adapts');
  }
  function toggleFollow() {
    state.follow = !state.follow;
    save();
    toast(state.follow ? 'Preview follows this page' : 'Preview stays on its current page');
    if (state.follow && stripHash(previewUrl) !== stripHash(location.href)) loadPreview(location.href);
  }
  function togglePin() {
    state.pinned = !state.pinned;
    save(true);
    paintChrome();
    toast(state.pinned ? 'Pinned – reopens on other pages in this tab' : 'Unpinned – closes when you leave this page');
  }
  function resetLayout() {
    state.pos = null;
    state.size = null;
    state.scale = null;
    state.zoomPreset = null;
    if (isResponsive()) { state.respScale = 1; state.respW = 390; state.respH = 720; }
    sizeFromState();
    restorePos();
    applyGeom();
    rememberPos();
  }
  async function openWorkspace() {
    await send({ type: 'viewer:open', url: previewUrl || location.href, mode: 'compare' });
  }
  async function startExact() {
    const d = baseDevice();
    if (!d) { toast('Pick a device first – Responsive has no device to emulate'); return; }
    toast('Starting exact mode…', 4000);
    save(true);
    // The service worker clears this widget's state before it reloads the tab.
    const res = await send({ type: 'exact:start', tabId: 'self', device: d, rotated: state.rotated });
    if (!res || !res.ok) {
      toast('Exact mode failed: ' + ((res && res.error) || 'unknown error'), 4000);
      return;
    }
    destroy({ silent: true });
  }

  async function screenshot() {
    if (status !== 'live') { toast('Nothing to capture yet'); return; }
    hideTip();
    closeMenu(false);
    await nextFrame();
    await nextFrame();
    const r = el.wrap.getBoundingClientRect();
    const iw = window.innerWidth, ih = window.innerHeight;
    const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top);
    const x1 = Math.min(iw, r.right), y1 = Math.min(ih, r.bottom);
    if (x1 - x0 < 8 || y1 - y0 < 8) { toast('Move the preview into view first'); return; }
    const res = await send({ type: 'float:capture' });
    if (!res || !res.ok) { toast('Screenshot failed' + (res && res.error ? `: ${res.error}` : '')); return; }
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('could not read capture'));
        i.src = res.dataUrl;
      });
      const k = img.naturalWidth / iw;
      const c = document.createElement('canvas');
      c.width = Math.round((x1 - x0) * k);
      c.height = Math.round((y1 - y0) * k);
      c.getContext('2d').drawImage(img, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, 0, 0, c.width, c.height);
      const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
      const v = viewportDims();
      const d = baseDevice();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${location.host.replace(/[^a-z0-9.-]+/gi, '_')}-${d ? d.id : 'responsive'}-${v.w}x${v.h}.png`;
      shadow.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Screenshot saved');
    } catch (err) {
      toast('Screenshot failed: ' + err.message);
    }
  }

  // ---- preview frame ------------------------------------------------------
  function frameName() {
    return 'ppv1:' + encodeURIComponent(JSON.stringify({ id: 'float', float: true, env: currentEnv() }));
  }

  async function loadPreview(url) {
    if (destroyed || mode === 'idle') return;
    const target = url || location.href;
    const seq = ++loadSeq;
    setStatus('loading');
    el.notice.hidden = true;
    cspFrameViolation = null;
    // Mobile user agent for the preview's page request (same-site frames in this tab only).
    const rr = await send({ type: 'float:rules', uaEnv: currentEnv() });
    rulesError = rr && rr.ok ? '' : (rr && rr.error) || 'no response from background';
    if (destroyed || seq !== loadSeq) return;
    const f = document.createElement('iframe');
    f.name = frameName();
    f.setAttribute('allow', 'fullscreen; autoplay; clipboard-write; encrypted-media; picture-in-picture');
    f.setAttribute('title', 'Mobile preview of this page');
    f.src = target;
    const info = { seq, url: target, frame: f, helloSinceLoad: false, everHello: false };
    loadInfo = info;
    f.addEventListener('load', () => {
      if (loadInfo !== info) return;
      if (info.helloSinceLoad) { info.helloSinceLoad = false; return; }
      setTimeout(() => {
        if (loadInfo !== info || info.helloSinceLoad) { info.helloSinceLoad = false; return; }
        showBlocked(info);
      }, 1200);
    });
    // A fresh frame each time keeps preview loads out of the tab's back/forward history.
    el.screen.replaceChildren(f);
    previewUrl = target;
    paintFooter();
  }

  function onFrameMessage(e) {
    const d = e.data;
    if (!d || d.__pp !== 1 || d.id !== 'float' || !loadInfo) return;
    if (e.source !== loadInfo.frame.contentWindow) return;
    if (d.type === 'url' && typeof d.url === 'string') {
      loadInfo.helloSinceLoad = true;
      loadInfo.everHello = true;
      previewUrl = d.url;
      previewTitle = d.title || '';
      if (status !== 'live') setStatus('live');
      el.notice.hidden = true;
      paintFooter();
    }
  }

  async function showBlocked(info) {
    setStatus('blocked');
    el.notice.hidden = false;
    el.noticeWhy.textContent = 'Checking why…';
    let why, detail = '';
    if (cspFrameViolation && Date.now() - cspFrameViolation.t < 15000) {
      why = `This page's own Content-Security-Policy (${cspFrameViolation.directive.split(' ')[0]}) doesn't allow frames.`;
    } else {
      const d = await send({ type: 'float:diagnose', url: info.url });
      if (loadInfo !== info) return;
      const cut = (s) => (s.length > 140 ? s.slice(0, 137) + '…' : s);
      if (d && d.ok) {
        detail = `[HTTP ${d.status}, header rules active: ${d.rules}${rulesError ? ', rules error: ' + rulesError : ''}${d.finalUrl && stripHash(d.finalUrl) !== stripHash(info.url) ? ', redirected to ' + shortUrl(d.finalUrl) : ''}]`;
        const xfo = String(d.xfo || '').toLowerCase();
        const fa = d.frameAncestors ? cut(d.frameAncestors) : '';
        if (fa && /'none'/.test(fa)) why = `The site sends Content-Security-Policy: ${fa}`;
        else if (xfo.includes('deny')) why = 'The site sends X-Frame-Options: DENY.';
        else if (fa) why = `The site only allows framing by: ${fa}`;
        else if (xfo.includes('sameorigin')) why = 'The site sends X-Frame-Options: SAMEORIGIN and the page moved to another origin.';
        else if (d.status >= 400) why = `The server answered HTTP ${d.status}.`;
        else why = "The page didn't start inside the frame. It may block framing with a script, or require being the top window.";
      } else {
        why = "The page couldn't be loaded (network error).";
      }
    }
    if (loadInfo === info && status === 'blocked') el.noticeWhy.textContent = why + (detail ? ' ' + detail : '');
  }

  function checkHostUrl() {
    if (location.href === lastHostUrl) return;
    lastHostUrl = location.href;
    paintFooter();
    if (!state.follow || mode === 'idle') return;
    if (mode === 'minimized') { pendingFollow = true; return; }
    clearTimeout(followTimer);
    followTimer = setTimeout(() => loadPreview(location.href), 250);
  }

  function onViewportResize() {
    if (mode === 'idle') return;
    if (isResponsive()) {
      const m = maxBox();
      geom.w = clamp(geom.w, MIN_W, m.w);
      geom.h = clamp(geom.h, MIN_H, m.h);
    } else if (state.lockAspect) {
      Object.assign(geom, sizeForScale(clampScale(state.zoomPreset === 'fit' ? fitScale() : (state.scale != null ? state.scale : currentScale()))));
    } else {
      const m = maxBox();
      const want = state.size || { w: geom.w, h: geom.h };
      geom.w = clamp(want.w, MIN_W, m.w);
      geom.h = clamp(want.h, MIN_H, m.h);
    }
    restorePos();
    applyGeom();
    if (mode === 'minimized') placeLauncher();
    if (menuState) closeMenu(false);
    hideTip();
  }

  // ---- lifecycle ----------------------------------------------------------
  function reportState() {
    send({ type: 'float:state', minimized: mode === 'minimized' });
    if (host) host.setAttribute('data-state', mode);
  }

  function openWidget(opts = {}) {
    if (destroyed) return Promise.resolve();
    if (mode === 'minimized' && !opts.minimized) { restore(); return Promise.resolve(); }
    if (mode !== 'idle') return Promise.resolve();
    if (opening) return opening;
    opening = (async () => {
      await loadSettings();
      if (destroyed || mode !== 'idle') return;
      build();
      mode = 'open';
      sizeFromState();
      restorePos();
      el.frame.hidden = false;
      applyGeom();
      paintChrome();
      el.frame.classList.add('entering');
      setTimeout(() => el.frame && el.frame.classList.remove('entering'), 220);
      loadPreview(location.href);
      if (opts.minimized) minimize();
      else reportState();
    })().finally(() => { opening = null; });
    return opening;
  }

  function minimize() {
    if (mode !== 'open') return;
    const hadFocus = shadow.activeElement != null;
    mode = 'minimized';
    closeMenu(false);
    hideTip();
    el.frame.hidden = true;
    el.launcher.hidden = false;
    placeLauncher();
    el.launcher.classList.remove('entering');
    void el.launcher.offsetWidth;
    el.launcher.classList.add('entering');
    if (hadFocus) el.launcher.focus({ preventScroll: true });
    reportState();
  }

  function restore() {
    if (mode !== 'minimized') return;
    mode = 'open';
    el.launcher.hidden = true;
    el.frame.hidden = false;
    onViewportResize();
    el.frame.classList.remove('entering');
    void el.frame.offsetWidth;
    el.frame.classList.add('entering');
    setTimeout(() => el.frame && el.frame.classList.remove('entering'), 220);
    if (pendingFollow) { pendingFollow = false; loadPreview(location.href); }
    if (shadow.activeElement === el.launcher) el.grip.focus({ preventScroll: true });
    reportState();
  }

  async function destroy(opts = {}) {
    if (destroyed) return;
    destroyed = true;
    const wasOpen = mode !== 'idle';
    mode = 'idle';
    if (wasOpen) save(true);
    for (const fn of cleanups.splice(0)) { try { fn(); } catch (_) {} }
    for (const id of intervals) clearInterval(id);
    intervals.clear();
    clearTimeout(followTimer); clearTimeout(saveTimer); clearTimeout(toastTimer); clearTimeout(tipTimer);
    if (rafId) cancelAnimationFrame(rafId);
    if (observer) observer.disconnect();
    try { if (host && host.matches(':popover-open')) host.hidePopover(); } catch (_) {}
    if (host) host.remove();
    host = null; shadow = null; el = {}; loadInfo = null;
    try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch (_) {}
    if (window.__ppFloating === api) delete window.__ppFloating;
    if (!opts.silent) await send({ type: 'float:closed' });
  }

  function onRuntimeMessage(msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== 'string' || msg.type.indexOf('float:') !== 0) return;
    if (destroyed) { sendResponse({ ok: false, gone: true }); return; }
    const supported = document.documentElement instanceof HTMLElement && !!document.body;
    switch (msg.type) {
      case 'float:toggle':
        if (!supported) { sendResponse({ ok: false, unsupported: true }); return; }
        if (opening) opening.then(() => destroy());
        else if (mode === 'idle') openWidget();
        else if (mode === 'minimized') restore();
        else destroy();
        sendResponse({ ok: true });
        return;
      case 'float:open':
        if (!supported) { sendResponse({ ok: false, unsupported: true }); return; }
        openWidget({ minimized: !!msg.minimized });
        sendResponse({ ok: true });
        return;
      case 'float:close':
        destroy();
        sendResponse({ ok: true });
        return;
      case 'float:ping':
        sendResponse({ ok: true, mode: opening ? 'opening' : mode });
        return;
      default:
        return;
    }
  }

  const api = {
    alive: () => !destroyed && runtimeOk(),
    destroy
  };
  window.__ppFloating = api;
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
})();
