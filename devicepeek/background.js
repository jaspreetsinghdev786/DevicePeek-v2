// DevicePeek – background service worker.
//
// Owns the per-tab "open" state (chrome.storage.session) so the panel can restore itself
// after reloads and navigations, keeps the declarativeNetRequest rules that make preview
// frames look like a phone (mobile User-Agent, no X-Frame-Options / CSP), and handles
// screenshots, the keyboard shortcut and messages from the popup.

importScripts('lib/devices.js', 'lib/prefs.js', 'lib/urls.js');

const DP = globalThis.DevicePeek;
const TABS_KEY = 'devicepeek:tabs'; // { [tabId]: { os, previewUrl } } – tabs with the panel open
const WINDOWS_KEY = 'devicepeek:windows'; // { [tabId]: { os } } – "device window" popups
const ANY_OPEN_KEY = 'devicepeek:anyOpen'; // read by content scripts to skip the hello round trip

// Lets content scripts read ANY_OPEN_KEY directly (no service-worker wake-up on every page load).
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});

const errText = (e) => String((e && e.message) || e || 'Unknown error');

// ---------------------------------------------------------------------------
// State (serialised so concurrent messages can't lose updates)
// ---------------------------------------------------------------------------
let lock = Promise.resolve();

async function readState() {
  const r = await chrome.storage.session.get([TABS_KEY, WINDOWS_KEY]);
  return { tabs: r[TABS_KEY] || {}, windows: r[WINDOWS_KEY] || {} };
}

function mutate(fn, { rules = true } = {}) {
  const run = lock.then(async () => {
    const s = await readState();
    const result = await fn(s);
    await chrome.storage.session.set({
      [TABS_KEY]: s.tabs,
      [WINDOWS_KEY]: s.windows,
      [ANY_OPEN_KEY]: Object.keys(s.tabs).length > 0
    });
    if (rules) await syncRules(s);
    return result;
  });
  lock = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------------------
// Network rules
// ---------------------------------------------------------------------------
function uaHeaders(os, withHints) {
  const headers = [{ header: 'user-agent', operation: 'set', value: DP.devices.UA[os] || DP.devices.UA.ios }];
  if (!withHints) return headers;
  if (os === 'android') {
    headers.push(
      { header: 'sec-ch-ua-mobile', operation: 'set', value: '?1' },
      { header: 'sec-ch-ua-platform', operation: 'set', value: '"Android"' }
    );
  } else {
    // Safari doesn't send client hints at all.
    headers.push(
      { header: 'sec-ch-ua', operation: 'remove' },
      { header: 'sec-ch-ua-mobile', operation: 'remove' },
      { header: 'sec-ch-ua-platform', operation: 'remove' }
    );
  }
  return headers;
}

const STRIP_FRAME_BLOCKERS = [
  { header: 'x-frame-options', operation: 'remove' },
  { header: 'content-security-policy', operation: 'remove' }
];

function buildRules(s, withHints) {
  const rules = [];
  const seen = new Set();
  for (const [id, w] of Object.entries(s.windows)) {
    const tabId = Number(id);
    seen.add(tabId);
    rules.push({
      id: tabId,
      priority: 1,
      condition: { tabIds: [tabId], resourceTypes: ['main_frame', 'sub_frame'] },
      action: { type: 'modifyHeaders', requestHeaders: uaHeaders(w.os, withHints) }
    });
  }
  for (const [id, t] of Object.entries(s.tabs)) {
    const tabId = Number(id);
    if (seen.has(tabId)) continue;
    // Applies to frames inside the tab only – the desktop page itself is untouched.
    rules.push({
      id: tabId,
      priority: 1,
      condition: { tabIds: [tabId], resourceTypes: ['sub_frame'] },
      action: { type: 'modifyHeaders', requestHeaders: uaHeaders(t.os, withHints), responseHeaders: STRIP_FRAME_BLOCKERS }
    });
  }
  return rules;
}

async function syncRules(s) {
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = existing.map((r) => r.id);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules: buildRules(s, true) });
  } catch (e) {
    // Fall back to the User-Agent header alone if a client-hint header is rejected.
    console.warn('[DevicePeek] client-hint rules rejected, retrying without them:', errText(e));
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules: buildRules(s, false) });
  }
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
async function setBadge(tabId, state) {
  try {
    if (state === 'open') {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#1a73e8' });
      await chrome.action.setBadgeText({ tabId, text: 'ON' });
      await chrome.action.setTitle({ tabId, title: 'DevicePeek (open)' });
    } else if (state === 'error') {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
      await chrome.action.setBadgeText({ tabId, text: '!' });
    } else {
      await chrome.action.setBadgeText({ tabId, text: '' });
      await chrome.action.setTitle({ tabId, title: 'DevicePeek' });
    }
  } catch (e) {
    // Tab closed in the meantime.
  }
}

async function flagError(tabId, message) {
  await setBadge(tabId, 'error');
  try {
    await chrome.action.setTitle({ tabId, title: message });
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Content script plumbing
// ---------------------------------------------------------------------------
const CONTENT_FILES = (() => {
  const cs = chrome.runtime.getManifest().content_scripts || [];
  const entry = cs.find((c) => (c.js || []).includes('content.js'));
  return entry ? entry.js : [];
})();

async function ping(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'dp:ping' }, { frameId: 0 });
    return !!(r && r.ok);
  } catch (e) {
    return false;
  }
}

// Tabs that were open before the extension was installed/reloaded have no content script yet.
async function ensureContent(tabId) {
  if (await ping(tabId)) return;
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: CONTENT_FILES });
  if (!(await ping(tabId))) throw new Error('The page did not respond.');
}

// History hooks run in the page's own JS world so pushState/replaceState can be observed.
// Injected only while DevicePeek is open, never on pages where it isn't used.
async function injectPageHooks(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ['page-hooks.js'],
      world: 'MAIN',
      injectImmediately: true
    });
  } catch (e) {
    console.warn('[DevicePeek] page hooks not injected:', errText(e));
  }
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------
async function checkTab(tab) {
  const url = tab.url || tab.pendingUrl;
  const result = DP.urls.check(url);
  if (result.ok && result.file) {
    const allowed = await chrome.extension.isAllowedFileSchemeAccess();
    if (!allowed) {
      return {
        ok: false,
        reason: 'file',
        message: 'To preview local files, open chrome://extensions, click Details on DevicePeek and turn on "Allow access to file URLs".'
      };
    }
  }
  return result;
}

async function openTab(tab) {
  const check = await checkTab(tab);
  if (!check.ok) {
    await flagError(tab.id, check.message);
    return { ok: false, open: false, reason: check.reason, message: check.message };
  }
  const prefs = await DP.prefs.load();
  const os = DP.devices.resolve(prefs).os;
  await mutate((s) => {
    s.tabs[tab.id] = Object.assign({}, s.tabs[tab.id], { os });
  });
  try {
    await ensureContent(tab.id);
    await injectPageHooks(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: 'dp:open' }, { frameId: 0 });
  } catch (e) {
    await mutate((s) => {
      delete s.tabs[tab.id];
    });
    const message = `DevicePeek couldn't start on this page: ${errText(e)}`;
    await flagError(tab.id, message);
    return { ok: false, open: false, reason: 'inject', message };
  }
  await setBadge(tab.id, 'open');
  return { ok: true, open: true };
}

async function closeTab(tabId, { notify = true } = {}) {
  await mutate((s) => {
    delete s.tabs[tabId];
  });
  if (notify) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'dp:close' }, { frameId: 0 });
    } catch (e) {
      // No content script (page navigated to chrome:// etc.) – nothing to close.
    }
  }
  await setBadge(tabId, 'closed');
  return { ok: true, open: false };
}

async function isOpen(tabId) {
  const s = await readState();
  return !!s.tabs[tabId];
}

async function toggleTab(tab) {
  if (!tab || tab.id == null) return { ok: false, message: 'No active tab.' };
  return (await isOpen(tab.id)) ? closeTab(tab.id) : openTab(tab);
}

// ---------------------------------------------------------------------------
// Device window (fallback for pages that refuse to be framed)
// ---------------------------------------------------------------------------
async function openDeviceWindow({ url, width, height, os }) {
  const w = Math.max(200, Math.min(2560, Math.round(width)));
  const h = Math.max(200, Math.min(2560, Math.round(height)));
  const win = await chrome.windows.create({ url: 'about:blank', type: 'popup', width: w + 16, height: h + 80, focused: true });
  const tab = win.tabs && win.tabs[0];
  if (!tab) throw new Error('Could not create the window.');
  await mutate((s) => {
    s.windows[tab.id] = { os };
  });
  // Correct the outer size so the page area matches the requested viewport.
  try {
    const t = await chrome.tabs.get(tab.id);
    if (t.width && t.height) {
      await chrome.windows.update(win.id, { width: w + 16 + (w - t.width), height: h + 80 + (h - t.height) });
    }
  } catch (e) {}
  await chrome.tabs.update(tab.id, { url });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
async function handle(msg, sender) {
  const senderTabId = sender.tab && sender.tab.id;
  switch (msg && msg.type) {
    // --- from the content script ---
    case 'dp:hello': {
      if (senderTabId == null || sender.frameId !== 0) return { open: false };
      const s = await readState();
      const t = s.tabs[senderTabId];
      if (!t) return { open: false };
      await injectPageHooks(senderTabId);
      await setBadge(senderTabId, 'open');
      return { open: true, previewUrl: t.previewUrl || null };
    }
    case 'dp:closed':
      if (senderTabId != null) await closeTab(senderTabId, { notify: false });
      return { ok: true };
    case 'dp:setOs':
      if (senderTabId == null) return { ok: false };
      await mutate((s) => {
        if (s.tabs[senderTabId]) s.tabs[senderTabId].os = msg.os;
      });
      return { ok: true };
    case 'dp:previewUrl':
      if (senderTabId == null) return { ok: false };
      await mutate(
        (s) => {
          if (s.tabs[senderTabId]) s.tabs[senderTabId].previewUrl = String(msg.url || '');
        },
        { rules: false }
      );
      return { ok: true };
    case 'dp:capture': {
      if (!sender.tab) return { error: 'No tab.' };
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
      return { dataUrl };
    }
    case 'dp:openWindow':
      return openDeviceWindow(msg);

    // --- from the popup ---
    case 'dp:status': {
      const tab = await chrome.tabs.get(msg.tabId);
      const check = await checkTab(tab);
      return { supported: check.ok, message: check.message || '', open: await isOpen(tab.id) };
    }
    case 'dp:toggle':
      return toggleTab(await chrome.tabs.get(msg.tabId));
    case 'dp:open':
      return openTab(await chrome.tabs.get(msg.tabId));
    case 'dp:close':
      return closeTab(msg.tabId);
    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('dp:')) return false;
  handle(msg, sender).then(
    (r) => sendResponse(r),
    (e) => sendResponse({ ok: false, error: errText(e), message: errText(e) })
  );
  return true; // async response
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-devicepeek') return;
  try {
    const target = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    await toggleTab(target);
  } catch (e) {
    console.warn('[DevicePeek] shortcut failed:', errText(e));
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  mutate((s) => {
    const had = s.tabs[tabId] || s.windows[tabId];
    delete s.tabs[tabId];
    delete s.windows[tabId];
    return had;
  });
});

// Session storage and session rules are cleared on install/update; start from a clean slate.
chrome.runtime.onInstalled.addListener(() => {
  mutate((s) => {
    s.tabs = {};
    s.windows = {};
  });
});
