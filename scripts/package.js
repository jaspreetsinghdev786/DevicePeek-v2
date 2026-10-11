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

const isWin = process.platform === 'win32';
const has = (cmd) => {
  try {
    execFileSync(isWin ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
};

if (!isWin && has('zip')) {
  // Linux/macOS. (GNU tar's -a can't write zip files: it would write a tar named .zip.)
  execFileSync('zip', ['-r', '-X', '-q', out, 'devicepeek', '-x', '*.DS_Store'], { cwd: root, stdio: 'inherit' });
} else {
  // Windows 10+ and macOS ship bsdtar, where -a picks the zip format from the extension.
  execFileSync('tar', ['-a', '-c', '-f', out, '--exclude=.DS_Store', 'devicepeek'], { cwd: root, stdio: 'inherit' });
}

const magic = fs.readFileSync(out).subarray(0, 2).toString('latin1');
if (magic !== 'PK') {
  fs.rmSync(out, { force: true });
  console.error('The archive is not a zip file. Install "zip" (Linux) and run npm run package again.');
  process.exit(1);
}
console.log(`Created ${path.relative(root, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
