// Verifies the simulated viewport is exactly the device size in every layout/zoom combination.
const { chromium } = require('playwright');
const path = require('path'), os = require('os'), fs = require('fs');
const http = require('http');
const startServer = require('./server');
const EXT = path.resolve(__dirname, '..', 'devicepeek');
const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, total = 0;
const ok = (c, name, x) => { total++; if (!c) fails++; if (!c) console.log('FAIL', name, JSON.stringify(x)); };

(async () => {
  const srv = await startServer(5396);
  // extra page: site that zooms <html> and uses a responsive breakpoint
  const zsrv = http.createServer((q, r) => {
    r.writeHead(200, { 'content-type': 'text/html' });
    r.end(`<!doctype html><html style="zoom:0.8"><head><meta name="viewport" content="width=device-width"><style>
      #bp{font:20px sans-serif} @media (max-width:400px){#bp::after{content:' MOBILE<=400'}} @media (min-width:401px){#bp::after{content:' WIDE>400'}}</style></head>
      <body><div id="bp">breakpoint:</div></body></html>`);
  }).listen(5397);

  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'dp-')), {
    channel: 'chromium', headless: true, viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  const page = ctx.pages()[0];
  const save = (p) => sw.evaluate((p) => DevicePeek.prefs.save(p), p);
  const frame = () => page.frames().find((f) => f.name().startsWith('__dp:'));
  async function measure() {
    const f = frame();
    const inner = await f.evaluate(() => ({ w: innerWidth, h: innerHeight, cw: document.documentElement.clientWidth }));
    const el = await f.frameElement();
    const box = await el.boundingBox(); // on-screen size (after transform)
    return { inner, box };
  }

  await page.goto('http://localhost:5396/');
  await save({ mode: 'side', zoom: 1, panelWidth: 430, deviceId: 'iphone15pro', landscape: false, debugHud: false });
  await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ active: true }); return toggleTab(t); });
  await sleep(1500);

  const devices = ['iphone15pro', 'iphone15promax', 'iphone14', 'iphonese', 'pixel8', 'galaxys24', 'ipadmini'];
  const sizes = { iphone15pro: [393, 852], iphone15promax: [430, 932], iphone14: [390, 844], iphonese: [375, 667], pixel8: [412, 915], galaxys24: [360, 780], ipadmini: [768, 1024] };
  const layouts = [
    { mode: 'side', panelWidth: 280 }, { mode: 'side', panelWidth: 430 }, { mode: 'side', panelWidth: 900 },
    { mode: 'floating', floatW: 320, floatH: 500, floatX: 100, floatY: 50 }, { mode: 'floating', floatW: 700, floatH: 860, floatX: 600, floatY: 10 }
  ];
  const zooms = ['fit', 0.5, 0.75, 1, 1.25];
  const results = [];
  for (const L of layouts) {
    await save(L);
    for (const id of devices) {
      for (const landscape of [false, true]) {
        await save({ deviceId: id, landscape });
        for (const z of zooms) {
          await save({ zoom: z });
          await sleep(z === 'fit' ? 250 : 150);
          let m;
          for (let i = 0; i < 20; i++) {
            try { m = await measure(); } catch (e) { m = null; }
            const [W, H] = landscape ? [sizes[id][1], sizes[id][0]] : sizes[id];
            if (m && m.inner.w === W && m.inner.h === H) break;
            await sleep(150);
          }
          const [W, H] = landscape ? [sizes[id][1], sizes[id][0]] : sizes[id];
          const good = m && m.inner.w === W && m.inner.h === H;
          ok(good, `${L.mode}/${L.panelWidth || L.floatW} ${id}${landscape ? ' L' : ''} zoom=${z}`, m);
          // On-screen size must equal W*scale (scale = zoom, or <=1 for fit)
          if (good && z !== 'fit') ok(Math.abs(m.box.width - W * z) < 1.5 && Math.abs(m.box.height - H * z) < 1.5, `visual size ${id} z=${z}`, m.box);
          if (good && z === 'fit') ok(Math.abs(m.box.width / m.box.height - W / H) < 0.01 && m.box.width <= W + 0.5, `fit keeps aspect ${id}`, m.box);
        }
      }
    }
  }
  // breakpoint check on a page that zooms <html>
  await save({ mode: 'side', panelWidth: 430, deviceId: 'iphone15pro', landscape: false, zoom: 1, debugHud: true });
  await page.goto('http://localhost:5397/');
  await sleep(2000);
  const bp = await frame().evaluate(() => [innerWidth, getComputedStyle(document.getElementById('bp'), '::after').content]);
  ok(bp[0] === 393 && /MOBILE/.test(bp[1]), 'page with html zoom: preview still 393 wide, mobile breakpoint active', bp);
  const hostZoom = await page.evaluate(() => document.querySelector('devicepeek-root').style.zoom);
  ok(Math.abs(Number(hostZoom) - 1.25) < 0.001, 'panel cancels page html zoom', hostZoom);
  await page.screenshot({ path: path.join(OUT, 'hud.png') });

  console.log(`${total - fails}/${total} passed`);
  await ctx.close(); srv.close(); zsrv.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
