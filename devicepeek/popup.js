// DevicePeek – toolbar popup. Opens the preview on the current tab (one click) and edits
// the shared settings; open panels pick up changes instantly via chrome.storage.onChanged.
(async () => {
  'use strict';
  const NS = globalThis.DevicePeek;
  const P = NS.prefs;
  const $ = (id) => document.getElementById(id);

  const els = {
    status: $('status'),
    notice: $('notice'),
    noticeText: $('noticeText'),
    toggle: $('toggle'),
    device: $('device'),
    rotate: $('rotate'),
    modeSide: $('modeSide'),
    modeFloat: $('modeFloat'),
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
    els.status.textContent = !supported ? 'Unavailable' : open ? 'Open' : 'Closed';
    els.status.classList.toggle('on', supported && open);
    els.toggle.textContent = open ? 'Close DevicePeek' : 'Open DevicePeek';
    els.toggle.classList.toggle('close', open);
    els.toggle.disabled = !supported || busy;
  }

  function renderPrefs(p) {
    els.device.value = p.deviceId;
    els.rotate.setAttribute('aria-pressed', String(p.landscape));
    els.modeSide.setAttribute('aria-checked', String(p.mode === 'side'));
    els.modeFloat.setAttribute('aria-checked', String(p.mode === 'floating'));
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
  els.modeSide.addEventListener('click', () => P.save({ mode: 'side' }));
  els.modeFloat.addEventListener('click', () => P.save({ mode: 'floating' }));
  els.follow.addEventListener('change', () => P.save({ followPage: els.follow.checked }));
  els.sync.addEventListener('change', () => P.save({ syncScroll: els.sync.checked }));
  els.twoway.addEventListener('change', () => P.save({ syncScrollTwoWay: els.twoway.checked }));
  els.autoOpen.addEventListener('change', () => P.save({ openFromPopup: els.autoOpen.checked }));
  els.toggle.addEventListener('click', () => setOpen(!open));

  // ----- shortcut -----
  try {
    const cmds = await chrome.commands.getAll();
    const cmd = cmds.find((c) => c.name === 'toggle-devicepeek');
    els.shortcut.textContent = (cmd && cmd.shortcut) || 'Not set';
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
    showNotice((status && status.message) || NS.urls?.GENERIC || "DevicePeek can't run on this page.");
    renderOpen(false);
    return;
  }
  open = !!status.open;
  renderOpen(true);

  // One click: opening the popup opens the preview.
  if (!open && prefs.openFromPopup) setOpen(true);
})();
