# Changelog

## 3.0.0 – 2026-10-11
**New look.** The panel and popup were redesigned: rounded, grouped controls, a brand-green
accent that matches the icon, a dotted canvas behind the preview and larger click targets.
- **Device frame:** the preview sits in a phone or tablet bezel (camera, side buttons, a home
  button on iPhone SE). The bezel is drawn around the viewport, never inside it, so sizes stay
  exact. Toggle it with the frame button in the toolbar or **Frame** in the popup. Screenshots
  are always the bare screen.
- **Themes:** Dark (default), Light or Auto (follows your system), in the popup.
- **Zoom stepper:** − / + buttons next to the zoom menu (25 %–300 %), plus `+`, `−` and `0` (Fit)
  as keyboard shortcuts while the panel has focus. Typed zooms replace the menu in place
  instead of widening the toolbar.
- **Floating window title bar** with the site name and window buttons; minimize now collapses to it.
- **Narrow panels:** below ~370 px the toolbar reflows into three tidy rows.
- **Popup:** device silhouette with size, pixel ratio and OS; Portrait/Landscape and Frame chips;
  icon segmented controls; fits Chrome's 600 px popup height on every page.
- Status bar: lock icon for HTTPS, rounded address field, compact size chip, "compat" badge.
- Toolbar badge is green to match the brand.

**Fixes**
- Switching from Floating back to Docked left the panel at the floating window's position and
  height (half-way across the page instead of on the right edge).
- An error page in the preview (unreachable address, or a refused frame after a link click)
  never showed "This website prevents embedded previews." Detection no longer depends on the
  old page's unload message, which Chrome drops in that case.
- The service worker reported the preview as open even when the panel failed to start on the page.
- Restoring a tab after settings changed elsewhere could load the preview with the previous
  device's User-Agent header.
- Choosing "Custom…" zoom and leaving the field empty left the menu stuck on "Custom…".
- `npm run package` produced a tar file named `.zip` on Linux; it now uses `zip` there and
  checks the result.

**Requires Chrome 123+** (was 116) for `light-dark()` theming.

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
