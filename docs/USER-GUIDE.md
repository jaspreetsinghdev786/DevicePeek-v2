# DevicePeek – User Guide

## 1. Install (one time only)

1. In Chrome, open `chrome://extensions`.
2. Turn on **Developer mode** (switch at the top right).
3. Click **Load unpacked**.
4. Choose the folder `C:\Users\Jaspreet Singh\Downloads\DevicePeek\devicepeek`
   (the one that contains `manifest.json`).
5. Click the puzzle-piece icon in the Chrome toolbar and **pin** DevicePeek.

You don't need to set it up again. It stays installed after you close Chrome or restart your
computer. Your settings are saved automatically.

**Keep in mind**
- Don't move, rename or delete the `devicepeek` folder.
- Leave **Developer mode** on.
- If the extension's files change (a new version), click the reload arrow on the DevicePeek card
  in `chrome://extensions`, or restart Chrome.

## 2. Daily use

1. Open the website you're working on (localhost works).
2. Click the **DevicePeek** icon, or press **Alt+Shift+M**.
3. The phone preview opens. Click the icon again (then **Close DevicePeek**), press
   **Alt+Shift+M**, or click **✕** in the panel to close it.

The preview stays open when you reload, click links or change routes. Each tab remembers it
until you close it.

## 3. The two layouts

| Layout | What it looks like | Best for |
| --- | --- | --- |
| **Docked** (default) | Panel on the right; the website moves over to make room | Side-by-side checking |
| **Floating** | A movable window over the website | Moving the phone anywhere on screen |

Switch with the pop-out / dock button in the panel toolbar (next to ✕), or with **Layout** in the
popup. Switching doesn't reload the preview.

**Docked:** drag the panel's left edge to make it wider or narrower (280 px up to 70% of the window).
Double-click the edge to reset it.

**Floating:**
- **Move:** drag an empty part of the toolbar.
- **Resize:** drag the left, right or bottom edge, or a bottom corner.
- **Minimize** (—) shrinks it to just the toolbar. **Maximize** (□) fills the window. Double-click the
  toolbar to maximize or restore.
- Position and size are remembered.

## 4. Toolbar controls

| Control | What it does |
| --- | --- |
| Device menu | iPhone 15 Pro / Pro Max / 14 / 14 Pro / 13 mini / SE, Galaxy S24 / S23 Ultra / S20 / Z Fold, Pixel 8 / 7, iPad Mini / Air / Pro, Custom |
| Width × Height | Type a size to make a custom device |
| Rotate | Portrait ↔ landscape (393 × 852 → 852 × 393) |
| ◀ ▶ ⟳ | Back, forward and reload, for the preview only |
| Link icon (Follow) | When on, the preview opens the same page you open on the desktop |
| Arrows icon (Sync) | When on, scrolling the desktop scrolls the preview to the same spot. Turn on **Two-way** in the popup to make it work the other way too |
| Zoom | Fit, 50%, 75%, 100%, 125% or Custom. Changes only how big the phone looks, never the size the website sees |
| Camera | Saves a PNG of just the phone screen to Downloads, e.g. `devicepeek-iphone-15-pro-example-com.png` |
| Address bar (bottom left) | Shows the preview's URL. Type a URL or `/path` and press Enter to open it in the preview |
| Size text (bottom right) | Click to show the viewport readout (see section 5) |

## 5. Is the size exact?

Yes. The size you pick is the website's real viewport. For iPhone 15 Pro, the website sees exactly
`innerWidth` 393 and `innerHeight` 852. The toolbar and borders are not counted.

- **Fit** makes the phone smaller on your screen so all of it is visible. The website still lays
  out at 393 px.
- **100%** means 1 website pixel = 1 screen pixel. A tall phone can then be taller than the
  panel, so you scroll the panel to see the bottom. That's expected.

Click the size text at the bottom right to see the **readout**:

```
Configured     393 × 852
innerWidth     393
innerHeight    852
OK – viewport matches the device
```

If it ever turns yellow and says **MISMATCH**, take a screenshot and report it.

## 6. The popup

Click the DevicePeek icon to open it. It opens the preview right away (you can turn that off with
"Open preview when I click the icon"). It also has the device menu, Rotate, Layout
(Docked / Floating), Follow current page, Sync scroll and Two-way.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Popup says **"Unavailable"** with a Chrome-pages message | Chrome doesn't allow extensions on `chrome://` pages, the New Tab page or the Chrome Web Store. Open a normal website. |
| Popup says **"background service isn't running"** or **"Receiving end does not exist"** | Open `chrome://extensions` and click the reload arrow on DevicePeek. If that doesn't help, click **Remove**, then **Load unpacked** again. |
| Shortcut shows **"Not set"** | In the popup, click **Change** and set Alt+Shift+M for "Show / hide the DevicePeek preview". Another extension may already use that key. |
| Preview shows **"This website prevents embedded previews"** | Click **Retry**, then **Compatibility mode**. If it still doesn't load, use **Open device window**. |
| Logged out inside the preview in Compatibility mode | Expected for some sites in that mode. Use the normal mode or Open device window. |
| Panel doesn't appear on a tab that was open before installing | Reload that tab. |
| Local `file://` page doesn't work | `chrome://extensions` → DevicePeek → **Details** → turn on **Allow access to file URLs**. |
| A desktop page's layout looks squeezed in Docked mode | The page gets less width, but its CSS breakpoints still use the full window width. Use Floating mode to see the desktop at full width. |
| Red **Errors** button on the extension card | Click it, copy the message and the file name, and report it. |

## Good to know

- Requests from frames in the tab get a phone User-Agent, so server-side mobile detection works.
  Video embeds on the desktop page also get it while the preview is open.
- Clicking links inside the preview doesn't mess up the tab's Back button.
- Always do a final check on a real phone. Touch gestures, hover and real performance can differ.
