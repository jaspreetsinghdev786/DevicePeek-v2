// DevicePeek – user preferences stored in chrome.storage.local.
// One storage key holds everything; the popup and every open panel write to it and
// react to chrome.storage.onChanged, so settings stay in sync everywhere.
(function (g) {
  'use strict';
  const NS = (g.DevicePeek = g.DevicePeek || {});

  const KEY = 'devicepeek:prefs';
  const LEGACY_KEY = 'mvxState'; // v1.0 settings, migrated once
  const LIMITS = Object.freeze({
    panelMin: 280,
    panelMaxRatio: 0.7,
    dimMin: 200,
    dimMax: 2560,
    zoomMin: 0.1,
    zoomMax: 3,
    floatMinW: 280,
    floatMinH: 240
  });
  const DEFAULTS = Object.freeze({
    deviceId: 'iphone15pro',
    customW: 390,
    customH: 844,
    landscape: false,
    zoom: 'fit', // 'fit' or a scale factor (0.5 = 50%)
    panelWidth: 430,
    syncScroll: true,
    syncScrollTwoWay: false,
    followPage: true,
    mode: 'side', // 'side' = docked, page reflows next to the panel; 'floating' = movable window over the page
    floatX: null, // floating window position/size; null = default placement
    floatY: null,
    floatW: null,
    floatH: null,
    openFromPopup: true, // clicking the toolbar icon opens the preview right away
    debugHud: false // viewport readout (configured vs. actual size) over the preview
  });
  const ZOOM_PRESETS = Object.freeze(['fit', 0.5, 0.75, 1, 1.25]);

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const num = (v, d) => {
    const n = Number(v);
    return v !== null && v !== '' && Number.isFinite(n) ? n : d;
  };

  const optInt = (v, lo, hi) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(clamp(Number(v), lo, hi)));

  function normalize(input) {
    const p = Object.assign({}, DEFAULTS, input && typeof input === 'object' ? input : {});
    return {
      deviceId: NS.devices && NS.devices.has(p.deviceId) ? p.deviceId : DEFAULTS.deviceId,
      customW: Math.round(clamp(num(p.customW, DEFAULTS.customW), LIMITS.dimMin, LIMITS.dimMax)),
      customH: Math.round(clamp(num(p.customH, DEFAULTS.customH), LIMITS.dimMin, LIMITS.dimMax)),
      landscape: !!p.landscape,
      zoom: p.zoom === 'fit' ? 'fit' : clamp(num(p.zoom, 1), LIMITS.zoomMin, LIMITS.zoomMax),
      panelWidth: Math.round(Math.max(LIMITS.panelMin, num(p.panelWidth, DEFAULTS.panelWidth))),
      syncScroll: !!p.syncScroll,
      syncScrollTwoWay: !!p.syncScrollTwoWay,
      followPage: !!p.followPage,
      mode: p.mode === 'floating' || p.mode === 'overlay' ? 'floating' : 'side', // 'overlay' = 2.0.0 name
      floatX: optInt(p.floatX, 0, 20000),
      floatY: optInt(p.floatY, 0, 20000),
      floatW: optInt(p.floatW, LIMITS.floatMinW, 20000),
      floatH: optInt(p.floatH, LIMITS.floatMinH, 20000),
      openFromPopup: !!p.openFromPopup,
      debugHud: !!p.debugHud
    };
  }

  function fromLegacy(s) {
    if (!s || typeof s !== 'object') return null;
    const d = (Array.isArray(s.devices) && s.devices[0]) || {};
    return {
      deviceId: d.id,
      landscape: !!d.land,
      customW: d.cw,
      customH: d.ch,
      zoom: s.zoom === 'fit' || s.zoom == null ? 'fit' : Number(s.zoom),
      syncScroll: s.sync !== false
    };
  }

  async function load() {
    const r = await chrome.storage.local.get([KEY, LEGACY_KEY]);
    if (r[KEY]) return normalize(r[KEY]);
    const migrated = normalize(fromLegacy(r[LEGACY_KEY]) || {});
    try {
      await chrome.storage.local.set({ [KEY]: migrated });
    } catch (e) {
      console.warn('[DevicePeek] could not store settings:', e);
    }
    return migrated;
  }

  // Writes are queued so quick successive changes don't overwrite each other.
  let queue = Promise.resolve();
  function save(patch) {
    const run = queue.then(async () => {
      const r = await chrome.storage.local.get(KEY);
      const next = normalize(Object.assign({}, r[KEY], patch));
      await chrome.storage.local.set({ [KEY]: next });
      return next;
    });
    queue = run.catch((e) => console.warn('[DevicePeek] could not save settings:', e));
    return run;
  }

  function onChange(cb) {
    const listener = (changes, area) => {
      if (area === 'local' && changes[KEY] && changes[KEY].newValue) {
        cb(normalize(changes[KEY].newValue), normalize(changes[KEY].oldValue));
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  // Panel width allowed for a given browser viewport width.
  function clampPanelWidth(w, viewportWidth) {
    const max = Math.max(LIMITS.panelMin, Math.floor(viewportWidth * LIMITS.panelMaxRatio));
    return Math.round(clamp(num(w, DEFAULTS.panelWidth), LIMITS.panelMin, max));
  }

  NS.prefs = { KEY, LIMITS, DEFAULTS, ZOOM_PRESETS, normalize, load, save, onChange, clampPanelWidth };
})(globalThis);
