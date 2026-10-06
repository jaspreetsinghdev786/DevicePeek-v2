// DevicePeek – SVG icons built with DOM APIs (24×24 grid, stroke style).
(function (g) {
  'use strict';
  const NS = (g.DevicePeek = g.DevicePeek || {});
  const SVG = 'http://www.w3.org/2000/svg';

  const SHAPES = {
    rotate: [
      ['rect', { x: 7, y: 3, width: 10, height: 18, rx: 2 }],
      ['path', { d: 'M3 12a9 9 0 0 1 4-7.5M21 12a9 9 0 0 1-4 7.5' }]
    ],
    reload: [['path', { d: 'M20 12a8 8 0 1 1-2.34-5.66' }], ['path', { d: 'M20 4v5h-5' }]],
    back: [['path', { d: 'M15 18l-6-6 6-6' }]],
    forward: [['path', { d: 'M9 18l6-6-6-6' }]],
    camera: [['path', { d: 'M4 8h3l2-3h6l2 3h3v11H4z' }], ['circle', { cx: 12, cy: 13, r: 3.5 }]],
    close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
    sync: [['path', { d: 'M8 4v16M8 4L5 7M8 4l3 3M16 20V4M16 20l-3-3M16 20l3-3' }]],
    follow: [
      ['path', { d: 'M10 14a4.5 4.5 0 0 0 6.36 0l3-3a4.5 4.5 0 0 0-6.36-6.36l-1.2 1.2' }],
      ['path', { d: 'M14 10a4.5 4.5 0 0 0-6.36 0l-3 3a4.5 4.5 0 0 0 6.36 6.36l1.2-1.2' }]
    ],
    external: [
      ['path', { d: 'M14 4h6v6M20 4l-9 9' }],
      ['path', { d: 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' }]
    ],
    warning: [['path', { d: 'M12 3.5l9 16H3z' }], ['path', { d: 'M12 10v4.5M12 17.5v.01' }]],
    float: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['rect', { x: 11, y: 10, width: 7, height: 7, rx: 1 }]],
    dock: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['path', { d: 'M14 4v16' }]],
    minimize: [['path', { d: 'M6 12h12' }]],
    maximize: [['rect', { x: 5, y: 5, width: 14, height: 14, rx: 1.5 }]],
    restore: [['rect', { x: 5, y: 8, width: 11, height: 11, rx: 1.5 }], ['path', { d: 'M8 5h9.5A1.5 1.5 0 0 1 19 6.5V16' }]],
    phone: [['rect', { x: 7, y: 2.5, width: 10, height: 19, rx: 2.5 }], ['path', { d: 'M11 18.5h2' }]]
  };

  function icon(name, size) {
    const s = size || 16;
    const svg = document.createElementNS(SVG, 'svg');
    const attrs = {
      viewBox: '0 0 24 24',
      width: s,
      height: s,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false'
    };
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v));
    for (const [tag, a] of SHAPES[name] || []) {
      const el = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(a)) el.setAttribute(k, String(v));
      svg.appendChild(el);
    }
    return svg;
  }

  NS.icon = icon;
})(globalThis);
