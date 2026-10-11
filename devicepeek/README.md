# DevicePeek 3.0 – Responsive Preview

A phone or tablet preview docked to the right of the page you're on. The desktop site stays
fully usable on the left, and the preview follows your navigation and scrolling.

```
DESKTOP WEBSITE  |  drag divider  |  MOBILE PREVIEW
```

## Install

1. Keep the `devicepeek` folder somewhere permanent (Chrome loads it from there).
2. Go to `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the `devicepeek` folder (the one with `manifest.json`).
4. Pin DevicePeek from the puzzle-piece menu.

Updating from 1.0: remove the old version first or load this folder over it. Your device, zoom
and sync settings are migrated.

## Use

- **Click the icon.** The popup opens the preview on the current tab right away (turn off
  "Open preview when I click the icon" if you'd rather press the button yourself).
- **Alt+Shift+M** toggles the preview without the popup. Change it at `chrome://extensions/shortcuts`.
- **Drag the divider** to resize (280 px up to 70 % of the window). Double-click it to reset;
  arrow keys work when it has focus. The width is remembered.
- The preview **stays open** when you reload, click links or change routes. It's remembered per
  tab until you close it.

### Two layouts

- **Docked** (default): the panel sits on the right and the page reflows into the remaining width.
  Best for side-by-side checking.
- **Floating**: the preview becomes a movable window over the page.
  - Drag the title bar (or an empty part of the toolbar) to move it. It always stays inside the
    browser window.
  - Resize it from the left, right or bottom edge, or from a bottom corner.
  - Minimize collapses it to the title bar; maximize fills the window. Double-click the title bar
    to maximize or restore.
  - Position and size are remembered.

Switch with the dock / pop-out button in the toolbar or **Layout** in the popup. Switching
doesn't reload the preview, and every feature (devices, rotate, zoom, follow, sync, screenshot)
works in both.

### Toolbar

| Control | What it does |
| --- | --- |
| Device menu | iPhone, Android and tablet presets, or Custom size |
| W × H | Type a size to switch to a custom viewport |
| Rotate | Portrait / landscape (remembered) |
| Pop out / Dock | Switches between the floating window and the docked panel |
| Minimize / Maximize | Floating window only |
| Close | Closes the preview and restores the page |
| Back / Forward / Reload | Navigation for the preview only |
| Follow (link icon) | Preview opens the page the desktop navigates to, including SPA routes |
| Sync (arrows icon) | Desktop scrolling moves the preview to the same relative position. Turn on **Two-way** in the popup to let preview scrolling move the desktop as well |
| Frame (phone icon) | Device bezel around the preview (camera, side buttons, home button on iPhone SE). Drawn outside the viewport |
| − Zoom + | Fit, 50–150 % or Custom…; − / + step from 25 % to 300 %. Keys `+` `−` `0` while the panel has focus. Only changes how big the preview is drawn, never the simulated viewport |
| Camera (green) | Saves a PNG of the preview screen only (never the bezel), e.g. `devicepeek-iphone-15-pro-example-com.png` |
| Size readout (bottom right) | Click it to show the viewport readout: configured size, real `innerWidth` / `innerHeight` inside the page, scale. Turns yellow if the page ever reports a different size |
| Address bar (bottom) | Shows the preview URL. Type a URL or path and press Enter to open it in the preview |

### Popup

Open / close, device (with a silhouette, size, pixel ratio and OS), Portrait/Landscape, Frame,
**Layout** (Docked / Floating), **Theme** (Light / Dark / Auto), Follow current page, Sync scroll,
Two-way.

## Viewport accuracy

The device size is the page's real CSS viewport: for iPhone 15 Pro the site sees exactly
`innerWidth` 393 and `innerHeight` 852. The toolbar, status bar, padding and borders are never part of
it. Zoom and Fit only change how big the preview is drawn (CSS transform); the site still lays out
at 393 px. At 100 % a tall device can be taller than the panel; scroll the panel or use Fit.

## How the preview works

- The preview is a real frame of the site, sized to the device's CSS viewport, so media queries,
  layout, links, forms, menus and scrolling behave like on the phone.
- Requests from frames in that tab get a mobile User-Agent and client hints, and
  `X-Frame-Options` / `Content-Security-Policy` response headers are removed so sites that
  normally refuse to be framed still load. The desktop page itself is not modified.
- Inside the preview, `navigator.userAgent`, `platform`, `maxTouchPoints`, `userAgentData` and
  `devicePixelRatio` match the selected device. Scrollbars are hidden and the cursor is a touch dot.
- Preview navigation doesn't fill the tab's Back/Forward history: links and `pushState` in the
  preview use `replace`, and the preview's Back/Forward buttons use their own history.

### When a site still won't load

If a page arrives with blocking headers DevicePeek can't change (usually because the site's
service worker served it), the panel shows **"This website prevents embedded previews."** with:

- **Retry**
- **Compatibility mode** – hosts the frame inside an extension page. Also switched on
  automatically when the desktop page's own CSP forbids frames. Some sites treat cookies in this
  mode as third-party, so you may appear logged out.
- **Open device window** – a separate window sized to the device, with the mobile User-Agent.

## Limits worth knowing

- Chrome doesn't let extensions run on `chrome://` pages, the New Tab page, other extensions'
  pages or the Chrome Web Store. The popup explains this when you open it there.
- Local `file://` pages need **Allow access to file URLs** (chrome://extensions → DevicePeek → Details).
- Docked mode narrows the page with a margin on `<html>`. Normal content reflows into the
  remaining space, and fixed headers, banners and chat buttons that end up under the panel are
  moved out from under it. CSS media queries and `vw` units on the desktop page still use the
  full window width, because no extension can change the real viewport of the tab.
- While the preview is open, other frames embedded in the desktop page (for example video
  embeds) also receive the mobile User-Agent header.
- CSS hover/pointer media queries in the preview still reflect a mouse.
- Always do a final check on a real phone.

## Files

```
manifest.json        MV3 manifest
background.js        service worker: per-tab state, network rules, screenshots, shortcut, popup API
content.js           content-script bootstrap: restore after navigation, open/close, settings
content.css          panel styles (shadow DOM only)
content/
  panel.js           panel UI and session controller (docked + floating window)
  preview.js         preview frame, engines (direct / compat), own history, blocked detection
  dock.js            side-by-side layout and fixed-element handling
  nav-watch.js       desktop URL change detection (SPA aware)
  scroll-sync.js     desktop scroll ratio
  screenshot.js      viewport screenshot
  icons.js           SVG icons
lib/                 shared by service worker, popup and content scripts
  devices.js         device presets, user agents
  prefs.js           settings, defaults, migration from 1.0
  urls.js            which pages can be previewed
  util.js            helpers
frame.js             agent inside preview frames (scroll, URL reporting, commands)
frame-main.js        page-world patch inside preview frames (UA, DPR, history)
page-hooks.js        page-world pushState/replaceState hook for the desktop page (only while open)
preview.html/.js     compatibility-mode frame host
popup.html/.css/.js  toolbar popup
```
