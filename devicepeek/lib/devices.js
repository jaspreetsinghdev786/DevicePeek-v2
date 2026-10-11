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
  // frame = the look of the optional device bezel drawn around the viewport (never inside it):
  //   phone  – modern edge-to-edge phone   home – phone with a home button (iPhone SE)
  //   tablet – tablet
  const DEVICES = [
    { id: 'iphone15pro', name: 'iPhone 15 Pro', group: 'iPhone', w: 393, h: 852, dpr: 3, os: 'ios', frame: 'phone' },
    { id: 'iphone15promax', name: 'iPhone 15 Pro Max', group: 'iPhone', w: 430, h: 932, dpr: 3, os: 'ios', frame: 'phone' },
    { id: 'iphone14', name: 'iPhone 14', group: 'iPhone', w: 390, h: 844, dpr: 3, os: 'ios', frame: 'phone' },
    { id: 'iphone14pro', name: 'iPhone 14 Pro', group: 'iPhone', w: 393, h: 852, dpr: 3, os: 'ios', frame: 'phone' },
    { id: 'iphone13mini', name: 'iPhone 13 mini', group: 'iPhone', w: 375, h: 812, dpr: 3, os: 'ios', frame: 'phone' },
    { id: 'iphonese', name: 'iPhone SE', group: 'iPhone', w: 375, h: 667, dpr: 2, os: 'ios', frame: 'home' },
    { id: 'galaxys24', name: 'Samsung Galaxy S24', group: 'Android', w: 360, h: 780, dpr: 3, os: 'android', frame: 'phone' },
    { id: 'galaxys23ultra', name: 'Samsung Galaxy S23 Ultra', group: 'Android', w: 384, h: 824, dpr: 3.75, os: 'android', frame: 'phone' },
    { id: 'galaxys20', name: 'Samsung Galaxy S20', group: 'Android', w: 360, h: 800, dpr: 3, os: 'android', frame: 'phone' },
    { id: 'galaxyfold', name: 'Galaxy Z Fold (folded)', group: 'Android', w: 344, h: 882, dpr: 3, os: 'android', frame: 'phone' },
    { id: 'pixel8', name: 'Google Pixel 8', group: 'Android', w: 412, h: 915, dpr: 2.625, os: 'android', frame: 'phone' },
    { id: 'pixel7', name: 'Google Pixel 7', group: 'Android', w: 412, h: 915, dpr: 2.625, os: 'android', frame: 'phone' },
    { id: 'ipadmini', name: 'iPad Mini', group: 'Tablet', w: 768, h: 1024, dpr: 2, os: 'ipados', frame: 'tablet' },
    { id: 'ipadair', name: 'iPad Air', group: 'Tablet', w: 820, h: 1180, dpr: 2, os: 'ipados', frame: 'tablet' },
    { id: 'ipadpro', name: 'iPad Pro 12.9"', group: 'Tablet', w: 1024, h: 1366, dpr: 2, os: 'ipados', frame: 'tablet' },
    { id: 'custom', name: 'Custom', group: 'Custom', w: 390, h: 844, dpr: 2, os: 'android', frame: 'phone' }
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
    // A custom size gets a tablet bezel once it's tablet-sized.
    const frame = device.id === 'custom' && Math.min(w, h) >= 600 ? 'tablet' : device.frame;
    if (landscape) [w, h] = [h, w];
    return { device, W: w, H: h, dpr: device.dpr, os: device.os, landscape, frame };
  }

  // Bezel geometry in CSS px, drawn around the viewport (padding), never on top of it.
  // pad = [top, right, bottom, left]; outer/screen = corner radii.
  const FRAMES = {
    phone: { pad: [14, 14, 14, 14], outer: 54, screen: 40 },
    home: { pad: [72, 16, 72, 16], outer: 52, screen: 2 },
    tablet: { pad: [22, 22, 22, 22], outer: 40, screen: 18 }
  };
  function frameGeometry(frame, landscape) {
    const f = FRAMES[frame] || FRAMES.phone;
    const [t, r, b, l] = f.pad;
    // Rotating the device by 90° moves the top bezel to the left.
    const pad = landscape ? [r, b, l, t] : [t, r, b, l];
    return { pad, outer: f.outer, screen: f.screen };
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

  NS.devices = { UA, DEVICES, GROUPS, DEFAULT_ID, get, has: (id) => byId.has(id), resolve, fillSelect, frameGeometry };
})(globalThis);
