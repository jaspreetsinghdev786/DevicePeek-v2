/* Peak Preview – runs in the page's own JS world at document_start, in every frame,
 * but only does anything inside a Peak Preview device frame:
 *   - a frame of the comparison workspace (parent is the extension page), or
 *   - the floating preview frame (parent is the page itself; flagged float:true).
 * Makes JS-based device detection see a phone/tablet: user agent, platform,
 * touch support, screen size, pixel ratio and pointer/hover media queries.
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
  if (!cfg) return;
  if (!cfg.float && anc[0].indexOf('chrome-extension://') !== 0) return;
  const env = cfg.env;
  if (!env || !env.ua) return;

  const define = (target, prop, value) => {
    try {
      Object.defineProperty(target, prop, { configurable: true, enumerable: true, get() { return value; } });
    } catch (_) { /* ignore */ }
  };

  const N = Navigator.prototype;
  const realUAData = navigator.userAgentData;

  define(N, 'userAgent', env.ua);
  define(N, 'appVersion', env.ua.replace(/^Mozilla\//, ''));
  define(N, 'platform', env.platform);
  define(N, 'vendor', env.vendor);
  define(N, 'maxTouchPoints', env.touch ? 5 : 0);

  if ('userAgentData' in N) {
    if (env.uaData) {
      const brands = realUAData ? realUAData.brands : [];
      const low = { brands, mobile: !!env.uaData.mobile, platform: env.uaData.platform };
      const high = Object.assign({}, low, {
        architecture: '',
        bitness: '',
        model: env.uaData.model || '',
        platformVersion: env.uaData.platformVersion || '',
        fullVersionList: brands,
        wow64: false
      });
      const fake = Object.assign({}, low, {
        getHighEntropyValues(hints) {
          const out = Object.assign({}, low);
          (hints || []).forEach((h) => { if (h in high) out[h] = high[h]; });
          return Promise.resolve(out);
        },
        toJSON() { return Object.assign({}, low); }
      });
      define(N, 'userAgentData', fake);
    } else {
      define(N, 'userAgentData', undefined); // Safari has no UA client hints
    }
  }

  if (env.screen) {
    const S = Screen.prototype;
    define(S, 'width', env.screen.w);
    define(S, 'height', env.screen.h);
    define(S, 'availWidth', env.screen.w);
    define(S, 'availHeight', env.screen.h);
  }
  if (env.dpr) define(window, 'devicePixelRatio', env.dpr);

  if (env.touch) {
    try { if (!('ontouchstart' in window)) window.ontouchstart = null; } catch (_) {}
    const realMatchMedia = window.matchMedia;
    const YES = '(min-width: 0px)';
    const NO = '(max-width: 0px)';
    const rewrite = (q) => String(q)
      .replace(/\(\s*(?:any-)?pointer\s*:\s*coarse\s*\)/gi, YES)
      .replace(/\(\s*(?:any-)?pointer\s*:\s*fine\s*\)/gi, NO)
      .replace(/\(\s*(?:any-)?hover\s*:\s*none\s*\)/gi, YES)
      .replace(/\(\s*(?:any-)?hover\s*:\s*hover\s*\)/gi, NO);
    try {
      window.matchMedia = function matchMedia(q) { return realMatchMedia.call(window, rewrite(q)); };
    } catch (_) {}
  }
})();
