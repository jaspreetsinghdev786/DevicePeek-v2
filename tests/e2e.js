const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const startServer = require('./server');

const EXT = path.resolve(__dirname, '..', 'devicepeek');
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5391;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (cond, name, extra) => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`);
};

async function waitFor(fn, ms = 6000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {}
    await sleep(100);
  }
  return null;
}

(async () => {
  const srv = await startServer(PORT);
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1400, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  const errors = [];
  let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  sw.on('console', (m) => m.type() === 'error' && errors.push('sw: ' + m.text()));

  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('console', (m) => (m.type() === 'error' || m.text().includes('DevicePeek')) && errors.push('page: ' + m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE + '/');

  const toggle = () =>
    sw.evaluate(async () => {
      const [t] = await chrome.tabs.query({ active: true });
      return toggleTab(t);
    });
  const previewFrame = () => page.frames().find((f) => f !== page.mainFrame() && f.name().startsWith('__dp:'));
  // The panel UI is a closed shadow root. The extension's isolated world can still reach it
  // (DevicePeek.activePanel._testRoot), so buttons are found by selector, then clicked for real.
  const rectOf = (selector) =>
    sw.evaluate(async (sel) => {
      const [t] = await chrome.tabs.query({ active: true, url: 'http://localhost/*' });
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: t.id },
        args: [sel],
        func: (s) => {
          const p = globalThis.DevicePeek && DevicePeek.activePanel;
          const el = p && p._testRoot.querySelector(s);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: b.x + b.width / 2, y: b.y + b.height / 2, left: b.x, top: b.y, w: b.width, h: b.height };
        }
      });
      return r.result;
    }, selector);
  const panelAttr = (sel, attr) =>
    sw.evaluate(
      async ([s, a]) => {
        const [t] = await chrome.tabs.query({ active: true, url: 'http://localhost/*' });
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: t.id },
          args: [s, a],
          func: (s2, a2) => {
            const el = DevicePeek.activePanel && DevicePeek.activePanel._testRoot.querySelector(s2);
            return el ? el.getAttribute(a2) : null;
          }
        });
        return r.result;
      },
      [sel, attr]
    );
  const clickEl = async (sel) => {
    const r = await rectOf(sel);
    if (!r) throw new Error('panel element not found: ' + sel);
    await page.mouse.click(r.x, r.y);
  };
  const hostInfo = () =>
    page.evaluate(() => {
      const h = document.querySelector('devicepeek-root');
      return {
        host: !!h,
        hostWidth: h ? h.getBoundingClientRect().width : 0,
        marginRight: getComputedStyle(document.documentElement).marginRight,
        dockStyle: !!document.documentElement.style.marginRight,
        hdrRight: document.getElementById('hdr').getBoundingClientRect().right,
        chatRight: document.getElementById('chat').getBoundingClientRect().right,
        hdrStyle: document.getElementById('hdr').getAttribute('style'),
        chatStyle: document.getElementById('chat').getAttribute('style'),
        htmlStyle: document.documentElement.getAttribute('style')
      };
    });

  // ---- open
  const r = await toggle();
  ok(r && r.ok && r.open, 'toggle opens', r);
  const f1 = await waitFor(previewFrame);
  ok(!!f1, 'preview frame exists');
  await waitFor(async () => (await previewFrame().evaluate(() => document.readyState)) === 'complete');
  let info = await hostInfo();
  ok(info.host && Math.round(info.hostWidth) === 430, 'panel docked at 430px', info.hostWidth);
  ok(info.marginRight === '430px', 'page narrowed by margin-right', info.marginRight);
  await sleep(500);
  info = await hostInfo();
  ok(info.hdrRight <= 1400 - 430 + 1, 'fixed header constrained to page area', info.hdrRight);
  ok(info.chatRight <= 1400 - 430 + 1, 'fixed chat button moved out from under panel', info.chatRight);

  const fv = await previewFrame().evaluate(() => ({
    w: innerWidth, h: innerHeight, ua: navigator.userAgent, dpr: devicePixelRatio, mark: document.getElementById('ua-mark').textContent, url: location.href, tp: navigator.maxTouchPoints
  }));
  ok(fv.w === 393 && fv.h === 852, 'viewport = iPhone 15 Pro 393x852', [fv.w, fv.h]);
  ok(/iPhone/.test(fv.ua) && fv.dpr === 3 && fv.tp === 5, 'JS UA/DPR/touch emulated', fv);
  ok(fv.mark === 'MOBILE', 'server saw mobile UA header');
  const deskMark = await page.evaluate(() => document.getElementById('ua-mark').textContent);
  ok(deskMark === 'DESKTOP', 'desktop page untouched (desktop UA)');

  // ---- follow: full navigation via desktop link (also tests restore after navigation)
  await page.click('#about');
  await page.waitForURL(BASE + '/about');
  const f2 = await waitFor(async () => {
    const f = previewFrame();
    return f && (await f.evaluate(() => location.pathname)) === '/about' && f;
  }, 8000);
  ok(!!f2, 'panel restored after navigation and preview on /about');
  info = await hostInfo();
  ok(info.host && info.marginRight === '430px', 'docked again after navigation', info);

  // reload
  await page.reload();
  ok(!!(await waitFor(async () => (await hostInfo()).host && previewFrame())), 'panel restored after reload');

  // ---- SPA follow
  await page.goto(BASE + '/spa');
  await waitFor(async () => previewFrame() && (await previewFrame().evaluate(() => location.pathname)) === '/spa');
  const histBefore = await page.evaluate(() => history.length);
  await page.click('#go');
  const spaOk = await waitFor(async () => (await previewFrame().evaluate(() => location.pathname)) === '/spa/route2', 6000);
  ok(!!spaOk, 'preview follows pushState route');

  // ---- sync scroll desktop -> mobile
  await sleep(600);
  await page.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) / 2));
  const syncOk = await waitFor(async () => {
    const r = await previewFrame().evaluate(() => scrollY / (document.documentElement.scrollHeight - innerHeight));
    return Math.abs(r - 0.5) < 0.05 && r;
  });
  ok(!!syncOk, 'sync scroll moved preview to ~50%', syncOk);
  // two-way off by default: scrolling preview should not move desktop
  const deskY = await page.evaluate(() => scrollY);
  await previewFrame().evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  ok((await page.evaluate(() => scrollY)) === deskY, 'one-way: preview scroll does not move desktop');
  // enable two-way
  await sw.evaluate(() => DevicePeek.prefs.save({ syncScrollTwoWay: true }));
  await sleep(300);
  await previewFrame().evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const twoWay = await waitFor(async () => (await page.evaluate(() => scrollY / (document.documentElement.scrollHeight - innerHeight))) > 0.9);
  ok(!!twoWay, 'two-way: preview scroll moves desktop');
  await sleep(600);
  const y1 = await page.evaluate(() => scrollY);
  await sleep(600);
  ok(y1 === (await page.evaluate(() => scrollY)), 'no scroll feedback loop');
  await sw.evaluate(() => DevicePeek.prefs.save({ syncScrollTwoWay: false }));

  // ---- device switch (same OS) and OS switch
  await sw.evaluate(() => DevicePeek.prefs.save({ deviceId: 'iphonese' }));
  const se = await waitFor(async () => {
    const v = await previewFrame().evaluate(() => [innerWidth, innerHeight]);
    return v[0] === 375 && v[1] === 667 && v;
  });
  ok(!!se, 'switch to iPhone SE 375x667', se);
  await sw.evaluate(() => DevicePeek.prefs.save({ deviceId: 'pixel8' }));
  const px = await waitFor(async () => {
    const f = previewFrame();
    const v = await f.evaluate(() => [innerWidth, innerHeight, navigator.userAgent, document.getElementById('ua-mark') ? document.getElementById('ua-mark').textContent : 'spa', devicePixelRatio]);
    return v[0] === 412 && /Android/.test(v[2]) && v;
  }, 8000);
  ok(!!px, 'switch to Pixel 8 reloads with Android UA', px);
  const uaHeader = await (async () => {
    await previewFrame().evaluate((u) => location.replace(u), BASE + '/ua');
    await sleep(800);
    return previewFrame().evaluate(() => document.body.innerText);
  })();
  ok(/Android/.test(uaHeader), 'Android UA header after OS switch', uaHeader.slice(0, 60));

  // ---- orientation
  await sw.evaluate(() => DevicePeek.prefs.save({ landscape: true }));
  const land = await waitFor(async () => {
    const v = await previewFrame().evaluate(() => [innerWidth, innerHeight]);
    return v[0] === 915 && v[1] === 412 && v;
  });
  ok(!!land, 'landscape 915x412', land);
  await sw.evaluate(() => DevicePeek.prefs.save({ landscape: false, deviceId: 'custom', customW: 500, customH: 700 }));
  const cust = await waitFor(async () => {
    const v = await previewFrame().evaluate(() => [innerWidth, innerHeight]);
    return v[0] === 500 && v[1] === 700 && v;
  }, 8000);
  ok(!!cust, 'custom 500x700', cust);

  // ---- panel width pref + clamp
  await sw.evaluate(() => DevicePeek.prefs.save({ panelWidth: 5000 }));
  await sleep(400);
  info = await hostInfo();
  ok(Math.round(info.hostWidth) === Math.floor(1400 * 0.7), 'panel width clamped to 70%', info.hostWidth);
  await sw.evaluate(() => DevicePeek.prefs.save({ panelWidth: 100 }));
  await sleep(400);
  info = await hostInfo();
  ok(Math.round(info.hostWidth) === 280, 'panel width min 280', info.hostWidth);

  // ---- drag the divider
  await sw.evaluate(() => DevicePeek.prefs.save({ panelWidth: 430 }));
  await sleep(400);
  const x0 = 1400 - 430;
  await page.mouse.move(x0, 400);
  await page.mouse.down();
  await page.mouse.move(x0 - 100, 400, { steps: 8 });
  await page.mouse.up();
  await sleep(600);
  info = await hostInfo();
  const stored = await sw.evaluate(() => DevicePeek.prefs.load().then((p) => p.panelWidth));
  ok(Math.abs(info.hostWidth - 530) <= 2 && Math.abs(stored - 530) <= 2, 'drag divider resizes + persists', [info.hostWidth, stored, info.marginRight]);

  // ---- floating mode
  const rect = () => page.evaluate(() => { const r = document.querySelector('devicepeek-root').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
  await sw.evaluate(() => DevicePeek.prefs.save({ mode: 'floating', floatX: null, floatY: null, floatW: null, floatH: null }));
  await sleep(500);
  info = await hostInfo();
  let fr = await rect();
  ok(info.host && !info.dockStyle && info.marginRight === '0px', 'floating mode: page not narrowed', info);
  ok(fr.w === 420 && fr.x === 1400 - 420 - 16 && fr.y === 16, 'floating default rect', fr);
  const fvW = await previewFrame().evaluate(() => innerWidth);
  // move by dragging the title bar (the host name text is an empty, draggable spot)
  const tb = await rectOf('.dp-title-host');
  ok(!!tb && tb.y - fr.y < 30, 'floating window has a title bar', tb);
  await page.mouse.move(tb.left + 10, tb.y);
  await page.mouse.down();
  await page.mouse.move(tb.left + 10 - 300, tb.y + 50, { steps: 10 });
  await page.mouse.up();
  await sleep(500);
  let fr2 = await rect();
  ok(fr2.x === fr.x - 300 && fr2.y === Math.min(fr.y + 50, 900 - fr.h), 'drag moves floating window (clamped to viewport)', [fr, fr2]);
  // resize from bottom-right corner
  await page.mouse.move(fr2.x + fr2.w - 7, fr2.y + fr2.h - 7);
  await page.mouse.down();
  await page.mouse.move(fr2.x + fr2.w - 107, fr2.y + fr2.h - 107, { steps: 10 });
  await page.mouse.up();
  await sleep(600);
  let fr3 = await rect();
  ok(fr3.w === fr2.w - 100 && fr3.h === fr2.h - 100 && fr3.x === fr2.x, 'corner resize', [fr2, fr3]);
  const savedF = await sw.evaluate(() => DevicePeek.prefs.load());
  ok(savedF.floatX === fr3.x && savedF.floatY === fr3.y && savedF.floatW === fr3.w && savedF.floatH === fr3.h, 'floating rect persisted', savedF);
  ok((await previewFrame().evaluate(() => innerWidth)) === fvW, 'viewport unchanged by window resize (iframe not reloaded)');
  // minimize / restore / maximize via the title bar buttons
  await sw.evaluate(() => DevicePeek.prefs.save({ floatW: 420 }));
  await sleep(400);
  fr3 = await rect();
  await clickEl('button[aria-label="Minimize"]');
  await sleep(400);
  const frMin = await rect();
  ok(frMin.h < 60 && frMin.w === fr3.w, 'minimize collapses to the title bar', frMin);
  await clickEl('button[aria-label="Expand"]');
  await sleep(400);
  ok((await rect()).h === fr3.h, 'expand restores height');
  await clickEl('button[aria-label="Maximize"]');
  await sleep(400);
  const frMax = await rect();
  ok(frMax.x === 0 && frMax.y === 0 && frMax.w === 1400 && frMax.h === 900, 'maximize fills viewport', frMax);
  await clickEl('button[aria-label="Restore size"]');
  await sleep(400);
  ok(JSON.stringify(await rect()) === JSON.stringify(fr3), 'restore returns to saved rect');
  await clickEl('button[aria-label="Maximize"]');
  await sleep(400);
  const tbMax = await rectOf('.dp-title-host');
  await page.mouse.dblclick(tbMax.left + 10, tbMax.y);
  await sleep(400);
  ok(JSON.stringify(await rect()) === JSON.stringify(fr3), 'double-click on the title bar restores a maximized window', await rect());
  // reload keeps floating window where it was
  await page.reload();
  await waitFor(async () => (await hostInfo()).host);
  await sleep(600);
  ok(JSON.stringify(await rect()) === JSON.stringify(fr3), 'floating position survives reload', await rect());
  // dock button switches back
  await clickEl('button[aria-label^="Dock to the right"]');
  await sleep(600);
  info = await hostInfo();
  ok(info.marginRight === '530px' && Math.round(info.hostWidth) === 530, 'dock button returns to side-by-side', info);
  // regression (2.2.0): the floating left/height used to stick, leaving the docked panel mid-screen
  const docked = await rect();
  ok(docked.x === 1400 - 530 && docked.y === 0 && docked.h === 900, 'docked again: panel at the right edge, full height', docked);
  await sw.evaluate(() => DevicePeek.prefs.save({ mode: 'side' }));
  await sleep(400);

  // ---- zoom stepper, device frame and theme
  await sw.evaluate(() => DevicePeek.prefs.save({ deviceId: 'iphone15pro', zoom: 1, landscape: false }));
  await sleep(1500);
  await clickEl('button[aria-label="Zoom out"]');
  await sleep(300);
  ok((await sw.evaluate(() => DevicePeek.prefs.load().then((p) => p.zoom))) === 0.9, 'zoom out steps 100% → 90%');
  await clickEl('button[aria-label="Zoom in"]');
  await sleep(300);
  ok((await sw.evaluate(() => DevicePeek.prefs.load().then((p) => p.zoom))) === 1, 'zoom in steps back to 100%');
  const frameOn = await rectOf('.dp-bezel');
  const vpOn = await previewFrame().evaluate(() => [innerWidth, innerHeight]);
  await clickEl('button[aria-label="Device frame"]');
  await sleep(400);
  const frameOff = await rectOf('.dp-bezel');
  const vpOff = await previewFrame().evaluate(() => [innerWidth, innerHeight]);
  ok(frameOn.w > frameOff.w && frameOff.w === 393, 'frame toggle adds/removes the bezel around the viewport', [frameOn.w, frameOff.w]);
  ok(vpOn[0] === 393 && vpOff[0] === 393 && vpOn[1] === 852 && vpOff[1] === 852, 'frame never changes the viewport', [vpOn, vpOff]);
  await sw.evaluate(() => DevicePeek.prefs.save({ showFrame: true, theme: 'light' }));
  await sleep(300);
  ok((await panelAttr('.dp', 'data-theme')) === 'light', 'panel follows the theme setting');
  await sw.evaluate(() => DevicePeek.prefs.save({ theme: 'dark' }));

  // ---- screenshot (use 100% zoom so output is full size)
  await sw.evaluate(() => DevicePeek.prefs.save({ deviceId: 'iphone15pro', zoom: 'fit' }));
  await sleep(1500);
  const dlP = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await clickEl('button[aria-label="Screenshot of the preview"]');
  const dl = await dlP;
  ok(!!dl && /^devicepeek-iphone-15-pro-localhost\.png$/.test(dl.suggestedFilename()), 'screenshot downloaded with clean name', dl && dl.suggestedFilename());
  if (dl) {
    const p = path.join(OUT, 'shot.png');
    await dl.saveAs(p);
    const buf = fs.readFileSync(p);
    const w = buf.readUInt32BE(16), hgt = buf.readUInt32BE(20);
    ok(Math.abs(w / hgt - 393 / 852) < 0.02, 'screenshot aspect = viewport', [w, hgt]);
  }
  await page.screenshot({ path: path.join(OUT, 'docked.png') });

  // ---- blocked site (XFO) loads because headers are stripped
  await page.goto(BASE + '/xfo');
  const xfo = await waitFor(async () => previewFrame() && (await previewFrame().evaluate(() => document.querySelector('h1') && document.querySelector('h1').textContent)) === 'xfo page', 8000);
  ok(!!xfo, 'X-Frame-Options/frame-ancestors page still previews');

  // ---- page with strict CSP frame-src: compat engine
  await page.goto(BASE + '/strictcsp');
  const compat = await waitFor(async () => {
    const f = previewFrame();
    return f && (await f.evaluate(() => document.querySelector('h1') && document.querySelector('h1').textContent)) === 'strict csp';
  }, 10000);
  ok(!!compat, "page with CSP frame-src 'none' still previews");

  // ---- compatibility engine host (preview.html) loads + relays
  {
    const extId = sw.url().split('/')[2];
    const cp = await ctx.newPage();
    const cfg = { url: BASE + '/about', name: '__dp:android:2.625:test', sandbox: 'allow-scripts allow-same-origin allow-forms', allow: '' };
    await cp.addInitScript(() => {
      window.__msgs = [];
      window.addEventListener('message', (e) => e.data && e.data.__dp && window.__msgs.push(e.data.evt));
    });
    await cp.goto(`chrome-extension://${extId}/preview.html#` + encodeURIComponent(JSON.stringify(cfg)));
    const inner = await waitFor(async () => {
      const f = cp.frames().find((x) => x.name() === cfg.name);
      return f && (await f.evaluate(() => [document.querySelector('h1').textContent, navigator.userAgent, innerWidth > 0]));
    });
    const msgs = await cp.evaluate(() => window.__msgs);
    ok(inner && inner[0] === '/about' && /Android/.test(inner[1]) && msgs.includes('hello') && msgs.includes('frameload'), 'compat engine: inner frame loads, emulates, relays', { inner, msgs });
    await cp.close();
  }

  // ---- unreachable page / error page inside the preview shows the blocked message
  // (regression: the old document's "unload" message is dropped when an error page replaces it)
  await page.goto(BASE + '/');
  await waitFor(async () => previewFrame() && (await previewFrame().evaluate(() => location.pathname)) === '/');
  await sleep(400);
  await previewFrame().evaluate(() => location.replace('http://localhost:9/'));
  const blockedShown = await waitFor(async () => (await panelAttr('.dp-msg', 'hidden')) === null, 6000);
  ok(!!blockedShown, 'error page in the preview shows the "prevents embedded previews" message');
  await clickEl('.dp-msg-actions .dp-primary'); // Retry
  await sleep(300);

  // ---- tab history not polluted by preview navigation
  await page.goto(BASE + '/');
  await waitFor(async () => previewFrame() && (await previewFrame().evaluate(() => location.pathname)) === '/');
  await sleep(500);
  const hl0 = await page.evaluate(() => history.length);
  await previewFrame().click('#about');
  await waitFor(async () => (await previewFrame().evaluate(() => location.pathname)) === '/about');
  await sleep(300);
  ok((await page.evaluate(() => history.length)) === hl0, 'preview link click adds no tab history entry', [hl0]);
  ok(page.url() === BASE + '/', 'desktop stayed on / while preview navigated (follow is one-way)');

  // ---- close restores page exactly
  const before = await page.evaluate(() => document.documentElement.getAttribute('style'));
  const c = await toggle();
  await sleep(500);
  info = await hostInfo();
  ok(c && c.ok && !c.open && !info.host && !info.dockStyle && info.marginRight === '0px', 'close removes panel and dock', info);
  ok(info.hdrStyle === null && info.chatStyle === null, 'fixed elements restored (no leftover inline style)', [info.hdrStyle, info.chatStyle]);
  ok(info.htmlStyle === before || info.htmlStyle === null, 'html style untouched', info.htmlStyle);
  await page.reload();
  await sleep(800);
  ok(!(await hostInfo()).host, 'stays closed after reload');

  // ---- unsupported page status
  const st = await sw.evaluate(async () => {
    const t = await chrome.tabs.create({ url: 'chrome://version' });
    await new Promise((r) => setTimeout(r, 500));
    const s = await handle({ type: 'dp:status', tabId: t.id }, {});
    const o = await openTab(await chrome.tabs.get(t.id));
    await chrome.tabs.remove(t.id);
    return { s, o };
  });
  ok(st.s.supported === false && st.o.ok === false && st.o.message, 'chrome:// reported unsupported', st);

  // ---- popup renders
  const extId = sw.url().split('/')[2];
  const pop = await ctx.newPage();
  pop.on('pageerror', (e) => errors.push('popup: ' + e.message));
  await pop.goto(`chrome-extension://${extId}/popup.html`);
  await sleep(800);
  const popInfo = await pop.evaluate(() => ({ opts: document.querySelectorAll('#device option').length, device: document.getElementById('device').value, status: document.getElementById('status').textContent }));
  ok(popInfo.opts === 16, 'popup lists 16 device options', popInfo);
  await pop.screenshot({ path: path.join(OUT, 'popup.png') });
  await pop.close();

  const realErrors = errors.filter((e) => !/favicon/.test(e));
  ok(realErrors.length === 0, 'no console errors', realErrors);

  await ctx.close();
  srv.close();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
