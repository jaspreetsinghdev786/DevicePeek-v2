# Changelog

## 1.1.0 – Peak Preview (2026-10-20)
- Extension code in `devicepeek/` replaced with Peak Preview 1.1.0: floating movable mobile
  preview, side-by-side device workspace (`viewer.html`), exact device mode via `debugger`.
- Shortcuts: Alt+Shift+P (floating preview), Alt+Shift+M (comparison workspace).
- The 2.x DevicePeek code remains in git history. `docs/` and `tests/` still describe 2.2.0.

## 2.2.0 – 2026-10-04
- **Exact viewport:** the device viewport and its iframe are locked to the exact CSS size
  (min/max widths, no stretching). Zoom and Fit scale visually only.
- Cancels CSS `zoom` that a page sets on `<html>`, so the preview size isn't distorted.
- **Viewport readout:** click the size text to compare the configured size with the real
  `innerWidth`/`innerHeight` inside the page. The size text turns yellow if they ever differ.

## 2.1.0 – 2026-10-04
- **Floating mode:** the preview becomes a movable, resizable window with minimize/maximize.
  Position and size are remembered. Switch between Docked and Floating from the toolbar or popup.
- Window buttons stay grouped when the toolbar wraps on narrow widths.
- The popup explains what to do if the background service isn't running.

## 2.0.0 – 2026-10-04
- Rebuilt as a docked side-by-side panel: the desktop page reflows next to a resizable preview.
- Restores itself after reloads, navigations and SPA route changes.
- Follow desktop page, sync scroll (one- or two-way), rotate, zoom (Fit/50–125%/custom),
  viewport screenshot, popup controls, Alt+Shift+M command.
- New presets: iPhone 15 Pro, iPhone 14, Galaxy S24, Galaxy S23 Ultra, Pixel 8, iPad Pro.
- Handles blocked sites (header stripping, compatibility mode, device window) and pages that
  can't run extensions.
- Closed Shadow DOM UI, exact page restore, no tab-history pollution from the preview.

## 1.0.0
- Full-tab overlay with up to 5 devices side by side.
