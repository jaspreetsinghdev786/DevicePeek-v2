/* Peak Preview – service worker.
 * 1. Extension icon / shortcut: toggles the floating mobile preview in the current tab
 *    (injected on demand), or stops exact mode, or opens the workspace on pages
 *    Chrome doesn't let extensions touch.
 * 2. Comparison workspace: lets sites load inside its device frames (strips
 *    frame-blocking headers, only for the workspace tab, only for frame documents).
 * 3. Mobile user agent for preview page requests (workspace and floating preview).
 * 4. "Exact device mode": DevTools-grade emulation of one device in a normal tab.
 */
importScripts('devices.js');

const { envFor } = self.PeakDevices;
const VIEWER_URL = chrome.runtime.getURL('viewer.html');
const ACCENT = '#4F46E5';
const FLOAT_FILES = ['devices.js', 'content/floating.js'];

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function isWebUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}
function canInject(url) {
  return isWebUrl(url) && !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)(\/|$)/i.test(url);
}

/** Runs async jobs for one tab strictly one after another (e.g. rapid icon clicks). */
const tabQueues = new Map();
function enqueue(tabId, job) {
  const prev = tabQueues.get(tabId) || Promise.resolve();
  const next = prev.then(job).catch((e) => console.warn('[Peak Preview]', e));
  tabQueues.set(tabId, next);
  next.then(() => { if (tabQueues.get(tabId) === next) tabQueues.delete(tabId); });
  return next;
}

/** Serialises read-modify-write updates of shared state. */
let chain = Promise.resolve();
function serial(job) {
  const p = chain.then(job);
  chain = p.catch(() => {});
  return p;
}

const sendToTab = (tabId, msg) => chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => null);

/* ------------------------------------------------------------------ */
/* Network rules (session-scoped, per tab)                              */
/* ------------------------------------------------------------------ */

const UA_CH_HEADERS = [
  'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-ch-ua-platform-version',
  'sec-ch-ua-model', 'sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-full-version',
  'sec-ch-ua-full-version-list', 'sec-ch-ua-wow64'
];

function uaRequestHeaders(env) {
  const headers = [{ header: 'user-agent', operation: 'set', value: env.ua }];
  if (env.uaData) {
    headers.push({ header: 'sec-ch-ua-mobile', operation: 'set', value: env.uaData.mobile ? '?1' : '?0' });
    headers.push({ header: 'sec-ch-ua-platform', operation: 'set', value: `"${env.uaData.platform}"` });
  } else {
    UA_CH_HEADERS.forEach((h) => headers.push({ header: h, operation: 'remove' }));
  }
  return headers;
}

// Floating-preview rules are the only ones with priority 2 (workspace rules use 1).
const isFloatRule = (r) => r.priority === 2;

function replaceTabRules(tabId, kind, rules) {
  return serial(async () => {
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const mine = existing.filter((r) => (r.condition.tabIds || []).includes(tabId) && isFloatRule(r) === (kind === 'float'));
    if (!mine.length && !rules.length) return;
    const taken = new Set(existing.filter((r) => !mine.includes(r)).map((r) => r.id));
    let next = 1;
    const nextId = () => { while (taken.has(next)) next++; taken.add(next); return next; };
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: mine.map((r) => r.id),
      addRules: rules.map((r) => Object.assign({ id: nextId(), priority: 1 }, r))
    });
  });
}

/** Workspace tab: allow framing + optional mobile UA for everything its frames load. */
function setViewerRules(tabId, uaEnv) {
  const rules = [{
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'x-frame-options', operation: 'remove' },
        { header: 'content-security-policy', operation: 'remove' }
      ]
    },
    condition: { tabIds: [tabId], resourceTypes: ['sub_frame'] }
  }];
  if (uaEnv && uaEnv.ua) {
    rules.push({
      action: { type: 'modifyHeaders', requestHeaders: uaRequestHeaders(uaEnv) },
      condition: { tabIds: [tabId] }
    });
  }
  return replaceTabRules(tabId, 'viewer', rules);
}

/** Floating preview: while the widget is open, this tab's frame documents may be framed
 *  (frame-blocking headers removed, like the workspace) and get the mobile UA when a device
 *  is chosen. Not limited to same-site frames, so redirects and cross-site links still load.
 *  Float rules are told apart from workspace rules by priority 2. */
function setFloatRules(tabId, uaEnv) {
  const condition = { tabIds: [tabId], resourceTypes: ['sub_frame'] };
  const rules = [{
    priority: 2,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'x-frame-options', operation: 'remove' },
        { header: 'content-security-policy', operation: 'remove' }
      ]
    },
    condition
  }];
  if (uaEnv && uaEnv.ua) {
    rules.push({
      priority: 2,
      action: { type: 'modifyHeaders', requestHeaders: uaRequestHeaders(uaEnv) },
      condition
    });
  }
  return replaceTabRules(tabId, 'float', rules);
}

const clearViewerRules = (tabId) => replaceTabRules(tabId, 'viewer', []);
const clearFloatRules = (tabId) => replaceTabRules(tabId, 'float', []);

/* ------------------------------------------------------------------ */
/* Session state                                                        */
/* ------------------------------------------------------------------ */

async function getMap(key) {
  const got = await chrome.storage.session.get(key);
  return got[key] || {};
}
function setInMap(key, tabId, value) {
  return serial(async () => {
    const map = await getMap(key);
    if (value) map[tabId] = value; else delete map[tabId];
    await chrome.storage.session.set({ [key]: map });
  });
}
const getExactMap = () => getMap('exact');
const setExact = (tabId, info) => setInMap('exact', tabId, info);
const getFloatTabs = () => getMap('floatTabs');
const setFloatTab = (tabId, info) => setInMap('floatTabs', tabId, info);

/* ------------------------------------------------------------------ */
/* Comparison workspace                                                 */
/* ------------------------------------------------------------------ */

async function openViewer(url, mode, fromTab, notice) {
  const hash = new URLSearchParams();
  if (isWebUrl(url)) hash.set('url', url);
  hash.set('mode', mode || 'compare');
  if (notice) hash.set('notice', notice);
  const opts = { url: `${VIEWER_URL}#${hash.toString()}` };
  if (fromTab && typeof fromTab.index === 'number') {
    opts.index = fromTab.index + 1;
    opts.windowId = fromTab.windowId;
  }
  // The user picks where it opens (toolbar "Open in"): this tab (default) or a new tab.
  let openIn = 'same';
  try {
    const { settings } = await chrome.storage.local.get('settings');
    if (settings && settings.openIn === 'new') openIn = 'new';
  } catch (_) { /* default */ }
  if (openIn === 'same' && fromTab && fromTab.id != null) return chrome.tabs.update(fromTab.id, { url: opts.url });
  return chrome.tabs.create(opts);
}

/* ------------------------------------------------------------------ */
/* Floating preview                                                     */
/* ------------------------------------------------------------------ */

async function injectFloating(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: FLOAT_FILES });
}

async function handleActionClick(tab) {
  if (!tab || tab.id == null) return;
  const exact = await getExactMap();
  if (exact[tab.id]) { await stopExact(tab.id); return; }
  if (!canInject(tab.url)) { await openViewer('', 'compare', tab, 'restricted'); return; }

  let res = await sendToTab(tab.id, { type: 'float:toggle' });
  if (res && res.ok) return;
  if (res && res.unsupported) { await openViewer(tab.url, 'compare', tab, 'unsupported'); return; }

  try {
    await injectFloating(tab.id);
  } catch (e) {
    await openViewer('', 'compare', tab, 'restricted');
    return;
  }
  res = await sendToTab(tab.id, { type: 'float:open' });
  if (res && res.unsupported) await openViewer(tab.url, 'compare', tab, 'unsupported');
}

/** After a full page load: bring a pinned preview back, otherwise clean up. */
async function afterPageLoad(tabId, tab) {
  const floatTabs = await getFloatTabs();
  const info = floatTabs[tabId];
  if (!info) return;
  const alive = await sendToTab(tabId, { type: 'float:ping' });
  if (alive && alive.ok && alive.mode !== 'idle') return; // same document (SPA) – still open
  const { floatSettings } = await chrome.storage.local.get('floatSettings');
  if (floatSettings && floatSettings.pinned && canInject(tab.url)) {
    try {
      await injectFloating(tabId);
      await sendToTab(tabId, { type: 'float:open', minimized: !!info.minimized });
      return;
    } catch (_) { /* fall through to cleanup */ }
  }
  await setFloatTab(tabId, null);
  await clearFloatRules(tabId);
}

async function diagnoseFraming(url) {
  try {
    const r = await fetch(url, { method: 'GET', credentials: 'omit', redirect: 'follow', cache: 'no-store' });
    const csp = r.headers.get('content-security-policy') || '';
    const fa = /frame-ancestors[^;]*/i.exec(csp);
    return {
      ok: true,
      status: r.status,
      finalUrl: r.url,
      xfo: r.headers.get('x-frame-options'),
      frameAncestors: fa ? fa[0].trim() : null
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/* ------------------------------------------------------------------ */
/* Exact device mode (chrome.debugger)                                  */
/* ------------------------------------------------------------------ */

const send = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params || {});

async function paintBadge(tabId, info) {
  try {
    if (info) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: ACCENT });
      await chrome.action.setBadgeText({ tabId, text: 'ON' });
      await chrome.action.setTitle({ tabId, title: `Peak Preview – emulating ${info.name} (${info.w}×${info.h}). Click to stop.` });
    } else {
      await chrome.action.setBadgeText({ tabId, text: '' });
      await chrome.action.setTitle({ tabId, title: 'Peak Preview – floating mobile preview' });
    }
  } catch (_) { /* tab may be gone */ }
}

async function startExact({ tabId, url, device, rotated, reuseSender }) {
  if (!device) throw new Error('No device selected.');
  if (!tabId || reuseSender) {
    if (!isWebUrl(url)) throw new Error('Enter a web address that starts with http:// or https://');
  }
  if (reuseSender && tabId) {
    // The workspace tab itself becomes the device tab (same screen).
    await chrome.tabs.update(tabId, { url });
  } else if (!tabId) {
    const created = await chrome.tabs.create({ url, active: true });
    tabId = created.id;
  }
  const tab = await chrome.tabs.get(tabId);
  if (!isWebUrl(reuseSender ? url : (tab.url || tab.pendingUrl || url))) {
    throw new Error('Exact mode works on normal web pages (http/https), not on Chrome or extension pages.');
  }

  // The tab itself becomes the device, so the floating preview must not come back.
  await setFloatTab(tabId, null);
  await clearFloatRules(tabId);

  const w = rotated ? device.h : device.w;
  const h = rotated ? device.w : device.h;

  // Give the device its own window, sized to the screen, so the page is not left in a
  // corner of a big tab with empty space beside it. The tab goes back when exact mode stops.
  const prior = (await getExactMap())[tabId];
  let origin = prior && prior.origin;
  let popupId = prior && prior.windowId;
  if (!prior || !prior.popup) {
    origin = { windowId: tab.windowId, index: tab.index };
    const win = await chrome.windows.create({ tabId, type: 'popup', width: w + 16, height: h + 100, focused: true });
    popupId = win.id;
  }
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (e) {
    if (!/already attached/i.test(String(e && e.message))) throw e;
  }
  // Fit the window to the device: first learn how much space the window frame takes,
  // then shrink the scale if the device is taller or wider than a typical screen.
  const sized = await chrome.tabs.get(tabId);
  const win1 = await chrome.windows.get(popupId);
  const dW = win1.width - (sized.width || w), dH = win1.height - (sized.height || h);
  const sc = Math.max(0.25, Math.floor(Math.min(1, 820 / h, 1500 / w) * 100) / 100);
  await chrome.windows.update(popupId, { width: Math.round(w * sc) + dW, height: Math.round(h * sc) + dH, focused: true });
  await new Promise((r) => setTimeout(r, 250));
  tab.width = (await chrome.tabs.get(tabId)).width;
  tab.height = (await chrome.tabs.get(tabId)).height;
  const env = envFor(device, rotated);
  const isDesktop = device.type === 'desktop';
  const fit = Math.min(1, (tab.width || w) / w, (tab.height || h) / h);

  const metrics = {
    width: w,
    height: h,
    deviceScaleFactor: device.dpr || 1,
    mobile: !isDesktop,
    scale: Math.max(0.25, Math.floor(fit * 100) / 100),
    screenWidth: w,
    screenHeight: h
  };
  if (!isDesktop) {
    metrics.screenOrientation = rotated
      ? { type: 'landscapePrimary', angle: 90 }
      : { type: 'portraitPrimary', angle: 0 };
  }
  await send(tabId, 'Emulation.setDeviceMetricsOverride', metrics);

  if (env) {
    const uaParams = { userAgent: env.ua, platform: env.platform };
    if (env.uaData) {
      const major = (/Chrome\/(\d+)/.exec(env.ua) || [])[1] || '140';
      uaParams.userAgentMetadata = {
        brands: [
          { brand: 'Chromium', version: major },
          { brand: 'Google Chrome', version: major },
          { brand: 'Not=A?Brand', version: '24' }
        ],
        platform: env.uaData.platform,
        platformVersion: env.uaData.platformVersion,
        architecture: '',
        model: env.uaData.model,
        mobile: env.uaData.mobile
      };
    }
    await send(tabId, 'Emulation.setUserAgentOverride', uaParams);
    await send(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send(tabId, 'Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  } else {
    await send(tabId, 'Emulation.setTouchEmulationEnabled', { enabled: false });
    await send(tabId, 'Emulation.setEmitTouchEventsForMouse', { enabled: false });
  }

  const info = { id: device.id, name: device.name, w, h, rotated: !!rotated, popup: true, windowId: popupId, origin };
  await setExact(tabId, info);
  await chrome.tabs.reload(tabId);
  await paintBadge(tabId, info);
  return { tabId, info };
}

/** Device windows have no toolbar, so add a small round button to leave exact mode. */
async function injectExitButton(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () => {
        if (document.getElementById('__pp_exit')) return;
        const b = document.createElement('button');
        b.id = '__pp_exit';
        b.type = 'button';
        b.title = 'Leave device mode (Peak Preview)';
        b.setAttribute('aria-label', 'Leave device mode');
        b.textContent = '✕';
        b.style.cssText = 'all:initial;position:fixed;left:10px;bottom:10px;z-index:2147483647;width:30px;height:30px;border-radius:50%;background:rgba(20,22,28,.78);color:#fff;font:600 14px/30px system-ui,sans-serif;text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3)';
        b.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'exact:stop', tabId: 'self' }));
        (document.documentElement || document).appendChild(b);
      }
    });
  } catch (_) { /* page may not allow scripts */ }
}

async function stopExact(tabId) {
  const info = (await getExactMap())[tabId];
  try { await send(tabId, 'Emulation.clearDeviceMetricsOverride'); } catch (_) {}
  try { await chrome.debugger.detach({ tabId }); } catch (_) {}
  await setExact(tabId, null);
  await paintBadge(tabId, null);
  if (info && info.popup) {
    // Put the tab back where it came from (or into a normal window if that is gone).
    try {
      await chrome.tabs.move(tabId, { windowId: info.origin.windowId, index: info.origin.index });
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(info.origin.windowId, { focused: true });
    } catch (_) {
      try { await chrome.windows.create({ tabId, type: 'normal', focused: true }); } catch (__) {}
    }
  }
  try { await chrome.tabs.reload(tabId); } catch (_) {}
}

chrome.debugger.onDetach.addListener(async (source) => {
  if (source.tabId == null) return;
  await setExact(source.tabId, null);
  await paintBadge(source.tabId, null);
});

/* ------------------------------------------------------------------ */
/* Messages                                                             */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;
  (async () => {
    switch (msg && msg.type) {
      case 'viewer:rules': {
        if (tabId == null) throw new Error('Viewer tab not found');
        await setViewerRules(tabId, msg.uaEnv || null);
        return { ok: true };
      }
      case 'viewer:open': {
        await openViewer(msg.url, msg.mode, sender.tab);
        return { ok: true };
      }
      case 'float:rules': {
        if (tabId == null) throw new Error('No tab');
        await setFloatRules(tabId, msg.uaEnv || null);
        return { ok: true };
      }
      case 'float:state': {
        if (tabId != null) await setFloatTab(tabId, { minimized: !!msg.minimized });
        return { ok: true };
      }
      case 'float:closed': {
        if (tabId != null) { await setFloatTab(tabId, null); await clearFloatRules(tabId); }
        return { ok: true };
      }
      case 'float:diagnose': {
        if (!isWebUrl(msg.url)) return { ok: false, error: 'Not a web address' };
        const d = await diagnoseFraming(msg.url);
        try {
          const rules = await chrome.declarativeNetRequest.getSessionRules();
          d.rules = rules.filter((r) => (r.condition.tabIds || []).includes(tabId) && isFloatRule(r)).length;
        } catch (_) { d.rules = -1; }
        return d;
      }
      case 'float:capture': {
        if (!sender.tab) throw new Error('No tab');
        const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
        return { ok: true, dataUrl };
      }
      case 'exact:start': {
        const res = await startExact(Object.assign({}, msg, { tabId: msg.tabId === 'self' || msg.reuseSender ? tabId : msg.tabId }));
        return Object.assign({ ok: true }, res);
      }
      case 'exact:stop': {
        await stopExact(msg.tabId === 'self' ? tabId : msg.tabId);
        return { ok: true };
      }
      case 'exact:state': {
        const exact = await getExactMap();
        return { ok: true, info: exact[msg.tabId === 'self' ? tabId : msg.tabId] || null };
      }
      default:
        return { ok: false, error: 'Unknown message' };
    }
  })().then(sendResponse, (err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true;
});

/* ------------------------------------------------------------------ */
/* Icon, shortcut, menus, cleanup                                      */
/* ------------------------------------------------------------------ */

chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id != null) enqueue(tab.id, () => handleActionClick(tab));
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'pp-page',
      title: 'Preview this page on mobile & desktop',
      contexts: ['page'],
      documentUrlPatterns: ['http://*/*', 'https://*/*']
    });
    chrome.contextMenus.create({
      id: 'pp-link',
      title: 'Preview this link on mobile & desktop',
      contexts: ['link'],
      targetUrlPatterns: ['http://*/*', 'https://*/*']
    });
    chrome.contextMenus.create({ id: 'pp-action-workspace', title: 'Open comparison workspace', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'pp-action-stop-exact', title: 'Stop exact device mode on this tab', contexts: ['action'] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'pp-action-stop-exact') {
    if (tab && tab.id != null && (await getExactMap())[tab.id]) enqueue(tab.id, () => stopExact(tab.id));
    return;
  }
  const url = info.menuItemId === 'pp-link' ? info.linkUrl : (info.pageUrl || (tab && tab.url));
  openViewer(url, 'compare', tab);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-compare') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  openViewer(tab && tab.url, 'compare', tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearViewerRules(tabId);
  clearFloatRules(tabId);
  setExact(tabId, null);
  setFloatTab(tabId, null);
});

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.url && !change.url.startsWith(VIEWER_URL)) clearViewerRules(tabId);
  if (change.status === 'complete') {
    const exact = await getExactMap();
    if (exact[tabId]) { paintBadge(tabId, exact[tabId]); if (exact[tabId].popup) injectExitButton(tabId); }
    enqueue(tabId, () => afterPageLoad(tabId, tab));
  }
});
