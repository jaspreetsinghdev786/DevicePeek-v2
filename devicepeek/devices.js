/* Peak Preview – shared device catalog.
 * Loaded by the viewer page, the floating preview (content script) and the service worker (importScripts).
 * Sizes are CSS pixels (the viewport a site's media queries see).
 */
(function (root) {
  'use strict';

  const chromeMajor = (() => {
    const m = /Chrome\/(\d+)/.exec((root.navigator && root.navigator.userAgent) || '');
    return m ? m[1] : '140';
  })();

  const UA = {
    ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    // iPadOS Safari asks for the desktop site by default and reports a Mac user agent.
    ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
    android: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Mobile Safari/537.36`,
    androidTablet: `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`
  };

  const DEVICES = [
    { id: 'iphone-se', name: 'iPhone SE', w: 375, h: 667, dpr: 2, type: 'phone', os: 'ios', cut: 'home' },
    { id: 'iphone-14', name: 'iPhone 13 / 14', w: 390, h: 844, dpr: 3, type: 'phone', os: 'ios', cut: 'notch' },
    { id: 'iphone-16', name: 'iPhone 15 / 16', w: 393, h: 852, dpr: 3, type: 'phone', os: 'ios', cut: 'island' },
    { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max', w: 440, h: 956, dpr: 3, type: 'phone', os: 'ios', cut: 'island' },
    { id: 'android-360', name: 'Android (common)', w: 360, h: 800, dpr: 3, type: 'phone', os: 'android', cut: 'punch' },
    { id: 'pixel-7', name: 'Pixel 7', w: 412, h: 915, dpr: 2.625, type: 'phone', os: 'android', cut: 'punch' },
    { id: 'ipad-mini', name: 'iPad mini', w: 768, h: 1024, dpr: 2, type: 'tablet', os: 'ipados', cut: 'dot' },
    { id: 'ipad-air', name: 'iPad Air', w: 820, h: 1180, dpr: 2, type: 'tablet', os: 'ipados', cut: 'dot' },
    { id: 'android-tablet', name: 'Android tablet', w: 800, h: 1280, dpr: 2, type: 'tablet', os: 'android', cut: 'dot' },
    { id: 'laptop', name: 'Laptop', w: 1366, h: 768, dpr: 1, type: 'desktop', os: 'desktop', cut: 'webcam' },
    { id: 'laptop-hd', name: 'Laptop HD', w: 1536, h: 864, dpr: 1.25, type: 'desktop', os: 'desktop', cut: 'macnotch' },
    { id: 'desktop-fhd', name: 'Desktop Full HD', w: 1920, h: 1080, dpr: 1, type: 'desktop', os: 'desktop' }
  ];

  const MODES = {
    mobile: { label: 'Mobile', devices: ['iphone-16', 'android-360', 'iphone-se'] },
    tablet: { label: 'Tablet', devices: ['ipad-mini', 'ipad-air', 'android-tablet'] },
    desktop: { label: 'Desktop', devices: ['laptop', 'desktop-fhd'] },
    compare: { label: 'Compare', devices: ['iphone-16', 'ipad-air', 'laptop'] }
  };

  function typeForWidth(w) {
    if (w < 600) return 'phone';
    if (w < 1100) return 'tablet';
    return 'desktop';
  }

  function makeCustom(w, h, name) {
    const type = typeForWidth(w);
    return {
      id: `custom-${w}x${h}`,
      name: name || `Custom ${w}×${h}`,
      w, h,
      dpr: type === 'desktop' ? 1 : 2,
      type,
      os: type === 'desktop' ? 'desktop' : 'android',
      cut: type === 'phone' ? 'punch' : type === 'tablet' ? 'dot' : 'webcam',
      custom: true
    };
  }

  /** What a device should report to the page. null = use the real browser as-is. */
  function envFor(d, rotated) {
    if (!d || d.type === 'desktop') return null;
    const w = rotated ? d.h : d.w;
    const h = rotated ? d.w : d.h;
    const base = { screen: { w, h }, dpr: d.dpr, touch: true };
    if (d.os === 'ios') {
      return Object.assign(base, { ua: UA.ios, platform: 'iPhone', vendor: 'Apple Computer, Inc.', mobile: true, uaData: null });
    }
    if (d.os === 'ipados') {
      return Object.assign(base, { ua: UA.ipad, platform: 'MacIntel', vendor: 'Apple Computer, Inc.', mobile: false, uaData: null });
    }
    const phone = d.type === 'phone';
    return Object.assign(base, {
      ua: phone ? UA.android : UA.androidTablet,
      platform: 'Linux armv81',
      vendor: 'Google Inc.',
      mobile: phone,
      uaData: { platform: 'Android', mobile: phone, platformVersion: '10.0.0', model: 'K' }
    });
  }

  function allDevices(custom) {
    return DEVICES.concat(Array.isArray(custom) ? custom : []);
  }

  function findDevice(id, custom) {
    return allDevices(custom).find((d) => d.id === id) || null;
  }

  /** "example.com" -> "https://example.com/", "localhost:3000" -> "http://localhost:3000/". '' if not a web URL. */
  function normalizeUrl(input) {
    const s = String(input || '').trim();
    if (!s) return '';
    const check = (v) => {
      try {
        const u = new URL(v);
        return /^https?:$/.test(u.protocol) && u.hostname ? u.href : '';
      } catch (_) { return ''; }
    };
    if (/^https?:\/\//i.test(s)) return check(s);
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/i.test(s)) return check('http://' + s);
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) return ''; // chrome:, file:, about:, …
    return check('https://' + s);
  }

  root.PeakDevices = { UA, DEVICES, MODES, envFor, makeCustom, allDevices, findDevice, typeForWidth, normalizeUrl };
})(typeof self !== 'undefined' ? self : this);
