// DevicePeek – compatibility preview host.
// Used when the desktop page's own Content-Security-Policy forbids frames. This extension
// page is allowed on any site and hosts the real preview frame, relaying messages both ways.
(() => {
  let cfg = {};
  try {
    cfg = JSON.parse(decodeURIComponent(location.hash.slice(1)));
  } catch (e) {}
  const url = /^(https?|file):/i.test(String(cfg.url || '')) ? cfg.url : 'about:blank';

  const frame = document.createElement('iframe');
  frame.name = String(cfg.name || '');
  frame.setAttribute('sandbox', String(cfg.sandbox || ''));
  frame.setAttribute('allow', String(cfg.allow || ''));
  frame.src = url;
  document.body.appendChild(frame);

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.__dp !== 1) return;
    if (e.source === parent && d.cmd) {
      if (frame.contentWindow) frame.contentWindow.postMessage(d, '*');
    } else if (e.source === frame.contentWindow && d.evt) {
      parent.postMessage(d, '*');
    }
  });
  frame.addEventListener('load', () => parent.postMessage({ __dp: 1, evt: 'frameload' }, '*'));
})();
