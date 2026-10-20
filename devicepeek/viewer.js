/* Peak Preview – multi-device viewer */
(() => {
  'use strict';

  const { MODES, envFor, makeCustom, allDevices, findDevice, normalizeUrl } = window.PeakDevices;
  const $ = (sel, el = document) => el.querySelector(sel);

  /* ---------------- Icons ---------------- */
  const svg = (paths, size = 16) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const ICON = {
    phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
    tablet: svg('<rect x="4.5" y="2.5" width="15" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
    desktop: svg('<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>'),
    compare: svg('<rect x="2.5" y="6" width="6" height="12" rx="1.5"/><rect x="10.5" y="4" width="11" height="10" rx="1.5"/><path d="M14 18h4"/>'),
    custom: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
    reload: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
    rotate: svg('<rect x="3" y="9" width="12" height="12" rx="2"/><path d="M13 3h3a5 5 0 0 1 5 5v1"/><path d="m19 7 2 2 2-2"/>'),
    camera: svg('<path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/>'),
    exact: svg('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="9" y="7.5" width="6" height="9" rx="1.2"/>'),
    external: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    trash: svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>', 14),
    globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9S14.600 18.400 12 21c-2.600-2.600-3.900-5.600-3.900-9S9.400 5.600 12 3Z"/>'),
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 18),
    frame: svg('<rect x="6" y="2.5" width="12" height="19" rx="3"/>'),
    scroll: svg('<rect x="7" y="2.5" width="10" height="19" rx="5"/><path d="M12 7v3"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1"/><path d="M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1"/>'),
    grid: svg('<rect x="3.500" y="3.500" width="7" height="7" rx="1.500"/><rect x="13.500" y="3.500" width="7" height="7" rx="1.500"/><rect x="3.500" y="13.500" width="7" height="7" rx="1.500"/><rect x="13.500" y="13.500" width="7" height="7" rx="1.500"/>'),
    newtab: svg('<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M12 12.500v5M9.500 15h5"/>'),
    sliders: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
    hero: `<svg width="132" height="84" viewBox="0 0 132 84" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" aria-hidden="true"><rect x="34" y="6" width="78" height="52" rx="5"/><path d="M60 72h26M73 58v14" stroke-linecap="round"/><rect x="10" y="30" width="28" height="48" rx="6" fill="var(--bg)"/><path d="M21 71h6" stroke-linecap="round"/><rect x="100" y="34" width="24" height="44" rx="5" fill="var(--bg)"/></svg>`
  };

  /* ---------------- State ---------------- */
  const GAP = 28, PAD = 28, HEAD = 44, FOOT = 30, MIN_CARD = 250;

  const settings = {
    zoom: 'fit',
    frames: true,
    syncScroll: true,
    syncNav: false,
    openIn: 'same',
    custom: [],
    selected: ['iphone-16', 'android-360', 'ipad-air', 'laptop'],
    lastMode: 'compare'
  };
  const state = { url: '', mode: 'compare', rotated: {} };
  const cards = new Map();

  const grid = $('#grid');
  const canvas = $('#canvas');

  /* ---------------- Helpers ---------------- */
  async function loadSettings() {
    try {
      const { settings: saved } = await chrome.storage.local.get('settings');
      if (saved && typeof saved === 'object') Object.assign(settings, saved);
    } catch (_) {}
  }
  function saveSettings() {
    try { chrome.storage.local.set({ settings }); } catch (_) {}
  }

  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  function host(url) {
    try { return new URL(url).host; } catch (_) { return url; }
  }

  function parseHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    return { url: p.get('url') || '', mode: p.get('mode') || '', notice: p.get('notice') || '' };
  }
  function writeHash() {
    const p = new URLSearchParams();
    if (state.url) p.set('url', state.url);
    p.set('mode', state.mode);
    history.replaceState(null, '', '#' + p.toString());
    document.title = state.url ? `${host(state.url)} · Peak Preview` : 'Peak Preview';
  }

  function visibleDevices() {
    if (state.mode === 'all') return allDevices(settings.custom);
    const ids = state.mode === 'custom' ? settings.selected : (MODES[state.mode] || MODES.compare).devices;
    return ids.map((id) => findDevice(id, settings.custom)).filter(Boolean);
  }

  /** Server-side user agent: only switch to mobile when every visible screen is a phone. */
  function headerEnv(devs) {
    if (!devs.length || !devs.every((d) => d.type === 'phone')) return null;
    const ios = devs.filter((d) => d.os === 'ios').length;
    const pick = ios >= devs.length - ios ? devs.find((d) => d.os === 'ios') : devs.find((d) => d.os !== 'ios');
    return envFor(pick || devs[0], false);
  }

  async function applyRules(devs) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'viewer:rules', uaEnv: headerEnv(devs) });
      if (!res || !res.ok) throw new Error((res && res.error) || 'no response');
    } catch (e) {
      toast('Could not prepare previews: ' + e.message, 5000);
    }
  }

  /* ---------------- Toolbar ---------------- */
  function buildToolbar() {
    $('#reloadAll').innerHTML = ICON.reload;
    $('#panelClose').innerHTML = ICON.close;
    $('#devicesBtn').innerHTML = ICON.sliders;
    $('#urlIcon').innerHTML = ICON.globe;
    $('#go').innerHTML = ICON.arrow;
    $('#tgFrames').innerHTML = ICON.frame;
    $('#tgScroll').innerHTML = ICON.scroll;
    $('#tgNav').innerHTML = ICON.link;
    $('.empty-art').innerHTML = ICON.hero;
    $('.hint-icon').innerHTML = ICON.exact;
    for (const chip of document.querySelectorAll('.chip[data-url]')) {
      chip.addEventListener('click', () => {
        $('#url').value = chip.dataset.url;
        $('#urlForm').requestSubmit();
      });
    }

    const modes = $('#modes');
    const items = [
      ['mobile', ICON.phone, 'Mobile'],
      ['tablet', ICON.tablet, 'Tablet'],
      ['desktop', ICON.desktop, 'Desktop'],
      ['compare', ICON.compare, 'Compare'],
      ['all', ICON.grid, 'All'],
      ['custom', ICON.custom, 'Custom']
    ];
    modes.innerHTML = items.map(([m, icon, label]) =>
      `<button type="button" data-mode="${m}" aria-pressed="false" title="${label}">${icon}<span>${label}</span></button>`).join('');
    modes.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mode]');
      if (!b || b.dataset.mode === state.mode) return;
      setMode(b.dataset.mode);
    });

    $('#urlForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const url = normalizeUrl($('#url').value);
      if (!url) { toast('Enter a website address, e.g. example.com'); return; }
      state.url = url;
      $('#url').value = url;
      writeHash();
      render();
    });
    $('#reloadAll').addEventListener('click', () => {
      for (const c of cards.values()) navigateCard(c, c.url || state.url);
    });

    const zoom = $('#zoom');
    zoom.value = String(settings.zoom);
    if (zoom.value !== String(settings.zoom)) { settings.zoom = 'fit'; zoom.value = 'fit'; }
    zoom.addEventListener('change', () => {
      settings.zoom = zoom.value === 'fit' ? 'fit' : Number(zoom.value);
      saveSettings();
      layout();
    });

    const openIn = $('#openIn');
    openIn.value = settings.openIn === 'new' ? 'new' : 'same';
    openIn.addEventListener('change', () => {
      settings.openIn = openIn.value;
      saveSettings();
      toast(settings.openIn === 'new' ? 'Previews will open in a new tab' : 'Previews will open in the current tab');
    });

    const bindToggle =(id, key, after) => {
      const el = $(id);
      el.setAttribute('aria-pressed', String(!!settings[key]));
      el.addEventListener('click', () => {
        settings[key] = !settings[key];
        el.setAttribute('aria-pressed', String(settings[key]));
        saveSettings();
        if (after) after();
      });
    };
    bindToggle('#tgFrames', 'frames', layout);
    bindToggle('#tgScroll', 'syncScroll', () => toast(settings.syncScroll ? 'Scrolling is synced across devices' : 'Scroll sync off'));
    bindToggle('#tgNav', 'syncNav', () => toast(settings.syncNav ? 'Links you click open on every device' : 'Link sync off'));

    $('#devicesBtn').addEventListener('click', () => togglePanel());
    $('#panelClose').addEventListener('click', () => togglePanel(false));
  }

  function setMode(mode) {
    state.mode = mode;
    settings.lastMode = mode;
    saveSettings();
    writeHash();
    render();
    if (!$('#panel').hidden) buildDeviceList();
  }

  function paintModes() {
    for (const b of document.querySelectorAll('#modes button')) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
    }
  }

  /* ---------------- Cards ---------------- */
  function frameName(card) {
    const env = envFor(card.d, !!state.rotated[card.key]);
    return 'ppv1:' + encodeURIComponent(JSON.stringify({ id: card.key, env }));
  }

  function createCard(d) {
    const key = d.id;
    const el = document.createElement('section');
    el.className = `device type-${d.type}`;
    el.setAttribute('aria-label', d.name);
    el.dataset.cut = d.cut || '';
    const action = (name, label) =>
      `<button type="button" class="icon-btn" data-act="${name}" title="${label}" aria-label="${label}">${ICON[name]}</button>`;
    el.innerHTML = `
      <header class="device-head">
        <div class="device-meta"><span class="device-name"></span><span class="device-dims"></span></div>
        <div class="device-actions">
          ${d.type !== 'desktop' ? action('rotate', 'Rotate') : ''}
          ${action('reload', 'Reload')}
          ${action('camera', 'Screenshot of what you can see')}
          ${action('exact', 'This screen in this tab (exact device emulation)')}
          ${action('newtab', 'This screen in a new tab (exact device emulation)')}
          ${action('external', 'Open page normally in this tab')}
        </div>
      </header>
      <div class="stage">
        <div class="shell">
          <div class="lid"><i class="cam"></i></div>
          <i class="hw hw-speaker"></i><i class="hw hw-cam"></i><i class="hw hw-btn"></i>
          <div class="shell-top"><span class="dots"><i></i><i></i><i></i></span><span class="addr"></span></div>
          <div class="screen"></div>
        </div>
      </div>
      <footer class="device-foot"><span class="device-url"></span></footer>`;
    $('.device-name', el).textContent = d.name;
    $('.device-name', el).title = d.name;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('allow', 'fullscreen; autoplay; clipboard-write; encrypted-media; picture-in-picture');
    iframe.title = `${d.name} preview`;

    const card = {
      key, d, el, iframe,
      stage: $('.stage', el),
      shell: $('.shell', el),
      screen: $('.screen', el),
      dimsEl: $('.device-dims', el),
      urlEl: $('.device-url', el),
      addrEl: $('.addr', el),
      url: '',
      title: '',
      expectNav: false,
      lockUntil: 0
    };
    iframe.name = frameName(card);
    card.screen.appendChild(iframe);
    const cut = document.createElement('i');
    cut.className = 'cut';
    card.screen.appendChild(cut);
    iframe.addEventListener('load', () => el.classList.remove('loading'));

    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      onCardAction(card, b.dataset.act);
    });

    cards.set(key, card);
    return card;
  }

  function navigateCard(card, url) {
    if (!url) return;
    card.expectNav = true;
    card.lockUntil = Date.now() + 1500;
    card.el.classList.add('loading');
    card.urlEl.textContent = 'Loading ' + host(url) + '…';
    card.iframe.name = frameName(card);
    card.iframe.src = url;
  }

  function paintCardUrl(card) {
    const u = card.url || state.url;
    let short = u;
    try { const x = new URL(u); short = x.host + (x.pathname === '/' ? '' : x.pathname); } catch (_) {}
    card.urlEl.textContent = short;
    card.urlEl.title = card.title ? `${card.title}\n${u}` : u;
    card.addrEl.textContent = short;
  }

  async function onCardAction(card, act) {
    const url = card.url || state.url;
    if (act === 'reload') navigateCard(card, url);
    else if (act === 'rotate') {
      state.rotated[card.key] = !state.rotated[card.key];
      card.iframe.name = frameName(card);
      layout();
    } else if (act === 'external') {
      location.href = url;
    } else if (act === 'exact' || act === 'newtab') {
      const res = await chrome.runtime.sendMessage({
        type: 'exact:start', url, reuseSender: act === 'exact', device: card.d, rotated: !!state.rotated[card.key]
      }).catch((e) => ({ ok: false, error: e.message }));
      if (!res || !res.ok) toast('Exact mode failed: ' + ((res && res.error) || 'unknown error'), 5000);
    } else if (act === 'camera') {
      screenshot(card);
    }
  }

  async function screenshot(card) {
    const r = card.screen.getBoundingClientRect();
    const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top);
    const x1 = Math.min(window.innerWidth, r.right), y1 = Math.min(window.innerHeight, r.bottom);
    if (x1 - x0 < 20 || y1 - y0 < 20) { toast('Scroll this device into view first.'); return; }
    try {
      const win = await chrome.windows.getCurrent();
      const dataUrl = await chrome.tabs.captureVisibleTab(win.id, { format: 'png' });
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = dataUrl;
      });
      const k = img.naturalWidth / window.innerWidth;
      const cv = document.createElement('canvas');
      cv.width = Math.round((x1 - x0) * k);
      cv.height = Math.round((y1 - y0) * k);
      cv.getContext('2d').drawImage(img, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, 0, 0, cv.width, cv.height);
      const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
      const rot = !!state.rotated[card.key];
      const w = rot ? card.d.h : card.d.w, h = rot ? card.d.w : card.d.h;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${host(card.url || state.url).replace(/[^a-z0-9.-]+/gi, '_')}-${card.d.id}-${w}x${h}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Screenshot saved');
    } catch (e) {
      toast('Screenshot failed: ' + e.message, 4000);
    }
  }

  /* ---------------- Messages from frames ---------------- */
  function cardForSource(source) {
    for (const c of cards.values()) if (c.iframe.contentWindow === source) return c;
    return null;
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.__pp !== 1) return;
    const card = cardForSource(e.source);
    if (!card) return;

    if (d.type === 'url' && typeof d.url === 'string') {
      const changed = d.url !== card.url;
      card.url = d.url;
      card.title = d.title || '';
      paintCardUrl(card);
      if (!changed) return;
      if (card.expectNav) { card.expectNav = false; card.lockUntil = Date.now() + 1500; return; }
      if (Date.now() < card.lockUntil) return;
      // The person navigated inside this device.
      if (settings.syncNav) {
        state.url = d.url;
        $('#url').value = d.url;
        writeHash();
        for (const other of cards.values()) if (other !== card) navigateCard(other, d.url);
      }
    } else if (d.type === 'scroll' && settings.syncScroll && typeof d.ratio === 'number') {
      for (const other of cards.values()) {
        if (other === card || !other.iframe.contentWindow) continue;
        other.iframe.contentWindow.postMessage({ __pp: 1, type: 'scrollTo', ratio: d.ratio }, '*');
      }
    }
  });

  /* ---------------- Layout ---------------- */
  function bezel(d, rot) {
    if (!settings.frames) return { x: 0, top: 0, bottom: 0 };
    if (d.type === 'phone') {
      if (d.cut === 'home') return rot ? { x: 74, top: 16, bottom: 16 } : { x: 16, top: 74, bottom: 82 };
      return { x: 12, top: 12, bottom: 12 };
    }
    if (d.type === 'tablet') return { x: 14, top: 14, bottom: 14 };
    return { x: 0, top: 32 + (d.cut ? 22 : 0), bottom: 0 };
  }

  function measure(card) {
    const rot = !!state.rotated[card.key];
    const w = rot ? card.d.h : card.d.w;
    const h = rot ? card.d.w : card.d.h;
    const b = bezel(card.d, rot);
    return { card, w, h, b, ow: w + b.x * 2, oh: h + b.top + b.bottom };
  }

  function computeScale(list) {
    if (settings.zoom !== 'fit') return Number(settings.zoom) || 1;
    const availW = Math.max(200, canvas.clientWidth - PAD * 2);
    const availH = Math.max(200, canvas.clientHeight - PAD * 2 - HEAD - FOOT);
    const maxW = Math.max(...list.map((x) => x.ow));
    const maxH = Math.max(...list.map((x) => x.oh));
    let s = Math.min(1, availH / maxH, availW / maxW);
    // Prefer one row (easier to compare) if it doesn't make things too small.
    const rowWidth = (k) => list.reduce((a, x) => a + Math.max(x.ow * k, MIN_CARD), 0) + GAP * (list.length - 1);
    if (rowWidth(s) > availW) {
      let t = s;
      while (t >= 0.42 && rowWidth(t) > availW) t -= 0.01;
      if (t >= 0.42) s = t;
    }
    return Math.max(0.15, Math.floor(s * 100) / 100);
  }

  function layout() {
    grid.classList.toggle('frames', !!settings.frames);
    const list = [...cards.values()].map(measure);
    if (!list.length) { $('#zoomInfo').textContent = ''; return; }
    const s = computeScale(list);
    for (const x of list) {
      const c = x.card;
      const sw = Math.round(x.ow * s), sh = Math.round(x.oh * s);
      c.el.style.width = Math.max(sw, MIN_CARD) + 'px';
      c.stage.style.width = sw + 'px';
      c.stage.style.height = sh + 'px';
      c.el.classList.toggle('land', !!state.rotated[c.key]);
      c.shell.style.padding = settings.frames && c.d.type !== 'desktop' ? `${x.b.top}px ${x.b.x}px ${x.b.bottom}px` : '';
      c.shell.style.width = x.ow + 'px';
      c.shell.style.height = x.oh + 'px';
      c.shell.style.transform = `scale(${s})`;
      c.screen.style.width = x.w + 'px';
      c.screen.style.height = x.h + 'px';
      c.dimsEl.textContent = `${x.w} × ${x.h}${state.rotated[c.key] ? ' · landscape' : ''}`;
    }
    $('#zoomInfo').textContent = Math.round(s * 100) + '%';
  }

  let layoutQueued = false;
  function scheduleLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => { layoutQueued = false; layout(); });
  }

  /* ---------------- Render ---------------- */
  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    paintModes();
    const devs = visibleDevices();
    $('#empty').hidden = !!state.url;
    $('#hint').hidden = !state.url;
    grid.textContent = '';
    cards.clear();

    if (!state.url) { layout(); $('#url').focus(); return; }
    if (!devs.length) {
      grid.innerHTML = '<p class="muted">No devices selected. Open <strong>Devices</strong> and tick a few screens.</p>';
      return;
    }

    await applyRules(devs);
    if (seq !== renderSeq) return; // a newer render started

    const created = devs.map(createCard);
    created.forEach((c) => grid.appendChild(c.el));
    layout();
    created.forEach(paintCardUrl);
    // Let the frames take their final size before the site loads, so scripts that
    // read window.innerWidth on load see the device width, not a placeholder size.
    void grid.offsetHeight;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (seq !== renderSeq) return;
    created.forEach((c) => navigateCard(c, state.url));
  }

  /* ---------------- Devices panel ---------------- */
  function positionPanel() {
    document.documentElement.style.setProperty('--panel-top', $('.toolbar').offsetHeight + 'px');
  }

  function togglePanel(force) {
    const panel = $('#panel');
    const open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    $('#devicesBtn').setAttribute('aria-expanded', String(open));
    if (open) { positionPanel(); buildDeviceList(); }
  }

  function currentIds() {
    return visibleDevices().map((d) => d.id);
  }

  function buildDeviceList() {
    const list = $('#deviceList');
    const checked = new Set(currentIds());
    const groups = [
      ['Phones', (d) => d.type === 'phone'],
      ['Tablets', (d) => d.type === 'tablet'],
      ['Laptops & desktops', (d) => d.type === 'desktop']
    ];
    const all = allDevices(settings.custom);
    list.innerHTML = '';
    for (const [title, test] of groups) {
      const items = all.filter(test);
      if (!items.length) continue;
      const h = document.createElement('div');
      h.className = 'group-title';
      h.textContent = title;
      list.appendChild(h);
      for (const d of items) {
        const row = document.createElement('label');
        row.className = 'dev-row';
        row.innerHTML = `<input type="checkbox"><span class="dev-name"></span><span class="dev-size"></span>`;
        const cb = $('input', row);
        cb.checked = checked.has(d.id);
        cb.value = d.id;
        $('.dev-name', row).textContent = d.name;
        $('.dev-size', row).textContent = `${d.w}×${d.h}`;
        if (d.custom) {
          const rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'icon-btn remove';
          rm.title = 'Remove this size';
          rm.setAttribute('aria-label', `Remove ${d.name}`);
          rm.innerHTML = ICON.trash;
          rm.addEventListener('click', (e) => {
            e.preventDefault();
            settings.custom = settings.custom.filter((x) => x.id !== d.id);
            settings.selected = settings.selected.filter((id) => id !== d.id);
            saveSettings();
            buildDeviceList();
            if (state.mode === 'custom') render();
          });
          row.appendChild(rm);
        }
        cb.addEventListener('change', onPickChange);
        list.appendChild(row);
      }
    }
  }

  let pickTimer;
  function onPickChange() {
    const ids = [...document.querySelectorAll('#deviceList input[type=checkbox]:checked')].map((x) => x.value);
    settings.selected = ids;
    saveSettings();
    clearTimeout(pickTimer);
    pickTimer = setTimeout(() => {
      if (state.mode !== 'custom') { state.mode = 'custom'; settings.lastMode = 'custom'; writeHash(); }
      render();
    }, 450);
  }

  function bindCustomForm() {
    $('#customForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const w = Math.round(Number($('#cw').value));
      const h = Math.round(Number($('#ch').value));
      if (!(w >= 200 && w <= 3840 && h >= 200 && h <= 2400)) {
        toast('Width 200–3840 and height 200–2400');
        return;
      }
      const d = makeCustom(w, h, $('#cn').value.trim());
      if (!findDevice(d.id, settings.custom)) settings.custom.push(d);
      if (!settings.selected.includes(d.id)) {
        // carry over what's on screen now, then add the new size
        settings.selected = Array.from(new Set(currentIds().concat(d.id)));
      }
      state.mode = 'custom';
      settings.lastMode = 'custom';
      saveSettings();
      writeHash();
      $('#customForm').reset();
      buildDeviceList();
      render();
      toast(`Added ${d.name}`);
    });
  }

  /* ---------------- Init ---------------- */
  async function init() {
    await loadSettings();
    const h = parseHash();
    const validMode = (m) => m === 'custom' || m === 'all' ||Object.prototype.hasOwnProperty.call(MODES, m);
    state.mode = validMode(h.mode) ? h.mode : (validMode(settings.lastMode) ? settings.lastMode : 'compare');
    state.url = normalizeUrl(h.url);
    $('#url').value = state.url;

    buildToolbar();
    bindCustomForm();
    writeHash();

    window.addEventListener('resize', () => { scheduleLayout(); if (!$('#panel').hidden) positionPanel(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#panel').hidden) togglePanel(false);
    });

    await render();

    if (h.notice === 'restricted') {
      toast('Chrome doesn’t let extensions run on that page (Chrome pages, the Web Store, local files). Enter a website above to preview it.', 7000);
    } else if (h.notice === 'unsupported') {
      toast('That page type can’t host the floating preview, so it opened here instead.', 6000);
    }
  }

  init();
})();
