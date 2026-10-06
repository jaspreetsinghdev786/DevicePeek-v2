// DevicePeek – runs in the desktop page's own JS world (injected only while DevicePeek is open).
// Announces SPA route changes made with history.pushState / replaceState, which content
// scripts can't observe directly. Behaviour of the original methods is unchanged.
(() => {
  if (window.top !== window) return;
  const FLAG = Symbol.for('devicepeek.historyHooks');
  if (history[FLAG]) return;
  try {
    Object.defineProperty(history, FLAG, { value: true });
  } catch (e) {
    return;
  }
  const announce = () => {
    try {
      window.dispatchEvent(new Event('devicepeek:locationchange'));
    } catch (e) {}
  };
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    if (typeof original !== 'function') continue;
    history[name] = function () {
      const result = original.apply(this, arguments);
      announce();
      return result;
    };
  }
})();
