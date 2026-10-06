# DevicePeek

A Chrome extension for checking websites on phones and tablets while you work. The desktop site
stays on the left, and a real mobile viewport sits next to it, docked or as a floating window.

Current version: **2.2.0** (Manifest V3) · see [CHANGELOG.md](CHANGELOG.md)

## Start here

| I want to… | Read |
| --- | --- |
| Install it and use it every day | [docs/USER-GUIDE.md](docs/USER-GUIDE.md) |
| Fix a problem | [docs/USER-GUIDE.md → Troubleshooting](docs/USER-GUIDE.md#troubleshooting) |
| Change the code, run tests, make a release | [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md) |
| Ask an AI assistant to change the extension | [docs/AI-PROMPT.md](docs/AI-PROMPT.md) |

## Install (one time)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this folder:
   ```
   C:\Users\Jaspreet Singh\Downloads\DevicePeek\devicepeek
   ```
3. Pin DevicePeek from the puzzle-piece menu.

Then open any website and click the DevicePeek icon, or press **Alt+Shift+M**.

> Chrome loads the extension from that folder. Don't move, rename or delete it. If you do,
> load it again from the new place.

## Project layout

```
DevicePeek/
├── devicepeek/          The extension. This is the folder Chrome loads.
│   ├── manifest.json
│   ├── background.js    Service worker
│   ├── content.js       Page bootstrap
│   ├── content.css      Panel styles
│   ├── content/         Panel, preview, docking, sync, screenshot modules
│   ├── lib/             Shared helpers (devices, settings, URLs)
│   ├── popup.*          Toolbar popup
│   └── icons/
├── docs/
│   ├── USER-GUIDE.md        How to use it, troubleshooting
│   ├── DEVELOPER-GUIDE.md   Architecture, testing, releases
│   └── AI-PROMPT.md         Ready-to-paste prompt for AI coding tools
├── tests/               Automated browser tests (Playwright)
├── scripts/             check.js (static checks), package.js (zip build)
├── CHANGELOG.md
└── package.json         Developer tooling only (the extension has no dependencies)
```

## Developer commands

Requires Node.js 18+. Run `npm run setup` once.

| Command | What it does |
| --- | --- |
| `npm run check` | Syntax, manifest and file-reference checks (no browser needed) |
| `npm test` | Checks plus the end-to-end browser test (~2 min) |
| `npm run test:viewport` | 700+ viewport-size checks across devices, zooms and layouts (~4 min) |
| `npm run package` | Builds `dist/DevicePeek-<version>.zip` |
