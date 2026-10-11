# DevicePeek – project prompt

Project path (load this folder in Chrome):
C:\Users\Jaspreet Singh\Downloads\DevicePeek\devicepeek

Current version: 3.0.0 (Manifest V3)

---

## Prompt

I have a Chrome extension called **DevicePeek** (Manifest V3) at:

`C:\Users\Jaspreet Singh\Downloads\DevicePeek\devicepeek`

It is a side-by-side responsive testing tool for daily web development and digital marketing.
Inspect all existing files first, understand the architecture, reuse what works, and don't rewrite
working code without a reason.

The project root is `C:\Users\Jaspreet Singh\Downloads\DevicePeek`. Read
`docs/DEVELOPER-GUIDE.md` first: it explains the architecture, the key rules and how to test.
Use `npm run check`, `npm test` and `npm run test:viewport` to verify, update `CHANGELOG.md`,
and bump the version in both `devicepeek/manifest.json` and `package.json`.

Key rule: the selected device size is the page's exact CSS viewport (iPhone 15 Pro =
`innerWidth` 393 × `innerHeight` 852). The toolbar, padding and borders are never part of it, and
Zoom/Fit only scale it visually with `transform`.

### What it does
- Clicking the icon (or Alt+Shift+M) keeps the desktop site usable on the left and docks a mobile
  preview panel on the right of the same tab: DESKTOP | RESIZABLE DIVIDER | MOBILE PREVIEW.
- No tab replacement and no DevTools. It should feel like a native browser feature.

### Features
1. **Docked panel**: the desktop page reflows into the remaining width. Default 430px; drag the
   divider (min 280px, max 70% of viewport); double-click to reset. Width is remembered.
2. **Devices**: iPhone 15 Pro / 15 Pro Max / 14 / 14 Pro / 13 mini / SE, Galaxy S24 / S23 Ultra / S20 /
   Z Fold, Pixel 8 / 7, iPad Mini / Air / Pro, Custom. Each sets width, height, DPR and OS (User-Agent).
   W×H inputs for custom sizes.
3. **Real site in preview**: iframe sized to the device viewport, with links, forms, scroll,
   reload, back and forward. Mobile User-Agent via header and navigator.
4. **Follow Desktop Page**: follows reloads, link clicks and SPA routes (pushState, replaceState,
   popstate, hashchange). One-way, with no loops.
5. **Sync Scroll**: proportional scroll position, optional two-way, no feedback loops.
6. **Rotate**: swaps W×H; orientation is remembered.
7. **Zoom**: Fit / 50 / 75 / 100 / 125 / Custom. Only visual scale; the viewport stays the same.
8. **Toolbar**: device, W×H, rotate, back, forward, reload, follow, sync, device frame, zoom (− menu +),
   screenshot, pop out/dock, close. Floating mode adds a title bar with minimize/maximize.
9. **Screenshot**: preview viewport only, saved as `devicepeek-<device>-<site>.png`.
10. **Persistence** (chrome.storage): device, size, orientation, zoom, width, toggles, per-tab
    open state.
11. **Survives navigation**: the panel restores itself after reload or navigation.
12. **Popup**: opens the preview in one click and has controls for device (with a silhouette),
    rotate, frame, Layout (Docked / Floating), Theme (Light / Dark / Auto), follow, sync, two-way.
13. **Shortcut**: Alt+Shift+M (`commands` in manifest). Inside the panel: `+` / `−` zoom, `0` Fit, Esc closes.
14. **Floating mode** (in addition to Docked): the preview becomes a movable window over the page.
    Drag the toolbar to move it, resize from the edges and bottom corners, minimize/maximize
    (double-click the toolbar to maximize), and it stays inside the viewport. Position and size
    are remembered in chrome.storage.local. Switching modes (toolbar button or popup) doesn't
    reload the preview, and every feature works in both modes.

### Design rules (3.0)
- Bold but tidy: rounded controls (10 px, groups as pills), 32 px click targets, brand green
  accent (`#4ade80` dark / `#16a34a` light) matching the icon, SVG icons.
- Themes: Dark (default), Light, Auto. All colors are tokens with `light-dark()` at the top of
  `content.css` and `popup.css`; never hard-code a color in a rule.
- The optional device bezel is padding around the viewport and carries the zoom transform; it
  must never cover or resize the viewport. Screenshots are the bare screen.
- Animate only open, close, resize and small state changes. Respect reduced motion.
- It must not look AI-generated: no glows, no rainbow gradients, no emoji.

### Architecture rules
- Modular files: background.js (service worker), content.js (bootstrap), content.css (shadow DOM
  styles), content/*.js (panel, preview, dock, nav-watch, scroll-sync, screenshot, icons),
  lib/*.js (devices, prefs, urls, util), frame.js / frame-main.js (inside preview frames),
  page-hooks.js, preview.html/js (compatibility mode), popup.*.
- UI in a closed Shadow DOM. Don't touch global html/body/button/input/iframe styles unless
  unavoidable. Restore the page exactly on close.
- Fixed headers, banners and chat buttons under the panel get moved and restored on close.

### Robustness
- X-Frame-Options / CSP frame-ancestors: strip them for preview frames with tab-scoped
  declarativeNetRequest session rules. If loading still fails, show "This website prevents
  embedded previews." with Retry / Compatibility mode / Open device window.
- Preview navigation must not pollute the tab's Back/Forward history.
- Show clear states for: blocked frames, invalid URLs, runtime errors, a reloaded extension,
  chrome:// pages, extension pages, the New Tab page, the Web Store, and file:// pages without access.
- Lightweight: no heavy MutationObservers or fast polling. Throttle or debounce resize, scroll
  and navigation detection.

### My change request
<describe the new feature or fix here>

### After changes, verify
JS syntax, MV3 compliance, messaging, reload/navigation persistence, resize, device switching,
orientation, open/close, storage restore, CSS conflicts. Keep the folder ready for
chrome://extensions → Developer mode → Load unpacked.
