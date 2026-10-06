// DevicePeek – device presets and viewport helpers.
// Shared by the service worker, the popup and the content scripts (attaches to globalThis.DevicePeek).
(function (g) {
  'use strict';
  const NS = (g.DevicePeek = g.DevicePeek || {});

  // User-Agent strings sent by the preview frame (header + navigator.userAgent).
  // Keep in sync with frame-main.js, which runs in the page world and can't read this file.
  const UA = {
    ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    ipados: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    android: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
  };

  // CSS viewport sizes (portrait). dpr = device pixel ratio reported to page scripts.
  const DEVICES = [
    { id: 'iphone15pro', name: 'iPhone 15 Pro', group: 'iPhone', w: 393, h: 852, dpr: 3, os: 'ios' },
    { id: 'iphone15promax', name: 'iPhone 15 Pro Max', group: 'iPhone', w: 430, h: 932, dpr: 3, os: 'ios' },
    { id: 'iphone14', name: 'iPhone 14', group: 'iPhone', w: 390, h: 844, dpr: 3, os: 'ios' },
    { id: 'iphone14pro', name: 'iPhone 14 Pro', group: 'iPhone', w: 393, h: 852, dpr: 3, os: 'ios' },
    { id: 'iphone13mini', name: 'iPhone 13 mini', group: 'iPhone', w: 375, h: 812, dpr: 3, os: 'ios' },
    { id: 'iphonese', name: 'iPhone SE', group: 'iPhone', w: 375, h: 667, dpr: 2, os: 'ios' },
    { id: 'galaxys24', name: 'Samsung Galaxy S24', group: 'Android', w: 360, h: 780, dpr: 3, os: 'android' },
    { id: 'galaxys23ultra', name: 'Samsung Galaxy S23 Ultra', group: 'Android', w: 384, h: 824, dpr: 3.75, os: 'android' },
    { id: 'galaxys20', name: 'Samsung Galaxy S20', group: 'Android', w: 360, h: 800, dpr: 3, os: 'android' },
    { id: 'galaxyfold', name: 'Galaxy Z Fold (folded)', group: 'Android', w: 344, h: 882, dpr: 3, os: 'android' },
    { id: 'pixel8', name: 'Google Pixel 8', group: 'Android', w: 412, h: 915, dpr: 2.625, os: 'android' },
    { id: 'pixel7', name: 'Google Pixel 7', group: 'Android', w: 412, h: 915, dpr: 2.625, os: 'android' },
    { id: 'ipadmini', name: 'iPad Mini', group: 'Tablet', w: 768, h: 1024, dpr: 2, os: 'ipados' },
    { id: 'ipadair', name: 'iPad Air', group: 'Tablet', w: 820, h: 1180, dpr: 2, os: 'ipados' },
    { id: 'ipadpro', name: 'iPad Pro 12.9"', group: 'Tablet', w: 1024, h: 1366, dpr: 2, os: 'ipados' },
    { id: 'custom', name: 'Custom', group: 'Custom', w: 390, h: 844, dpr: 2, os: 'android' }
  ];
  const GROUPS = ['iPhone', 'Android', 'Tablet', 'Custom'];
  const byId = new Map(DEVICES.map((d) => [d.id, d]));
  const DEFAULT_ID = 'iphone15pro';

  function get(id) {
    return byId.get(id) || byId.get(DEFAULT_ID);
  }

  // Effective viewport for a prefs object (device + custom size + orientation).
  function resolve(prefs) {
    const device = get(prefs && prefs.deviceId);
    let w = device.w;
    let h = device.h;
    if (device.id === 'custom') {
      w = prefs.customW || device.w;
      h = prefs.customH || device.h;
    }
    const landscape = !!(prefs && prefs.landscape);
    if (landscape) [w, h] = [h, w];
    return { device, W: w, H: h, dpr: device.dpr, os: device.os, landscape };
  }

  // Fills a <select> with grouped device options (popup + panel share this).
  function fillSelect(select) {
    const doc = select.ownerDocument;
    select.textContent = '';
    for (const group of GROUPS) {
      const og = doc.createElement('optgroup');
      og.label = group;
      for (const dev of DEVICES.filter((x) => x.group === group)) {
        const o = doc.createElement('option');
        o.value = dev.id;
        o.textContent = dev.id === 'custom' ? 'Custom size' : dev.name;
        og.appendChild(o);
      }
      select.appendChild(og);
    }
  }

  NS.devices = { UA, DEVICES, GROUPS, DEFAULT_ID, get, has: (id) => byId.has(id), resolve, fillSelect };
})(globalThis);
