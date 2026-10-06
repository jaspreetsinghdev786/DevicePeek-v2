// Builds dist/DevicePeek-<version>.zip containing the devicepeek/ folder (ready to unzip and
// "Load unpacked", or to upload to the Chrome Web Store).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'devicepeek', 'manifest.json'), 'utf8'));
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const out = path.join(dist, `DevicePeek-${version}.zip`);
fs.rmSync(out, { force: true });

// tar ships with Windows 10+ and macOS; -a picks the zip format from the extension.
execFileSync('tar', ['-a', '-c', '-f', out, '--exclude=.DS_Store', 'devicepeek'], { cwd: root, stdio: 'inherit' });
console.log(`Created ${path.relative(root, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
