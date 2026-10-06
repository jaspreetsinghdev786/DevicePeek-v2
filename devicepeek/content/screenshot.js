// DevicePeek – screenshot of the preview viewport only.
// The panel briefly shows the viewport unscaled (or as large as the window allows) in the
// top-left corner, the visible tab is captured, and the viewport area is cropped out.
(function (g) {
  'use strict';
  const NS = (g.DevicePeek = g.DevicePeek || {});
  const { send, slug } = NS.util;

  const frames = (n) =>
    new Promise((resolve) => {
      const step = (left) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
      step(n);
    });

  function fileName(vp, pageUrl) {
    let host = 'page';
    try {
      const u = new URL(pageUrl);
      host = u.hostname || (u.protocol === 'file:' ? 'local-file' : 'page');
    } catch (e) {}
    const dev = vp.device.id === 'custom' ? `custom-${vp.W}x${vp.H}` : slug(vp.device.name);
    return `devicepeek-${dev}${vp.landscape ? '-landscape' : ''}-${slug(host)}.png`;
  }

  // enterCapture(): puts the viewport in capture position and returns its screen element.
  // exitCapture(): restores the panel.
  async function captureViewport({ vp, pageUrl, enterCapture, exitCapture, downloadRoot }) {
    let rect;
    let dataUrl;
    try {
      const screenEl = enterCapture();
      await frames(2);
      await new Promise((r) => setTimeout(r, 60)); // let the frame repaint at the new scale
      rect = screenEl.getBoundingClientRect();
      const res = await send({ type: 'dp:capture' });
      if (!res || !res.dataUrl) throw new Error((res && (res.error || res.message)) || 'Capture failed');
      dataUrl = res.dataUrl;
    } finally {
      exitCapture();
    }
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const k = img.naturalWidth / window.innerWidth;
    const x = Math.max(0, rect.left);
    const y = Math.max(0, rect.top);
    const w = Math.min(window.innerWidth, rect.right) - x;
    const h = Math.min(window.innerHeight, rect.bottom) - y;
    if (w <= 0 || h <= 0) throw new Error('The preview is not visible.');
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);
    canvas.getContext('2d').drawImage(img, x * k, y * k, w * k, h * k, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('Could not encode the image.');
    const name = fileName(vp, pageUrl);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    downloadRoot.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return { name, width: canvas.width, height: canvas.height };
  }

  NS.captureViewport = captureViewport;
})(globalThis);
