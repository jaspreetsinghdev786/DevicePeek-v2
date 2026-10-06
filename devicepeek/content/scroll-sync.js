// DevicePeek – scroll position of the desktop page as a 0..1 ratio.
// Works with the normal document scroller and with apps that scroll a large inner container.
(function (g) {
  'use strict';
  const NS = (g.DevicePeek = g.DevicePeek || {});
  const { clamp, rafThrottle } = NS.util;

  function createDesktopScroll(onScroll, getHost) {
    let scroller = null; // null = the document
    let lockUntil = 0;

    const docEl = () => document.scrollingElement || document.documentElement;
    const metrics = () => {
      if (scroller && scroller.isConnected) return { top: scroller.scrollTop, max: scroller.scrollHeight - scroller.clientHeight };
      return { top: docEl().scrollTop, max: docEl().scrollHeight - window.innerHeight };
    };
    const ratio = () => {
      const m = metrics();
      return m.max > 0 ? clamp(m.top / m.max, 0, 1) : 0;
    };
    const emit = rafThrottle(() => onScroll(ratio()));

    function onEvent(e) {
      const t = e.target;
      if (t === getHost()) return;
      if (t === document || t === document.documentElement || t === document.body) scroller = null;
      else if (t instanceof Element && t.clientHeight >= window.innerHeight * 0.5 && t.scrollHeight > t.clientHeight + 20) scroller = t;
      else return;
      if (Date.now() < lockUntil) return;
      emit();
    }
    document.addEventListener('scroll', onEvent, { capture: true, passive: true });

    return {
      ratio,
      set(r) {
        lockUntil = Date.now() + 200; // ignore the scroll events this causes (no echo loop)
        const m = metrics();
        const top = Math.round(clamp(r, 0, 1) * Math.max(0, m.max));
        if (scroller && scroller.isConnected) scroller.scrollTop = top;
        else window.scrollTo({ top, behavior: 'instant' });
      },
      stop() {
        document.removeEventListener('scroll', onEvent, { capture: true });
        emit.cancel();
      }
    };
  }

  NS.createDesktopScroll = createDesktopScroll;
})(globalThis);
