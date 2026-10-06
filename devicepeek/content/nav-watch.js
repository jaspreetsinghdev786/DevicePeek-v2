// DevicePeek – detects URL changes of the desktop page (SPA routes, hash changes, back/forward).
// Signals: page-hooks.js (pushState/replaceState), popstate, hashchange, the Navigation API,
// plus a cheap 1.5 s string comparison as a safety net. Calls are debounced.
(function (g) {
  'use strict';
  const NS = (g.DevicePeek = g.DevicePeek || {});

  function createNavWatch(onChange) {
    let last = location.href;
    const check = () => {
      const href = location.href;
      if (href === last) return;
      const prev = last;
      last = href;
      onChange(href, prev);
    };
    const soon = NS.util.debounce(check, 150);
    const events = ['devicepeek:locationchange', 'popstate', 'hashchange'];
    events.forEach((e) => window.addEventListener(e, soon));

    let nav = null;
    try {
      if (window.navigation && typeof window.navigation.addEventListener === 'function') {
        nav = window.navigation;
        nav.addEventListener('currententrychange', soon);
      }
    } catch (e) {
      nav = null;
    }
    const poll = setInterval(() => {
      if (!document.hidden) check();
    }, 1500);

    return {
      stop() {
        events.forEach((e) => window.removeEventListener(e, soon));
        if (nav) nav.removeEventListener('currententrychange', soon);
        clearInterval(poll);
        soon.cancel();
      }
    };
  }

  NS.createNavWatch = createNavWatch;
})(globalThis);
