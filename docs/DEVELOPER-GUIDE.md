# DevicePeek – Developer Guide

## Setup

```bash
cd "C:\Users\Jaspreet Singh\Downloads\DevicePeek"
npm run setup        # installs Playwright and its test Chromium (one time)
npm run check        # static checks, no browser
```

Branded Google Chrome (137+) ignores `--load-extension`, so the tests use Playwright's Chromium.
Your normal Chrome install isn't touched by the tests.

## Architecture

```
┌──────────────────────── tab ────────────────────────┐
│ desktop page                     │ <devicepeek-root> │  closed Shadow DOM
│   content.js (isolated world)    │   toolbar         │
│   page-hooks.js (page world,     │   iframe ─────────┼─► preview document
│     only while open)             │   status bar      │     frame-main.js (page world)
└──────────────────────────────────┴───────────────────┘     frame.js (isolated world)
            ▲  chrome.runtime messages
            ▼
   background.js (service worker)
     • per-tab open state  → chrome.storage.session
     • DNR session rules   → mobile UA, strip X-Frame-Options/CSP for frames in open tabs
     • screenshots, keyboard command, popup API
   settings → chrome.storage.local ("devicepeek:prefs"), shared by popup + every panel
```

| File | Role |
| --- | --- |
| `background.js` | Tab state, network rules, `captureVisibleTab`, the `toggle-devicepeek` command, popup messages, injecting content scripts into tabs opened before install |
| `content.js` | Asks the service worker whether this tab was open (restore after reload or navigation), mounts and unmounts the panel, forwards settings changes |
| `content/panel.js` | The panel: toolbar, layout and zoom, docked divider, floating window (move, resize, minimize, maximize), screenshot, viewport readout |
| `content/preview.js` | Preview engines (`direct` iframe, `compat` iframe inside `preview.html`), its own back/forward history, blocked-frame detection |
| `content/dock.js` | Docked mode: `margin-right` on `<html>` plus moving fixed elements out from under the panel; restores everything exactly |
| `content/nav-watch.js` | Desktop URL changes (pushState/replaceState via page-hooks, popstate, hashchange, Navigation API, 1.5 s fallback) |
| `content/scroll-sync.js` | Desktop scroll position as a 0–1 ratio |
| `content/screenshot.js` | Captures the visible tab and crops the viewport |
| `frame.js` | Inside the preview: reports URL, scroll and real viewport size; runs commands; hides scrollbars; keeps link clicks out of tab history |
| `frame-main.js` | Inside the preview, page world: User-Agent, `userAgentData`, `devicePixelRatio`, history patching |
| `lib/devices.js` | **Device presets** and User-Agent strings |
| `lib/prefs.js` | **Settings defaults**, validation, migration from v1 |
| `lib/urls.js` | Which pages can be previewed, plus address-bar parsing |
| `popup.*` | Toolbar popup |

### Key rules (keep these when changing code)
- **The viewport is exact.** `.dp-device` and its iframe are locked to `--dp-vw × --dp-vh` with
  min/max sizes. Zoom and Fit use `transform: scale()` on `.dp-bezel` only. Never size them with
  `%`, `flex: 1` or CSS `zoom`. The bezel is padding *around* the viewport.
- **No containment above fixed elements.** The screenshot moves `.dp-bezel` to `position: fixed`.
  Don't add `transform`, `filter`, `contain` or `container-type` to its ancestors (`.dp`, stage,
  sizer); the toolbar is the only size container.
- **Restore the page exactly.** All page changes go through `dock.js` snapshots: inline styles are
  set through the CSSOM (never blocked by CSP) and removed again, including empty `style=""`
  attributes.
- **The UI lives in a closed Shadow DOM.** Never style page elements globally.
- **Preview frames are identified by `window.name`** (`__dp:<os>:<dpr>:<id>`). `frame.js` and
  `frame-main.js` do nothing in any other frame.
- **Settings have a single source:** write with `DevicePeek.prefs.save()`, react in
  `prefs.onChange`.

## Common changes

**Add a device preset:** add one line to `DEVICES` in `lib/devices.js`, using the CSS viewport in
portrait, plus `dpr` and `os` (`ios` / `ipados` / `android`). The popup and the panel pick it up
automatically. Update the device count in `tests/e2e.js` (the "popup lists N device options" check).

**Change a default** (panel width, default device, sync on/off): edit `DEFAULTS` in `lib/prefs.js`.
Add any new setting to both `DEFAULTS` and `normalize()`.

**Change the look:** panel styles are in `content.css`, popup styles in `popup.css`. Both start with
color tokens written as `light-dark(light, dark)`; the theme setting only switches `color-scheme`
(`data-theme` on `.dp` / `<html>`). Change a token once and both themes follow.

**Change the device bezel:** `FRAMES` in `lib/devices.js` (padding and corner radii per frame type;
`frame` on each device picks one). `panel.js` turns it into CSS variables on `.dp-bezel`; the
details (camera, home button, side buttons) are `.dp-bz-*` rules in `content.css`.

**Change the shortcut default:** `commands` in `manifest.json`. Existing installs keep their current
binding; users change it at `chrome://extensions/shortcuts`.

## Testing

| Command | Covers |
| --- | --- |
| `npm run check` | Syntax of every JS file, manifest validity, referenced files exist, versions match |
| `npm test` | End to end in real Chromium: open/close, restore after navigation and reload, docking and fixed elements, device/OS/rotation/custom size, width limits, divider drag, floating move/resize/minimize/maximize, follow page (incl. SPA), sync scroll (one- and two-way, no loops), screenshot, blocked sites, compat engine, tab history, exact page restore, unsupported pages, popup, console errors |
| `npm run test:viewport` | 700+ checks that `innerWidth`/`innerHeight` inside the preview equal the device size for every device × orientation × zoom × layout, plus a site that zooms `<html>` |

Test screenshots are written to `tests/output/`.

The panel is a closed shadow root, so tests can't query it from the page. Instead they run a
script in the extension's isolated world (`chrome.scripting.executeScript` from the service
worker) and read `DevicePeek.activePanel._testRoot`, find a button by its `aria-label`, and click
its real screen position. Page scripts can't see that world, so the shadow root stays private.

## Releasing a new version

1. Make the change.
2. Bump the version in **both** `devicepeek/manifest.json` and `package.json`.
3. Add an entry to `CHANGELOG.md`.
4. Run `npm run test:all`.
5. Run `npm run package` → `dist/DevicePeek-<version>.zip`.
6. In Chrome, reload the extension at `chrome://extensions` (or restart Chrome).

## Debugging tips

- **Service worker:** `chrome://extensions` → DevicePeek → "service worker" link → DevTools console.
- **Panel / content scripts:** page DevTools → Console → choose the DevicePeek context in the
  context dropdown.
- **Preview frame:** page DevTools → pick the iframe in the context dropdown.
- **Viewport:** click the size text at the bottom right of the panel to show the readout.
