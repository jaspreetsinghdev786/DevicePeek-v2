// DevicePeek – runs in the page's own JS world, but only inside DevicePeek preview frames
// (recognised by window.name, which DevicePeek sets to "__dp:<os>:<dpr>:<id>").
//  - Makes navigator.userAgent etc. look like the chosen phone so JS mobile detection works.
//  - Reports the device pixel ratio of the chosen device.
//  - Keeps preview navigation out of the tab's Back/Forward history: pushState becomes
//    replaceState, and history.back()/forward() are routed to DevicePeek's own history.
(() => {
  try {
    if (window.top === window) return;
    const name = String(window.name || '');
    if (!name.startsWith('__dp:')) return;
    const [, os, dprText] = name.split(':');

    // Keep in sync with lib/devices.js
    const UA = {
      ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ipados: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      android: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
    };
    const android = os === 'android';
    const ua = UA[os] || UA.ios;

    const defNav = (key, value) => {
      try {
        Object.defineProperty(Navigator.prototype, key, { get: () => value, configurable: true });
      } catch (e) {}
    };
    defNav('userAgent', ua);
    defNav('appVersion', ua.replace(/^Mozilla\//, ''));
    defNav('platform', android ? 'Linux armv8l' : os === 'ipados' ? 'iPad' : 'iPhone');
    defNav('vendor', android ? 'Google Inc.' : 'Apple Computer, Inc.');
    defNav('maxTouchPoints', 5);
    if (android) {
      const brands = [
        { brand: 'Chromium', version: '131' },
        { brand: 'Google Chrome', version: '131' },
        { brand: 'Not_A Brand', version: '24' }
      ];
      const uaData = {
        brands,
        mobile: true,
        platform: 'Android',
        getHighEntropyValues: () =>
          Promise.resolve({ brands, mobile: true, platform: 'Android', platformVersion: '14.0.0', model: 'Pixel 8', architecture: '' }),
        toJSON: () => ({ brands, mobile: true, platform: 'Android' })
      };
      defNav('userAgentData', uaData);
    } else {
      defNav('userAgentData', undefined);
    }

    const dpr = Number(dprText);
    if (Number.isFinite(dpr) && dpr > 0) {
      try {
        Object.defineProperty(window, 'devicePixelRatio', { get: () => dpr, configurable: true });
      } catch (e) {}
    }

    // --- history -----------------------------------------------------------
    const H = History.prototype;
    const replace = H.replaceState;
    const notify = (type) => {
      try {
        window.dispatchEvent(new Event(type));
      } catch (e) {}
    };
    const toParent = (msg) => {
      try {
        window.parent.postMessage(Object.assign({ __dp: 1 }, msg), '*');
      } catch (e) {}
    };
    H.pushState = function (state, title, url) {
      const r = replace.call(this, state, title, url);
      notify('devicepeek:push');
      return r;
    };
    H.replaceState = function (state, title, url) {
      const r = replace.call(this, state, title, url);
      notify('devicepeek:replace');
      return r;
    };
    H.back = function () {
      toParent({ evt: 'history', delta: -1 });
    };
    H.forward = function () {
      toParent({ evt: 'history', delta: 1 });
    };
    H.go = function (delta) {
      const d = Math.trunc(Number(delta) || 0);
      if (d === 0) location.reload();
      else toParent({ evt: 'history', delta: d });
    };
  } catch (e) {}
})();
