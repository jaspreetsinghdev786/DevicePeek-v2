// DevicePeek – toolbar popup. Opens the preview on the current tab (one click) and edits
// the shared settings; open panels pick up changes instantly via chrome.storage.onChanged.
(async () => {
  'use strict';
  const NS = globalThis.DevicePeek;
  const P = NS.prefs;
  const $ = (id) => document.getElementById(id);

  // Paint with the last theme right away (settings load asynchronously).
  const THEME_CACHE = 'devicepeek:theme';
  const applyTheme = (t) => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(THEME_CACHE, t);
    } catch (e) {}
  };
  try {
    const cached = localStorage.getItem(THEME_CACHE);
    if (P.THEMES.includes(cached)) document.documentElement.dataset.theme = cached;
  } catch (e) {}

  // Icons are shared with the panel (content/icons.js).
  for (const el of document.querySelectorAll('[data-icon]')) el.appendChild(NS.icon(el.dataset.icon, 16));

  const els = {
    status: $('status'),
    statusText: $('statusText'),
    notice: $('notice'),
    noticeText: $('noticeText'),
    toggle: $('toggle'),
    toggleText: $('toggleText'),
    toggleKbd: $('toggleKbd'),
    device: $('device'),
    shape: $('shape'),
    specs: $('specs'),
    rotate: $('rotate'),
    rotateText: $('rotateText'),
    frame: $('frame'),
    modeSide: $('modeSide'),
    modeFloat: $('modeFloat'),
    themes: [...document.querySelectorAll('[data-theme-value]')],
    follow: $('follow'),
    sync: $('sync'),
    twoway: $('twoway'),
    autoOpen: $('autoOpen'),
    shortcut: $('shortcut'),
    shortcutLink: $('shortcutLink')
  };
  NS.devices.fillSelect(els.device);

  let tab = null;
  let open = false;
  let busy = false;

  function showNotice(text) {
    els.noticeText.textContent = text;
    els.notice.hidden = !text;
  }

  function renderOpen(supported) {
    els.statusText.textContent = !supported ? 'Unavailable' : open ? 'Open' : 'Closed';
    els.status.classList.toggle('on', supported && open);
    els.status.classList.toggle('off', !supported);
    els.toggleText.textContent = open ? 'Close preview' : 'Open preview';
    els.toggle.classList.toggle('close', open);
    els.toggle.disabled = !supported || busy;
    // Nothing to open on this page: the notice explains why, settings stay editable.
    els.toggle.hidden = !supported;
  }

  const OS_NAME = { ios: 'iOS', ipados: 'iPadOS', android: 'Android' };
  function renderDevice(p) {
    const vp = NS.devices.resolve(p);
    // Device silhouette, scaled into a 56×72 box (bezel included when the frame is on).
    const k = Math.min(56 / vp.W, 72 / vp.H);
    els.shape.style.width = `${Math.max(14, Math.round(vp.W * k))}px`;
    els.shape.style.height = `${Math.max(14, Math.round(vp.H * k))}px`;
    els.shape.classList.toggle('bare', !p.showFrame);
    els.specs.textContent = '';
    const b = document.createElement('b');
    b.textContent = `${vp.W} × ${vp.H}`;
    els.specs.append(b, ` · ${vp.dpr}x · ${OS_NAME[vp.os] || vp.os}`);
    els.rotateText.textContent = p.landscape ? 'Landscape' : 'Portrait';
  }

  function renderPrefs(p) {
    applyTheme(p.theme);
    els.device.value = p.deviceId;
    renderDevice(p);
    els.rotate.setAttribute('aria-pressed', String(p.landscape));
    els.frame.setAttribute('aria-pressed', String(p.showFrame));
    els.modeSide.setAttribute('aria-checked', String(p.mode === 'side'));
    els.modeFloat.setAttribute('aria-checked', String(p.mode === 'floating'));
    for (const b of els.themes) b.setAttribute('aria-checked', String(b.dataset.themeValue === p.theme));
    els.follow.checked = p.followPage;
    els.sync.checked = p.syncScroll;
    els.twoway.checked = p.syncScrollTwoWay;
    els.twoway.disabled = !p.syncScroll;
    els.twoway.closest('.switch').classList.toggle('off', !p.syncScroll);
    els.autoOpen.checked = p.openFromPopup;
  }

  async function call(msg) {
    try {
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      const text = NS.util.errorText(e);
      if (/Receiving end does not exist|Could not establish connection/i.test(text)) {
        return {
          ok: false,
          message: "DevicePeek's background service isn't running. Open chrome://extensions and click the reload arrow on the DevicePeek card."
        };
      }
      return { ok: false, message: text };
    }
  }

  async function setOpen(next) {
    if (!tab || busy) return;
    busy = true;
    renderOpen(true);
    const res = await call({ type: next ? 'dp:open' : 'dp:close', tabId: tab.id });
    busy = false;
    if (res && res.ok) {
      open = !!res.open;
      showNotice('');
    } else {
      showNotice((res && res.message) || 'Something went wrong. Reload the page and try again.');
    }
    renderOpen(true);
  }

  // ----- settings -----
  let prefs = await P.load();
  renderPrefs(prefs);
  P.onChange((p) => {
    prefs = p;
    renderPrefs(p);
  });

  els.device.addEventListener('change', () => P.save({ deviceId: els.device.value }));
  els.rotate.addEventListener('click', () => P.save({ landscape: !prefs.landscape }));
  els.frame.addEventListener('click', () => P.save({ showFrame: !prefs.showFrame }));
  els.modeSide.addEventListener('click', () => P.save({ mode: 'side' }));
  els.modeFloat.addEventListener('click', () => P.save({ mode: 'floating' }));
  for (const b of els.themes) b.addEventListener('click', () => P.save({ theme: b.dataset.themeValue }));
  els.follow.addEventListener('change', () => P.save({ followPage: els.follow.checked }));
  els.sync.addEventListener('change', () => P.save({ syncScroll: els.sync.checked }));
  els.twoway.addEventListener('change', () => P.save({ syncScrollTwoWay: els.twoway.checked }));
  els.autoOpen.addEventListener('change', () => P.save({ openFromPopup: els.autoOpen.checked }));
  els.toggle.addEventListener('click', () => setOpen(!open));

  // ----- shortcut -----
  try {
    const cmds = await chrome.commands.getAll();
    const cmd = cmds.find((c) => c.name === 'toggle-devicepeek');
    const key = (cmd && cmd.shortcut) || '';
    els.shortcut.textContent = key || 'Not set';
    els.toggleKbd.textContent = key;
    els.toggleKbd.hidden = !key;
  } catch (e) {}
  els.shortcutLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  // ----- current tab -----
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    showNotice('No active tab.');
    renderOpen(false);
    return;
  }
  const status = await call({ type: 'dp:status', tabId: tab.id });
  if (!status || status.ok === false || !status.supported) {
    showNotice((status && status.message) || "DevicePeek can't run on this page.");
    renderOpen(false);
    return;
  }
  open = !!status.open;
  renderOpen(true);

  // One click: opening the popup opens the preview.
  if (!open && prefs.openFromPopup) setOpen(true);
})();
